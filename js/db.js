/**
 * Dicklum Water Association - IndexedDB Storage Engine (Version 2)
 * Provides persistent offline storage for Consumers, Meters, Clusters, Readings, Bills, Routes, and Settings.
 */

const DB_NAME = 'DicklumWaterDB';
const DB_VERSION = 2;

class WaterDB {
  constructor() {
    this.db = null;
    this.readyPromise = this.init();
  }

  init() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = (event) => {
        const db = event.target.result;

        // Consumers Store
        if (!db.objectStoreNames.contains('consumers')) {
          const consumerStore = db.createObjectStore('consumers', { keyPath: 'id' });
          consumerStore.createIndex('accountNo', 'accountNo', { unique: true });
          consumerStore.createIndex('name', 'name', { unique: false });
          consumerStore.createIndex('zone', 'zone', { unique: false });
          consumerStore.createIndex('status', 'status', { unique: false });
        }

        // Meters Store
        if (!db.objectStoreNames.contains('meters')) {
          const meterStore = db.createObjectStore('meters', { keyPath: 'id' });
          meterStore.createIndex('meterNo', 'meterNo', { unique: true });
          meterStore.createIndex('consumerId', 'consumerId', { unique: false });
          meterStore.createIndex('clusterId', 'clusterId', { unique: false });
          meterStore.createIndex('isClustered', 'isClustered', { unique: false });
        }

        // Clusters Store
        if (!db.objectStoreNames.contains('clusters')) {
          const clusterStore = db.createObjectStore('clusters', { keyPath: 'id' });
          clusterStore.createIndex('zone', 'zone', { unique: false });
          clusterStore.createIndex('name', 'name', { unique: false });
        }

        // Readings Store
        if (!db.objectStoreNames.contains('readings')) {
          const readingStore = db.createObjectStore('readings', { keyPath: 'id' });
          readingStore.createIndex('consumerId', 'consumerId', { unique: false });
          readingStore.createIndex('meterId', 'meterId', { unique: false });
          readingStore.createIndex('billingPeriod', 'billingPeriod', { unique: false });
          readingStore.createIndex('readingDate', 'readingDate', { unique: false });
          readingStore.createIndex('consumer_period', ['consumerId', 'billingPeriod'], { unique: false });
        }

        // Bills Store
        if (!db.objectStoreNames.contains('bills')) {
          const billStore = db.createObjectStore('bills', { keyPath: 'id' });
          billStore.createIndex('consumerId', 'consumerId', { unique: false });
          billStore.createIndex('readingId', 'readingId', { unique: false });
          billStore.createIndex('billingPeriod', 'billingPeriod', { unique: false });
          billStore.createIndex('paymentStatus', 'paymentStatus', { unique: false });
        }

        // Walking Routes Store (Phase 2, Section 7)
        if (!db.objectStoreNames.contains('routes')) {
          const routeStore = db.createObjectStore('routes', { keyPath: 'id' });
          routeStore.createIndex('createdAt', 'createdAt', { unique: false });
          routeStore.createIndex('name', 'name', { unique: false });
        }

        // Settings Store
        if (!db.objectStoreNames.contains('settings')) {
          db.createObjectStore('settings', { keyPath: 'key' });
        }
      };

      request.onsuccess = (event) => {
        this.db = event.target.result;
        resolve(this.db);
      };

      request.onerror = (event) => {
        console.error('IndexedDB error:', event.target.error);
        reject(event.target.error);
      };
    });
  }

  async ready() {
    return this.readyPromise;
  }

  // --- Generic Helpers ---

  async getAll(storeName) {
    await this.ready();
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(storeName, 'readonly');
      const store = tx.objectStore(storeName);
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  }

  async get(storeName, key) {
    await this.ready();
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(storeName, 'readonly');
      const store = tx.objectStore(storeName);
      const req = store.get(key);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async put(storeName, item) {
    await this.ready();
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(storeName, 'readwrite');
      const store = tx.objectStore(storeName);
      const req = store.put(item);
      req.onsuccess = () => resolve(item);
      req.onerror = () => reject(req.error);
    });
  }

  async delete(storeName, key) {
    await this.ready();
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(storeName, 'readwrite');
      const store = tx.objectStore(storeName);
      const req = store.delete(key);
      req.onsuccess = () => resolve(true);
      req.onerror = () => reject(req.error);
    });
  }

  async clear(storeName) {
    await this.ready();
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(storeName, 'readwrite');
      const store = tx.objectStore(storeName);
      const req = store.clear();
      req.onsuccess = () => resolve(true);
      req.onerror = () => reject(req.error);
    });
  }

  async getByIndex(storeName, indexName, value) {
    await this.ready();
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(storeName, 'readonly');
      const store = tx.objectStore(storeName);
      const index = store.index(indexName);
      const req = index.getAll(value);
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  }

  // --- Consumer Management Domain Methods ---

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
    const latestReading = readings[0] || null;

    return {
      consumer,
      meter,
      meters,
      cluster,
      readings,
      latestReading
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

  async deactivateConsumer(consumerId) {
    const consumer = await this.get('consumers', consumerId);
    if (!consumer) throw new Error('Consumer not found.');
    consumer.status = 'Inactive';
    consumer.deactivatedAt = new Date().toISOString();
    await this.put('consumers', consumer);
    return consumer;
  }

  async activateConsumer(consumerId) {
    const consumer = await this.get('consumers', consumerId);
    if (!consumer) throw new Error('Consumer not found.');
    consumer.status = 'Active';
    delete consumer.deactivatedAt;
    await this.put('consumers', consumer);
    return consumer;
  }

  // --- Reading & Duplicate Detection ---

  async findDuplicateReading(consumerId, billingPeriod) {
    await this.ready();
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction('readings', 'readonly');
      const store = tx.objectStore('readings');
      const index = store.index('consumer_period');
      const req = index.getAll([consumerId, billingPeriod]);
      req.onsuccess = () => resolve(req.result && req.result.length > 0 ? req.result[0] : null);
      req.onerror = () => reject(req.error);
    });
  }

  // --- Walking Route Methods (Phase 2, Section 7) ---

  async saveRoute(route) {
    if (!route.id) route.id = `route-${Date.now()}`;
    if (!route.createdAt) route.createdAt = new Date().toISOString();
    return this.put('routes', route);
  }

  async getRoutes() {
    const routes = await this.getAll('routes');
    routes.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    return routes;
  }

  async deleteRoute(id) {
    return this.delete('routes', id);
  }

  async renameRoute(id, newName) {
    const route = await this.get('routes', id);
    if (!route) throw new Error('Route not found.');
    route.name = newName;
    route.updatedAt = new Date().toISOString();
    return this.put('routes', route);
  }

  // --- Settings ---

  async getSetting(key, defaultValue = null) {
    const item = await this.get('settings', key);
    return item ? item.value : defaultValue;
  }

  async setSetting(key, value) {
    return this.put('settings', { key, value, updatedAt: new Date().toISOString() });
  }

  // --- Zones & Purok Districts Management ---

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

  // --- Clusters Management (Separated by Zone/Purok) ---

  async getClustersByZone(zone) {
    const clusters = await this.getAll('clusters');
    if (!zone) return clusters;
    return clusters.filter(c => c.zone === zone);
  }

  async saveCluster(cluster) {
    if (!cluster.id) cluster.id = `cluster-${Date.now().toString().slice(-6)}-${Math.random().toString(36).slice(2, 6)}`;
    return this.put('clusters', cluster);
  }

  // --- Full Backup and Restore ---

  async dumpAllData() {
    const stores = ['consumers', 'meters', 'clusters', 'readings', 'bills', 'routes', 'settings'];
    const backup = {
      version: 2,
      appName: 'Dicklum Water Association System',
      exportedAt: new Date().toISOString(),
      summary: {},
      data: {}
    };
    for (const store of stores) {
      backup.data[store] = await this.getAll(store);
      backup.summary[store] = backup.data[store].length;
    }
    return backup;
  }

  async restoreAllData(backupData) {
    if (!backupData || !backupData.data) {
      throw new Error('Invalid backup file format. Expected a valid Dicklum Water Association backup.');
    }
    const stores = ['consumers', 'meters', 'clusters', 'readings', 'bills', 'routes', 'settings'];
    for (const store of stores) {
      if (backupData.data[store]) {
        await this.clear(store);
        for (const item of backupData.data[store]) {
          await this.put(store, item);
        }
      }
    }
    return true;
  }

  /**
   * Clears all pinned GPS locations across households, meters, clusters, and routes.
   * Keeps consumer names, accounts, and billing history intact.
   */
  async clearAllPins() {
    await this.ready();
    const consumers = await this.getAll('consumers');
    for (const c of consumers) {
      c.householdLat = null;
      c.householdLng = null;
      await this.put('consumers', c);
    }

    const meters = await this.getAll('meters');
    for (const m of meters) {
      m.meterLat = null;
      m.meterLng = null;
      await this.put('meters', m);
    }

    const clusters = await this.getAll('clusters');
    for (const cl of clusters) {
      cl.lat = null;
      cl.lng = null;
      await this.put('clusters', cl);
    }

    await this.clear('routes');
    await this.put('settings', { key: 'freshStart', value: true });
    return true;
  }

  /**
   * Completely wipes all sample data to start with an empty association utility.
   * Keeps tariff configuration and sets freshStart flag.
   */
  async wipeCleanSlate() {
    await this.ready();
    const storesToClear = ['consumers', 'meters', 'clusters', 'readings', 'bills', 'routes'];
    for (const store of storesToClear) {
      await this.clear(store);
    }
    await this.put('settings', { key: 'freshStart', value: true });
    // Guarantee basic default tariff and association settings exist
    const tariff = await this.get('settings', 'tariff');
    if (!tariff) {
      await this.put('settings', {
        key: 'tariff',
        value: {
          minimumChargePesos: 100.00,
          minimumCoverageM3: 10,
          excessPerM3Pesos: 15.00,
          currency: 'PHP',
          activeBillingPeriod: 'October 2026',
          activeBillingCode: '2026-10'
        }
      });
    }
    const zones = await this.getSetting('zones');
    if (!zones) {
      await this.setSetting('zones', [
        'Zone 1 - Dicklum Central',
        'Zone 2 - San Francisco',
        'Zone 3 - Sayre Highway & Riverside',
        'Zone 4 - Upper Dicklum'
      ]);
    }
    return true;
  }
}

// Export singleton instance
window.db = new WaterDB();
