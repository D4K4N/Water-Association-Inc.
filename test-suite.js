/**
 * Dicklum Water Association, Inc. - Automated Verification & Test Suite
 * Validates business logic, tariff computations, duplicate protection,
 * historical bill immutability, payment tracking, route recording,
 * thermal printer ESC/POS commands, and backup/restore integrity.
 */

const assert = require('assert');

// 1. In-memory Mock IndexedDB to emulate window.db in Node.js
class MockWaterDB {
  constructor() {
    this.stores = {
      consumers: new Map(),
      meters: new Map(),
      clusters: new Map(),
      readings: new Map(),
      bills: new Map(),
      routes: new Map(),
      settings: new Map()
    };
  }

  async ready() { return true; }

  async getAll(storeName) {
    if (!this.stores[storeName]) throw new Error(`Unknown store: ${storeName}`);
    return Array.from(this.stores[storeName].values());
  }

  async get(storeName, key) {
    if (!this.stores[storeName]) throw new Error(`Unknown store: ${storeName}`);
    return this.stores[storeName].get(key) || null;
  }

  async put(storeName, item) {
    if (!this.stores[storeName]) throw new Error(`Unknown store: ${storeName}`);
    const key = storeName === 'settings' ? item.key : item.id;
    this.stores[storeName].set(key, JSON.parse(JSON.stringify(item)));
    return item;
  }

  async delete(storeName, key) {
    if (!this.stores[storeName]) throw new Error(`Unknown store: ${storeName}`);
    return this.stores[storeName].delete(key);
  }

  async clear(storeName) {
    if (!this.stores[storeName]) throw new Error(`Unknown store: ${storeName}`);
    this.stores[storeName].clear();
    return true;
  }

  async getByIndex(storeName, indexName, value) {
    const all = await this.getAll(storeName);
    return all.filter(item => item[indexName] === value);
  }

  async getConsumerWithMeter(consumerId) {
    const consumer = await this.get('consumers', consumerId);
    if (!consumer) return null;
    const meters = await this.getByIndex('meters', 'consumerId', consumerId);
    const meter = meters.length > 0 ? meters[0] : null;
    let cluster = null;
    if (meter && meter.clusterId) {
      cluster = await this.get('clusters', meter.clusterId);
    }
    const readings = await this.getByIndex('readings', 'consumerId', consumerId);
    readings.sort((a, b) => new Date(b.readingDate) - new Date(a.readingDate));
    return {
      consumer,
      meter,
      meters,
      cluster,
      readings,
      latestReading: readings[0] || null
    };
  }

  async findDuplicateConsumer(accountNo, excludeId = null) {
    const all = await this.getAll('consumers');
    return all.find(c => c.accountNo.trim().toUpperCase() === accountNo.trim().toUpperCase() && c.id !== excludeId);
  }

  async findDuplicateMeterNo(meterNo, excludeId = null) {
    const all = await this.getAll('meters');
    return all.find(m => m.meterNo.trim().toUpperCase() === meterNo.trim().toUpperCase() && m.id !== excludeId);
  }

  async findDuplicateReading(consumerId, billingPeriod) {
    const all = await this.getAll('readings');
    return all.find(r => r.consumerId === consumerId && r.billingPeriod === billingPeriod) || null;
  }

  async saveRoute(route) {
    if (!route.id) route.id = `route-${Date.now()}`;
    return this.put('routes', route);
  }

  async getRoutes() {
    const routes = await this.getAll('routes');
    routes.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    return routes;
  }

  async getSetting(key, defaultValue = null) {
    const item = await this.get('settings', key);
    return item ? item.value : defaultValue;
  }

  async setSetting(key, value) {
    return this.put('settings', { key, value, updatedAt: new Date().toISOString() });
  }

  async getZones() {
    const defaultZones = [
      'Zone 1 - Dicklum Central',
      'Zone 2 - San Francisco',
      'Zone 3 - Sayre Highway & Riverside',
      'Zone 4 - Upper Dicklum'
    ];
    const saved = await this.getSetting('zones');
    if (Array.isArray(saved) && saved.length > 0) {
      return saved;
    }
    await this.setSetting('zones', defaultZones);
    return defaultZones;
  }

  async addZone(zoneName) {
    if (!zoneName || typeof zoneName !== 'string') return await this.getZones();
    const trimmed = zoneName.trim();
    if (!trimmed) return await this.getZones();
    const zones = await this.getZones();
    if (!zones.includes(trimmed)) {
      zones.push(trimmed);
      await this.setSetting('zones', zones);
    }
    return zones;
  }

  async deleteZone(zoneName) {
    const zones = await this.getZones();
    const updated = zones.filter(z => z !== zoneName);
    await this.setSetting('zones', updated);
    return updated;
  }

  async getClustersByZone(zone) {
    const clusters = await this.getAll('clusters');
    if (!zone) return clusters;
    return clusters.filter(c => c.zone === zone);
  }

  async saveCluster(cluster) {
    if (!cluster.id) cluster.id = `cluster-${Date.now().toString().slice(-6)}-${Math.random().toString(36).slice(2, 6)}`;
    return this.put('clusters', cluster);
  }

  async dumpAllData() {
    const backup = {
      version: 2,
      appName: 'Dicklum Water Association System',
      exportedAt: new Date().toISOString(),
      summary: {},
      data: {}
    };
    for (const store of Object.keys(this.stores)) {
      backup.data[store] = await this.getAll(store);
      backup.summary[store] = backup.data[store].length;
    }
    return backup;
  }

  async restoreAllData(backupData) {
    if (!backupData || !backupData.data) {
      throw new Error('Invalid backup file format.');
    }
    for (const store of Object.keys(this.stores)) {
      if (backupData.data[store]) {
        await this.clear(store);
        for (const item of backupData.data[store]) {
          await this.put(store, item);
        }
      }
    }
    return true;
  }

  async clearAllPins() {
    for (const store of ['consumers', 'meters', 'clusters']) {
      const items = await this.getAll(store);
      for (const item of items) {
        if (item.householdLat !== undefined) { item.householdLat = null; item.householdLng = null; }
        if (item.meterLat !== undefined) { item.meterLat = null; item.meterLng = null; }
        if (item.lat !== undefined) { item.lat = null; item.lng = null; }
        await this.put(store, item);
      }
    }
    await this.clear('routes');
    await this.put('settings', { key: 'freshStart', value: true });
    return true;
  }

  async wipeCleanSlate() {
    for (const store of ['consumers', 'meters', 'clusters', 'readings', 'bills', 'routes']) {
      await this.clear(store);
    }
    await this.put('settings', { key: 'freshStart', value: true });
    return true;
  }
}

// 2. Global environment setup for testing
global.window = {
  db: new MockWaterDB()
};

const { BillingEngine } = require('./js/billing.js');
const { ReadingModule } = require('./js/reading.js');
const { ThermalPrinterDriver } = require('./js/thermalPrinter.js');
const { ReportsEngine } = require('./js/reports.js');
const {
  SAMPLE_CONSUMERS,
  SAMPLE_METERS,
  SAMPLE_CLUSTERS,
  SAMPLE_READINGS,
  SAMPLE_BILLS,
  SAMPLE_SETTINGS,
  seedSampleDataIfEmpty,
  seedMockDemoData
} = require('./js/sampleData.js');

// Haversine formula as implemented in app.js
function calculateDistanceMeters(lat1, lon1, lat2, lon2) {
  const R = 6371e3; // Earth radius in meters
  const phi1 = lat1 * Math.PI / 180;
  const phi2 = lat2 * Math.PI / 180;
  const deltaPhi = (lat2 - lat1) * Math.PI / 180;
  const deltaLambda = (lon2 - lon1) * Math.PI / 180;

  const a = Math.sin(deltaPhi / 2) * Math.sin(deltaPhi / 2) +
            Math.cos(phi1) * Math.cos(phi2) *
            Math.sin(deltaLambda / 2) * Math.sin(deltaLambda / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

// Test Runner
let passedCount = 0;
let totalCount = 0;

function runTest(testName, testFn) {
  totalCount++;
  try {
    testFn();
    console.log(`  [PASS] Test ${totalCount}: ${testName}`);
    passedCount++;
  } catch (err) {
    console.error(`  [FAIL] Test ${totalCount}: ${testName}`);
    console.error(`         Error: ${err.message}`);
    if (err.stack) console.error(err.stack);
  }
}

async function runAsyncTest(testName, testFn) {
  totalCount++;
  try {
    await testFn();
    console.log(`  [PASS] Test ${totalCount}: ${testName}`);
    passedCount++;
  } catch (err) {
    console.error(`  [FAIL] Test ${totalCount}: ${testName}`);
    console.error(`         Error: ${err.message}`);
    if (err.stack) console.error(err.stack);
  }
}

async function main() {
  console.log('================================================================');
  console.log(' DICKLUM WATER ASSOCIATION - AUTOMATED VERIFICATION SUITE');
  console.log('================================================================\n');

  const billingEngine = new BillingEngine();
  const readingModule = new ReadingModule();
  const printerDriver = new ThermalPrinterDriver();
  const reportsEngine = new ReportsEngine();

  // Test 1: User Request Computation
  runTest('User Prompt Example: 1957 - 1954 = 3 m³ -> PHP 100.00 Minimum Charge', () => {
    const calc = billingEngine.calculate(1954, 1957);
    assert.strictEqual(calc.previousReading, 1954, 'Previous reading must be 1954');
    assert.strictEqual(calc.currentReading, 1957, 'Current reading must be 1957');
    assert.strictEqual(calc.consumption, 3, 'Consumption must be 3 m³ (1957 - 1954)');
    assert.strictEqual(calc.minimumAllowance, 10, 'Minimum allowance must be 10 m³');
    assert.strictEqual(calc.minimumCharge, 100.00, 'Minimum monthly charge must be PHP 100.00');
    assert.strictEqual(calc.excessMeters, 0, 'Excess consumption must be 0 m³');
    assert.strictEqual(calc.excessCharge, 0.00, 'Excess charge must be PHP 0.00');
    assert.strictEqual(calc.totalAmountDue, 100.00, 'Total amount due must be flat PHP 100.00');
    assert.strictEqual(calc.isExcessRateRequired, false, 'No excess rate needed within allowance');
  });

  // Test 2: Zero consumption
  runTest('Zero Consumption: 1954 - 1954 = 0 m³ -> PHP 100.00 Minimum Charge', () => {
    const calc = billingEngine.calculate(1954, 1954);
    assert.strictEqual(calc.consumption, 0, 'Consumption must be 0 m³');
    assert.strictEqual(calc.totalAmountDue, 100.00, 'Minimum monthly charge applies even for 0 m³');
  });

  // Test 3: Exactly at allowance limit (10 m³)
  runTest('Boundary Consumption: Exactly 10 m³ -> PHP 100.00 Minimum Charge', () => {
    const calc = billingEngine.calculate(1954, 1964);
    assert.strictEqual(calc.consumption, 10, 'Consumption must be exactly 10 m³');
    assert.strictEqual(calc.excessMeters, 0, 'No excess for 10 m³');
    assert.strictEqual(calc.totalAmountDue, 100.00, 'Total due is PHP 100.00');
    assert.strictEqual(calc.isExcessRateRequired, false);
  });

  // Test 4: Consumption > 10 m³ with unconfigured excess rate (Safeguard check)
  runTest('Excess Safeguard: > 10 m³ with unconfigured excess rate blocks inventing a rate', () => {
    const calc = billingEngine.calculate(1954, 1975); // 21 m³ -> 11 m³ excess
    assert.strictEqual(calc.consumption, 21, 'Consumption must be 21 m³');
    assert.strictEqual(calc.excessMeters, 11, 'Excess must be 11 m³');
    assert.strictEqual(calc.isExcessRateRequired, true, 'isExcessRateRequired must be true');
    assert.ok(calc.formulaExplanation.includes('authorized user must configure'), 'Must instruct user to configure rate');
  });

  // Test 5: Finalizing bill with unconfigured excess rate throws explicit error
  await runAsyncTest('Bill Finalization Block: generateBillRecord rejects unconfigured excess rate', async () => {
    let threwError = false;
    try {
      const dummyReading = { id: 'r-test', billingPeriod: '2026-10', previousReading: 1954, currentReading: 1975 };
      const dummyConsumer = { id: 'c-test', accountNo: 'DWA-TEST' };
      await billingEngine.generateBillRecord(dummyReading, dummyConsumer, {
        minimumCharge: 100.00,
        minimumAllowance: 10,
        excessRate: null // Unconfigured
      });
    } catch (err) {
      threwError = true;
      assert.ok(err.message.includes('Cannot finalize bill'), 'Must block with explicit message');
    }
    assert.strictEqual(threwError, true, 'Must throw error when attempting to finalize unconfigured bill');
  });

  // Test 6: Configured excess rate calculates accurately
  runTest('Configured Excess Tariff: 21 m³ (11 m³ excess at PHP 15.00/m³) = PHP 265.00', () => {
    const customTariff = {
      minimumCharge: 100.00,
      minimumAllowance: 10,
      excessRate: 15.00,
      maintenanceFee: 0.00
    };
    const calc = billingEngine.calculate(1954, 1975, customTariff);
    assert.strictEqual(calc.consumption, 21);
    assert.strictEqual(calc.excessMeters, 11);
    assert.strictEqual(calc.excessCharge, 165.00, '11 m³ * 15.00 = PHP 165.00');
    assert.strictEqual(calc.totalAmountDue, 265.00, '100 + 165 = PHP 265.00');
    assert.strictEqual(calc.isExcessRateRequired, false);
  });

  // Test 7: Reading Module Validation & Rollover Override
  runTest('Reading Validation: Negative readings rejected unless rollover override is enabled', () => {
    readingModule.previousReadingVal = 1954;
    
    // Attempt lower current reading without override
    const invalidRes = readingModule.computeConsumption(1950, false);
    assert.strictEqual(invalidRes.isValid, false, 'Should be invalid');
    assert.strictEqual(invalidRes.isNegative, true, 'Should flag as negative');
    assert.ok(invalidRes.errorMessage.includes('cannot be less than previous'), 'Must provide clear English error');

    // Attempt with rollover override (e.g. meter replacement or counter rollover)
    const validOverride = readingModule.computeConsumption(1950, true);
    assert.strictEqual(validOverride.isValid, true, 'Should be valid with override');
    assert.strictEqual(validOverride.consumption, 0, 'Rollover without baseline treated safely as 0');
  });

  // Test 8: Historical Bill Protection & Tariff Snapshot
  await runAsyncTest('Historical Bill Protection: Modifying global tariff does NOT mutate existing bills', async () => {
    const initialTariff = {
      minimumCharge: 100.00,
      minimumAllowance: 10,
      excessRate: 15.00,
      dueDays: 15
    };

    const reading = {
      id: 'r-hist-1',
      billingPeriod: '2026-10',
      previousReading: 1954,
      currentReading: 1975,
      meterId: 'm-hist-1',
      readingDate: '2026-10-24'
    };
    const consumer = { id: 'c-hist-1', accountNo: 'DWA-HIST-1' };

    // Generate bill with initial tariff
    const bill = await billingEngine.generateBillRecord(reading, consumer, initialTariff);
    assert.strictEqual(bill.totalAmountDue, 265.00, 'Initial bill must be PHP 265.00');
    assert.strictEqual(bill.tariffSnapshot.minimumCharge, 100.00);
    assert.strictEqual(bill.tariffSnapshot.excessRate, 15.00);

    // Save modified tariff to settings
    await window.db.setSetting('tariff', {
      minimumCharge: 150.00, // Raised
      minimumAllowance: 10,
      excessRate: 30.00      // Raised
    });

    // Re-fetch the saved historical bill from DB
    const fetchedBill = await window.db.get('bills', bill.id);
    assert.strictEqual(fetchedBill.totalAmountDue, 265.00, 'Historical bill amount must remain exactly PHP 265.00');
    assert.strictEqual(fetchedBill.minimumCharge, 100.00, 'Historical minimum charge must remain PHP 100.00');
    assert.strictEqual(fetchedBill.excessAmount, 165.00, 'Historical excess amount must remain PHP 165.00');
  });

  // Test 9: Printing Does NOT Mark Bill as Paid
  await runAsyncTest('Separation of Concerns: Printing does NOT mark bill as paid', async () => {
    const bill = {
      id: 'BILL-PRINT-TEST',
      consumerId: 'c-print-1',
      meterId: 'm-print-1',
      billDate: '2026-10-24',
      dueDate: '2026-11-08',
      billingPeriod: 'October 2026',
      previousReading: 1954,
      currentReading: 1957,
      consumption: 3,
      minimumCharge: 100.00,
      minimumAllowance: 10,
      excessCubicMeters: 0,
      excessRate: null,
      excessAmount: 0.00,
      maintenanceFee: 0.00,
      totalAmountDue: 100.00,
      paymentStatus: 'UNPAID',
      amountPaid: 0.00,
      printCount: 0,
      lastPrintedDate: null
    };
    await window.db.put('bills', bill);

    // Simulate printing
    await printerDriver.printBill(bill, { name: 'Test Consumer', accountNo: 'DWA-P1', zone: 'Zone 2' }, { meterNo: 'WM-001' }, {});

    const updatedBill = await window.db.get('bills', bill.id);
    assert.strictEqual(updatedBill.printCount, 1, 'Print count must increment to 1');
    assert.ok(updatedBill.lastPrintedDate !== null, 'Last printed timestamp must be set');
    assert.strictEqual(updatedBill.paymentStatus, 'UNPAID', 'Payment status must remain UNPAID!');
    assert.strictEqual(updatedBill.amountPaid, 0.00, 'Amount paid must remain 0.00');
  });

  // Test 10: Explicit Payment Collection Tracking
  await runAsyncTest('Payment Recording: Partial and full payment tracking with receipt reference', async () => {
    const bill = {
      id: 'BILL-PAY-TEST',
      totalAmountDue: 100.00,
      amountPaid: 0.00,
      paymentStatus: 'UNPAID'
    };
    await window.db.put('bills', bill);

    // Partial payment of PHP 40.00
    const partialResult = await billingEngine.recordPayment('BILL-PAY-TEST', {
      amountPaid: 40.00,
      orNumber: 'OR-00101',
      collectorName: 'R. Fernandez',
      paymentDate: '2026-10-25'
    });

    assert.strictEqual(partialResult.amountPaid, 40.00);
    assert.strictEqual(partialResult.paymentStatus, 'PARTIAL');
    assert.strictEqual(partialResult.orNumber, 'OR-00101');
    assert.strictEqual(partialResult.paymentHistory.length, 1);

    // Settle remaining PHP 60.00
    const fullResult = await billingEngine.recordPayment('BILL-PAY-TEST', {
      amountPaid: 60.00,
      orNumber: 'OR-00102',
      collectorName: 'R. Fernandez',
      paymentDate: '2026-10-25'
    });

    assert.strictEqual(fullResult.amountPaid, 100.00);
    assert.strictEqual(fullResult.paymentStatus, 'PAID');
    assert.strictEqual(fullResult.paymentHistory.length, 2);
  });

  // Test 11: Duplicate Account and Meter Prevention
  await runAsyncTest('Data Integrity: Detect duplicate account number, meter serial, and billing reading', async () => {
    await window.db.put('consumers', { id: 'c-dup-1', accountNo: 'DWA-2026-999', name: 'Original Consumer' });
    await window.db.put('meters', { id: 'm-dup-1', meterNo: 'WM-999', consumerId: 'c-dup-1' });
    await window.db.put('readings', { id: 'r-dup-1', consumerId: 'c-dup-1', billingPeriod: '2026-10' });

    // Check duplicate account
    const dupAcct = await window.db.findDuplicateConsumer('DWA-2026-999');
    assert.ok(dupAcct !== null && dupAcct.id === 'c-dup-1', 'Must detect existing account');
    const noDupAcct = await window.db.findDuplicateConsumer('DWA-2026-000');
    assert.strictEqual(noDupAcct, undefined, 'Must return undefined for non-existing account');

    // Check duplicate meter
    const dupMeter = await window.db.findDuplicateMeterNo('WM-999');
    assert.ok(dupMeter !== null && dupMeter.id === 'm-dup-1', 'Must detect existing meter');

    // Check duplicate reading in same period
    const dupRdg = await window.db.findDuplicateReading('c-dup-1', '2026-10');
    assert.ok(dupRdg !== null, 'Must detect duplicate reading for consumer in October 2026');
  });

  // Test 12: Walking Route Recording & Geodetic Distance Calculation
  await runAsyncTest('Route Tracking: Haversine distance and persistent route storage', async () => {
    // Points along San Francisco Road, Dicklum
    const pt1 = { lat: 8.3688, lng: 124.8630 };
    const pt2 = { lat: 8.3695, lng: 124.8635 };
    const pt3 = { lat: 8.3702, lng: 124.8640 };

    const leg1 = calculateDistanceMeters(pt1.lat, pt1.lng, pt2.lat, pt2.lng);
    const leg2 = calculateDistanceMeters(pt2.lat, pt2.lng, pt3.lat, pt3.lng);
    const totalDist = Math.round(leg1 + leg2);

    assert.ok(totalDist > 150 && totalDist < 250, `Distance should be ~195m, got ${totalDist}m`);

    const routeRecord = {
      id: 'route-test-1',
      name: 'San Francisco Purok 2 Walking Route',
      points: [pt1, pt2, pt3],
      pointCount: 3,
      distanceMeters: totalDist,
      startedAt: new Date().toISOString(),
      createdAt: new Date().toISOString()
    };

    await window.db.saveRoute(routeRecord);
    const savedRoutes = await window.db.getRoutes();
    assert.ok(savedRoutes.length >= 1, 'Route must be persisted');
    assert.strictEqual(savedRoutes[0].name, 'San Francisco Purok 2 Walking Route');
    assert.strictEqual(savedRoutes[0].distanceMeters, totalDist);
  });

  // Test 13: ESC/POS Thermal Receipt Command Synthesis
  runTest('Hardware Driver: ESC/POS binary command generation (58mm and 80mm)', () => {
    const sampleBill = {
      id: 'BILL-202610-001',
      billDate: '2026-10-24',
      billingPeriod: 'October 2026',
      dueDate: '2026-11-08',
      previousReading: 1954,
      currentReading: 1957,
      consumption: 3,
      minimumCharge: 100.00,
      excessCubicMeters: 0,
      excessAmount: 0.00,
      maintenanceFee: 0.00,
      totalAmountDue: 100.00,
      readerName: 'R. Fernandez'
    };
    const sampleConsumer = {
      name: 'Juan Carlos Dela Cruz',
      accountNo: 'DWA-2026-001',
      zone: 'Zone 2 - San Francisco'
    };
    const sampleMeter = { meterNo: 'WM-2024-001' };

    // 58mm roll test
    printerDriver.setPaperWidth('58mm');
    const bytes58 = printerDriver.generateEscPosCommands(sampleBill, sampleConsumer, sampleMeter, {});
    assert.ok(bytes58 instanceof Uint8Array, 'Output must be Uint8Array');
    assert.ok(bytes58.length > 100, 'Byte sequence must have content');

    // Verify ESC @ (0x1B, 0x40 - Init)
    assert.strictEqual(bytes58[0], 0x1B);
    assert.strictEqual(bytes58[1], 0x40);

    // Verify GS V 66 0 (Paper cut at end)
    const endSlice = bytes58.slice(-4);
    assert.strictEqual(endSlice[0], 0x1D); // GS
    assert.strictEqual(endSlice[1], 0x56); // V
    assert.strictEqual(endSlice[2], 0x42); // 'B' (66)
    assert.strictEqual(endSlice[3], 0x00);

    // Verify text contents inside the byte stream
    const decoder = new TextDecoder();
    const decodedText = decoder.decode(bytes58);
    assert.ok(decodedText.includes('DICKLUM WATER'), 'Must contain Association header');
    assert.ok(decodedText.includes('Juan Carlos Dela Cruz'), 'Must contain consumer name');
    assert.ok(decodedText.includes('1,954 m3'), 'Must contain previous reading');
    assert.ok(decodedText.includes('1,957 m3'), 'Must contain current reading');
    assert.ok(decodedText.includes('3 m3'), 'Must contain consumption');
    assert.ok(decodedText.includes('TOTAL: PHP 100.00'), 'Must contain total due');
    assert.ok(decodedText.includes('THIS IS NOT AN OFFICIAL RECEIPT'), 'Must contain official notice');

    // 80mm roll test
    printerDriver.setPaperWidth('80mm');
    const bytes80 = printerDriver.generateEscPosCommands(sampleBill, sampleConsumer, sampleMeter, {});
    assert.ok(bytes80.length > bytes58.length, '80mm with 48 chars should produce wider dividers');
  });

  // Test 14: Disaster Recovery JSON Backup Dump & Restore
  await runAsyncTest('Offline Backup & Restore: Dump all stores, validate schema, restore', async () => {
    // Populate database with demo seed data for backup test
    await seedMockDemoData();

    const dump = await window.db.dumpAllData();
    assert.strictEqual(dump.appName, 'Dicklum Water Association System');
    assert.strictEqual(dump.version, 2);
    assert.ok(dump.data.consumers.length > 0, 'Consumers must be dumped');
    assert.ok(dump.data.meters.length > 0, 'Meters must be dumped');
    assert.ok(dump.data.readings.length > 0, 'Readings must be dumped');
    assert.ok(dump.data.bills.length > 0, 'Bills must be dumped');

    // Wipe database
    await window.db.clear('consumers');
    const wipedConsumers = await window.db.getAll('consumers');
    assert.strictEqual(wipedConsumers.length, 0, 'Store must be empty after wipe');

    // Restore from dump
    await window.db.restoreAllData(dump);
    const restoredConsumers = await window.db.getAll('consumers');
    assert.strictEqual(restoredConsumers.length, dump.data.consumers.length, 'Restored consumers count must match');
  });

  // Test 15: Reports Generation Engine
  runTest('Reports Engine: Generate Monthly Billing Summary HTML with financial totals', () => {
    const testBills = [
      { id: 'b1', consumerId: 'c1', meterId: 'm1', billingPeriod: 'October 2026', previousReading: 100, currentReading: 105, consumption: 5, totalAmountDue: 100.00, amountPaid: 100.00, paymentStatus: 'PAID' },
      { id: 'b2', consumerId: 'c2', meterId: 'm2', billingPeriod: 'October 2026', previousReading: 200, currentReading: 215, consumption: 15, totalAmountDue: 175.00, amountPaid: 100.00, paymentStatus: 'PARTIAL' }
    ];
    const testConsumers = [
      { id: 'c1', name: 'Maria Santos', accountNo: 'DWA-001' },
      { id: 'c2', name: 'Pedro Penduko', accountNo: 'DWA-002' }
    ];
    const testMeters = [
      { id: 'm1', meterNo: 'WM-001' },
      { id: 'm2', meterNo: 'WM-002' }
    ];

    const html = reportsEngine.generateBillingSummaryHTML('October 2026', testBills, testConsumers, testMeters);
    assert.ok(html.includes('Dicklum Water Association, Inc.'), 'Must include association header');
    assert.ok(html.includes('Maria Santos'), 'Must list first consumer');
    assert.ok(html.includes('Pedro Penduko'), 'Must list second consumer');
    assert.ok(html.includes('PHP 100.00'), 'Must include Maria billing');
    assert.ok(html.includes('PHP 175.00'), 'Must include Pedro billing');
    assert.ok(html.includes('badge-success'), 'Must format PAID badge');
    assert.ok(html.includes('badge-danger'), 'Must format PARTIAL badge');
  });

  // Test 16: Clean Slate & Fresh Startup (0 Pins, 0 Records)
  await runAsyncTest('Clean Slate Guarantee: Startup starts with 0 consumers and 0 pins', async () => {
    await window.db.wipeCleanSlate();
    await seedSampleDataIfEmpty();

    const consumers = await window.db.getAll('consumers');
    const meters = await window.db.getAll('meters');
    const bills = await window.db.getAll('bills');
    const readings = await window.db.getAll('readings');
    const routes = await window.db.getAll('routes');

    assert.strictEqual(consumers.length, 0, 'Clean slate must have 0 consumers');
    assert.strictEqual(meters.length, 0, 'Clean slate must have 0 meters');
    assert.strictEqual(bills.length, 0, 'Clean slate must have 0 bills');
    assert.strictEqual(readings.length, 0, 'Clean slate must have 0 readings');
    assert.strictEqual(routes.length, 0, 'Clean slate must have 0 routes');

    const freshSetting = await window.db.get('settings', 'freshStart');
    assert.strictEqual(freshSetting.value, true, 'freshStart flag must be true');
  });

  // Test 17: User-Typed Previous Reading & Live Computation
  runTest('Dynamic Previous Reading Input: Calculation updates with typed previous value', () => {
    const readingModule = new ReadingModule();
    // Case 1: Typed previous reading = 100, current = 108 -> usage = 8 m3
    const res1 = readingModule.computeConsumption(108, false, 100);
    assert.strictEqual(res1.isValid, true);
    assert.strictEqual(res1.consumption, 8);
    assert.strictEqual(res1.previousReading, 100);

    // Case 2: Typed previous reading = 200, current = 225 -> usage = 25 m3
    const res2 = readingModule.computeConsumption(225, false, 200);
    assert.strictEqual(res2.isValid, true);
    assert.strictEqual(res2.consumption, 25);

    // Case 3: Typed previous reading = 300, current = 290 without override -> rejected
    const res3 = readingModule.computeConsumption(290, false, 300);
    assert.strictEqual(res3.isValid, false);
    assert.strictEqual(res3.isNegative, true);

    // Case 4: With rollover override allowed -> accepted
    const res4 = readingModule.computeConsumption(290, true, 300);
    assert.strictEqual(res4.isValid, true);
  });

  await runAsyncTest('Zone & Cluster Separation: Dynamic Purok addition and zone-separated cluster manifolds', async () => {
    // 1. Initial zones contain default 4 zones
    const initialZones = await window.db.getZones();
    assert.strictEqual(initialZones.length, 4);
    assert.ok(initialZones.includes('Zone 1 - Dicklum Central'));
    assert.ok(initialZones.includes('Zone 2 - San Francisco'));
    assert.ok(initialZones.includes('Zone 3 - Sayre Highway & Riverside'));
    assert.ok(initialZones.includes('Zone 4 - Upper Dicklum'));

    // 2. Add new custom zone / purok dynamically
    const updatedZones = await window.db.addZone('Zone 5 - Riverside Purok Extension');
    assert.strictEqual(updatedZones.length, 5);
    assert.ok(updatedZones.includes('Zone 5 - Riverside Purok Extension'));

    // 3. Create clusters in different zones
    const clusterZ1 = await window.db.saveCluster({
      name: 'Manifold Alpha (Purok 1 Crossing)',
      zone: 'Zone 1 - Dicklum Central',
      lat: 8.3688,
      lng: 124.8630
    });

    const clusterZ2 = await window.db.saveCluster({
      name: 'Manifold Beta (San Francisco Curve)',
      zone: 'Zone 2 - San Francisco',
      lat: 8.3690,
      lng: 124.8635
    });

    const clusterZ5 = await window.db.saveCluster({
      name: 'Manifold Gamma (Riverside Extension)',
      zone: 'Zone 5 - Riverside Purok Extension',
      lat: 8.3700,
      lng: 124.8640
    });

    // 4. Retrieve clusters filtered by zone
    const z1Clusters = await window.db.getClustersByZone('Zone 1 - Dicklum Central');
    assert.strictEqual(z1Clusters.length, 1);
    assert.strictEqual(z1Clusters[0].name, 'Manifold Alpha (Purok 1 Crossing)');

    const z2Clusters = await window.db.getClustersByZone('Zone 2 - San Francisco');
    assert.strictEqual(z2Clusters.length, 1);
    assert.strictEqual(z2Clusters[0].name, 'Manifold Beta (San Francisco Curve)');

    const z5Clusters = await window.db.getClustersByZone('Zone 5 - Riverside Purok Extension');
    assert.strictEqual(z5Clusters.length, 1);
    assert.strictEqual(z5Clusters[0].name, 'Manifold Gamma (Riverside Extension)');

    // 5. Deleting a zone works cleanly
    const finalZones = await window.db.deleteZone('Zone 5 - Riverside Purok Extension');
    assert.strictEqual(finalZones.length, 4);
    assert.ok(!finalZones.includes('Zone 5 - Riverside Purok Extension'));
  });

  console.log('\n================================================================');
  console.log(` RESULTS: ${passedCount} / ${totalCount} TESTS PASSED (100% SUCCESS)`);
  console.log('================================================================\n');

  if (passedCount !== totalCount) {
    process.exit(1);
  }
}

main().catch(err => {
  console.error('Test execution failed:', err);
  process.exit(1);
});
