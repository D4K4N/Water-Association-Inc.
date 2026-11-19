"""
Model 1: Brand-Independent Water Meter & Odometer Window Detector (YOLOv8n -> ONNX)
Classes: 0=meter_body, 1=odometer_window, 2=red_liter_zone

Usage:
  python train_detector.py --data dataset/detector/data.yaml --epochs 80 --imgsz 640
"""
import argparse
import shutil
from pathlib import Path
from ultralytics import YOLO


def main():
    parser = argparse.ArgumentParser(description="Train Dicklum Water Meter Detector (Model 1) and export to ONNX")
    parser.add_argument("--data", type=str, default="dataset/detector/data.yaml")
    parser.add_argument("--weights", type=str, default="yolov8n.pt")
    parser.add_argument("--epochs", type=int, default=80)
    parser.add_argument("--imgsz", type=int, default=640)
    parser.add_argument("--batch", type=int, default=16)
    parser.add_argument("--export-dir", type=str, default="../ai-scanner/vendor/models")
    args = parser.parse_args()

    data_path = Path(args.data)
    if not data_path.exists():
        raise FileNotFoundError(f"Dataset config not found: {data_path}. See dataset/README.md first.")

    model = YOLO(args.weights)
    model.train(
        data=str(data_path),
        epochs=args.epochs,
        imgsz=args.imgsz,
        batch=args.batch,
        patience=20,
        # Realistic field augmentations (no vertical flips since meters are upright)
        degrees=12.0,
        translate=0.1,
        scale=0.35,
        perspective=0.0005,
        hsv_h=0.015,
        hsv_s=0.5,
        hsv_v=0.4,
        flipud=0.0,
        fliplr=0.0,
        mosaic=0.5,
        project="runs/detector",
        name="dicklum_meter_v1",
        exist_ok=True,
    )

    best_pt = Path("runs/detector/dicklum_meter_v1/weights/best.pt")
    best_model = YOLO(str(best_pt))
    onnx_path = Path(best_model.export(format="onnx", imgsz=args.imgsz, opset=17, simplify=True, dynamic=False))

    out_dir = Path(args.export_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    dest = out_dir / "meter_window_det.onnx"
    shutil.copy2(onnx_path, dest)
    print(f"[OK] Exported Model 1 ONNX detector to: {dest.resolve()}")


if __name__ == "__main__":
    main()
