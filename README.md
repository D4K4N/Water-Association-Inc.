# Dicklum Water Association, Inc. - Mobile Water Billing & Field Operations System

A mobile-first Progressive Web Application (PWA) engineered specifically for water meter readers and field operations personnel of **Dicklum Water Association, Inc.** (Dicklum, Manolo Fortich, Bukidnon, Philippines).

---

## 1. Executive Overview

This application streamlines water utility fieldwork by combining high-precision GPS mapping, water meter reading calculations, instant portable Bluetooth thermal receipt printing, official A4 billing statements, and IndexedDB offline persistence into a unified, smartphone-optimized interface.

### Key Operational Capabilities
- **Dual Operational Modes**:
  - **Mapping Mode**: Record and visualize consumer household locations, standalone water meters, and manifold clusters on satellite imagery or offline vector maps.
  - **Reading Mode**: Guide daily field routes, record meter readings, automatically calculate water consumption and billing amounts, and generate field receipts.
- **Separate Household and Meter Geolocation**:
  - Distinguish between consumer residence coordinates (`householdLat`, `householdLng`) and water meter installation coordinates (`meterLat`, `meterLng`).
  - Support clustered water meter manifolds (groupings of 2 to 6 meters installed on a single pipe manifold along road rights-of-way).
- **Automated Billing Engine**:
  - Immediate consumption calculation: $\text{Current Reading} - \text{Previous Reading}$.
  - Dicklum Water Association tariff: PHP 100.00 minimum monthly charge for water consumption up to 10 m³.
  - Strict enforcement: No invented excess rate; prompts administrator configuration if consumption exceeds 10 m³.
  - Historical bill immutability via permanent tariff snapshots.
- **Field Printing & Hardware Integration**:
  - Direct Web Bluetooth API driver for ESC/POS portable thermal receipt printers (58mm and 80mm roll support).
  - Print receipt action is strictly isolated from payment collection—printing does not mark a bill as paid.
  - Complete A4 Statement of Account with official association insignia and cashier collection stub.
- **100% Offline Resilience**:
  - Client-side IndexedDB persistence (`DicklumWaterDB`).
  - Full JSON backup export and validated restore.
  - Progressive Web Application (PWA) manifest and service worker caching for field areas without cellular coverage.

---

## 2. Directory Architecture

```
dicklum-water-billing/
├── index.html                   # Mobile-first viewport, modals, and screen sections
├── manifest.webmanifest         # PWA installation manifest for Android/iOS
├── sw.js                        # Service worker with offline asset caching
├── server.js                    # Built-in zero-dependency HTTP server
├── package.json                 # Project scripts and configuration
├── README.md                    # System documentation and operational manual
├── assets/
│   └── logo.svg                 # Dicklum Water Association vector insignia
├── css/
│   ├── styles.css               # Human-designed utility UI, pine forest palette (#1B4332)
│   ├── print-thermal.css        # ESC/POS 58mm/80mm continuous roll print styling
│   └── print-a4.css             # Official A4 Billing Statement print layout
└── js/
    ├── icons.js                 # Handcrafted vector SVG icon library (zero emojis)
    ├── db.js                    # IndexedDB v2 data persistence layer
    ├── sampleData.js            # Initial realistic data for Dicklum, Manolo Fortich
    ├── mapEngine.js             # Canvas slippy map engine (ESRI, OSM, Hybrid, GPS, Routes)
    ├── reading.js               # Water reading entry, live calculation, photo watermark
    ├── billing.js               # Tariff calculation engine, bill creation, payment recording
    ├── thermalPrinter.js        # Bluetooth thermal printer driver & ESC/POS generator
    ├── a4Statement.js           # Official A4 Statement of Account generator
    ├── reports.js               # Monthly Billing Summary & Consumer Directory generator
    ├── backup.js                # Database export, JSON schema validator, and restore engine
    └── app.js                   # Main application state coordinator & event router
```

---

## 3. Installation and Execution

### Method 1: Local HTTP Server (Recommended)
From the project directory, execute the Node.js server:
```powershell
node server.js
```
Open a browser and navigate to:
```
http://localhost:3000
```

### Method 2: Android PWA Installation
1. Host the project directory on your local network or web host with HTTPS.
2. On the Android field smartphone (Chrome browser), navigate to the application URL.
3. Tap the browser menu (three dots) and select **"Add to Home screen"** or **"Install App"**.
4. The application installs as a standalone Android utility app with fullscreen capability and full offline functionality.

### Method 3: Direct Browser File Access
Open `index.html` directly in any modern desktop browser (Chrome, Edge, Firefox, Safari):
```
file:///C:/Users/mrama/.gemini/antigravity/scratch/dicklum-water-billing/index.html
```

---

## 4. Operational Workflow Guide

### Step 1: Selecting Operational Mode
- Open the application on the mobile device.
- From the **Home** screen, choose either:
  - **Mapping Mode**: Used when establishing coordinates for new consumers, auditing meter locations, or recording field walking routes.
  - **Reading Mode**: Used during monthly reading rounds to record meter numbers and issue receipts.

### Step 2: Live GPS Tracking & Pin Dropping
- Navigate to the **Map** tab.
- Tap **Live GPS** to center on your current position. The green accuracy circle displays the GPS reading confidence.
- To record a new location:
  1. Pan the map crosshair to the target point, or walk to the exact site.
  2. Tap the floating **+** (Add Pin) button.
  3. Select **Consumer Household** or **Water Meter**.
  4. Fill in consumer information or link the meter to an existing consumer account.
  5. Tap **Save Pin**.

### Step 3: Recording Walking Routes
- Tap the **Record Walking Route** icon (blue circle with play arrow) on the map.
- The top banner turns active and displays real-time tracked waypoints and total distance in meters.
- As the meter reader walks the service route, waypoints are periodically plotted.
- Tap **Stop & Save** to persist the route into IndexedDB with an assigned route name and zone.

### Step 4: Meter Reading & Calculation
- In the **Map** tab, tap any meter or household pin, then tap **Record Meter Reading**; alternatively, navigate to the **Readings** tab.
- The previous reading is automatically loaded (e.g., `1,954 m³`).
- Enter the current reading (e.g., `1,957 m³`).
- The system automatically computes:
  $$\text{Consumption} = 1,957 - 1,954 = 3\text{ m}^3$$
  $$\text{Total Due} = \text{PHP } 100.00\text{ (Minimum charge covers up to }10\text{ m}^3\text{)}$$
- If the current reading is lower than the previous reading, an error banner appears. If a meter was physically replaced, enable the **Meter Replacement / Rollover Override** checkbox.
- Optional: Tap the camera card to capture a field photo of the meter dial. The image is watermarked with GPS coordinates, timestamp, and meter serial.
- Tap **Save Reading to Database** or **Save & Print Thermal Receipt**.

### Step 5: Thermal Receipt & A4 Printing
- **Bluetooth Thermal Printer**:
  1. Power on the portable thermal printer (e.g., PT-210 or GOOJPRT).
  2. Navigate to **Records / Settings** -> **Portable Bluetooth Thermal Printer**.
  3. Tap **Connect Bluetooth Printer** and pair with the device.
  4. Select **58mm** or **80mm** roll width.
  5. Tap **Test Ticket** to verify paper alignment and font rendering.
  6. Subsequent prints from the Reading or Bills tab will send raw ESC/POS commands directly to the paired printer.
- **A4 Statement of Account**:
  - In the **Bills** tab, tap **A4 Statement** on any bill card to preview the full document with tear-off cashier slip, then tap **Print / Save as PDF**.

### Step 6: Recording Official Collections
- In the **Bills** tab, unpaid statements display an **Unpaid** status badge.
- When cash is collected, tap **Record Payment**.
- Enter the Amount Paid, Official Receipt (OR) Number, and Collector Name.
- Tap **Record Payment**. The status updates to **Paid** or **Partial**, and the receipt reference is logged.

### Step 7: Generating Executive Reports
- Navigate to **Records / Settings**.
- Tap **Generate Monthly Billing Summary** for financial KPIs, total billed volume, collection rate, and zone breakdowns.
- Tap **Generate Consumer & Meter Directory** for complete consumer rosters and meter status.
- Tap **Print / Save Report (PDF)** to print or archive.

---

## 5. Tariff Configuration and Safeguards

The Dicklum Water Association tariff engine implements strict financial rules:
1. **Minimum Allowance**: $10\text{ m}^3$ included with the minimum monthly charge of PHP 100.00.
2. **Excess Rate Safeguard**: When consumption exceeds $10\text{ m}^3$ and the excess rate is not yet officially established in Settings, the billing engine will **not** guess or default to zero. Instead, it prevents saving the bill, displays an explicit notification banner, and directs the user to enter the approved excess rate under Settings.
3. **Historical Bill Protection**: When saving a bill, the tariff rules active at that moment are permanently embedded into the bill record (`tariffSnapshot`). Subsequent tariff modifications will never alter previously finalized historical bills.

---

## 6. Offline Data Safety & Disaster Recovery

All operations are executed locally using the device's IndexedDB storage.
- **JSON Backup Export**: Creates a structured, timestamped JSON export containing all consumers, meters, clusters, readings, bills, routes, and settings.
- **Validated Restore**: Performs schema verification, duplicate prevention, and displays a pre-import summary dialog before applying changes to the database.
- **Reset to Sample Data**: Restores realistic Dicklum test data at any time for demonstration or training.
