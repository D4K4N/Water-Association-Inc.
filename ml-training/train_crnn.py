"""
Model 2: Brand-Independent Mechanical Water Meter Digit Sequence Recognizer
Architecture: MobileNetV3-Small CNN feature extractor + 2-layer BiLSTM + CTC Loss
Vocabulary: 0=CTC_blank, 1..10='0'..'9', 11='?' (ambiguous / half-rolled drum)

Usage:
  python train_crnn.py --data-dir dataset/crnn --epochs 60 --batch 32
"""
import argparse
import csv
from pathlib import Path

import albumentations as A
import cv2
import numpy as np
import torch
import torch.nn as nn
from torch.utils.data import Dataset, DataLoader
from torchvision.models import mobilenet_v3_small, MobileNet_V3_Small_Weights

CHARS = "0123456789?"
CHAR_TO_IDX = {c: i + 1 for i, c in enumerate(CHARS)}  # 0 is CTC blank
IDX_TO_CHAR = {i + 1: c for i, c in enumerate(CHARS)}
NUM_CLASSES = len(CHARS) + 1


class MeterCropDataset(Dataset):
    def __init__(self, crops_dir: Path, csv_path: Path, img_h=48, img_w=192, augment=False):
        self.crops_dir = crops_dir
        self.img_h = img_h
        self.img_w = img_w
        self.samples = []
        with open(csv_path, "r", encoding="utf-8") as f:
            for row in csv.DictReader(f):
                reading = (row.get("reading") or "").strip()
                if not reading:
                    continue
                if all(ch in CHAR_TO_IDX for ch in reading):
                    self.samples.append((row["filename"], reading))

        self.aug = A.Compose([
            A.Rotate(limit=8, border_mode=cv2.BORDER_REPLICATE, p=0.5),
            A.Perspective(scale=(0.02, 0.06), p=0.4),
            A.RandomBrightnessContrast(brightness_limit=0.25, contrast_limit=0.25, p=0.6),
            A.GaussianBlur(blur_limit=(3, 5), p=0.25),
            A.ImageCompression(quality_range=(55, 95), p=0.3),
        ]) if augment else None

    def __len__(self):
        return len(self.samples)

    def __getitem__(self, idx):
        fname, reading = self.samples[idx]
        img = cv2.imread(str(self.crops_dir / fname))
        if img is None:
            raise FileNotFoundError(f"Missing crop image: {self.crops_dir / fname}")
        img = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)
        if self.aug is not None:
            img = self.aug(image=img)["image"]
        img = cv2.resize(img, (self.img_w, self.img_h), interpolation=cv2.INTER_AREA)
        tensor = torch.from_numpy(img.astype(np.float32) / 255.0).permute(2, 0, 1)
        tensor = (tensor - 0.5) / 0.5
        target = torch.tensor([CHAR_TO_IDX[c] for c in reading], dtype=torch.long)
        return tensor, target, len(reading)


def collate_fn(batch):
    imgs, targets, lengths = zip(*batch)
    return torch.stack(imgs, dim=0), torch.cat(targets), torch.tensor(lengths, dtype=torch.long)


class WaterMeterCRNN(nn.Module):
    def __init__(self, num_classes=NUM_CLASSES, hidden_size=128):
        super().__init__()
        backbone = mobilenet_v3_small(weights=MobileNet_V3_Small_Weights.DEFAULT).features
        # Preserve horizontal width while collapsing height to 1
        self.cnn = nn.Sequential(*list(backbone.children())[:9])
        self.pool_h = nn.AdaptiveAvgPool2d((1, None))
        self.rnn = nn.LSTM(
            input_size=48,
            hidden_size=hidden_size,
            num_layers=2,
            bidirectional=True,
            dropout=0.15,
            batch_first=False,
        )
        self.fc = nn.Linear(hidden_size * 2, num_classes)

    def forward(self, x):
        # x: [B, 3, 48, 192]
        feat = self.cnn(x)          # [B, 48, H', W']
        feat = self.pool_h(feat)    # [B, 48, 1, W']
        feat = feat.squeeze(2).permute(2, 0, 1)  # [W', B, 48]
        seq, _ = self.rnn(feat)     # [W', B, 2*hidden]
        logits = self.fc(seq)       # [W', B, num_classes]
        return logits


def ctc_greedy_decode(logits):
    probs = torch.softmax(logits, dim=-1)
    max_probs, indices = probs.max(dim=-1)  # [T, B]
    results = []
    T, B = indices.shape
    for b in range(B):
        chars = []
        confs = []
        prev = 0
        for t in range(T):
            idx = int(indices[t, b])
            if idx != 0 and idx != prev:
                chars.append(IDX_TO_CHAR[idx])
                confs.append(float(max_probs[t, b]))
            prev = idx
        results.append(("".join(chars), min(confs) if confs else 0.0))
    return results


def main():
    parser = argparse.ArgumentParser(description="Train Dicklum Mechanical Digit CRNN (Model 2) and export ONNX")
    parser.add_argument("--data-dir", type=str, default="dataset/crnn")
    parser.add_argument("--epochs", type=int, default=60)
    parser.add_argument("--batch", type=int, default=32)
    parser.add_argument("--lr", type=float, default=1e-3)
    parser.add_argument("--export-dir", type=str, default="../ai-scanner/vendor/models")
    args = parser.parse_args()

    data_dir = Path(args.data_dir)
    train_ds = MeterCropDataset(data_dir / "crops/train", data_dir / "labels_train.csv", augment=True)
    val_ds = MeterCropDataset(data_dir / "crops/val", data_dir / "labels_val.csv", augment=False)
    train_loader = DataLoader(train_ds, batch_size=args.batch, shuffle=True, collate_fn=collate_fn)
    val_loader = DataLoader(val_ds, batch_size=args.batch, shuffle=False, collate_fn=collate_fn)

    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    model = WaterMeterCRNN().to(device)
    criterion = nn.CTCLoss(blank=0, zero_infinity=True)
    optimizer = torch.optim.AdamW(model.parameters(), lr=args.lr, weight_decay=1e-4)

    best_exact = -1.0
    out_dir = Path(args.export_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    ckpt_path = Path("runs/crnn/best_crnn.pt")
    ckpt_path.parent.mkdir(parents=True, exist_ok=True)

    for epoch in range(1, args.epochs + 1):
        model.train()
        total_loss = 0.0
        for imgs, targets, target_lens in train_loader:
            imgs, targets = imgs.to(device), targets.to(device)
            logits = model(imgs)
            log_probs = torch.log_softmax(logits, dim=-1)
            input_lens = torch.full((imgs.size(0),), logits.size(0), dtype=torch.long)
            loss = criterion(log_probs, targets, input_lens, target_lens)
            optimizer.zero_grad()
            loss.backward()
            torch.nn.utils.clip_grad_norm_(model.parameters(), 5.0)
            optimizer.step()
            total_loss += float(loss.item())

        # Validation exact full-reading accuracy
        model.eval()
        exact_ok = 0
        total_val = 0
        with torch.no_grad():
            for imgs, targets, target_lens in val_loader:
                imgs = imgs.to(device)
                preds = ctc_greedy_decode(model(imgs))
                offset = 0
                for (pred_str, _), tlen in zip(preds, target_lens):
                    gt = "".join(IDX_TO_CHAR[int(i)] for i in targets[offset:offset + int(tlen)])
                    offset += int(tlen)
                    if pred_str == gt:
                        exact_ok += 1
                    total_val += 1

        val_acc = exact_ok / max(1, total_val)
        print(f"Epoch {epoch:02d}/{args.epochs} | loss={total_loss/max(1,len(train_loader)):.4f} | val_exact_acc={val_acc:.4f}")
        if val_acc > best_exact:
            best_exact = val_acc
            torch.save(model.state_dict(), ckpt_path)

    # Export best checkpoint to ONNX
    model.load_state_dict(torch.load(ckpt_path, map_location="cpu"))
    model.cpu().eval()
    dummy = torch.randn(1, 3, 48, 192)
    onnx_dest = out_dir / "digit_crnn.onnx"
    torch.onnx.export(
        model,
        dummy,
        str(onnx_dest),
        opset_version=17,
        input_names=["input"],
        output_names=["logits"],
        dynamic_axes={"input": {0: "batch"}, "logits": {1: "batch"}},
    )
    print(f"[OK] Exported Model 2 CRNN ONNX to: {onnx_dest.resolve()} (best val_exact_acc={best_exact:.4f})")


if __name__ == "__main__":
    main()
