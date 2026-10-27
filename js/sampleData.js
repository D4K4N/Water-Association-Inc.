/**
 * Dicklum Water Association, Inc. - Realistic Initial Seed Data
 * Centers on Dicklum, Manolo Fortich, Bukidnon (approx 8.3685° N, 124.8625° E).
 * 100% English language records.
 */

const SAMPLE_ZONES = [
  'Zone 1 - Dicklum Central',
  'Zone 2 - San Francisco',
  'Zone 3 - Sayre Highway & Riverside',
  'Zone 4 - Upper Dicklum'
];

const SAMPLE_CLUSTERS = [
  {
    id: 'cluster-sf-1',
    name: 'San Francisco Road Manifold Cluster',
    zone: 'Zone 2 - San Francisco',
    lat: null,
    lng: null,
    description: 'Central distribution manifold for 3 households installed along San Francisco main road curve.',
    meterCount: 3
  },
  {
    id: 'cluster-central-1',
    name: 'Dicklum Central Purok 2 Cluster',
    zone: 'Zone 1 - Dicklum Central',
    lat: null,
    lng: null,
    description: 'Grouped meters located beside barangay secondary water line.',
    meterCount: 2
  }
];

const SAMPLE_CONSUMERS = [
  {
    id: 'c-1',
    accountNo: 'DWA-2026-001',
    name: 'Juan Carlos Dela Cruz',
    address: 'Purok 2, San Francisco, Dicklum, Manolo Fortich',
    zone: 'Zone 2 - San Francisco',
    contact: '0917-542-1982',
    status: 'Active',
    householdLat: null,
    householdLng: null,
    notes: 'Located near barangay chapel, green gate with concrete perimeter wall.',
    reminders: 'Reading window: 1st week of month. Watch out for guard dog.',
    createdAt: '2026-01-15T08:00:00Z'
  },
  {
    id: 'c-2',
    accountNo: 'DWA-2026-002',
    name: 'Mark Zuckerberg',
    address: 'San Francisco Road, Dicklum, Manolo Fortich',
    zone: 'Zone 2 - San Francisco',
    contact: '0920-987-6543',
    status: 'Active',
    householdLat: null,
    householdLng: null,
    notes: 'Yellow painted bungalow, 50m north of San Francisco curve.',
    reminders: 'Meter installed at roadside cluster manifold.',
    createdAt: '2026-01-18T09:30:00Z'
  },
  {
    id: 'c-3',
    accountNo: 'DWA-2026-003',
    name: 'Maria Clara Santos',
    address: 'San Francisco Purok 3, Dicklum',
    zone: 'Zone 2 - San Francisco',
    contact: '0918-456-7890',
    status: 'Active',
    householdLat: null,
    householdLng: null,
    notes: 'White bungalow, beside mango orchard.',
    reminders: 'Meter connected to roadside cluster manifold.',
    createdAt: '2026-02-01T10:00:00Z'
  },
  {
    id: 'c-4',
    accountNo: 'DWA-2026-004',
    name: 'Rolando Datu',
    address: 'San Francisco Crossing, Dicklum',
    zone: 'Zone 2 - San Francisco',
    contact: '0929-112-2334',
    status: 'Active',
    householdLat: null,
    householdLng: null,
    notes: 'Corner store fronting road.',
    reminders: 'Meter connected to roadside cluster manifold.',
    createdAt: '2026-02-10T11:15:00Z'
  },
  {
    id: 'c-5',
    accountNo: 'DWA-2026-005',
    name: 'Elena Bautista',
    address: 'Central Plaza, Dicklum Central',
    zone: 'Zone 1 - Dicklum Central',
    contact: '0933-445-5667',
    status: 'Active',
    householdLat: null,
    householdLng: null,
    notes: 'Two-story wooden house near Dicklum Elementary School.',
    reminders: 'Individual meter installed beside perimeter gate.',
    createdAt: '2026-02-15T14:00:00Z'
  },
  {
    id: 'c-6',
    accountNo: 'DWA-2026-006',
    name: 'Antonio Lim',
    address: 'Purok 2 Corner, Dicklum Central',
    zone: 'Zone 1 - Dicklum Central',
    contact: '0915-778-8990',
    status: 'Active',
    householdLat: null,
    householdLng: null,
    notes: 'Blue roof bungalow.',
    reminders: 'Meter grouped with neighboring meter.',
    createdAt: '2026-02-20T08:45:00Z'
  },
  {
    id: 'c-7',
    accountNo: 'DWA-2026-007',
    name: 'Grace Villanueva',
    address: 'Riverside Road, Dicklum',
    zone: 'Zone 3 - Sayre Highway & Riverside',
    contact: '0917-333-2211',
    status: 'Active',
    householdLat: null,
    householdLng: null,
    notes: 'Near footbridge entrance.',
    reminders: 'Meter installed on fence post.',
    createdAt: '2026-03-01T09:00:00Z'
  },
  {
    id: 'c-8',
    accountNo: 'DWA-2026-008',
    name: 'Pedro Penduko',
    address: 'Upper Dicklum Hillside',
    zone: 'Zone 4 - Upper Dicklum',
    contact: '0998-123-9876',
    status: 'Active',
    householdLat: null,
    householdLng: null,
    notes: 'Uphill pathway, bamboo perimeter.',
    reminders: 'Steep steps during rainy conditions.',
    createdAt: '2026-03-05T13:20:00Z'
  }
];

const SAMPLE_METERS = [
  {
    id: 'm-1',
    meterNo: 'WM-2024-001',
    consumerId: 'c-1',
    meterLat: null,
    meterLng: null,
    isClustered: false,
    clusterId: null,
    installDate: '2024-02-10',
    initialReading: 1500,
    brand: 'Zenner DN15',
    diameter: '1/2" (15mm)',
    status: 'Operational',
    notes: 'Installed on riser pipe beside gate.',
    reminders: 'Dial glass is clear and easily legible.'
  },
  {
    id: 'm-2',
    meterNo: 'WM-2024-002',
    consumerId: 'c-2',
    meterLat: null,
    meterLng: null,
    isClustered: true,
    clusterId: 'cluster-sf-1',
    installDate: '2024-02-12',
    initialReading: 500,
    brand: 'Ningbo Multi-jet',
    diameter: '1/2" (15mm)',
    status: 'Operational',
    notes: 'Meter Slot #1 on San Francisco cluster rack.',
    reminders: 'Tagged with yellow identification wire.'
  },
  {
    id: 'm-3',
    meterNo: 'WM-2024-003',
    consumerId: 'c-3',
    meterLat: null,
    meterLng: null,
    isClustered: true,
    clusterId: 'cluster-sf-1',
    installDate: '2024-02-12',
    initialReading: 1200,
    brand: 'Ningbo Multi-jet',
    diameter: '1/2" (15mm)',
    status: 'Operational',
    notes: 'Meter Slot #2 on San Francisco cluster rack.',
    reminders: 'Tagged with green identification wire.'
  },
  {
    id: 'm-4',
    meterNo: 'WM-2024-004',
    consumerId: 'c-4',
    meterLat: null,
    meterLng: null,
    isClustered: true,
    clusterId: 'cluster-sf-1',
    installDate: '2024-02-12',
    initialReading: 1900,
    brand: 'Ningbo Multi-jet',
    diameter: '1/2" (15mm)',
    status: 'Operational',
    notes: 'Meter Slot #3 on San Francisco cluster rack.',
    reminders: 'Tagged with blue identification wire.'
  },
  {
    id: 'm-5',
    meterNo: 'WM-2024-005',
    consumerId: 'c-5',
    meterLat: null,
    meterLng: null,
    isClustered: false,
    clusterId: null,
    installDate: '2024-03-01',
    initialReading: 2800,
    brand: 'Zenner DN15',
    diameter: '1/2" (15mm)',
    status: 'Operational',
    notes: 'Mounted on concrete base near street.',
    reminders: 'Clean protective enclosure box.'
  },
  {
    id: 'm-6',
    meterNo: 'WM-2024-006',
    consumerId: 'c-6',
    meterLat: null,
    meterLng: null,
    isClustered: true,
    clusterId: 'cluster-central-1',
    installDate: '2024-03-05',
    initialReading: 850,
    brand: 'Zenner DN15',
    diameter: '1/2" (15mm)',
    status: 'Operational',
    notes: 'Central Purok 2 cluster post.',
    reminders: 'Meter Slot #1 on stand.'
  },
  {
    id: 'm-7',
    meterNo: 'WM-2024-007',
    consumerId: 'c-7',
    meterLat: null,
    meterLng: null,
    isClustered: false,
    clusterId: null,
    installDate: '2024-03-10',
    initialReading: 1100,
    brand: 'Ningbo Multi-jet',
    diameter: '1/2" (15mm)',
    status: 'Operational',
    notes: 'Standpipe next to footbridge.',
    reminders: 'Check shutoff valve condition.'
  },
  {
    id: 'm-8',
    meterNo: 'WM-2024-008',
    consumerId: 'c-8',
    meterLat: null,
    meterLng: null,
    isClustered: false,
    clusterId: null,
    installDate: '2024-03-15',
    initialReading: 500,
    brand: 'Zenner DN15',
    diameter: '1/2" (15mm)',
    status: 'Operational',
    notes: 'Mounted on timber riser.',
    reminders: 'Inspect for dirt or debris.'
  }
];

// Historical and Current Readings
// Exactly demonstrates the user example:
// Previous Reading: 1954
// Current Reading: 1957
// Usage: 3 cubic meters
// Minimum Monthly Charge: PHP 100.00
const SAMPLE_READINGS = [
  {
    id: 'r-1-prev',
    consumerId: 'c-1',
    meterId: 'm-1',
    billingPeriod: '2026-09',
    previousReading: 1945,
    currentReading: 1954,
    consumption: 9,
    readingDate: '2026-09-24T08:30:00Z',
    readerName: 'R. Fernandez',
    notes: 'Normal monthly reading.',
    status: 'Recorded',
    isRolloverOverride: false
  },
  {
    id: 'r-1-curr',
    consumerId: 'c-1',
    meterId: 'm-1',
    billingPeriod: '2026-10',
    previousReading: 1954,
    currentReading: 1957,
    consumption: 3,
    readingDate: '2026-10-24T09:15:00Z',
    readerName: 'R. Fernandez',
    notes: 'Prompt example verified: 1957 - 1954 = 3 m3 (Minimum charge PHP 100).',
    status: 'Recorded',
    isRolloverOverride: false
  },
  {
    id: 'r-2-prev',
    consumerId: 'c-2',
    meterId: 'm-2',
    billingPeriod: '2026-09',
    previousReading: 830,
    currentReading: 840,
    consumption: 10,
    readingDate: '2026-09-24T09:00:00Z',
    readerName: 'R. Fernandez',
    notes: 'San Francisco cluster inspection.',
    status: 'Recorded',
    isRolloverOverride: false
  },
  {
    id: 'r-3-prev',
    consumerId: 'c-3',
    meterId: 'm-3',
    billingPeriod: '2026-09',
    previousReading: 1405,
    currentReading: 1420,
    consumption: 15,
    readingDate: '2026-09-24T09:10:00Z',
    readerName: 'R. Fernandez',
    notes: 'Excess consumption example verified.',
    status: 'Recorded',
    isRolloverOverride: false
  },
  {
    id: 'r-5-prev',
    consumerId: 'c-5',
    meterId: 'm-5',
    billingPeriod: '2026-09',
    previousReading: 3112,
    currentReading: 3120,
    consumption: 8,
    readingDate: '2026-09-24T10:00:00Z',
    readerName: 'R. Fernandez',
    notes: 'Central plaza inspection.',
    status: 'Recorded',
    isRolloverOverride: false
  }
];

const SAMPLE_BILLS = [
  {
    id: 'BILL-202610-001',
    readingId: 'r-1-curr',
    consumerId: 'c-1',
    meterId: 'm-1',
    billingPeriod: 'October 2026',
    billDate: '2026-10-24',
    dueDate: '2026-11-08',
    previousReading: 1954,
    currentReading: 1957,
    consumption: 3,
    minimumCharge: 100.00,
    excessCubicMeters: 0,
    excessRate: 15.00,
    excessAmount: 0.00,
    maintenanceFee: 0.00,
    penaltyAmount: 0.00,
    totalAmountDue: 100.00,
    paymentStatus: 'UNPAID', // Printing DOES NOT mark bill as paid
    amountPaid: 0.00,
    paidDate: null,
    orNumber: null,
    collectorName: null,
    printCount: 1,
    lastPrintedDate: '2026-10-24T09:20:00Z'
  }
];

const SAMPLE_SETTINGS = [
  {
    key: 'tariff',
    value: {
      minimumCharge: 100.00,       // PHP 100.00 minimum monthly charge
      minimumAllowance: 10,        // Up to 10 m3 included
      excessRate: 15.00,           // Configurable excess per m3 above 10
      maintenanceFee: 0.00,
      penaltyPercent: 10,
      dueDays: 15,
      activeBillingPeriod: 'October 2026',
      activeBillingCode: '2026-10'
    }
  },
  {
    key: 'reader',
    value: {
      name: 'R. Fernandez',
      id: 'DWA-FO-03',
      role: 'Field Meter Reader & Operations Officer',
      contact: '0917-888-9921'
    }
  },
  {
    key: 'association',
    value: {
      name: 'Dicklum Water Association, Inc.',
      shortName: 'DWA',
      address: 'Dicklum, Manolo Fortich, Bukidnon, 8703',
      regNo: 'SEC Reg. CN2014-99120',
      tin: '008-721-432-000',
      emergencyContact: '0926-444-1234 / 0917-888-9921',
      advisory: 'Please settle water bills on or before due date to avoid service disconnection. Conserve water for the community.'
    }
  },
  {
    key: 'printer',
    value: {
      paperWidth: '58mm',
      simulatedMode: true,
      bluetoothDeviceName: 'POS-5802'
    }
  },
  {
    key: 'zones',
    value: [
      'Zone 1 - Dicklum Central',
      'Zone 2 - San Francisco',
      'Zone 3 - Sayre Highway & Riverside',
      'Zone 4 - Upper Dicklum'
    ]
  }
];

async function seedSampleDataIfEmpty() {
  // Ensure default system settings (tariff, association info, printer config) are initialized
  const existingSettings = await window.db.getAll('settings');
  if (!existingSettings || existingSettings.length === 0) {
    for (const s of SAMPLE_SETTINGS) {
      await window.db.put('settings', s);
    }
  }
  // Start 100% fresh with 0 consumers, 0 meters, 0 pins, 0 bills, 0 readings.
  // Mock data is NEVER seeded automatically on startup.
  await window.db.put('settings', { key: 'freshStart', value: true });
  return false;
}

async function seedMockDemoData() {
  for (const c of SAMPLE_CONSUMERS) {
    await window.db.put('consumers', c);
  }
  for (const m of SAMPLE_METERS) {
    await window.db.put('meters', m);
  }
  for (const cl of SAMPLE_CLUSTERS) {
    await window.db.put('clusters', cl);
  }
  for (const r of SAMPLE_READINGS) {
    await window.db.put('readings', r);
  }
  for (const b of SAMPLE_BILLS) {
    await window.db.put('bills', b);
  }
  for (const s of SAMPLE_SETTINGS) {
    await window.db.put('settings', s);
  }
  await window.db.put('settings', { key: 'freshStart', value: false });
  return true;
}

if (typeof window !== 'undefined') {
  window.seedSampleDataIfEmpty = seedSampleDataIfEmpty;
  window.seedMockDemoData = seedMockDemoData;
}
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    SAMPLE_CONSUMERS,
    SAMPLE_METERS,
    SAMPLE_CLUSTERS,
    SAMPLE_READINGS,
    SAMPLE_BILLS,
    SAMPLE_SETTINGS,
    seedSampleDataIfEmpty,
    seedMockDemoData
  };
}
