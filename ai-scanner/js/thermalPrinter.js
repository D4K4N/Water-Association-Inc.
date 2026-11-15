/**
 * Dicklum Water Association - Xprinter XP-P300 Thermal Printer Driver
 *
 * Designated Hardware Specification:
 * - Manufacturer: Xprinter
 * - Model: XP-P300
 * - Technology: Direct Thermal (No ink, no cartridges, no ribbons)
 * - Command Language: ESC/POS
 * - Resolution: 203 DPI (8 dots/mm)
 * - Max Speed: 70 mm/s
 * - Connectivity: Bluetooth (BLE / GATT) & USB (WebUSB / Direct System USB)
 * - Standard Paper Spec: 57.5 ± 0.5 mm width, 50 mm max roll diameter, 48 mm printable width (384 dots / 32 cols), 0.06–0.08 mm thickness
 * - Configurable Widths: 58mm (48mm printable, default), 80mm (72mm printable, if verified on hardware), or custom printable width (32–72mm)
 * - Mandatory Chemical Compliance: 100% PHENOL-FREE thermal paper (Free of BPA, BPS, and all bisphenol/phenolic developers)
 */

const XPRINTER_XP_P300_SPEC = {
  manufacturer: 'Xprinter',
  model: 'XP-P300',
  category: 'Portable thermal receipt printer',
  technology: 'Direct thermal',
  commandLanguage: 'ESC/POS',
  dpi: 203,
  dotsPerMm: 8,
  maxSpeedMmPerSec: 70,
  connectivity: ['Bluetooth', 'USB'],
  paperSpecs: {
    '58mm': {
      label: '57.5 ± 0.5 mm (Standard XP-P300)',
      paperWidthMm: 57.5,
      printableWidthMm: 48,
      printableDots: 384,
      columnsFontA: 32,
      columnsFontB: 42,
      maxRollDiameterMm: 50,
      thicknessMm: '0.06–0.08 mm'
    },
    '80mm': {
      label: '79.5 ± 0.5 mm (80mm — Verify Hardware First)',
      paperWidthMm: 79.5,
      printableWidthMm: 72,
      printableDots: 576,
      columnsFontA: 48,
      columnsFontB: 64,
      maxRollDiameterMm: 50,
      thicknessMm: '0.06–0.08 mm'
    }
  },
  chemicalRequirement: {
    mandatory: '100% PHENOL-FREE',
    prohibited: [
      'BPA (Bisphenol A)',
      'BPS (Bisphenol S)',
      'Other bisphenol-based developers',
      'Other phenolic-based developers'
    ],
    notice: 'BPA-free alone is NOT sufficient. Suppliers must provide manufacturer documentation confirming the absence of phenolic developers.'
  }
};

class ThermalPrinterDriver {
  constructor() {
    this.spec = XPRINTER_XP_P300_SPEC;

    // Connection state
    this.connectionType = null; // 'bluetooth' | 'usb' | 'simulated' | null
    this.device = null;
    this.server = null;
    this.characteristic = null;
    this.usbDevice = null;
    this.usbInterfaceNumber = null;
    this.usbEndpointOut = null;
    this.isConnected = false;
    this.isSimulated = false;
    this.deviceName = '';

    // Configurable Paper & Formatting Settings (Persisted in localStorage)
    this.paperWidth = '58mm'; // '58mm' (57.5mm standard), '80mm' (79.5mm if verified), or 'custom'
    this.printableWidthMm = 48; // 48mm standard for XP-P300 (384 dots @ 203 DPI)
    this.hasAutoCutter = false; // XP-P300 uses a manual tear bar by default; do not assume auto-cutter
    this.printLogo = false;
    this.printQrCode = true;
    this.printBarcode = true;
    this.customHeader = 'OFFICIAL WATER BILL NOTICE';
    this.customFooter = 'Conserve water for the community.';
    this.phenolFreeVerified = true;

    this.statusListeners = [];
    this._loadSavedConfig();
  }

  _loadSavedConfig() {
    try {
      if (typeof localStorage === 'undefined') return;
      const raw = localStorage.getItem('dicklum_xprinter_config_v1');
      if (!raw) return;
      const cfg = JSON.parse(raw);
      if (cfg.paperWidth) this.paperWidth = cfg.paperWidth;
      if (cfg.printableWidthMm) this.printableWidthMm = Number(cfg.printableWidthMm) || 48;
      if (typeof cfg.hasAutoCutter === 'boolean') this.hasAutoCutter = cfg.hasAutoCutter;
      if (typeof cfg.printLogo === 'boolean') this.printLogo = cfg.printLogo;
      if (typeof cfg.printQrCode === 'boolean') this.printQrCode = cfg.printQrCode;
      if (typeof cfg.printBarcode === 'boolean') this.printBarcode = cfg.printBarcode;
      if (typeof cfg.customHeader === 'string') this.customHeader = cfg.customHeader;
      if (typeof cfg.customFooter === 'string') this.customFooter = cfg.customFooter;
      if (typeof cfg.phenolFreeVerified === 'boolean') this.phenolFreeVerified = cfg.phenolFreeVerified;
    } catch (e) {
      console.warn('Could not load saved Xprinter config:', e);
    }
  }

  saveConfig(updates = {}) {
    if (updates.paperWidth !== undefined) {
      this.setPaperWidth(updates.paperWidth, updates.printableWidthMm);
    } else if (updates.printableWidthMm !== undefined) {
      this.printableWidthMm = Math.min(72, Math.max(32, Number(updates.printableWidthMm) || 48));
    }
    if (updates.hasAutoCutter !== undefined) this.hasAutoCutter = Boolean(updates.hasAutoCutter);
    if (updates.printLogo !== undefined) this.printLogo = Boolean(updates.printLogo);
    if (updates.printQrCode !== undefined) this.printQrCode = Boolean(updates.printQrCode);
    if (updates.printBarcode !== undefined) this.printBarcode = Boolean(updates.printBarcode);
    if (updates.customHeader !== undefined) this.customHeader = String(updates.customHeader).trim() || 'OFFICIAL WATER BILL NOTICE';
    if (updates.customFooter !== undefined) this.customFooter = String(updates.customFooter).trim() || 'Conserve water for the community.';
    if (updates.phenolFreeVerified !== undefined) this.phenolFreeVerified = Boolean(updates.phenolFreeVerified);

    try {
      localStorage.setItem('dicklum_xprinter_config_v1', JSON.stringify({
        paperWidth: this.paperWidth,
        printableWidthMm: this.printableWidthMm,
        hasAutoCutter: this.hasAutoCutter,
        printLogo: this.printLogo,
        printQrCode: this.printQrCode,
        printBarcode: this.printBarcode,
        customHeader: this.customHeader,
        customFooter: this.customFooter,
        phenolFreeVerified: this.phenolFreeVerified
      }));
    } catch (e) {
      console.warn('Could not persist Xprinter config:', e);
    }
  }

  onStatusChange(cb) {
    this.statusListeners.push(cb);
  }

  notifyStatus(status, details = '') {
    this.statusListeners.forEach(cb => cb(status, details, this.getStatusSummary()));
  }

  getStatusSummary() {
    return {
      isConnected: this.isConnected,
      isSimulated: this.isSimulated,
      connectionType: this.connectionType,
      deviceName: this.deviceName || (this.device && this.device.name) || 'Xprinter XP-P300',
      paperWidth: this.paperWidth,
      printableWidthMm: this.printableWidthMm,
      lineWidthChars: this.getLineCharacterWidth(),
      printableDots: this.getPrintableWidthDots(),
      hasAutoCutter: this.hasAutoCutter
    };
  }

  /**
   * Sets paper width mode ('58mm' -> 48mm printable, '80mm' -> 72mm printable, or 'custom')
   */
  setPaperWidth(widthMode, customPrintableMm = null) {
    if (widthMode === '80mm') {
      this.paperWidth = '80mm';
      this.printableWidthMm = customPrintableMm ? Number(customPrintableMm) : 72;
    } else if (widthMode === 'custom') {
      this.paperWidth = 'custom';
      this.printableWidthMm = Math.min(72, Math.max(32, Number(customPrintableMm) || 48));
    } else {
      this.paperWidth = '58mm';
      this.printableWidthMm = customPrintableMm ? Number(customPrintableMm) : 48;
    }
  }

  /**
   * Calculates exact character columns for 203 DPI Font A (12x24 dots = 1.5mm per character)
   * - 48mm printable width (58mm roll) => 32 characters
   * - 72mm printable width (80mm roll) => 48 characters
   */
  getLineCharacterWidth() {
    const mm = Number(this.printableWidthMm) || (this.paperWidth === '80mm' ? 72 : 48);
    return Math.max(20, Math.min(48, Math.floor((mm * 8) / 12)));
  }

  getPrintableWidthDots() {
    const mm = Number(this.printableWidthMm) || (this.paperWidth === '80mm' ? 72 : 48);
    return Math.floor(mm * 8); // 203 DPI = 8 dots/mm
  }

  // ─── 1. BLUETOOTH & USB CONNECTION MANAGEMENT ──────────────────────────────

  /**
   * Connect to Xprinter XP-P300 via Bluetooth (Web Bluetooth API)
   */
  async connectBluetooth() {
    if (!navigator.bluetooth) {
      const msg = 'Web Bluetooth is not supported in this browser. Use Chrome or Edge on Android/Desktop, or connect via USB.';
      this.notifyStatus('error', msg);
      return { success: false, error: msg };
    }

    try {
      this.notifyStatus('connecting', 'Scanning for Xprinter XP-P300 Bluetooth printer...');

      this.device = await navigator.bluetooth.requestDevice({
        acceptAllDevices: true,
        optionalServices: [
          '000018f0-0000-1000-8000-00805f9b34fb', // Standard POS & Xprinter XP-P300 BLE Service
          '0000ff00-0000-1000-8000-00805f9b34fb', // Xprinter BLE UART Service
          '49535343-fe7d-4ae5-8fa9-9fafd205e455', // Microchip ISSC BLE UART (Xprinter dual-mode)
          'e7810a06-73ae-499d-8c15-faa9aef0c3f2', // POS BLE Printer Service
          '0000fee7-0000-1000-8000-00805f9b34fb', // Xprinter secondary BLE service
          '0000ffe0-0000-1000-8000-00805f9b34fb'  // Serial BLE Printer Service
        ]
      });

      this.device.addEventListener('gattserverdisconnected', () => {
        this.isConnected = false;
        this.notifyStatus('disconnected', `Xprinter (${this.deviceName || 'Bluetooth'}) disconnected. Tap Reconnect to resume.`);
      });

      return await this._connectBluetoothGatt();
    } catch (err) {
      console.warn('Bluetooth connection failed:', err);
      const friendly = this._formatConnectionError('Bluetooth', err);
      this.isConnected = false;
      this.notifyStatus('error', friendly);
      return { success: false, error: friendly };
    }
  }

  async _connectBluetoothGatt() {
    if (!this.device) {
      return { success: false, error: 'No Bluetooth printer selected yet.' };
    }

    this.server = await this.device.gatt.connect();
    this.characteristic = null;

    const services = await this.server.getPrimaryServices();
    for (const service of services) {
      const characteristics = await service.getCharacteristics();
      for (const char of characteristics) {
        if (char.properties.write || char.properties.writeWithoutResponse) {
          this.characteristic = char;
          break;
        }
      }
      if (this.characteristic) break;
    }

    if (!this.characteristic) {
      throw new Error('Connected to Bluetooth device, but no writable ESC/POS print channel was found.');
    }

    this.connectionType = 'bluetooth';
    this.isConnected = true;
    this.isSimulated = false;
    this.deviceName = this.device.name || 'Xprinter XP-P300 (BT)';
    this.notifyStatus('connected', `Connected via Bluetooth: ${this.deviceName} (${this.printableWidthMm}mm printable)`);
    return { success: true, mode: 'bluetooth', deviceName: this.deviceName };
  }

  /**
   * Connect to Xprinter XP-P300 via USB Cable (WebUSB API)
   */
  async connectUsb() {
    if (!navigator.usb) {
      const msg = 'WebUSB is not supported in this browser. Use Chrome or Edge over HTTPS/localhost, or use Direct Browser Print for USB printers.';
      this.notifyStatus('error', msg);
      return { success: false, error: msg };
    }

    try {
      this.notifyStatus('connecting', 'Select Xprinter XP-P300 USB device from the prompt...');

      // Common Xprinter USB Vendor IDs (0x0483 STMicro, 0x0416 Winbond, 0x1FC9 NXP, 0x0471, 0x6868, or USB Printer Class 0x07)
      this.usbDevice = await navigator.usb.requestDevice({
        filters: [
          { classCode: 7 }, // Standard USB Printer Class
          { vendorId: 0x0483 },
          { vendorId: 0x0416 },
          { vendorId: 0x1FC9 },
          { vendorId: 0x6868 },
          { vendorId: 0x0471 }
        ]
      });

      return await this._openUsbDevice();
    } catch (err) {
      console.warn('USB connection failed:', err);
      const friendly = this._formatConnectionError('USB', err);
      this.isConnected = false;
      this.notifyStatus('error', friendly);
      return { success: false, error: friendly };
    }
  }

  async _openUsbDevice() {
    if (!this.usbDevice) {
      return { success: false, error: 'No USB printer selected yet.' };
    }

    await this.usbDevice.open();
    if (this.usbDevice.configuration === null) {
      await this.usbDevice.selectConfiguration(1);
    }

    this.usbInterfaceNumber = null;
    this.usbEndpointOut = null;

    const interfaces = this.usbDevice.configuration.interfaces || [];
    for (const iface of interfaces) {
      for (const alt of iface.alternates) {
        const outEp = (alt.endpoints || []).find(ep => ep.direction === 'out' && ep.type === 'bulk');
        if (outEp) {
          this.usbInterfaceNumber = iface.interfaceNumber;
          this.usbEndpointOut = outEp.endpointNumber;
          break;
        }
      }
      if (this.usbEndpointOut !== null) break;
    }

    if (this.usbInterfaceNumber === null || this.usbEndpointOut === null) {
      throw new Error('USB device opened, but no bulk OUT endpoint was found for ESC/POS printing.');
    }

    await this.usbDevice.claimInterface(this.usbInterfaceNumber);

    this.connectionType = 'usb';
    this.isConnected = true;
    this.isSimulated = false;
    this.deviceName = this.usbDevice.productName || 'Xprinter XP-P300 (USB)';
    this.notifyStatus('connected', `Connected via USB: ${this.deviceName} (${this.printableWidthMm}mm printable)`);
    return { success: true, mode: 'usb', deviceName: this.deviceName };
  }

  /**
   * Default connect alias (Bluetooth primary)
   */
  async connect() {
    return this.connectBluetooth();
  }

  /**
   * Reconnects to the previously paired Bluetooth or USB Xprinter XP-P300 without re-prompting if possible
   */
  async reconnect() {
    try {
      this.notifyStatus('connecting', 'Reconnecting to Xprinter XP-P300...');
      if (this.connectionType === 'usb' && this.usbDevice) {
        return await this._openUsbDevice();
      }
      if (this.device) {
        return await this._connectBluetoothGatt();
      }
      return await this.connectBluetooth();
    } catch (err) {
      const friendly = this._formatConnectionError(this.connectionType === 'usb' ? 'USB' : 'Bluetooth', err);
      this.notifyStatus('error', friendly);
      return { success: false, error: friendly };
    }
  }

  async disconnect() {
    try {
      if (this.device && this.device.gatt && this.device.gatt.connected) {
        this.device.gatt.disconnect();
      }
      if (this.usbDevice && this.usbDevice.opened) {
        await this.usbDevice.close();
      }
    } catch (e) {
      console.warn('Error during printer disconnect:', e);
    }
    this.isConnected = false;
    this.notifyStatus('disconnected', 'Xprinter XP-P300 disconnected.');
  }

  _formatConnectionError(channel, err) {
    const raw = (err && err.message) ? err.message : String(err || 'Unknown error');
    if (/User cancelled|Chooser|permission/i.test(raw)) {
      return `${channel} pairing cancelled. Turn on the Xprinter XP-P300 and select it from the list.`;
    }
    if (/GATT Server is disconnected|NetworkError/i.test(raw)) {
      return `Cannot reach Xprinter XP-P300 over ${channel}. Make sure the printer is powered ON, within range, and not connected to another phone.`;
    }
    if (/Access denied|claimInterface/i.test(raw)) {
      return `USB access blocked by OS driver. On Windows, use Bluetooth or click "Browser Print" to print through the installed Xprinter USB driver.`;
    }
    return `${channel} Printer Error: ${raw}`;
  }

  // ─── 2. ESC/POS BINARY COMMAND SYNTHESIS (203 DPI, TEXT, QR, BARCODE, IMAGE) ─

  /**
   * Sends raw ESC/POS bytes over the active Bluetooth or USB connection
   */
  async _sendRawBytes(data) {
    if (!this.isConnected) {
      throw new Error('Xprinter XP-P300 is not connected. Connect via Bluetooth or USB first, or use Browser Print.');
    }

    if (this.connectionType === 'usb' && this.usbDevice && this.usbEndpointOut !== null) {
      const chunkSize = 4096;
      for (let i = 0; i < data.length; i += chunkSize) {
        const chunk = data.slice(i, i + chunkSize);
        await this.usbDevice.transferOut(this.usbEndpointOut, chunk);
      }
      return;
    }

    if (this.connectionType === 'bluetooth' && this.characteristic) {
      const chunkSize = 100;
      const canWriteNoResp = Boolean(this.characteristic.properties && this.characteristic.properties.writeWithoutResponse);
      for (let i = 0; i < data.length; i += chunkSize) {
        const chunk = data.slice(i, i + chunkSize);
        if (canWriteNoResp && typeof this.characteristic.writeValueWithoutResponse === 'function') {
          await this.characteristic.writeValueWithoutResponse(chunk);
        } else {
          await this.characteristic.writeValue(chunk);
        }
        if (i + chunkSize < data.length) {
          await new Promise(resolve => setTimeout(resolve, 15));
        }
      }
      return;
    }

    throw new Error('No active Bluetooth or USB write channel available.');
  }

  /**
   * Builds native ESC/POS QR Code command bytes (GS ( k — Function 165, 167, 169, 180, 181)
   */
  _buildEscPosQrCodeBytes(qrText, moduleSize = 4) {
    const encoder = new TextEncoder();
    const payload = encoder.encode(String(qrText || ''));
    const storeLen = payload.length + 3;
    const pL = storeLen & 0xFF;
    const pH = (storeLen >> 8) & 0xFF;

    const chunks = [
      // Select QR model 2: GS ( k 04 00 31 41 32 00
      new Uint8Array([0x1D, 0x28, 0x6B, 0x04, 0x00, 0x31, 0x41, 0x32, 0x00]),
      // Set module size (dots): GS ( k 03 00 31 43 n
      new Uint8Array([0x1D, 0x28, 0x6B, 0x03, 0x00, 0x31, 0x43, Math.min(8, Math.max(3, moduleSize))]),
      // Set error correction level M (49): GS ( k 03 00 31 45 31
      new Uint8Array([0x1D, 0x28, 0x6B, 0x03, 0x00, 0x31, 0x45, 0x31]),
      // Store QR data in symbol storage: GS ( k pL pH 31 50 30 d1...dk
      new Uint8Array([0x1D, 0x28, 0x6B, pL, pH, 0x31, 0x50, 0x30]),
      payload,
      // Print QR symbol: GS ( k 03 00 31 51 30
      new Uint8Array([0x1D, 0x28, 0x6B, 0x03, 0x00, 0x31, 0x51, 0x30])
    ];

    return this._concatByteArrays(chunks);
  }

  /**
   * Builds native ESC/POS 1D Barcode (CODE128 / CODE39) command bytes
   */
  _buildEscPosBarcodeBytes(codeText) {
    const clean = String(codeText || '').replace(/[^A-Z0-9-]/gi, '').toUpperCase().slice(0, 18);
    if (!clean) return new Uint8Array(0);

    const encoder = new TextEncoder();
    // Use CODE128 subset B ({B prefix = 0x7B, 0x42)
    const dataBytes = encoder.encode(`{B${clean}`);

    return this._concatByteArrays([
      new Uint8Array([0x1D, 0x48, 0x02]), // GS H 2: Print HRI characters below barcode
      new Uint8Array([0x1D, 0x66, 0x01]), // GS f 1: Font B for HRI
      new Uint8Array([0x1D, 0x77, 0x02]), // GS w 2: Barcode module width = 2
      new Uint8Array([0x1D, 0x68, 0x34]), // GS h 52: Barcode height = 52 dots
      new Uint8Array([0x1D, 0x6B, 0x49, dataBytes.length]), // GS k 73 n: CODE128
      dataBytes,
      new Uint8Array([0x0A])
    ]);
  }

  /**
   * Converts an HTMLImageElement or Canvas into ESC/POS raster bit image bytes (GS v 0)
   * Constrained to the printer's printable width (e.g. 384 dots max, logo scaled to 160px)
   */
  async buildRasterLogoBytes(imgUrl = 'assets/logo.png', maxWidthDots = 160) {
    return new Promise((resolve) => {
      try {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => {
          const width = Math.min(maxWidthDots, this.getPrintableWidthDots());
          const byteWidth = Math.ceil(width / 8);
          const alignedWidth = byteWidth * 8;
          const scale = alignedWidth / (img.width || alignedWidth);
          const height = Math.min(120, Math.max(24, Math.round((img.height || alignedWidth) * scale)));

          const canvas = document.createElement('canvas');
          canvas.width = alignedWidth;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          ctx.fillStyle = '#FFFFFF';
          ctx.fillRect(0, 0, alignedWidth, height);
          ctx.drawImage(img, 0, 0, alignedWidth, height);

          const imgData = ctx.getImageData(0, 0, alignedWidth, height).data;
          const raster = new Uint8Array(byteWidth * height);

          for (let y = 0; y < height; y++) {
            for (let xByte = 0; xByte < byteWidth; xByte++) {
              let byteVal = 0;
              for (let bit = 0; bit < 8; bit++) {
                const x = xByte * 8 + bit;
                const idx = (y * alignedWidth + x) * 4;
                const r = imgData[idx];
                const g = imgData[idx + 1];
                const b = imgData[idx + 2];
                const a = imgData[idx + 3];
                const lum = a < 128 ? 255 : (0.299 * r + 0.587 * g + 0.114 * b);
                if (lum < 145) {
                  byteVal |= (1 << (7 - bit));
                }
              }
              raster[y * byteWidth + xByte] = byteVal;
            }
          }

          const xL = byteWidth & 0xFF;
          const xH = (byteWidth >> 8) & 0xFF;
          const yL = height & 0xFF;
          const yH = (height >> 8) & 0xFF;

          resolve(this._concatByteArrays([
            new Uint8Array([0x1B, 0x61, 0x01]), // Center align
            new Uint8Array([0x1D, 0x76, 0x30, 0x00, xL, xH, yL, yH]),
            raster,
            new Uint8Array([0x0A])
          ]));
        };
        img.onerror = () => resolve(new Uint8Array(0));
        img.src = imgUrl;
      } catch (_) {
        resolve(new Uint8Array(0));
      }
    });
  }

  _concatByteArrays(parts) {
    const totalLen = parts.reduce((acc, p) => acc + p.length, 0);
    const result = new Uint8Array(totalLen);
    let offset = 0;
    for (const p of parts) {
      result.set(p, offset);
      offset += p.length;
    }
    return result;
  }

  /**
   * Generates ESC/POS byte commands for a water bill formatted to the verified printable paper width
   */
  async generateEscPosCommands(bill, consumer, meter, settings) {
    const lineWidth = this.getLineCharacterWidth();
    const divider = '-'.repeat(lineWidth);
    const doubleDivider = '='.repeat(lineWidth);

    const encoder = new TextEncoder();
    const parts = [];

    const appendBytes = (bytes) => parts.push(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes));
    const appendText = (text = '') => parts.push(encoder.encode(String(text) + '\n'));

    const formatRow = (left, right) => {
      const l = String(left || '');
      const r = String(right || '');
      const maxLeft = Math.max(8, lineWidth - r.length - 1);
      const clippedLeft = l.length > maxLeft ? l.slice(0, maxLeft) : l;
      const spaces = Math.max(1, lineWidth - clippedLeft.length - r.length);
      return clippedLeft + ' '.repeat(spaces) + r;
    };

    const formatTable3Col = (desc, qty, price) => {
      const qStr = String(qty || '');
      const pStr = String(price || '');
      const rightPart = `${qStr.padStart(5, ' ')} ${pStr.padStart(10, ' ')}`;
      const maxDesc = Math.max(8, lineWidth - rightPart.length - 1);
      const dStr = String(desc || '').slice(0, maxDesc).padEnd(maxDesc, ' ');
      return `${dStr} ${rightPart}`;
    };

    const cName = (consumer && consumer.name) || bill.consumerName || 'Consumer';
    const cAcct = (consumer && consumer.accountNo) || bill.accountNo || 'N/A';
    const cAddress = (consumer && consumer.address) || bill.address || `${(consumer && consumer.zone) || bill.zone || 'Zone 1'}, Dicklum`;
    const classification = (consumer && consumer.classification) || bill.classification || 'Residential';
    const mNo = (meter && meter.meterNo && meter.meterNo !== 'Unassigned') ? meter.meterNo : (bill.meterNo || 'N/A');

    const prevRdg = Number(bill.previousReading || 0);
    const currRdg = Number(bill.currentReading || 0);
    const consRdg = Number(bill.consumption || 0);

    let currentBill = Number(bill.currentBill !== undefined ? bill.currentBill : (bill.totalAmountDue ?? 0));
    if (consRdg <= 0) {
      currentBill = 0.00;
    }
    let arrears = Number(bill.arrears || 0);
    if (consRdg <= 0) {
      arrears = 0.00;
    }
    const totalDue = currentBill + arrears;
    const paidAmt = Number(bill.amountPaid || 0);
    const isPaid = bill.paymentStatus === 'PAID';
    const orNo = bill.orNumber || bill.officialReceiptNo || '';

    // Date formatting helpers
    const formatDateLong = (val) => {
      if (!val) return '';
      const d = new Date(val);
      if (isNaN(d.getTime())) return String(val);
      return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
    };

    const formatPeriodLong = (val) => {
      if (!val) return 'October 2026';
      if (val.includes(' ')) return val;
      const parts = String(val).split('-');
      if (parts.length === 2) {
        const y = parseInt(parts[0], 10);
        const m = parseInt(parts[1], 10) - 1;
        const d = new Date(y, m, 1);
        if (!isNaN(d.getTime())) {
          return d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
        }
      }
      return val;
    };

    const periodStr = formatPeriodLong(bill.billingPeriod);
    const dueDateStr = formatDateLong(bill.dueDate || new Date(Date.now() + 15 * 86400000));
    const discDateStr = formatDateLong(bill.disconnectionDate || (bill.dueDate ? new Date(new Date(bill.dueDate).getTime() + 2 * 86400000) : new Date(Date.now() + 17 * 86400000)));

    // 1. Initialize printer & set standard line spacing
    appendBytes([0x1B, 0x40]);       // ESC @: Initialize
    appendBytes([0x1B, 0x33, 0x1E]); // ESC 3 30: Set line spacing

    // 2. Optional Raster Business Logo
    if (this.printLogo) {
      const logoBytes = await this.buildRasterLogoBytes('assets/logo.png', 144);
      if (logoBytes.length > 0) {
        appendBytes(logoBytes);
      }
    }

    // 3. Header (Matching Original Paper Notice)
    appendBytes([0x1B, 0x61, 0x01]); // Center
    appendBytes([0x1B, 0x45, 0x01]); // Bold ON
    appendText('Dicklum Water Association, Inc.');
    appendBytes([0x1B, 0x45, 0x00]); // Bold OFF
    appendText('Dicklum, Manolo Fortich, Bukidnon');
    appendText(`Statement of Account for the month of ${periodStr}`);
    appendText(divider);

    // 4. Account Details (Matching Original Paper)
    appendBytes([0x1B, 0x61, 0x00]); // Left
    appendText(formatRow('Account Name:', cName));
    appendText(formatRow('Account No.:', cAcct));
    appendText(formatRow('Address:', cAddress));
    appendText(formatRow('Classification:', classification));
    appendText(formatRow('Meter No.:', mNo));
    appendText(divider);

    // 5. Meter Readings & Usage (Matching Original Paper)
    appendText(formatRow('Previous Reading:', prevRdg.toLocaleString()));
    appendText(formatRow('Current Reading:', currRdg.toLocaleString()));
    appendBytes([0x1B, 0x45, 0x01]);
    appendText(formatRow('Usage:', `${consRdg.toLocaleString()} cubic meters`));
    appendBytes([0x1B, 0x45, 0x00]);
    appendText(divider);

    // 6. Charges & Totals (Matching Original Paper)
    appendText(formatRow('Current Bill:', `PHP ${currentBill.toFixed(2)}`));
    appendText(formatRow('Arrears:', `PHP ${arrears.toFixed(2)}`));
    appendText(doubleDivider);

    // Grand Total (Centered Bold Double-Height)
    appendBytes([0x1B, 0x61, 0x01]); // Center
    appendBytes([0x1B, 0x45, 0x01]); // Bold ON
    appendBytes([0x1D, 0x21, 0x01]); // Double height
    appendText(`TOTAL DUE: PHP ${totalDue.toFixed(2)}`);
    appendBytes([0x1D, 0x21, 0x00]); // Normal size
    appendBytes([0x1B, 0x45, 0x00]); // Bold OFF
    appendText(doubleDivider);

    // 7. Important Deadlines
    appendBytes([0x1B, 0x61, 0x00]); // Left
    appendText(formatRow('Due Date:', dueDateStr));
    appendText(formatRow('Disconnection Date:', discDateStr));
    appendText(divider);

    // Payment Status if settled
    if (isPaid || paidAmt > 0) {
      appendBytes([0x1B, 0x61, 0x01]);
      appendText(`PAID: PHP ${paidAmt.toFixed(2)} ${orNo ? `| OR#: ${orNo}` : ''}`);
      appendText(divider);
      appendBytes([0x1B, 0x61, 0x00]);
    }

    // 8. Official Reminders from Dicklum Paper Notice
    appendBytes([0x1B, 0x45, 0x01]);
    appendText('Reminders:');
    appendBytes([0x1B, 0x45, 0x00]);
    appendText('1. Disregard this notice if payment has been made.');
    appendText('2. This serves as Notice of Disconnection.');
    appendText('3. Please pay on time. Reconnection fee is Php 500.');
    appendText('4. Pay bills directly to the cashier.');
    appendText('5. Kindly report leaks or acts of vandalism on our pipeline.');

    // 9. Optional 1D Barcode (Transaction Reference for Cashier Scan)
    if (this.printBarcode && bill.id) {
      appendBytes([0x1B, 0x61, 0x01]); // Center
      appendBytes(this._buildEscPosBarcodeBytes(bill.id));
      appendText(bill.id);
    }

    // 10. Optional QR Code (Verification Payload)
    if (this.printQrCode) {
      appendBytes([0x1B, 0x61, 0x01]); // Center
      const qrPayload = `DWA|${bill.id}|${cAcct}|${cName}|${consRdg}m3|PHP${totalDue.toFixed(2)}|${bill.dueDate || ''}`;
      appendBytes(this._buildEscPosQrCodeBytes(qrPayload, 4));
      appendText('');
    }

    // 11. Footer
    appendBytes([0x1B, 0x61, 0x01]); // Center
    appendText('[Printed on 100% Phenol-Free Thermal Paper]');

    // 12. Paper Feed (ESC d 4 — feeds 4 lines past the manual tear bar)
    appendBytes([0x1B, 0x64, 0x04]);

    // 14. Receipt Cut ONLY if user explicitly enabled automatic cutter
    if (this.hasAutoCutter) {
      appendBytes([0x1D, 0x56, 0x42, 0x00]);
    }

    return this._concatByteArrays(parts);
  }

  /**
   * Prints the water bill to the Xprinter XP-P300
   */
  async printBill(bill, consumer, meter, settings) {
    try {
      this.notifyStatus('printing', `Printing bill ${bill.id} on Xprinter XP-P300 (${this.printableWidthMm}mm)...`);

      if (this.isConnected && !this.isSimulated) {
        const data = await this.generateEscPosCommands(bill, consumer, meter, settings);
        await this._sendRawBytes(data);
      } else {
        throw new Error('Xprinter XP-P300 is not connected via Bluetooth or USB.');
      }

      bill.printCount = (bill.printCount || 0) + 1;
      bill.lastPrintedDate = new Date().toISOString();
      await window.db.put('bills', bill);

      this.notifyStatus('connected', `Printed ${bill.id} on Xprinter XP-P300.`);
      return { success: true };
    } catch (err) {
      console.error('Print failure:', err);
      this.notifyStatus('error', `Print failed: ${err.message}`);
      return { success: false, error: err.message };
    }
  }

  /**
   * Feeds paper by N lines (ESC d n) so the user can advance the roll cleanly past the tear bar
   */
  async feedPaper(lines = 3) {
    const n = Math.min(12, Math.max(1, Number(lines) || 3));
    try {
      if (!this.isConnected || this.isSimulated) {
        this.notifyStatus('error', 'Connect the Xprinter XP-P300 via Bluetooth or USB first to feed paper.');
        return { success: false, error: 'Printer not connected.' };
      }
      await this._sendRawBytes(new Uint8Array([0x1B, 0x40, 0x1B, 0x64, n]));
      this.notifyStatus('connected', `Fed ${n} lines of paper.`);
      return { success: true };
    } catch (err) {
      this.notifyStatus('error', `Paper feed failed: ${err.message}`);
      return { success: false, error: err.message };
    }
  }

  /**
   * Prints a Ruler & Alignment Test Ticket to physically verify whether the XP-P300 roll is 58mm (32 cols) or 80mm (48 cols)
   */
  async printTestTicket() {
    const lineWidth = this.getLineCharacterWidth();
    const divider = '='.repeat(lineWidth);
    const singleDivider = '-'.repeat(lineWidth);
    // Ruler string: 12345678901234567890123456789012...
    let ruler = '';
    for (let i = 1; i <= lineWidth; i++) {
      ruler += String(i % 10);
    }

    const encoder = new TextEncoder();
    const parts = [
      new Uint8Array([0x1B, 0x40]),       // Initialize
      new Uint8Array([0x1B, 0x61, 0x01]), // Center
      new Uint8Array([0x1B, 0x45, 0x01]), // Bold ON
      encoder.encode('XPRINTER XP-P300 TEST TICKET\n'),
      new Uint8Array([0x1B, 0x45, 0x00]), // Bold OFF
      encoder.encode('DICKLUM WATER ASSOCIATION\n'),
      encoder.encode(divider + '\n'),
      new Uint8Array([0x1B, 0x61, 0x00]), // Left
      encoder.encode(`Model       : Xprinter XP-P300\n`),
      encoder.encode(`Resolution  : 203 DPI (70 mm/s)\n`),
      encoder.encode(`Paper Mode  : ${this.paperWidth}\n`),
      encoder.encode(`Print Width : ${this.printableWidthMm} mm (${lineWidth} chars)\n`),
      encoder.encode(`Paper Spec  : 100% PHENOL-FREE\n`),
      encoder.encode(`              (BPA-Free & BPS-Free)\n`),
      encoder.encode(`Date/Time   : ${new Date().toLocaleString()}\n`),
      encoder.encode(singleDivider + '\n'),
      encoder.encode(`WIDTH RULER (${lineWidth} COLUMNS):\n`),
      encoder.encode(ruler + '\n'),
      encoder.encode(singleDivider + '\n')
    ];

    if (this.printQrCode) {
      parts.push(new Uint8Array([0x1B, 0x61, 0x01]));
      parts.push(this._buildEscPosQrCodeBytes('XPRINTER-XP-P300-OK', 4));
      parts.push(encoder.encode('\n'));
    }

    parts.push(new Uint8Array([0x1B, 0x61, 0x01]));
    parts.push(encoder.encode('Direct Thermal Head: OK\n'));
    parts.push(encoder.encode(divider + '\n'));
    parts.push(new Uint8Array([0x1B, 0x64, 0x04])); // Feed 4 lines

    if (this.hasAutoCutter) {
      parts.push(new Uint8Array([0x1D, 0x56, 0x42, 0x00]));
    }

    try {
      if (!this.isConnected || this.isSimulated) {
        this.notifyStatus('error', 'Connect Xprinter XP-P300 via Bluetooth or USB first to print a test ticket.');
        return { success: false, error: 'Printer not connected.' };
      }
      await this._sendRawBytes(this._concatByteArrays(parts));
      this.notifyStatus('connected', 'Xprinter XP-P300 test ticket printed.');
      return { success: true };
    } catch (err) {
      this.notifyStatus('error', `Test print failed: ${err.message}`);
      return { success: false, error: err.message };
    }
  }

  async printRawText(text) {
    if (!this.isConnected || this.isSimulated) {
      return { success: false, error: 'Printer not connected.' };
    }
    const encoder = new TextEncoder();
    const bytes = this._concatByteArrays([
      new Uint8Array([0x1B, 0x40]),
      encoder.encode(String(text) + '\n'),
      new Uint8Array([0x1B, 0x64, 0x04])
    ]);
    await this._sendRawBytes(bytes);
    this.notifyStatus('connected', 'Printed raw text.');
    return { success: true };
  }
}

if (typeof window !== 'undefined') {
  window.thermalPrinter = new ThermalPrinterDriver();
}
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { ThermalPrinterDriver, XPRINTER_XP_P300_SPEC };
}
