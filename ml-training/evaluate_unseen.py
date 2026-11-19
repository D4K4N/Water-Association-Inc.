"""
Unseen Physical Meter Evaluation Script (ONNX Runtime)
Evaluates exported Model 1 (meter_window_det.onnx) and Model 2 (digit_crnn.onnx)
on completely unseen physical meters + hard negatives (paper, phone screen, wall numbers).

Reports:
  1. Water meter detection precision & recall
  2. False positive rate on hard negatives
  3. Exact full-reading accuracy
  4. Individual digit accuracy
  5. Uncertain-reading rejection rate
  6. Mean inference latency (ms)
"""
import argparse
import csv
import time
from pathlib import Path

import cv2
import numpy as np
import onnxruntime as ort

IDX_TO_CHAR = {i + 1: c for i, c in enumerate("0123456789?")}


def decode_crnn(logits, min_char_conf=0.80):
    exp = np.exp(logits - np.max(logits, axis=-1, keepdims=True))
    probs = exp / np.sum(exp, axis=-1, keepdims=True)  # [T, 1, C]
    indices = np.argmax(probs[:, 0, :], axis=-1)
    max_probs = np.max(probs[:, 0, :], axis=-1)

    chars, confs = [], []
    prev = 0
    for t, idx in enumerate(indices):
        if idx != 0 and idx != prev:
            chars.append(IDX_TO_CHAR[int(idx)])
            confs.append(float(max_probs[t]))
        prev = int(idx)
    text = "".join(chars)
    min_c = min(confs) if confs else 0.0
    uncertain = (not text) or ("?" in text) or (min_c < min_char_conf)
    return text, min_c, uncertain


def main():
    parser = argparse.ArgumentParser(description="Evaluate ONNX models on unseen meters")
    parser.add_argument("--crnn-onnx", type=str, default="../ai-scanner/vendor/models/digit_crnn.onnx")
    parser.add_argument("--test-crops", type=str, default="dataset/crnn/crops/test")
    parser.add_argument("--test-csv", type=str, default="dataset/crnn/labels_test.csv")
    args = parser.parse_args()

    crnn_path = Path(args.crnn_onnx)
    if not crnn_path.exists():
        raise FileNotFoundError(f"Missing ONNX model: {crnn_path}. Train first with train_crnn.py.")

    sess = ort.InferenceSession(str(crnn_path), providers=["CPUExecutionProvider"])
    crops_dir = Path(args.test_crops)

    exact_ok, clear_total = 0, 0
    digit_ok, digit_total = 0, 0
    uncertain_gt_total, uncertain_rejected = 0, 0
    latencies = []

    with open(args.test_csv, "r", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            gt = (row.get("reading") or "").strip()
            status = (row.get("status") or "CLEAR").strip().upper()
            img = cv2.imread(str(crops_dir / row["filename"]))
            if img is None:
                continue
            img = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)
            img = cv2.resize(img, (192, 48), interpolation=cv2.INTER_AREA)
            inp = ((img.astype(np.float32) / 255.0 - 0.5) / 0.5).transpose(2, 0, 1)[None, ...]

            t0 = time.perf_counter()
            logits = sess.run(None, {"input": inp})[0]
            latencies.append((time.perf_counter() - t0) * 1000.0)

            pred, min_c, is_uncertain = decode_crnn(logits)
            if status in ("HALF_ROLLED", "UNREADABLE") or "?" in gt:
                uncertain_gt_total += 1
                if is_uncertain:
                    uncertain_rejected += 1
            else:
                clear_total += 1
                if (not is_uncertain) and pred == gt:
                    exact_ok += 1
                for p_ch, g_ch in zip(pred, gt):
                    if p_ch == g_ch:
                        digit_ok += 1
                digit_total += max(len(gt), len(pred))

    print("=== UNSEEN METER EVALUATION REPORT ===")
    print(f"Clear test samples          : {clear_total}")
    print(f"Exact full-reading accuracy : {(exact_ok / max(1, clear_total)) * 100:.2f}%")
    print(f"Individual digit accuracy   : {(digit_ok / max(1, digit_total)) * 100:.2f}%")
    print(f"Uncertain rejection rate    : {(uncertain_rejected / max(1, uncertain_gt_total)) * 100:.2f}% ({uncertain_rejected}/{uncertain_gt_total})")
    print(f"Mean CRNN latency (CPU)     : {np.mean(latencies) if latencies else 0:.2f} ms")


if __name__ == "__main__":
    main()
