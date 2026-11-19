# Dicklum Water Meter Dataset & Annotation Guide

## 1. Physical-Meter-Unit Split Rule (Strict — Zero Data Leakage)
- Assign every physical water meter a unique `meter_unit_id` (e.g., `M001`, `M002`, ...).
- Split strictly by `meter_unit_id`:
  - **70% `train/`**
  - **15% `val/`**
  - **15% `test/`** (completely unseen physical meters — never used during training or tuning)
- Do **not** put frames from the same physical meter into both `train` and `test`.
- Do **not** fabricate ground-truth readings or replace real meter photos with synthetic images.

## 2. Recommended Minimum Real Dataset
- **Positive Water Meter Photos**: 300–600 real smartphone photos across all Dicklum brands (Itron, Linflow, Sensus 620, polarity-split, monochrome), varied distances, angles (`±15°`), shade/glare, wet/scratched glass, and half-rolled drums.
- **Hard Negative Photos (Mandatory for Rejection Tests)**: 100–150 photos of:
  - Paper with printed numbers
  - Phone/computer screens showing numbers
  - Walls, signs, and house numbers
  - Soil, grass, hands, and empty meter boxes
  - Label hard negatives with an **empty `.txt` file** (zero objects).

## 3. Model 1 (Detector) Folder Structure (`dataset/detector/`)
```text
dataset/detector/
├── data.yaml
├── images/
│   ├── train/
│   ├── val/
│   └── test/
└── labels/
    ├── train/   # YOLO format: <class_id> <xc> <yc> <w> <h> (normalized 0..1)
    ├── val/
    └── test/
```
Classes (`data.yaml`):
- `0`: `meter_body`
- `1`: `odometer_window` (whole m³ black/white digit display)
- `2`: `red_liter_zone` (red fractional liter digits, excluded from whole m³ billing)

## 4. Model 2 (CRNN Sequence Recognizer) Folder Structure (`dataset/crnn/`)
```text
dataset/crnn/
├── crops/
│   ├── train/
│   ├── val/
│   └── test/
├── labels_train.csv
├── labels_val.csv
└── labels_test.csv
```
CSV columns:
```csv
filename,reading,meter_unit_id,status
m001_01.jpg,01386,M001,CLEAR
m002_01.jpg,2549,M002,CLEAR
m003_01.jpg,09702,M003,CLEAR
m004_01.jpg,?,M004,HALF_ROLLED
m005_01.jpg,,M005,UNREADABLE
```
- Use `?` for any partially rotated / half-rolled digit position so the CRNN learns to flag uncertainty instead of guessing.
