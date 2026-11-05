/**
 * Dicklum Water Association - Central Application Coordinator
 * Connects UI, DB, Real-Time Satellite Map, Route Recording, Reading Module, Billing,
 * Thermal Printing, Official Reports, and Offline Disaster Recovery.
 * 100% English Language & Clean Human-Crafted Vector Icons (Zero emojis).
 */

class WaterBillingApp {
  constructor() {
    this.activeView = 'view-map'; // Launch directly to Unified Map Dashboard
    this.currentMode = 'mapping';
    this.activeConsumer = null;
    this.activeMeter = null;
    this.activePinType = null;
    this.activeCluster = null;
    this.activeBill = null;
    this.mapEngine = null;
    this.activeBillingPeriod = 'October 2026';
    this.activeBillingCode = '2026-10';

    // Caches
    this.cachedConsumers = [];
    this.cachedMeters = [];
    this.cachedClusters = [];
    this.cachedBills = [];
    this.cachedRoutes = [];
    this.cachedSettings = {};

    // Geolocation & Route Recording State (Phase 2, Section 7)
    this.gpsWatchId = null;
    this.isRecordingRoute = false;
    this.recordedRoutePoints = [];
    this.routeRecordingStartTime = null;

    // Office Sync, Records Filter ('today' | 'month' | 'all'), and PIN Gate State
    this.recordsPeriodMode = 'today';
    this.pinGateMode = 'unlock';
    this.hasPinConfigured = false;
  }

  async init() {
    console.log('Initializing Dicklum Water Billing System...');

    // 1. Initialize DB and seed initial sample data if empty
    await window.db.ready();

    // Automatic clean slate wipe:
    // Ensures that any existing browser with old mock pins and mock records starts 100% fresh
    const CLEAN_SLATE_KEY = 'dicklum_app_fresh_slate_v5';
    if (!localStorage.getItem(CLEAN_SLATE_KEY)) {
      console.log('Activating fresh utility state: wiping all previous mock pins and records...');
      await window.db.wipeCleanSlate();
      localStorage.setItem(CLEAN_SLATE_KEY, 'true');
    }

    await window.seedSampleDataIfEmpty();

    // 2. Load cached records
    await this.refreshDataCache();

    // 3. Initialize Satellite Map Engine (Direct Launch)
    const mapContainer = document.getElementById('field-map');
    if (mapContainer) {
      this.mapEngine = new window.FieldMapEngine(mapContainer, {
        centerLat: 8.3735,
        centerLng: 124.8505,
        zoom: 15.0,
        layer: 'google_hybrid'
      });

      this.mapEngine.selectPinCallback = (pin) => this.handlePinSelect(pin);
      this.mapEngine.dropPinCallback = (lat, lng) => this.handleMapTapToPin(lat, lng);

      [50, 150, 350, 800].forEach(delay => {
        setTimeout(() => {
          if (this.mapEngine) this.mapEngine.resize();
        }, delay);
      });

      // Restore previous known GPS location in 1ms on startup
      this.restoreInstantGpsCache();
    }

    // 4. Setup Bluetooth printer listener
    window.thermalPrinter.onStatusChange((status, details) => {
      this.updatePrinterUIStatus(status, details);
    });

    // 5. Setup DOM event listeners
    this.bindNavigationEvents();
    this.bindMapEvents();
    this.bindRouteRecordingEvents();
    this.bindConsumerEvents();
    this.bindReadingEvents();
    this.bindBillingEvents();
    this.bindSettingsAndReportEvents();
    this.bindModalEvents();

    // 6. Check Online/Offline Network Status
    this.updateOnlineBadge();
    window.addEventListener('online', () => this.updateOnlineBadge());
    window.addEventListener('offline', () => this.updateOnlineBadge());

    // 7. Render initial pins, routes, and lists
    this.syncPinsToMap();
    this.syncRoutesToMap();
    this.renderConsumerList();
    this.renderBillingList();
    this.renderStats();
    this.resetReadingViewToEmpty();
    this.populateQuickConsumerSelect();
    await this.populateZoneDropdowns();
    try {
      await this.renderZoneExportCenter();
    } catch (err) {
      console.warn('Zone Export Center init warning:', err);
    }
    try {
      await this.initSecurityPinGate();
    } catch (err) {
      console.warn('Security PIN Gate init warning:', err);
    }

    // 8. Auto-start real-time GPS location & compass heading tracking
    if (navigator.geolocation) {
      this.startRealtimeGps({ silent: true });
    }

    console.log('Dicklum Water Billing System ready.');
  }

  cleanZoneString(zoneStr) {
    if (!zoneStr || typeof zoneStr !== 'string') return 'Zone 1';
    if (window.db && typeof window.db.normalizeZoneName === 'function') {
      return window.db.normalizeZoneName(zoneStr);
    }
    const m = zoneStr.trim().match(/^(Zone\s*\d+)\s*[-–—]\s*(Dicklum Central|San Francisco|Sayre Highway\s*&\s*Riverside|Upper Dicklum)$/i);
    return m ? m[1].replace(/\s+/g, ' ') : zoneStr.trim();
  }

  cleanAddressString(addrStr, zoneStr) {
    const cleanZ = this.cleanZoneString(zoneStr || 'Zone 1');
    if (!addrStr || typeof addrStr !== 'string') {
      return `${cleanZ}, Diclum`;
    }
    let cleaned = addrStr
      .replace(/Zone\s*\d+\s*[-–—]\s*(Dicklum Central|San Francisco|Sayre Highway\s*&\s*Riverside|Upper Dicklum)/gi, cleanZ)
      .replace(/\bDicklum\b/gi, 'Diclum')
      .trim();
    if (!cleaned || cleaned.toLowerCase() === cleanZ.toLowerCase()) {
      cleaned = `${cleanZ}, Diclum`;
    }
    return cleaned;
  }

  async refreshDataCache() {
    await window.db.getZones();
    this.cachedConsumers = await window.db.getAll('consumers');
    this.cachedMeters = await window.db.getAll('meters');
    this.cachedClusters = await window.db.getAll('clusters');
    this.cachedBills = await window.db.getAll('bills');
    this.cachedRoutes = await window.db.getRoutes();

    let dbUpdated = false;

    // 1. Normalize legacy Zone names ("Zone 2 - San Francisco" -> "Zone 2") & Addresses across all records
    for (const c of this.cachedConsumers) {
      const cleanZ = this.cleanZoneString(c.zone);
      const cleanA = this.cleanAddressString(c.address, cleanZ);
      if (c.zone !== cleanZ || c.address !== cleanA) {
        c.zone = cleanZ;
        c.address = cleanA;
        await window.db.put('consumers', c);
        dbUpdated = true;
      }
    }
    for (const m of this.cachedMeters) {
      if (m.zone) {
        const cleanZ = this.cleanZoneString(m.zone);
        if (m.zone !== cleanZ) {
          m.zone = cleanZ;
          await window.db.put('meters', m);
          dbUpdated = true;
        }
      }
    }
    for (const cl of this.cachedClusters) {
      if (cl.zone) {
        const cleanZ = this.cleanZoneString(cl.zone);
        if (cl.zone !== cleanZ) {
          cl.zone = cleanZ;
          await window.db.put('clusters', cl);
          dbUpdated = true;
        }
      }
    }

    // 2. Automatically link & merge same-name consumers (e.g. Household pin "paula" + Water Meter pin "paula")
    const byName = new Map();
    for (const c of this.cachedConsumers) {
      const key = (c.name || '').trim().toLowerCase();
      if (!key) continue;
      if (!byName.has(key)) byName.set(key, []);
      byName.get(key).push(c);
    }

    const allReadings = await window.db.getAll('readings');
    for (const [, group] of byName.entries()) {
      if (group.length < 2) continue;
      // Sort so earliest account (e.g. DWA-2026-003) is primary
      group.sort((a, b) => String(a.accountNo || '').localeCompare(String(b.accountNo || '')));
      const primary = group[0];

      for (let i = 1; i < group.length; i++) {
        const dup = group[i];
        if ((!primary.householdLat || !primary.householdLng) && dup.householdLat && dup.householdLng) {
          primary.householdLat = dup.householdLat;
          primary.householdLng = dup.householdLng;
        }
        if (dup.zone) {
          primary.zone = this.cleanZoneString(dup.zone);
          primary.address = this.cleanAddressString(dup.address, primary.zone);
        }

        // Re-link any water meters from duplicate consumer to primary consumer
        const dupMeters = this.cachedMeters.filter(m => m.consumerId === dup.id);
        for (const m of dupMeters) {
          m.consumerId = primary.id;
          m.ownerName = primary.name;
          if (!m.zone) m.zone = primary.zone;
          await window.db.put('meters', m);
        }

        // Re-link any readings and bills
        const dupReadings = allReadings.filter(r => r.consumerId === dup.id);
        for (const r of dupReadings) {
          r.consumerId = primary.id;
          await window.db.put('readings', r);
        }
        const dupBills = this.cachedBills.filter(b => b.consumerId === dup.id);
        for (const b of dupBills) {
          b.consumerId = primary.id;
          await window.db.put('bills', b);
        }

        await window.db.delete('consumers', dup.id);
        dbUpdated = true;
      }

      await window.db.put('consumers', primary);
    }

    // Also link any meter whose ownerName matches a consumer's name if consumerId is missing or mismatched
    const currentConsumers = dbUpdated ? await window.db.getAll('consumers') : this.cachedConsumers;
    for (const m of this.cachedMeters) {
      const linked = currentConsumers.find(c => c.id === m.consumerId);
      if (!linked && m.ownerName) {
        const matchByName = currentConsumers.find(
          c => (c.name || '').trim().toLowerCase() === m.ownerName.trim().toLowerCase()
        );
        if (matchByName) {
          m.consumerId = matchByName.id;
          await window.db.put('meters', m);
          dbUpdated = true;
        }
      }
    }

    if (dbUpdated) {
      this.cachedConsumers = await window.db.getAll('consumers');
      this.cachedMeters = await window.db.getAll('meters');
      this.cachedClusters = await window.db.getAll('clusters');
      this.cachedBills = await window.db.getAll('bills');
    }

    // 3. Automatically purge any orphaned consumers/meters whose GPS pins were cleared by legacy unpin behavior
    const orphanedConsumers = this.cachedConsumers.filter(c => {
      const hasHousePin = Boolean(c.householdLat && c.householdLng);
      const meter = this.cachedMeters.find(m => m.consumerId === c.id);
      const hasMeterPin = Boolean(meter && ((meter.meterLat && meter.meterLng) || meter.isClustered));
      return !hasHousePin && !hasMeterPin;
    });

    if (orphanedConsumers.length > 0) {
      const latestReadings = await window.db.getAll('readings');
      for (const orphan of orphanedConsumers) {
        await window.db.delete('consumers', orphan.id);
        const orphanMeters = this.cachedMeters.filter(m => m.consumerId === orphan.id);
        for (const m of orphanMeters) {
          await window.db.delete('meters', m.id);
        }
        const orphanBills = this.cachedBills.filter(b => b.consumerId === orphan.id);
        for (const b of orphanBills) {
          await window.db.delete('bills', b.id);
        }
        const orphanReadings = latestReadings.filter(r => r.consumerId === orphan.id);
        for (const r of orphanReadings) {
          await window.db.delete('readings', r.id);
        }
        if (this.activeConsumer && this.activeConsumer.id === orphan.id) {
          this.activeConsumer = null;
          this.activeMeter = null;
        }
      }
      this.cachedConsumers = await window.db.getAll('consumers');
      this.cachedMeters = await window.db.getAll('meters');
      this.cachedBills = await window.db.getAll('bills');
    }

    const settings = await window.db.getAll('settings');
    this.cachedSettings = {};
    settings.forEach(s => { this.cachedSettings[s.key] = s.value; });

    // Normalize tariff settings so excessRate is always configured (default PHP 15.00/m³)
    const rawTariff = this.cachedSettings.tariff || {};
    const normalizedTariff = {
      minimumCharge: Number(rawTariff.minimumCharge ?? rawTariff.minimumChargePesos) || 100.00,
      minimumAllowance: Number(rawTariff.minimumAllowance ?? rawTariff.minimumCoverageM3) || 10,
      excessRate: Number(rawTariff.excessRate ?? rawTariff.excessPerM3Pesos) || 15.00,
      maintenanceFee: Number(rawTariff.maintenanceFee) || 0.00,
      penaltyPercent: Number(rawTariff.penaltyPercent) || 10,
      dueDays: Number(rawTariff.dueDays) || 15,
      currency: rawTariff.currency || 'PHP',
      activeBillingPeriod: rawTariff.activeBillingPeriod || 'October 2026',
      activeBillingCode: rawTariff.activeBillingCode || '2026-10'
    };
    this.cachedSettings.tariff = normalizedTariff;
    if (!rawTariff.excessRate || isNaN(Number(rawTariff.excessRate))) {
      await window.db.setSetting('tariff', normalizedTariff);
    }

    if (this.cachedSettings.tariff && this.cachedSettings.tariff.activeBillingPeriod) {
      this.activeBillingPeriod = this.cachedSettings.tariff.activeBillingPeriod;
      this.activeBillingCode = this.cachedSettings.tariff.activeBillingCode || '2026-10';
    }
  }

  updateOnlineBadge() {
    const badge = document.getElementById('online-status-pill');
    if (!badge) return;
    if (navigator.onLine) {
      badge.innerHTML = '<span class="status-dot online"></span> Online';
      badge.className = 'status-pill online';
    } else {
      badge.innerHTML = '<span class="status-dot offline"></span> Offline';
      badge.className = 'status-pill offline';
    }
  }

  // --- View & Mode Switching ---

  switchView(viewId) {
    // If leaving map screen, stop GPS tracking to conserve battery (Phase 2, Section 5)
    if (this.activeView === 'view-map' && viewId !== 'view-map' && !this.isRecordingRoute) {
      this.stopRealtimeGps();
    }

    document.querySelectorAll('.app-view').forEach(view => {
      view.classList.remove('active');
    });
    const target = document.getElementById(viewId);
    if (target) {
      target.classList.add('active');
      this.activeView = viewId;
    }

    document.querySelectorAll('.nav-item').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.view === viewId);
    });

    if (viewId === 'view-reading') {
      this.populateQuickConsumerSelect();
      if (!this.activeConsumer) {
        this.resetReadingViewToEmpty();
      }
    }

    if (viewId === 'view-settings') {
      this.renderSettingsZonesAndClusters();
      this.renderZoneExportCenter();
      this.refreshPinSecurityBadge();
    }

    if (viewId === 'view-map') {
      [50, 150, 300, 600, 1000].forEach(delay => {
        setTimeout(() => {
          if (this.mapEngine) {
            this.mapEngine.resize();
            this.syncPinsToMap();
            this.syncRoutesToMap();
          }
        }, delay);
      });
    }
  }

  setMode(mode) {
    this.currentMode = mode || 'mapping';

    const modeBadge = document.getElementById('current-mode-badge');
    if (modeBadge) {
      modeBadge.textContent = 'UNIFIED MAP';
    }

    if (this.mapEngine) {
      this.mapEngine.setMappingMode(this.currentMode);
    }

    const fabPin = document.getElementById('fab-add-pin');
    if (fabPin) {
      fabPin.style.display = 'flex';
    }
  }

  // --- Map Controller & Pins ---

  syncPinsToMap() {
    if (!this.mapEngine) return;

    const pins = [];
    const readConsumerIds = new Set(
      this.cachedBills
        .filter(b => b.billingPeriod.includes('2026-10') || b.billingPeriod.includes('October 2026'))
        .map(b => b.consumerId)
    );

    // 1. Household Pins
    for (const c of this.cachedConsumers) {
      if (c.householdLat && c.householdLng) {
        pins.push({
          id: c.id,
          type: 'household',
          lat: Number(c.householdLat),
          lng: Number(c.householdLng),
          title: c.name,
          data: {
            consumerId: c.id,
            name: c.name,
            accountNo: c.accountNo,
            zone: c.zone,
            address: c.address,
            isUnread: !readConsumerIds.has(c.id)
          }
        });
      }
    }

    // 2. Individual Water Meter Pins
    for (const m of this.cachedMeters) {
      if (!m.isClustered && m.meterLat && m.meterLng) {
        const consumer = this.cachedConsumers.find(c => c.id === m.consumerId);
        const ownerDisplay = (consumer && consumer.name) ? consumer.name : (m.ownerName || m.meterNo);
        pins.push({
          id: m.id,
          type: 'meter',
          lat: Number(m.meterLat),
          lng: Number(m.meterLng),
          title: `${ownerDisplay} | WM`,
          data: {
            meterId: m.id,
            meterNo: m.meterNo,
            consumerId: m.consumerId,
            name: (consumer && consumer.name) ? consumer.name : (m.ownerName || 'Unassigned'),
            ownerName: (consumer && consumer.name) ? consumer.name : (m.ownerName || ''),
            accountNo: consumer ? consumer.accountNo : '',
            zone: m.zone || (consumer ? consumer.zone : ''),
            householdLat: consumer ? consumer.householdLat : null,
            householdLng: consumer ? consumer.householdLng : null,
            isUnread: consumer ? !readConsumerIds.has(consumer.id) : false
          }
        });
      }
    }

    // 3. Cluster Pins
    for (const cl of this.cachedClusters) {
      if (cl.lat && cl.lng) {
        const clusterMeters = this.cachedMeters.filter(m => m.clusterId === cl.id);
        pins.push({
          id: cl.id,
          type: 'cluster',
          lat: Number(cl.lat),
          lng: Number(cl.lng),
          title: cl.name,
          data: {
            clusterId: cl.id,
            name: cl.name,
            zone: cl.zone,
            description: cl.description,
            meterCount: clusterMeters.length,
            meters: clusterMeters
          }
        });
      }
    }

    this.mapEngine.setPins(pins);
    this.renderMapZoneChips();
    this.updateMapTypeSegmentCounts();
  }

  syncRoutesToMap() {
    if (!this.mapEngine) return;
    this.mapEngine.setSavedRoutes(this.cachedRoutes);
  }

  handlePinSelect(pin) {
    if (pin.type === 'cluster') {
      this.openClusterSheet(pin.data.clusterId);
    } else if (pin.type === 'meter') {
      this.openConsumerSheet(pin.data.consumerId, pin.data.meterId, 'meter');
    } else {
      this.openConsumerSheet(pin.data.consumerId, null, 'household');
    }
  }

  handleMapTapToPin(lat, lng) {
    this.openDropPinModal(lat, lng);
  }

  openConsumerSheet(consumerId, highlightMeterId = null, pinType = null) {
    let consumer = consumerId ? this.cachedConsumers.find(c => c.id === consumerId) : null;
    let meter = highlightMeterId
      ? this.cachedMeters.find(m => m.id === highlightMeterId)
      : (consumer ? this.cachedMeters.find(m => m.consumerId === consumer.id) : null);

    // Fallback: if consumer not found by ID or meter not linked by ID, match by owner/consumer name
    if (!consumer && meter && meter.ownerName) {
      consumer = this.cachedConsumers.find(
        c => (c.name || '').trim().toLowerCase() === meter.ownerName.trim().toLowerCase()
      ) || null;
    }
    if (consumer && !meter) {
      meter = this.cachedMeters.find(
        m => m.consumerId === consumer.id ||
             ((m.ownerName || '').trim().toLowerCase() === (consumer.name || '').trim().toLowerCase())
      ) || null;
    }

    if (!consumer && !meter) return;

    this.activeConsumer = consumer || null;
    this.activeMeter = meter || null;
    this.activePinType = pinType || (highlightMeterId ? 'meter' : 'household');

    const sheet = document.getElementById('map-bottom-sheet');
    if (!sheet) return;

    const btnUnpin = document.getElementById('sheet-btn-unpin');
    if (btnUnpin) {
      const label = this.activePinType === 'meter' ? 'Delete Meter Pin' : 'Delete House Pin';
      btnUnpin.innerHTML = `
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/>
        </svg>
        ${label}
      `;
    }

    const activeZone = highlightMeterId
      ? this.cleanZoneString((meter && meter.zone) || (consumer && consumer.zone) || 'Zone 1')
      : this.cleanZoneString((consumer && consumer.zone) || (meter && meter.zone) || 'Zone 1');

    const activeAddress = this.cleanAddressString(
      (consumer && consumer.address) || `${activeZone}, Diclum`,
      activeZone
    );

    document.getElementById('sheet-consumer-name').textContent = consumer
      ? consumer.name
      : (meter.ownerName || `Meter ${meter.meterNo}`);
    document.getElementById('sheet-account-no').textContent = consumer ? consumer.accountNo : 'UNASSIGNED';
    document.getElementById('sheet-zone').textContent = activeZone;
    document.getElementById('sheet-address').textContent = activeAddress;

    const meterNoEl = document.getElementById('sheet-meter-no');
    if (meter) {
      meterNoEl.textContent = meter.meterNo + (meter.isClustered ? ' (Clustered Manifold)' : ' (Individual Standpipe)');
    } else {
      meterNoEl.textContent = 'No meter assigned';
    }

    const latestBill = consumer ? this.cachedBills.find(b => b.consumerId === consumer.id) : null;
    document.getElementById('sheet-prev-reading').textContent = latestBill
      ? `${latestBill.currentReading} m³`
      : (meter && meter.initialReading !== undefined ? `${meter.initialReading} m³` : 'N/A');

    sheet.classList.add('visible');
  }

  closeConsumerSheet() {
    const sheet = document.getElementById('map-bottom-sheet');
    if (sheet) sheet.classList.remove('visible');
  }

  openClusterSheet(clusterId) {
    const cluster = this.cachedClusters.find(c => c.id === clusterId);
    if (!cluster) return;

    this.activeCluster = cluster;
    const clusterMeters = this.cachedMeters.filter(m => m.clusterId === clusterId);

    const sheet = document.getElementById('cluster-bottom-sheet');
    if (!sheet) return;

    document.getElementById('cluster-sheet-name').textContent = cluster.name;
    document.getElementById('cluster-sheet-zone').textContent = cluster.zone;
    document.getElementById('cluster-sheet-count').textContent = `${clusterMeters.length} Meters Grouped`;
    document.getElementById('cluster-sheet-desc').textContent = cluster.description || '';

    const listContainer = document.getElementById('cluster-meters-list');
    listContainer.innerHTML = '';

    clusterMeters.forEach(m => {
      const consumer = this.cachedConsumers.find(c => c.id === m.consumerId);
      const row = document.createElement('div');
      row.className = 'cluster-meter-item';
      row.innerHTML = `
        <div class="c-info">
          <strong>${consumer ? consumer.name : 'Unassigned'}</strong>
          <span class="sub">${m.meterNo} • ${consumer ? consumer.accountNo : ''}</span>
        </div>
        <button class="btn btn-sm btn-primary" onclick="window.app.startReadingForConsumer('${m.consumerId}')">
          Read Meter
        </button>
      `;
      listContainer.appendChild(row);
    });

    sheet.classList.add('visible');
  }

  closeClusterSheet() {
    const sheet = document.getElementById('cluster-bottom-sheet');
    if (sheet) sheet.classList.remove('visible');
  }

  // --- Real-Time Geolocation & Compass Heading Tracking (Phase 2, Section 5) ---

  _startCompassTracking() {
    if (this._compassListenerBound) return;
    this._compassListenerBound = true;

    this._onDeviceOrientation = (e) => {
      let compassHeading = null;
      if (typeof e.webkitCompassHeading === 'number' && !isNaN(e.webkitCompassHeading)) {
        // iOS Safari hardware compass heading (0° = North, 90° = East)
        compassHeading = e.webkitCompassHeading;
      } else if (e.alpha !== null && e.alpha !== undefined && !isNaN(e.alpha)) {
        // Android / Chrome orientation alpha (counter-clockwise from North)
        const screenAngle = (window.screen && window.screen.orientation && window.screen.orientation.angle)
          || window.orientation
          || 0;
        compassHeading = (360 - Number(e.alpha) + Number(screenAngle)) % 360;
      }

      if (compassHeading !== null && this.mapEngine) {
        this.mapEngine.setUserHeading(compassHeading, true);
      }
    };

    if ('ondeviceorientationabsolute' in window) {
      window.addEventListener('deviceorientationabsolute', this._onDeviceOrientation, true);
    }
    window.addEventListener('deviceorientation', this._onDeviceOrientation, true);
  }

  _stopCompassTracking() {
    if (!this._compassListenerBound) return;
    this._compassListenerBound = false;
    if (this._onDeviceOrientation) {
      window.removeEventListener('deviceorientationabsolute', this._onDeviceOrientation, true);
      window.removeEventListener('deviceorientation', this._onDeviceOrientation, true);
    }
  }

  toggleRealtimeGps() {
    if (!navigator.geolocation) {
      alert('Geolocation is not supported by this browser/device.\n\nFor GPS to work:\n• Use Chrome or Safari on mobile\n• Access the app via HTTPS\n• Enable Location Services and "Precise Location" in device settings');
      return;
    }

    // Request iOS 13+ DeviceOrientation permission on user tap so the directional cone tracks facing angle
    if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
      DeviceOrientationEvent.requestPermission()
        .then((state) => {
          if (state === 'granted') this._startCompassTracking();
        })
        .catch(() => {});
    } else {
      this._startCompassTracking();
    }

    if (this.gpsWatchId !== null) {
      // Already tracking — recenter map directly on current GPS position with deep zoom 19
      if (this.mapEngine && this.mapEngine.userGps) {
        const { lat, lng } = this.mapEngine.userGps;
        this.mapEngine.panTo(lat, lng, 19);
        const btn = document.getElementById('btn-gps-my-location');
        if (btn) {
          btn.innerHTML = `${window.AppIcons.crosshair()} Re-centered!`;
          setTimeout(() => {
            if (this.gpsWatchId !== null && this.mapEngine && this.mapEngine.userGps) {
              const acc = Math.round(this.mapEngine.userGps.accuracy || 0);
              const icon = acc <= 15 ? '●' : acc <= 40 ? '◉' : '○';
              btn.innerHTML = `${window.AppIcons.crosshair()} ${icon} ±${acc}m`;
            }
          }, 1200);
        }
      } else {
        this.stopRealtimeGps();
      }
    } else {
      this.startRealtimeGps({ silent: false });
    }
  }

  startRealtimeGps(opts = {}) {
    const silent = Boolean(opts.silent);
    const btn = document.getElementById('btn-gps-my-location');
    if (btn) {
      btn.classList.add('active');
      btn.innerHTML = `${window.AppIcons.crosshair()} Acquiring GPS...`;
    }

    this._startCompassTracking();

    // Track whether we've centered on real device location and the best accuracy seen
    this._gpsPannedOnce = false;
    this._bestGpsAccuracy = Infinity;

    const handleGpsPosition = (pos) => {
      const { latitude, longitude, accuracy, heading } = pos.coords;

      if (this.mapEngine) {
        // Update the GPS marker with real coordinates, accuracy circle, heading beam, and elastic Diclum border
        this.mapEngine.setUserGps(latitude, longitude, accuracy, heading);

        // Only auto-center the camera when we have an acceptable fix (<= 60m)
        if (accuracy <= 60) {
          if (!this._gpsPannedOnce) {
            this._gpsPannedOnce = true;
            this._bestGpsAccuracy = accuracy;
            const targetZoom = accuracy <= 20 ? 19 : 18;
            this.mapEngine.panTo(latitude, longitude, targetZoom);
          } else if (accuracy < this._bestGpsAccuracy - 20) {
            this._bestGpsAccuracy = accuracy;
            this.mapEngine.panTo(latitude, longitude, 19);
          }
        }
      }

      if (btn) {
        let accuracyStatus = '';
        if (accuracy <= 25) {
          accuracyStatus = `● ±${Math.round(accuracy)}m`;
        } else if (accuracy <= 60) {
          accuracyStatus = `◉ ±${Math.round(accuracy)}m`;
        } else {
          accuracyStatus = `○ ±${Math.round(accuracy)}m`;
        }
        btn.innerHTML = `${window.AppIcons.crosshair()} ${accuracyStatus}`;
        btn.title = `GPS Status:\nLat: ${latitude.toFixed(6)}\nLng: ${longitude.toFixed(6)}\nAccuracy: ±${Math.round(accuracy)}m${accuracy > 50 ? '\nTip: Move outdoors or turn ON "Precise Location" in phone settings for pinpoint accuracy.' : '\nHigh precision satellite lock.'}`;
      }

      if (this.isRecordingRoute) {
        this.appendRoutePoint(latitude, longitude, accuracy);
      }
    };

    // Immediate high-accuracy position probe + continuous real-time watchPosition stream
    navigator.geolocation.getCurrentPosition(handleGpsPosition, () => {}, {
      enableHighAccuracy: true,
      timeout: 12000,
      maximumAge: 0
    });

    this.gpsWatchId = navigator.geolocation.watchPosition(
      handleGpsPosition,
      (err) => {
        console.warn('GPS location error:', err);
        let msg = '';
        switch(err.code) {
          case 1:
            msg = 'Location permission denied.\n\nTo enable GPS:\n1. Tap the lock icon in the browser address bar\n2. Allow Location access (turn on "Precise Location")\n3. Refresh the page';
            break;
          case 2:
            msg = 'GPS signal unavailable. Make sure:\n• Location services are enabled on your device\n• You are outdoors or near a window for better satellite lock';
            break;
          case 3:
            msg = 'GPS request timed out. This can happen in areas with weak satellite coverage. Please try again outdoors.';
            break;
          default:
            msg = 'Unable to acquire GPS location: ' + err.message;
        }

        if (btn) {
          btn.classList.remove('active');
          btn.innerHTML = `${window.AppIcons.crosshair()} Live GPS`;
          btn.title = msg;
        }
        if (!silent) {
          alert(msg);
        }
        this.gpsWatchId = null;
      },
      {
        enableHighAccuracy: true,
        timeout: 25000,
        maximumAge: 0 // Always query hardware GPS, never accept stale cached coordinates
      }
    );
  }

  stopRealtimeGps() {
    if (this.gpsWatchId !== null) {
      navigator.geolocation.clearWatch(this.gpsWatchId);
      this.gpsWatchId = null;
    }
    this._stopCompassTracking();
    this._gpsPannedOnce = false;
    this._bestGpsAccuracy = Infinity;
    const btn = document.getElementById('btn-gps-my-location');
    if (btn) {
      btn.classList.remove('active');
      btn.innerHTML = `${window.AppIcons.crosshair()} Live GPS`;
      btn.title = 'Tap to enable GPS tracking';
    }
    if (this.mapEngine) {
      this.mapEngine.clearUserGps();
    }
  }

  restoreInstantGpsCache() {
    try {
      const cached = localStorage.getItem('dicklum_last_known_gps');
      if (cached && this.mapEngine) {
        const parsed = JSON.parse(cached);
        if (parsed && typeof parsed.lat === 'number' && typeof parsed.lng === 'number') {
          // Instant 1ms GPS marker restoration on startup
          this.mapEngine.setUserGps(parsed.lat, parsed.lng, parsed.accuracy || 15, parsed.heading || null);
          const btn = document.getElementById('btn-gps-my-location');
          if (btn) {
            btn.classList.add('active');
            const acc = Math.round(parsed.accuracy || 15);
            btn.innerHTML = `${window.AppIcons.crosshair()} ● ±${acc}m (cached)`;
          }
        }
      }
    } catch (e) {
      console.warn('Could not restore cached GPS:', e);
    }
  }

  toggleAllPinsVisibility() {
    if (!this.mapEngine) return;
    const isCurrentlyHidden = this.mapEngine.isPinsHidden;
    const newState = !isCurrentlyHidden;
    this.mapEngine.setPinsHidden(newState);

    const btnHeader = document.getElementById('btn-toggle-all-pins');
    const fabBtn = document.getElementById('fab-toggle-pins');

    [btnHeader, fabBtn].forEach(btn => {
      if (!btn) return;
      btn.classList.toggle('pins-hidden', newState);
      if (newState) {
        btn.title = 'Pins hidden (Search to reveal specific house/meter)';
      } else {
        btn.title = 'All pins visible';
      }
    });

    if (newState) {
      this.showToast('All pins hidden. Search consumer or meter to locate.', 2000);
    } else {
      this.showToast('All pins visible on map.', 1500);
    }
  }

  // --- Walking Route Recording (Phase 2, Section 7) ---

  startRouteRecording() {
    this.isRecordingRoute = true;
    this.recordedRoutePoints = [];
    this.routeRecordingStartTime = new Date();

    const bar = document.getElementById('route-recorder-bar');
    bar.classList.remove('hidden');
    bar.classList.add('recording');

    document.getElementById('route-pts-counter').textContent = '0 pts';
    document.getElementById('route-dist-counter').textContent = '0m';

    // Ensure GPS is running
    if (this.gpsWatchId === null) {
      this.startRealtimeGps();
    }
  }

  appendRoutePoint(lat, lng, accuracy) {
    const numLat = Number(lat);
    const numLng = Number(lng);

    // Suppress stationary jitter: don't record route point if moved < 2.5 meters
    if (this.recordedRoutePoints.length > 0) {
      const last = this.recordedRoutePoints[this.recordedRoutePoints.length - 1];
      const distFromLast = this.calculateDistanceMeters(last.lat, last.lng, numLat, numLng);
      if (distFromLast < 2.5) {
        return;
      }
    }

    const pt = {
      lat: numLat,
      lng: numLng,
      time: new Date().toISOString(),
      accuracy: Math.round(accuracy || 0)
    };

    this.recordedRoutePoints.push(pt);

    // Calculate approximate distance
    let dist = 0;
    for (let i = 1; i < this.recordedRoutePoints.length; i++) {
      dist += this.calculateDistanceMeters(
        this.recordedRoutePoints[i - 1].lat,
        this.recordedRoutePoints[i - 1].lng,
        this.recordedRoutePoints[i].lat,
        this.recordedRoutePoints[i].lng
      );
    }

    document.getElementById('route-pts-counter').textContent = `${this.recordedRoutePoints.length} pts`;
    document.getElementById('route-dist-counter').textContent = `${Math.round(dist)}m`;

    if (this.mapEngine) {
      this.mapEngine.setActiveRoute(this.recordedRoutePoints);
    }
  }

  async stopAndSaveRoute() {
    if (!this.isRecordingRoute) return;

    if (this.recordedRoutePoints.length < 2) {
      alert('Route has too few GPS points to save. Keep moving to record your path.');
      return;
    }

    const defaultName = `Route ${new Date().toLocaleDateString()} ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
    const routeName = prompt('Enter a name for this walking route (e.g., San Francisco Purok 2 Route):', defaultName);
    if (!routeName) return;

    let dist = 0;
    for (let i = 1; i < this.recordedRoutePoints.length; i++) {
      dist += this.calculateDistanceMeters(
        this.recordedRoutePoints[i - 1].lat,
        this.recordedRoutePoints[i - 1].lng,
        this.recordedRoutePoints[i].lat,
        this.recordedRoutePoints[i].lng
      );
    }

    const newRoute = {
      id: `route-${Date.now()}`,
      name: routeName.trim(),
      points: this.recordedRoutePoints,
      pointCount: this.recordedRoutePoints.length,
      distanceMeters: Math.round(dist),
      startedAt: this.routeRecordingStartTime.toISOString(),
      endedAt: new Date().toISOString(),
      createdAt: new Date().toISOString()
    };

    await window.db.saveRoute(newRoute);
    await this.refreshDataCache();
    this.syncRoutesToMap();

    // Reset recording state
    this.isRecordingRoute = false;
    this.recordedRoutePoints = [];
    if (this.mapEngine) this.mapEngine.setActiveRoute(null);

    const bar = document.getElementById('route-recorder-bar');
    bar.classList.add('hidden');
    bar.classList.remove('recording');

    alert(`Walking route "${newRoute.name}" (${newRoute.distanceMeters}m) saved successfully.`);
  }

  cancelRouteRecording() {
    if (!confirm('Are you sure you want to discard this walking route recording?')) return;
    this.isRecordingRoute = false;
    this.recordedRoutePoints = [];
    if (this.mapEngine) this.mapEngine.setActiveRoute(null);

    const bar = document.getElementById('route-recorder-bar');
    bar.classList.add('hidden');
    bar.classList.remove('recording');
  }

  calculateDistanceMeters(lat1, lon1, lat2, lon2) {
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

  // --- Reading Operations Flow & Validation (Phase 4) ---

  resetReadingViewToEmpty() {
    this.activeConsumer = null;
    this.activeMeter = null;

    const nameEl = document.getElementById('rdg-consumer-name');
    const acctEl = document.getElementById('rdg-account-no');
    const addrEl = document.getElementById('rdg-address');
    const zoneEl = document.getElementById('rdg-zone');
    const meterEl = document.getElementById('rdg-meter-no');

    if (nameEl) nameEl.textContent = 'No Consumer Selected';
    if (acctEl) acctEl.textContent = '—';
    if (addrEl) addrEl.textContent = 'Tap a water meter pin on the map or select below';
    if (zoneEl) zoneEl.textContent = '—';
    if (meterEl) meterEl.textContent = '—';

    const delBtn = document.getElementById('rdg-btn-delete-consumer');
    if (delBtn) delBtn.classList.add('hidden');

    const prevInput = document.getElementById('rdg-previous-input');
    const currInput = document.getElementById('rdg-current-input');
    if (prevInput) prevInput.value = 0;
    if (currInput) currInput.value = 0;

    const quickSelect = document.getElementById('rdg-quick-consumer-select');
    if (quickSelect) quickSelect.value = '';

    const historyContainer = document.getElementById('consumer-reading-history-list');
    if (historyContainer) {
      historyContainer.innerHTML = '<div style="font-size: 11px; color: #64748B; padding: 6px 0;">No consumer selected.</div>';
    }

    const dupAlert = document.getElementById('rdg-duplicate-alert');
    if (dupAlert) dupAlert.classList.add('hidden');

    const errorAlert = document.getElementById('rdg-error-alert');
    if (errorAlert) errorAlert.classList.add('hidden');

    this.updateLiveConsumption();
  }

  populateQuickConsumerSelect() {
    const select = document.getElementById('rdg-quick-consumer-select');
    if (!select) return;

    const currentVal = select.value;
    select.innerHTML = '<option value="">-- Choose Consumer or Water Meter --</option>';

    this.cachedConsumers.forEach(c => {
      const meter = this.cachedMeters.find(m => m.consumerId === c.id);
      const opt = document.createElement('option');
      opt.value = c.id;
      opt.textContent = `${c.name} (${c.accountNo}) - Meter: ${meter ? meter.meterNo : 'None'}`;
      select.appendChild(opt);
    });

    if (this.activeConsumer) {
      select.value = this.activeConsumer.id;
    } else if (currentVal) {
      select.value = currentVal;
    }
  }

  async startReadingForConsumer(consumerId) {
    this.closeConsumerSheet();
    this.closeClusterSheet();

    try {
      const data = await window.readingModule.loadConsumer(consumerId);
      this.activeConsumer = data.consumer;
      this.activeMeter = data.meter;

      document.getElementById('rdg-consumer-name').textContent = data.consumer.name;
      document.getElementById('rdg-account-no').textContent = data.consumer.accountNo;
      document.getElementById('rdg-address').textContent = data.consumer.address;
      document.getElementById('rdg-zone').textContent = data.consumer.zone;
      document.getElementById('rdg-meter-no').textContent = data.meter ? data.meter.meterNo : 'Unassigned';

      const delBtn = document.getElementById('rdg-btn-delete-consumer');
      if (delBtn) delBtn.classList.remove('hidden');

      const prevInput = document.getElementById('rdg-previous-input');
      const currInput = document.getElementById('rdg-current-input');
      if (prevInput) prevInput.value = data.previousReading;
      if (currInput) currInput.value = data.previousReading;

      this.populateQuickConsumerSelect();
      const quickSelect = document.getElementById('rdg-quick-consumer-select');
      if (quickSelect) quickSelect.value = consumerId;

      // Render Consumer Reading History in Reading Screen (Phase 4, Section 12)
      this.renderConsumerReadingHistory(data.history || []);

      // Duplicate Check
      const existingReading = await window.readingModule.checkDuplicate(consumerId, this.activeBillingCode);
      const duplicateWarning = document.getElementById('rdg-duplicate-alert');
      if (existingReading) {
        duplicateWarning.classList.remove('hidden');
        duplicateWarning.innerHTML = `
          <strong>Duplicate Notice:</strong> A reading has already been recorded for ${data.consumer.name} for ${this.activeBillingPeriod}. 
          Previous: ${existingReading.previousReading} m³, Current: ${existingReading.currentReading} m³ (${existingReading.consumption} m³).
        `;
      } else {
        duplicateWarning.classList.add('hidden');
      }

      this.updateLiveConsumption();
      this.switchView('view-reading');
    } catch (err) {
      alert(`Error loading reading: ${err.message}`);
    }
  }

  renderConsumerReadingHistory(history) {
    const container = document.getElementById('consumer-reading-history-list');
    if (!container) return;

    if (!history || history.length === 0) {
      container.innerHTML = '<div style="font-size: 11px; color: #64748B; padding: 6px 0;">No prior historical readings recorded.</div>';
      return;
    }

    container.innerHTML = history.slice(0, 5).map(h => `
      <div style="display: flex; justify-content: space-between; padding: 5px 0; border-bottom: 1px solid #E2E8F0; font-size: 11px;">
        <span><strong>${h.billingPeriod}</strong> (${new Date(h.readingDate).toLocaleDateString()})</span>
        <span>${h.previousReading} → <strong>${h.currentReading} m³</strong> (<span style="color: var(--primary); font-weight:700;">${h.consumption} m³</span>)</span>
      </div>
    `).join('');
  }

  updateLiveConsumption() {
    const prevInput = document.getElementById('rdg-previous-input');
    const currInput = document.getElementById('rdg-current-input');
    const prev = prevInput ? (Number(prevInput.value) || 0) : 0;
    const curr = currInput ? (Number(currInput.value) || 0) : 0;
    const isOverride = document.getElementById('rdg-override-checkbox').checked;

    const rawTariff = (this.cachedSettings && this.cachedSettings.tariff) ? this.cachedSettings.tariff : {};
    const activeTariff = Object.assign({}, rawTariff, {
      minimumCharge: Number(rawTariff.minimumCharge ?? rawTariff.minimumChargePesos) || 100.00,
      minimumAllowance: Number(rawTariff.minimumAllowance ?? rawTariff.minimumCoverageM3) || 10,
      excessRate: Number(rawTariff.excessRate ?? rawTariff.excessPerM3Pesos) || 15.00
    });

    const calculation = window.billingEngine.calculate(prev, curr, activeTariff);
    const usage = curr - prev;

    const errorAlert = document.getElementById('rdg-error-alert');
    const warningBox = document.getElementById('rdg-excess-warning-box');
    const saveBtn = document.getElementById('btn-save-reading');
    const savePrintBtn = document.getElementById('btn-save-print-reading');

    // 1. Check for Negative Consumption
    if (usage < 0 && !isOverride) {
      if (errorAlert) {
        errorAlert.classList.remove('hidden');
        errorAlert.innerHTML = `
          <strong>Invalid Reading:</strong> Current reading (${curr} m³) cannot be lower than Previous reading (${prev} m³). 
          Negative consumption (${usage} m³) is prohibited. Please verify the physical meter or check 'Meter Replacement / Rollover Override'.
        `;
      }
      if (saveBtn) saveBtn.disabled = true;
      if (savePrintBtn) savePrintBtn.disabled = true;
    } else {
      if (errorAlert) errorAlert.classList.add('hidden');
      if (saveBtn) saveBtn.disabled = false;
      if (savePrintBtn) savePrintBtn.disabled = false;
    }

    // 2. Check for Unconfigured Excess Rate (Phase 5, Section 13)
    if (calculation.isExcessRateRequired) {
      if (warningBox) {
        warningBox.classList.remove('hidden');
        warningBox.innerHTML = `
          <strong>Tariff Action Required:</strong> ${calculation.formulaExplanation}
        `;
      }
      if (saveBtn) saveBtn.disabled = true;
      if (savePrintBtn) savePrintBtn.disabled = true;
    } else {
      if (warningBox) warningBox.classList.add('hidden');
    }

    const calcPrevEl = document.getElementById('rdg-calc-prev');
    const calcCurrEl = document.getElementById('rdg-calc-curr');
    const calcUsageEl = document.getElementById('rdg-calc-usage');
    const calcMinEl = document.getElementById('rdg-calc-min-charge');
    const calcExcessEl = document.getElementById('rdg-calc-excess-charge');
    const calcTotalEl = document.getElementById('rdg-calc-total-due');
    const calcExpEl = document.getElementById('rdg-calc-explanation');

    if (calcPrevEl) calcPrevEl.textContent = `${prev.toLocaleString()} m³`;
    if (calcCurrEl) calcCurrEl.textContent = `${curr.toLocaleString()} m³`;
    if (calcUsageEl) calcUsageEl.textContent = `${Math.max(0, usage).toLocaleString()} m³`;
    if (calcMinEl) calcMinEl.textContent = `PHP ${calculation.minimumCharge.toFixed(2)}`;
    if (calcExcessEl) calcExcessEl.textContent = calculation.isExcessRateRequired ? 'Unset' : `PHP ${calculation.excessCharge.toFixed(2)}`;
    if (calcTotalEl) calcTotalEl.textContent = calculation.isExcessRateRequired ? 'Requires Tariff' : `PHP ${calculation.totalAmountDue.toFixed(2)}`;
    if (calcExpEl) calcExpEl.textContent = calculation.formulaExplanation;
  }

  async submitReading(andPrint = false) {
    if (!this.activeConsumer) {
      alert('Please select a consumer first before saving a reading.');
      return;
    }

    const prevInput = document.getElementById('rdg-previous-input');
    const currInput = document.getElementById('rdg-current-input');
    const prev = prevInput ? (Number(prevInput.value) || 0) : 0;
    const curr = currInput ? (Number(currInput.value) || 0) : 0;
    const isOverride = document.getElementById('rdg-override-checkbox').checked;
    const notes = document.getElementById('rdg-notes-input').value;
    const photoDataUrl = document.getElementById('rdg-photo-preview').dataset.src || null;

    if (curr < prev && !isOverride) {
      alert('Cannot save reading: Current reading is less than previous reading without replacement override.');
      return;
    }

    try {
      const result = await window.readingModule.saveReading({
        consumerId: this.activeConsumer.id,
        meterId: this.activeMeter ? this.activeMeter.id : null,
        billingPeriod: this.activeBillingCode,
        previousReading: prev,
        currentReading: curr,
        readerName: this.cachedSettings.reader ? this.cachedSettings.reader.name : 'R. Fernandez',
        notes: notes,
        isRolloverOverride: isOverride,
        photoDataUrl: photoDataUrl
      });

      await this.refreshDataCache();
      this.syncPinsToMap();
      this.renderConsumerList();
      this.renderBillingList();
      await this.renderZoneExportCenter();
      this.autoSyncToOfficePcSilent();

      if (andPrint) {
        this.openThermalReceiptModal(result.bill.id);
      } else {
        alert(`Reading saved successfully for ${this.activeConsumer.name}.\nConsumption: ${result.reading.consumption} m³ | Amount Due: PHP ${result.bill.totalAmountDue.toFixed(2)}`);
        this.switchView('view-map');
      }
    } catch (err) {
      alert(`Cannot save reading: ${err.message}`);
    }
  }

  // --- Printing Modals (Phase 6) ---

  async openThermalReceiptModal(billId) {
    const bill = await window.db.get('bills', billId);
    if (!bill) return;

    const consumer = await window.db.get('consumers', bill.consumerId);
    const meter = bill.meterId ? await window.db.get('meters', bill.meterId) : null;
    this.activeBill = bill;

    const is58 = window.thermalPrinter.paperWidth === '58mm';
    const paper = document.getElementById('thermal-paper-content');

    const divider = '-'.repeat(is58 ? 32 : 44);
    const doubleDivider = '='.repeat(is58 ? 32 : 44);

    paper.innerHTML = `
      <div class="thermal-receipt ${is58 ? 'w-58' : 'w-80'}">
        <div class="t-center t-bold t-large">DICKLUM WATER</div>
        <div class="t-center t-bold">ASSOCIATION, INC.</div>
        <div class="t-center t-small">Dicklum, Manolo Fortich, Bukidnon</div>
        <div class="t-center t-small">SEC Reg. CN2014-99120 | TIN: 008-721-432</div>
        <div class="t-center t-bold">OFFICIAL WATER BILL NOTICE</div>
        <div class="t-divider">${doubleDivider}</div>

        <div class="t-row"><span>Bill Ref :</span><span>${bill.id}</span></div>
        <div class="t-row"><span>Date     :</span><span>${bill.billDate}</span></div>
        <div class="t-row"><span>Period   :</span><span>${bill.billingPeriod}</span></div>
        <div class="t-row"><span>Due Date :</span><span class="t-bold text-danger">${bill.dueDate}</span></div>
        <div class="t-divider">${divider}</div>

        <div class="t-row"><span>Consumer :</span><span class="t-bold">${consumer.name}</span></div>
        <div class="t-row"><span>Acct No  :</span><span>${consumer.accountNo}</span></div>
        <div class="t-row"><span>Zone     :</span><span>${consumer.zone}</span></div>
        <div class="t-row"><span>Meter No :</span><span>${meter ? meter.meterNo : 'N/A'}</span></div>
        <div class="t-divider">${divider}</div>

        <div class="t-row t-bold"><span>DESCRIPTION</span><span>AMOUNT</span></div>
        <div class="t-row"><span>Previous Reading:</span><span>${bill.previousReading.toLocaleString()} m³</span></div>
        <div class="t-row"><span>Current Reading:</span><span>${bill.currentReading.toLocaleString()} m³</span></div>
        <div class="t-row t-bold text-primary"><span>Consumption:</span><span>${bill.consumption.toLocaleString()} m³</span></div>
        <div class="t-divider">${divider}</div>

        <div class="t-row"><span>Min Charge (10 m³):</span><span>PHP ${bill.minimumCharge.toFixed(2)}</span></div>
        ${bill.excessCubicMeters > 0 ? `<div class="t-row"><span>Excess (${bill.excessCubicMeters}m³@PHP ${bill.excessRate}):</span><span>PHP ${bill.excessAmount.toFixed(2)}</span></div>` : ''}
        ${bill.maintenanceFee > 0 ? `<div class="t-row"><span>Maintenance Fee:</span><span>PHP ${bill.maintenanceFee.toFixed(2)}</span></div>` : ''}
        <div class="t-divider">${doubleDivider}</div>

        <div class="t-center t-bold t-total">TOTAL DUE: PHP ${bill.totalAmountDue.toFixed(2)}</div>
        <div class="t-divider">${doubleDivider}</div>

        <div class="t-center t-small">Reader: ${bill.readerName || 'R. Fernandez'}</div>
        <div class="t-center t-small">Payment Status: <strong>${bill.paymentStatus}</strong></div>
        <div class="t-center t-warning t-small">*** THIS BILL IS NOT A PAYMENT RECEIPT ***</div>
        <div class="t-center t-small">Please settle on or before due date to avoid service disconnection.</div>
        <div class="t-center t-small">Conserve water for the community.</div>
      </div>
    `;

    document.getElementById('modal-thermal-preview').classList.add('active');
  }

  async openA4StatementModal(billId) {
    const bill = await window.db.get('bills', billId);
    if (!bill) return;

    const consumer = await window.db.get('consumers', bill.consumerId);
    const meter = bill.meterId ? await window.db.get('meters', bill.meterId) : null;
    this.activeBill = bill;

    const container = document.getElementById('a4-statement-content');
    container.innerHTML = window.a4StatementGenerator.generateHTML(bill, consumer, meter, this.cachedSettings);

    document.getElementById('modal-a4-preview').classList.add('active');
  }

  // Alias methods for modal triggers from consumer history & external calls
  openThermalReceipt(billId) {
    return this.openThermalReceiptModal(billId);
  }

  openA4Statement(billId) {
    return this.openA4StatementModal(billId);
  }

  async deleteConsumerRecord(consumerId) {
    const consumer = this.cachedConsumers.find(c => c.id === consumerId);
    const name = consumer ? consumer.name : `Consumer #${consumerId}`;
    if (!confirm(`Permanently delete consumer "${name}"?\n\nThis will also remove their water meter registration and associated billing/reading history.`)) {
      return;
    }

    try {
      // 1. Delete consumer from IndexedDB
      await window.db.delete('consumers', consumerId);

      // 2. Delete associated water meters
      const associatedMeters = this.cachedMeters.filter(m => m.consumerId === consumerId);
      for (const m of associatedMeters) {
        await window.db.delete('meters', m.id);
      }

      // 3. Delete associated bills and readings
      const associatedBills = this.cachedBills.filter(b => b.consumerId === consumerId);
      for (const b of associatedBills) {
        await window.db.delete('bills', b.id);
      }
      const readings = await window.db.getAll('readings');
      const associatedReadings = readings.filter(r => r.consumerId === consumerId);
      for (const r of associatedReadings) {
        await window.db.delete('readings', r.id);
      }

      // 4. Close any open sheets or modals if this consumer was active
      if (this.activeConsumer && this.activeConsumer.id === consumerId) {
        this.closeConsumerSheet();
        this.resetReadingViewToEmpty();
      }

      const historyModal = document.getElementById('modal-consumer-history');
      if (historyModal && historyModal.classList.contains('active')) {
        historyModal.classList.remove('active');
      }

      // 5. Refresh cache and update UI
      await this.refreshDataCache();
      this.syncPinsToMap();
      this.syncRoutesToMap();
      this.renderConsumerList();
      this.renderBillingList();
      this.populateQuickConsumerSelect();
      this.renderStats();
      if (this.activeView === 'view-settings') {
        await this.renderSettingsZonesAndClusters();
      }

      alert(`Consumer "${name}" has been permanently deleted.`);
    } catch (err) {
      console.error('Error deleting consumer:', err);
      alert(`Failed to delete consumer: ${err.message}`);
    }
  }

  async deleteBillRecord(billId) {
    if (!confirm(`Are you sure you want to permanently delete billing statement #${billId}?`)) {
      return;
    }

    try {
      await window.db.delete('bills', billId);
      await this.refreshDataCache();
      this.renderBillingList();
      this.renderStats();

      // If consumer history modal is open, refresh it
      if (this.activeConsumer) {
        const historyModal = document.getElementById('modal-consumer-history');
        if (historyModal && historyModal.classList.contains('active')) {
          await this.openConsumerHistoryModal(this.activeConsumer.id);
        }
      }

      alert(`Billing statement #${billId} deleted.`);
    } catch (err) {
      console.error('Error deleting bill:', err);
      alert(`Failed to delete billing record: ${err.message}`);
    }
  }

  async unpinActiveConsumerOrMeter() {
    // 1. User tapped a WATER METER pin -> delete ONLY the Water Meter pin (keep the Household pin intact!)
    if (this.activePinType === 'meter' && this.activeMeter) {
      const meter = this.activeMeter;
      const meterNo = meter.meterNo || 'Water Meter';
      const consumer = this.activeConsumer || (meter.consumerId ? this.cachedConsumers.find(c => c.id === meter.consumerId) : null);
      const hasHouseholdPin = Boolean(consumer && consumer.householdLat && consumer.householdLng);
      const otherMeters = consumer
        ? this.cachedMeters.filter(m => m.id !== meter.id && m.consumerId === consumer.id)
        : [];

      const confirmMsg = hasHouseholdPin
        ? `Delete Water Meter pin "${meterNo}" for "${consumer.name}"?\n\nOnly the Water Meter pin will be removed — "${consumer.name}"'s Household pin will remain on the map.`
        : `Delete Water Meter pin "${meterNo}"${consumer ? ` for "${consumer.name}"` : ''}?`;

      if (!confirm(confirmMsg)) {
        return;
      }

      try {
        await window.db.delete('meters', meter.id);

        // Only delete the consumer record if they have NO Household pin and NO other Water Meters left
        if (consumer && !hasHouseholdPin && otherMeters.length === 0) {
          await window.db.delete('consumers', consumer.id);
        }

        this.activeMeter = null;
        this.activePinType = null;
        this.closeConsumerSheet();
        await this.refreshDataCache();
        this.syncPinsToMap();
        this.renderConsumerList();
        this.populateQuickConsumerSelect();
        this.renderStats();
        try { await this.renderZoneExportCenter(); } catch (_) {}
        this.autoSyncToOfficePcSilent();

        if (hasHouseholdPin) {
          this.showToast(`Water Meter "${meterNo}" deleted. Household pin for ${consumer.name} kept on map.`, 3200);
        } else {
          this.showToast(`Water Meter "${meterNo}" deleted.`, 2600);
        }
      } catch (err) {
        console.error('Error deleting meter pin:', err);
        alert(`Failed to delete water meter pin: ${err.message}`);
      }
      return;
    }

    // 2. User tapped a HOUSEHOLD pin -> delete ONLY the Household pin if a Water Meter exists!
    if (this.activeConsumer) {
      const consumer = this.activeConsumer;
      const linkedMeters = this.cachedMeters.filter(
        m => m.consumerId === consumer.id ||
             ((m.ownerName || '').trim().toLowerCase() === (consumer.name || '').trim().toLowerCase())
      );
      const hasPinnedMeter = linkedMeters.some(m => m.meterLat && m.meterLng);

      if (hasPinnedMeter || linkedMeters.length > 0) {
        const meterLabels = linkedMeters.map(m => m.meterNo).join(', ');
        if (!confirm(`Delete Household pin for "${consumer.name}"?\n\nOnly the Household pin will be removed — Water Meter (${meterLabels}) will remain on the map.`)) {
          return;
        }
        try {
          consumer.householdLat = null;
          consumer.householdLng = null;
          await window.db.put('consumers', consumer);

          this.activeConsumer = null;
          this.activePinType = null;
          this.closeConsumerSheet();
          await this.refreshDataCache();
          this.syncPinsToMap();
          this.renderConsumerList();
          this.populateQuickConsumerSelect();
          this.renderStats();
          try { await this.renderZoneExportCenter(); } catch (_) {}
          this.autoSyncToOfficePcSilent();

          this.showToast(`Household pin for "${consumer.name}" deleted. Water Meter (${meterLabels}) kept on map.`, 3200);
        } catch (err) {
          console.error('Error removing household pin:', err);
          alert(`Failed to delete household pin: ${err.message}`);
        }
        return;
      }

      // Consumer has no water meters at all -> delete the consumer record completely
      await this.deleteConsumerRecord(consumer.id);
      return;
    }

    // Fallback for standalone unassigned meter
    if (this.activeMeter) {
      const meterNo = this.activeMeter.meterNo;
      if (!confirm(`Delete Water Meter pin "${meterNo}"?`)) {
        return;
      }
      try {
        await window.db.delete('meters', this.activeMeter.id);
        this.activeMeter = null;
        this.activePinType = null;
        this.closeConsumerSheet();
        await this.refreshDataCache();
        this.syncPinsToMap();
        this.renderConsumerList();
        this.populateQuickConsumerSelect();
        this.renderStats();
        this.showToast(`Water meter "${meterNo}" deleted.`);
      } catch (err) {
        console.error('Error deleting meter:', err);
        alert(`Failed to delete meter: ${err.message}`);
      }
    }
  }

  async unpinActiveCluster() {
    if (!this.activeCluster) return;
    const name = this.activeCluster.name;
    if (!confirm(`Remove pinned GPS location for cluster manifold "${name}"?\n\nThe cluster manifold definition stays saved; only the map pin is cleared.`)) {
      return;
    }

    try {
      this.activeCluster.lat = null;
      this.activeCluster.lng = null;
      await window.db.put('clusters', this.activeCluster);

      this.closeClusterSheet();
      this.cachedClusters = await window.db.getAll('clusters');
      this.syncPinsToMap();
      if (this.activeView === 'view-settings') {
        await this.renderSettingsZonesAndClusters();
      }
      alert(`GPS pin for cluster manifold "${name}" has been removed.`);
    } catch (err) {
      console.error('Error unpinning cluster:', err);
      alert(`Failed to remove cluster pin: ${err.message}`);
    }
  }

  async downloadElementAsPdf(element, filename) {
    if (!element) return;
    filename = filename || 'document.pdf';
    if (!filename.endsWith('.pdf')) filename += '.pdf';

    const activeBtn = document.activeElement;
    let origText = '';
    if (activeBtn && activeBtn.tagName === 'BUTTON') {
      origText = activeBtn.innerHTML;
      activeBtn.disabled = true;
      activeBtn.innerHTML = `
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="animation:spin 1s linear infinite"><circle cx="12" cy="12" r="10"/><path d="M12 2a10 10 0 0 1 10 10"/></svg>
        Saving PDF...
      `;
    }

    try {
      if (typeof html2pdf !== 'undefined') {
        const opt = {
          margin: [8, 8, 8, 8],
          filename: filename,
          image: { type: 'jpeg', quality: 0.98 },
          html2canvas: { scale: 2, useCORS: true, logging: false },
          jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' }
        };
        await html2pdf().set(opt).from(element).save();
      } else {
        // Fallback: standalone print window
        const printWindow = window.open('', '_blank');
        if (printWindow) {
          printWindow.document.write(`
            <!DOCTYPE html>
            <html>
            <head>
              <title>${filename}</title>
              <link rel="stylesheet" href="css/styles.css">
              <link rel="stylesheet" href="css/print-a4.css">
              <style>
                @page { size: A4; margin: 8mm; }
                body { margin: 0; padding: 10px; background: #fff; font-family: sans-serif; }
              </style>
            </head>
            <body>
              ${element.innerHTML}
              <script>
                window.onload = function() { window.print(); }
              <\/script>
            </body>
            </html>
          `);
          printWindow.document.close();
        } else {
          document.body.classList.add('printing-a4');
          window.print();
          setTimeout(() => document.body.classList.remove('printing-a4'), 1000);
        }
      }
    } catch (err) {
      console.error('Error generating PDF:', err);
      alert('PDF generation encountered an error: ' + err.message + '. Opening print preview instead.');
      window.print();
    } finally {
      if (activeBtn && origText) {
        activeBtn.disabled = false;
        activeBtn.innerHTML = origText;
      }
    }
  }

  async executeThermalPrint() {
    if (!this.activeBill) return;

    const consumer = await window.db.get('consumers', this.activeBill.consumerId);
    const meter = this.activeBill.meterId ? await window.db.get('meters', this.activeBill.meterId) : null;

    const result = await window.thermalPrinter.printBill(this.activeBill, consumer, meter, this.cachedSettings);
    if (result.success) {
      await this.refreshDataCache();
      this.renderBillingList();
    }
  }

  async executeBrowserThermalPrint() {
    document.body.classList.add('printing-thermal');
    document.body.classList.remove('printing-a4');
    window.print();
    setTimeout(() => {
      document.body.classList.remove('printing-thermal');
    }, 1000);
  }

  updatePrinterUIStatus(status, details) {
    const statusPill = document.getElementById('printer-status-pill');
    const detailsEl = document.getElementById('printer-status-details');

    if (statusPill) {
      statusPill.textContent = status.toUpperCase();
      statusPill.className = `badge badge-${status === 'connected' ? 'success' : status === 'error' ? 'danger' : 'warning'}`;
    }
    if (detailsEl) {
      detailsEl.textContent = details;
    }
  }

  // --- Payment Tracking (Phase 7, Section 17) ---

  openPaymentModal(billId) {
    const bill = this.cachedBills.find(b => b.id === billId);
    if (!bill) return;

    const consumer = this.cachedConsumers.find(c => c.id === bill.consumerId);
    this.activeBill = bill;

    document.getElementById('pay-bill-id').textContent = bill.id;
    document.getElementById('pay-consumer-name').textContent = consumer ? consumer.name : 'Unknown';
    document.getElementById('pay-amount-due').textContent = `PHP ${bill.totalAmountDue.toFixed(2)}`;
    document.getElementById('pay-amount-input').value = bill.totalAmountDue;
    document.getElementById('pay-or-input').value = `OR-${Date.now().toString().slice(-6)}`;
    document.getElementById('pay-collector-input').value = this.cachedSettings.reader ? this.cachedSettings.reader.name : 'R. Fernandez';

    document.getElementById('modal-record-payment').classList.add('active');
  }

  async submitPayment() {
    if (!this.activeBill) return;

    const amount = Number(document.getElementById('pay-amount-input').value);
    const orNumber = document.getElementById('pay-or-input').value;
    const collector = document.getElementById('pay-collector-input').value;

    try {
      await window.billingEngine.recordPayment(this.activeBill.id, {
        amountPaid: amount,
        orNumber: orNumber,
        collectorName: collector,
        paymentDate: new Date().toISOString().split('T')[0]
      });

      await this.refreshDataCache();
      this.renderBillingList();
      document.getElementById('modal-record-payment').classList.remove('active');
      alert(`Payment of PHP ${amount.toFixed(2)} recorded under Official Receipt ${orNumber}.`);
    } catch (err) {
      alert(`Error recording payment: ${err.message}`);
    }
  }

  // --- Consumer Management & Pinning (Phase 2 & 3) ---

  showToast(message, durationMs = 2400) {
    const host = document.getElementById('toast-host');
    if (!host) return;
    const el = document.createElement('div');
    el.className = 'toast';
    el.textContent = message;
    host.appendChild(el);
    setTimeout(() => {
      el.classList.add('out');
      setTimeout(() => el.remove(), 260);
    }, durationMs);
  }

  shortZoneLabel(zoneName) {
    if (!zoneName) return 'Zone';
    const parts = String(zoneName).split(/\s*[–—-]\s*/);
    return parts[0].trim();
  }

  zoneSubtitle(zoneName) {
    if (!zoneName) return '';
    const parts = String(zoneName).split(/\s*[–—-]\s*/);
    return parts.slice(1).join(' – ').trim();
  }

  async renderMapZoneChips() {
    const container = document.getElementById('map-zone-chips');
    if (!container) return;

    const zones = await window.db.getZones();
    const allPins = (this.mapEngine && this.mapEngine._pins) ? this.mapEngine._pins : [];
    const activeZone = (this.mapEngine && this.mapEngine._zoneFilter) ? this.mapEngine._zoneFilter : '';

    // Count pins per zone
    const countForZone = (z) => allPins.filter(p => {
      const pz = (p.data && p.data.zone) || p.zone || '';
      return z ? pz === z : true;
    }).length;

    container.innerHTML = '';

    const allChip = document.createElement('button');
    allChip.type = 'button';
    allChip.className = `zone-chip ${activeZone === '' ? 'active' : ''}`;
    allChip.dataset.zone = '';
    allChip.innerHTML = `<span>All Zones</span><span class="zc-count">${countForZone('')}</span>`;
    container.appendChild(allChip);

    zones.forEach(z => {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = `zone-chip ${activeZone === z ? 'active' : ''}`;
      chip.dataset.zone = z;
      chip.title = z;
      chip.innerHTML = `<span>${this.shortZoneLabel(z)}</span><span class="zc-count">${countForZone(z)}</span>`;
      container.appendChild(chip);
    });
  }

  updateMapTypeSegmentCounts() {
    const allPins = (this.mapEngine && this.mapEngine._pins) ? this.mapEngine._pins : [];
    const zf = (this.mapEngine && this.mapEngine._zoneFilter) ? this.mapEngine._zoneFilter : null;

    const inZone = allPins.filter(p => {
      if (!zf) return true;
      const pz = (p.data && p.data.zone) || p.zone || '';
      return pz === zf;
    });

    const houseCount = inZone.filter(p => p.type === 'household').length;
    const meterCount = inZone.filter(p => p.type === 'meter' || p.type === 'cluster').length;

    const elHouse = document.getElementById('seg-count-household');
    const elMeter = document.getElementById('seg-count-meter');
    if (elHouse) elHouse.textContent = houseCount;
    if (elMeter) elMeter.textContent = meterCount;
  }

  async populateZoneDropdowns(selectedZone = null) {
    const zones = await window.db.getZones();
    const zoneSelect = document.getElementById('pin-zone-select');
    if (zoneSelect) {
      const prevVal = selectedZone || zoneSelect.value;
      zoneSelect.innerHTML = '';
      zones.forEach(z => {
        const opt = document.createElement('option');
        opt.value = z;
        opt.textContent = z;
        zoneSelect.appendChild(opt);
      });
      if (prevVal && zones.includes(prevVal)) {
        zoneSelect.value = prevVal;
      } else if (zones.length > 0) {
        zoneSelect.value = zones[0];
      }
    }

    const currentZone = zoneSelect ? zoneSelect.value : null;
    await this.updateClusterDropdownForZone(currentZone);
    await this.renderSettingsZonesAndClusters();
    await this.renderMapZoneChips();
  }

  async updateClusterDropdownForZone(zone, selectedClusterId = null) {
    const selectCluster = document.getElementById('pin-cluster-select');
    if (!selectCluster) return;

    const clustersInZone = await window.db.getClustersByZone(zone);
    selectCluster.innerHTML = '<option value="">-- Individual Standalone Meter (No Cluster) --</option>';
    clustersInZone.forEach(cl => {
      const opt = document.createElement('option');
      opt.value = cl.id;
      opt.textContent = `${cl.name} (Purok/Zone: ${cl.zone || 'Unassigned'})`;
      selectCluster.appendChild(opt);
    });

    if (selectedClusterId) {
      selectCluster.value = selectedClusterId;
    }

    const badge = document.getElementById('pin-cluster-zone-badge');
    if (badge) {
      if (!zone) {
        badge.textContent = 'Showing clusters across all zones. Standalone meters do not belong to a cluster manifold.';
      } else if (clustersInZone.length === 0) {
        badge.innerHTML = `No clusters in <strong>${zone}</strong> yet. Tap <em>"+ New Cluster in Zone"</em> to create one.`;
      } else {
        badge.innerHTML = `<strong>${clustersInZone.length} cluster manifold(s)</strong> available in <strong>${zone}</strong>.`;
      }
    }
  }

  async renderSettingsZonesAndClusters() {
    const zonesList = document.getElementById('settings-zones-list');
    const clustersList = document.getElementById('settings-clusters-list');
    const zonesCountBadge = document.getElementById('settings-zones-count');
    if (!zonesList && !clustersList) return;

    const zones = await window.db.getZones();
    const clusters = await window.db.getAll('clusters');
    const consumers = this.cachedConsumers || [];

    if (zonesCountBadge) {
      zonesCountBadge.textContent = `${zones.length} ZONES`;
    }

    if (zonesList) {
      zonesList.innerHTML = '';
      zones.forEach(zone => {
        const zoneConsumers = consumers.filter(c => c.zone === zone);
        const zoneClusters = clusters.filter(cl => cl.zone === zone);
        const item = document.createElement('div');
        item.style.cssText = 'display: flex; justify-content: space-between; align-items: center; background: var(--surface-alt); padding: 6px 10px; border-radius: var(--radius-xs); border: 1px solid var(--border-color); font-size: 11.5px;';
        item.innerHTML = `
          <div>
            <strong>${zone}</strong>
            <span style="font-size: 10px; color: var(--text-muted); margin-left: 6px;">(${zoneConsumers.length} consumers, ${zoneClusters.length} clusters)</span>
          </div>
          <button type="button" class="btn btn-xs btn-outline btn-delete-zone" data-zone="${zone}" style="color: var(--danger); padding: 1px 6px;">Delete</button>
        `;
        zonesList.appendChild(item);
      });
    }

    if (clustersList) {
      clustersList.innerHTML = '';
      if (clusters.length === 0) {
        clustersList.innerHTML = '<div style="font-size: 11px; color: var(--text-muted); padding: 4px;">No meter clusters registered yet. Clusters group multiple meters sharing a single physical water manifold.</div>';
      } else {
        clusters.forEach(cl => {
          const item = document.createElement('div');
          item.style.cssText = 'display: flex; justify-content: space-between; align-items: center; background: var(--surface-alt); padding: 6px 10px; border-radius: var(--radius-xs); border: 1px solid var(--border-color); font-size: 11.5px;';
          item.innerHTML = `
            <div>
              <strong>${cl.name}</strong>
              <div style="font-size: 10px; color: var(--text-secondary);">Zone: ${cl.zone || 'Unassigned'}</div>
            </div>
            <button type="button" class="btn btn-xs btn-outline btn-delete-cluster" data-cluster-id="${cl.id}" style="color: var(--danger); padding: 1px 6px;">Delete</button>
          `;
          clustersList.appendChild(item);
        });
      }
    }
  }

  async openAddPinWizard(lat, lng, opts = {}) {
    if (!lat || !lng || isNaN(lat) || isNaN(lng)) {
      if (this.mapEngine && this.mapEngine._map) {
        const center = this.mapEngine._map.getCenter();
        lat = center.lat;
        lng = center.lng;
      } else {
        lat = 8.3688;
        lng = 124.8630;
      }
    }

    this._wizardLat = Number(lat);
    this._wizardLng = Number(lng);
    this._wizardFromGps = Boolean(opts.fromGpsButton);

    // Default pin type: use active map filter if set to household/meter, otherwise opts.pinType or 'household'
    const mapFilterType = (this.mapEngine && (this.mapEngine._filterMode === 'household' || this.mapEngine._filterMode === 'meter'))
      ? this.mapEngine._filterMode
      : null;
    this._wizardPinType = opts.pinType || mapFilterType || this._wizardPinType || 'household';

    const locText = document.getElementById('wizard-location-text');
    if (locText) {
      locText.textContent = this._wizardFromGps
        ? `GPS Standing Location · ${this._wizardLat.toFixed(5)}, ${this._wizardLng.toFixed(5)}`
        : `Map Location · ${this._wizardLat.toFixed(5)}, ${this._wizardLng.toFixed(5)}`;
    }

    const gpsBtn = document.getElementById('btn-wizard-use-gps');
    const gpsLabel = document.getElementById('wizard-gps-label');
    if (gpsBtn && gpsLabel) {
      if (this._wizardFromGps) {
        gpsBtn.classList.add('locked');
        gpsLabel.textContent = `GPS Locked (${this._wizardLat.toFixed(5)}, ${this._wizardLng.toFixed(5)}) — Choose Zone below`;
      } else {
        gpsBtn.classList.remove('locked', 'locking');
        gpsLabel.textContent = 'Use my current GPS (where I am standing)';
      }
    }

    document.querySelectorAll('.wizard-type-card').forEach(card => {
      card.classList.toggle('active', card.dataset.type === this._wizardPinType);
    });

    await this.renderWizardZoneCards();

    const dropModal = document.getElementById('modal-drop-pin');
    if (dropModal) dropModal.classList.remove('active');

    const wizModal = document.getElementById('modal-add-pin-wizard');
    if (wizModal) wizModal.classList.add('active');
  }

  async renderWizardZoneCards() {
    const grid = document.getElementById('wizard-zone-grid');
    if (!grid) return;

    const zones = await window.db.getZones();
    const consumers = this.cachedConsumers || [];
    const meters = this.cachedMeters || [];
    const suggestedZone = (this.mapEngine && this.mapEngine._zoneFilter) || this._lastSelectedZone || zones[0] || '';

    grid.innerHTML = '';

    zones.forEach(z => {
      const houseCount = consumers.filter(c => c.zone === z && c.householdLat && c.householdLng).length;
      const meterCount = meters.filter(m => {
        const c = consumers.find(con => con.id === m.consumerId);
        const mz = m.zone || (c ? c.zone : '');
        return mz === z && m.meterLat && m.meterLng;
      }).length;

      const isSuggested = z === suggestedZone;
      const card = document.createElement('button');
      card.type = 'button';
      card.className = `wizard-zone-card ${isSuggested ? 'suggested' : ''}`;
      card.dataset.zone = z;
      card.innerHTML = `
        ${isSuggested ? `<span class="wz-badge">Selected</span>` : ''}
        <span class="wz-name">${this.shortZoneLabel(z)}</span>
        <span class="wz-desc">${this.zoneSubtitle(z) || 'Association District'}</span>
        <span class="wz-stats">${houseCount} house${houseCount === 1 ? '' : 's'} · ${meterCount} meter${meterCount === 1 ? '' : 's'}</span>
      `;
      grid.appendChild(card);
    });

    const addBtn = document.createElement('button');
    addBtn.type = 'button';
    addBtn.className = 'wizard-zone-card add-new';
    addBtn.dataset.action = 'new-zone';
    addBtn.innerHTML = `+ Add New Zone`;
    grid.appendChild(addBtn);
  }

  updatePinContextBar(pinType, zone) {
    const isHouse = pinType === 'household';
    const iconEl = document.getElementById('pin-context-icon');
    const typeEl = document.getElementById('pin-context-type');
    const zoneEl = document.getElementById('pin-context-zone');
    const titleEl = document.getElementById('modal-drop-pin-title');

    if (iconEl) {
      iconEl.style.background = isHouse ? '#CCFBF1' : '#DBEAFE';
      iconEl.style.color = isHouse ? '#0F766E' : '#2563EB';
      iconEl.innerHTML = isHouse
        ? `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"><path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/></svg>`
        : `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2.7c3.6 4.2 6 7.5 6 10.8a6 6 0 0 1-12 0c0-3.3 2.4-6.6 6-10.8z"/></svg>`;
    }
    if (typeEl) {
      typeEl.textContent = isHouse ? 'Consumer Household Pin' : 'Water Meter Pin';
    }
    if (zoneEl) {
      zoneEl.textContent = this.cleanZoneString(zone || 'Zone 1');
    }
    if (titleEl) {
      titleEl.textContent = isHouse ? 'Add Consumer Household' : 'Add Water Meter';
    }
  }

  getNextMeterNo() {
    const existing = new Set((this.cachedMeters || []).map(m => (m.meterNo || '').trim().toUpperCase()));
    let num = (this.cachedMeters ? this.cachedMeters.length : 0) + 1;
    while (existing.has(`WM-2026-${String(num).padStart(3, '0')}`)) {
      num++;
    }
    return `WM-2026-${String(num).padStart(3, '0')}`;
  }

  getNextAccountNo() {
    const existing = new Set((this.cachedConsumers || []).map(c => (c.accountNo || '').trim().toUpperCase()));
    let num = (this.cachedConsumers ? this.cachedConsumers.length : 0) + 1;
    while (existing.has(`DWA-2026-${String(num).padStart(3, '0')}`)) {
      num++;
    }
    return `DWA-2026-${String(num).padStart(3, '0')}`;
  }

  _isLocalOfficeServer() {
    const host = (window.location && window.location.hostname) || '';
    return (
      host === 'localhost' ||
      host === '127.0.0.1' ||
      /^192\.168\./.test(host) ||
      /^10\./.test(host) ||
      /^172\.(1[6-9]|2\d|3[0-1])\./.test(host)
    );
  }

  async openDropPinModal(lat, lng, opts = {}) {
    if (!opts.skipWizard) {
      return this.openAddPinWizard(lat, lng, opts);
    }

    if (!lat || !lng || isNaN(lat) || isNaN(lng)) {
      if (this.mapEngine && this.mapEngine._map) {
        const center = this.mapEngine._map.getCenter();
        lat = center.lat;
        lng = center.lng;
      } else {
        lat = 8.3688;
        lng = 124.8630;
      }
    }

    const chosenType = opts.pinType || this._wizardPinType || 'household';
    const chosenZone = opts.zone ? this.cleanZoneString(opts.zone) : (this._lastSelectedZone || null);
    if (chosenZone) {
      this._lastSelectedZone = chosenZone;
    }

    const latInput = document.getElementById('pin-lat-input');
    const lngInput = document.getElementById('pin-lng-input');
    if (latInput) latInput.value = Number(lat).toFixed(6);
    if (lngInput) lngInput.value = Number(lng).toFixed(6);

    // Hide inline add boxes
    const addZoneBox = document.getElementById('pin-add-zone-box');
    if (addZoneBox) addZoneBox.style.display = 'none';
    const addClusterBox = document.getElementById('pin-add-cluster-box');
    if (addClusterBox) addClusterBox.style.display = 'none';

    // Populate zones and zone-separated clusters
    await this.populateZoneDropdowns(chosenZone);

    const activeZone = this.cleanZoneString(
      (document.getElementById('pin-zone-select') && document.getElementById('pin-zone-select').value)
        || chosenZone
        || 'Zone 1'
    );

    // Reset fields when opening fresh (preserve typed name if returning from GPS re-zone)
    if (!opts.preserveInputs) {
      const ownerInput = document.getElementById('pin-meter-owner-name');
      const meterNoInput = document.getElementById('pin-meter-no');
      const initRdgInput = document.getElementById('pin-meter-initial-reading');
      const meterAddrInput = document.getElementById('pin-meter-address');
      const meterNotesInput = document.getElementById('pin-meter-notes');
      const linkHouseCheckbox = document.getElementById('pin-meter-link-household');

      const nextMeterNo = this.getNextMeterNo();
      if (ownerInput) ownerInput.value = '';
      if (meterNoInput) meterNoInput.value = nextMeterNo;
      if (initRdgInput) initRdgInput.value = 0;
      if (meterAddrInput) meterAddrInput.value = '';
      if (meterNotesInput) meterNotesInput.value = '';
      if (linkHouseCheckbox) linkHouseCheckbox.checked = false;

      const houseNameInput = document.getElementById('pin-house-name');
      const houseAddrInput = document.getElementById('pin-house-address');
      const houseContactInput = document.getElementById('pin-house-contact');
      const houseNotesInput = document.getElementById('pin-house-notes');
      const houseLinkMeterCheckbox = document.getElementById('pin-house-link-meter');
      const houseMeterNoInput = document.getElementById('pin-house-meter-no');
      const houseMeterInitInput = document.getElementById('pin-house-meter-initial');

      if (houseNameInput) houseNameInput.value = '';
      if (houseAddrInput) houseAddrInput.value = '';
      if (houseContactInput) houseContactInput.value = '';
      if (houseNotesInput) houseNotesInput.value = '';
      if (houseLinkMeterCheckbox) houseLinkMeterCheckbox.checked = false;
      if (houseMeterNoInput) houseMeterNoInput.value = nextMeterNo;
      if (houseMeterInitInput) houseMeterInitInput.value = 0;
    }

    // Existing consumers dropdown
    const selectConsumer = document.getElementById('pin-meter-consumer-select');
    const existingRow = document.getElementById('pin-meter-existing-consumer-row');
    if (selectConsumer) {
      selectConsumer.innerHTML = '<option value="">-- Or Link to Existing Registered Consumer --</option>';
      if (this.cachedConsumers.length > 0) {
        this.cachedConsumers.forEach(c => {
          const opt = document.createElement('option');
          opt.value = c.id;
          opt.textContent = `${c.name} (${c.accountNo}) - ${c.zone}`;
          selectConsumer.appendChild(opt);
        });
        if (existingRow) existingRow.classList.remove('hidden');
      } else {
        if (existingRow) existingRow.classList.add('hidden');
      }
    }

    // Activate selected pin type (Household vs Water Meter)
    const isHouse = chosenType === 'household';
    const targetRadio = document.querySelector(`input[name="pin-type"][value="${isHouse ? 'household' : 'meter'}"]`);
    if (targetRadio) targetRadio.checked = true;

    const formMeter = document.getElementById('form-pin-meter');
    const formHouse = document.getElementById('form-pin-household');
    if (formMeter) formMeter.style.display = isHouse ? 'none' : 'block';
    if (formHouse) formHouse.style.display = isHouse ? 'block' : 'none';

    this.updatePinContextBar(isHouse ? 'household' : 'meter', activeZone);

    document.getElementById('modal-drop-pin').classList.add('active');

    setTimeout(() => {
      const focusEl = document.getElementById(isHouse ? 'pin-house-name' : 'pin-meter-owner-name');
      if (focusEl) focusEl.focus();
    }, 80);
  }

  async saveDroppedPin() {
    const checkedRadio = document.querySelector('input[name="pin-type"]:checked');
    const pinType = checkedRadio ? checkedRadio.value : 'household';
    const lat = Number(document.getElementById('pin-lat-input').value);
    const lng = Number(document.getElementById('pin-lng-input').value);

    if (!lat || !lng || isNaN(lat) || isNaN(lng)) {
      alert('Please provide valid Latitude and Longitude coordinates (tap the map or use GPS).');
      return;
    }

    // Obtain selected Zone from the Add-Pin popup / selector
    const rawZone = (document.getElementById('pin-zone-select') && document.getElementById('pin-zone-select').value)
      ? document.getElementById('pin-zone-select').value
      : (this._lastSelectedZone || 'Zone 1');
    const zone = this.cleanZoneString(rawZone);

    let targetConsumerId = null;
    let targetConsumerName = '';
    let savedMeterNo = '';
    let autoLinkedExisting = false;

    if (pinType === 'meter') {
      const ownerName = document.getElementById('pin-meter-owner-name').value.trim();
      const existingConsumerId = document.getElementById('pin-meter-consumer-select').value;
      const meterNo = document.getElementById('pin-meter-no').value.trim();
      const initialReading = Number(document.getElementById('pin-meter-initial-reading').value) || 0;
      const address = document.getElementById('pin-meter-address').value.trim();
      const linkHousehold = document.getElementById('pin-meter-link-household').checked;
      const clusterId = document.getElementById('pin-cluster-select').value || null;
      const notes = document.getElementById('pin-meter-notes').value.trim();

      if (!meterNo) {
        alert('Please enter Meter Serial Number (e.g. WM-2026-001).');
        return;
      }

      if (!existingConsumerId && !ownerName) {
        alert('Please enter the Water Meter Owner / Consumer Full Name.');
        return;
      }

      // Check if an existing consumer matches either by dropdown ID OR by the same Owner Full Name (e.g., "paula")
      const matchedConsumer = existingConsumerId
        ? this.cachedConsumers.find(c => c.id === existingConsumerId)
        : this.cachedConsumers.find(c => (c.name || '').trim().toLowerCase() === ownerName.toLowerCase());

      // Check duplicate meter serial (allow updating if the duplicate meter already belongs to this same consumer)
      const dupMeter = await window.db.findDuplicateMeterNo(meterNo);
      if (dupMeter && (!matchedConsumer || dupMeter.consumerId !== matchedConsumer.id)) {
        alert(`Water meter serial number "${meterNo}" is already registered.`);
        return;
      }

      if (matchedConsumer) {
        targetConsumerId = matchedConsumer.id;
        targetConsumerName = matchedConsumer.name;
        autoLinkedExisting = true;

        matchedConsumer.zone = zone;
        matchedConsumer.address = address ? `${address}, ${zone}, Diclum` : `${zone}, Diclum`;
        if (linkHousehold && (!matchedConsumer.householdLat || !matchedConsumer.householdLng)) {
          matchedConsumer.householdLat = lat;
          matchedConsumer.householdLng = lng;
        }
        await window.db.put('consumers', matchedConsumer);
      } else {
        // Register new consumer
        targetConsumerId = `c-${Date.now().toString().slice(-5)}`;
        targetConsumerName = ownerName;
        const accountNo = this.getNextAccountNo();

        const newConsumer = {
          id: targetConsumerId,
          accountNo: accountNo,
          name: ownerName,
          zone: zone,
          address: address ? `${address}, ${zone}, Diclum` : `${zone}, Diclum`,
          contact: '',
          status: 'Active',
          householdLat: linkHousehold ? lat : null,
          householdLng: linkHousehold ? lng : null,
          notes: notes,
          createdAt: new Date().toISOString()
        };
        await window.db.put('consumers', newConsumer);
      }

      // Register or update the consumer's water meter
      const existingConsumerMeter = this.cachedMeters.find(m => m.consumerId === targetConsumerId);
      const meterId = existingConsumerMeter ? existingConsumerMeter.id : `m-${Date.now().toString().slice(-5)}`;
      savedMeterNo = meterNo;
      const newMeter = {
        id: meterId,
        meterNo: meterNo,
        consumerId: targetConsumerId,
        ownerName: targetConsumerName,
        zone: zone,
        meterLat: lat,
        meterLng: lng,
        isClustered: Boolean(clusterId),
        clusterId: clusterId,
        installDate: new Date().toISOString().split('T')[0],
        initialReading: initialReading,
        status: 'Operational',
        notes: notes
      };
      await window.db.put('meters', newMeter);

    } else {
      // Consumer Household Pin — requires Full Name; automatically links if a Water Meter or Consumer with the same name already exists
      const name = document.getElementById('pin-house-name').value.trim();

      if (!name) {
        alert('Please enter Consumer Full Name.');
        return;
      }

      const matchedConsumer = this.cachedConsumers.find(
        c => (c.name || '').trim().toLowerCase() === name.toLowerCase()
      );
      const matchedMeterByOwner = !matchedConsumer
        ? this.cachedMeters.find(m => (m.ownerName || '').trim().toLowerCase() === name.toLowerCase())
        : null;

      if (matchedConsumer) {
        targetConsumerId = matchedConsumer.id;
        targetConsumerName = matchedConsumer.name;
        autoLinkedExisting = true;

        matchedConsumer.householdLat = lat;
        matchedConsumer.householdLng = lng;
        matchedConsumer.zone = zone;
        matchedConsumer.address = `${zone}, Diclum`;
        await window.db.put('consumers', matchedConsumer);

        const linkedMeter = this.cachedMeters.find(m => m.consumerId === matchedConsumer.id);
        if (linkedMeter) {
          savedMeterNo = linkedMeter.meterNo;
          if (!linkedMeter.zone) {
            linkedMeter.zone = zone;
            await window.db.put('meters', linkedMeter);
          }
        }
      } else {
        targetConsumerId = `c-${Date.now().toString().slice(-5)}`;
        targetConsumerName = name;
        const accountNo = this.getNextAccountNo();

        const newConsumer = {
          id: targetConsumerId,
          accountNo: accountNo,
          name: name,
          zone: zone,
          address: `${zone}, Diclum`,
          contact: '',
          status: 'Active',
          householdLat: lat,
          householdLng: lng,
          notes: '',
          createdAt: new Date().toISOString()
        };
        await window.db.put('consumers', newConsumer);

        if (matchedMeterByOwner) {
          matchedMeterByOwner.consumerId = targetConsumerId;
          matchedMeterByOwner.ownerName = name;
          if (!matchedMeterByOwner.zone) matchedMeterByOwner.zone = zone;
          await window.db.put('meters', matchedMeterByOwner);
          savedMeterNo = matchedMeterByOwner.meterNo;
          autoLinkedExisting = true;
        }
      }
    }

    await this.refreshDataCache();
    this.syncPinsToMap();
    this.renderConsumerList();
    this.populateQuickConsumerSelect();
    try {
      await this.renderZoneExportCenter();
    } catch (err) {
      console.warn('Zone export refresh warning:', err);
    }
    this.autoSyncToOfficePcSilent();
    document.getElementById('modal-drop-pin').classList.remove('active');

    if (pinType === 'household') {
      if (autoLinkedExisting && savedMeterNo) {
        this.showToast(`Household pin linked to ${targetConsumerName} (Meter: ${savedMeterNo}) in ${zone}!`, 3500);
      } else {
        this.showToast(`Household pin added for ${targetConsumerName} (${zone})`);
      }
    } else {
      const meterText = savedMeterNo ? ` (${savedMeterNo})` : '';
      if (autoLinkedExisting) {
        this.showToast(`Water Meter${meterText} linked to ${targetConsumerName}'s Household (${zone})!`, 3500);
      } else {
        this.showToast(`Water meter${meterText} added in ${zone}`);
      }
      if (confirm(`Water Meter${meterText} saved${autoLinkedExisting ? ' & linked to existing household' : ''} for ${targetConsumerName} in ${zone}!\n\nWould you like to open "Meter Reading & Computation" for this consumer now?`)) {
        this.startReadingForConsumer(targetConsumerId);
      }
    }
  }

  // --- Official Reports & PDF Viewer (Phase 7, Section 18) ---

  openBillingSummaryReport() {
    const period = this.activeBillingPeriod || (this.cachedBills.length > 0 ? this.cachedBills[0].billingPeriod : 'Consolidated');
    const html = window.reportsEngine.generateBillingSummaryHTML(
      period,
      this.cachedBills,
      this.cachedConsumers,
      this.cachedMeters
    );
    document.getElementById('report-content-container').innerHTML = html;
    document.getElementById('report-modal-title').textContent = `Monthly Billing Summary — ${period}`;
    document.getElementById('modal-report-preview').classList.add('active');
  }

  openConsumerDirectoryReport() {
    const html = window.reportsEngine.generateConsumerDirectoryHTML(
      this.cachedConsumers,
      this.cachedMeters,
      this.cachedClusters
    );
    document.getElementById('report-content-container').innerHTML = html;
    document.getElementById('report-modal-title').textContent = 'Master Consumer & Water Meter Directory';
    document.getElementById('modal-report-preview').classList.add('active');
  }

  // --- Zone-Separated & Consumer-Specific Records Export (PDF & Excel) + Office PC Sync ---

  async renderZoneExportCenter() {
    const container = document.getElementById('zone-export-cards-container');
    const consumerSelect = document.getElementById('export-consumer-select');
    const periodHintEl = document.getElementById('records-period-hint');
    if (!container && !consumerSelect) return;

    const allReadings = await window.db.getAll('readings');
    const periodMode = this.recordsPeriodMode || 'today';
    const todayIso = new Date().toISOString().split('T')[0];

    if (periodHintEl) {
      if (periodMode === 'today') {
        periodHintEl.innerHTML = `Showing <strong>Records I Made Today (${todayIso})</strong> — ready to download by Zone or Consumer in PDF or Excel.`;
      } else if (periodMode === 'month') {
        periodHintEl.innerHTML = `Showing <strong>Records of This Month (${this.activeBillingPeriod})</strong> — ready to download by Zone or Consumer in PDF or Excel.`;
      } else {
        periodHintEl.innerHTML = `Showing <strong>All Historical Records</strong> across all billing periods.`;
      }
    }

    // 1. Render Zone 1, Zone 2, Zone 3, Zone 4, and All Zones cards
    if (container && window.reportsEngine && typeof window.reportsEngine.filterRecords === 'function') {
      const zones = await window.db.getZones();
      const targetZones = [...zones, 'ALL'];

      container.innerHTML = targetZones.map(z => {
        const isAll = z === 'ALL';
        const rows = window.reportsEngine.filterRecords({
          zone: z,
          periodMode: periodMode,
          consumerId: null,
          consumers: this.cachedConsumers,
          meters: this.cachedMeters,
          bills: this.cachedBills,
          readings: allReadings,
          activeBillingPeriod: this.activeBillingPeriod
        });

        const totalConsumersInZone = isAll
          ? this.cachedConsumers.length
          : this.cachedConsumers.filter(c => this.cleanZoneString(c.zone) === this.cleanZoneString(z)).length;

        const readCount = rows.filter(r => r.readingDate !== '—' || Number(r.totalAmountDue) > 0 || Number(r.consumption) > 0).length;
        const totalM3 = rows.reduce((acc, r) => acc + (Number(r.consumption) || 0), 0);
        const totalBilled = rows.reduce((acc, r) => acc + (Number(r.totalAmountDue ?? r.billAmount) || 0), 0);
        const badgeColor = isAll ? '#1E40AF' : '#0F766E';
        const cardBg = isAll ? '#EFF6FF' : '#F8FAFC';
        const borderCol = isAll ? '#BFDBFE' : '#E2E8F0';
        const displayTitle = isAll ? 'All Zones (Combined Master Sheet)' : z;

        return `
          <div style="background: ${cardBg}; border: 1px solid ${borderCol}; border-radius: 8px; padding: 10px 12px; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 8px;">
            <div>
              <div style="display: flex; align-items: center; gap: 6px;">
                <strong style="font-size: 12.5px; color: #0F172A;">${displayTitle}</strong>
                <span style="font-size: 10px; font-weight: 700; padding: 1px 7px; border-radius: 999px; background: ${badgeColor}18; color: ${badgeColor};">
                  ${readCount} Read / ${totalConsumersInZone} Total
                </span>
              </div>
              <div style="font-size: 10.5px; color: #475569; margin-top: 2px;">
                Consumption: <strong>${totalM3.toLocaleString()} m³</strong> • Total Billed: <strong style="color: #0F766E;">PHP ${totalBilled.toFixed(2)}</strong>
              </div>
            </div>
            <div style="display: flex; gap: 6px;">
              <button type="button" class="btn btn-xs btn-primary btn-zone-export" data-zone="${z}" data-format="pdf" style="padding: 5px 10px; font-size: 11px; font-weight: 700;">
                PDF Table
              </button>
              <button type="button" class="btn btn-xs btn-outline btn-zone-export" data-zone="${z}" data-format="excel" style="padding: 5px 10px; font-size: 11px; font-weight: 700; border-color: #059669; color: #059669; background: #FFF;">
                Excel (.xls)
              </button>
            </div>
          </div>
        `;
      }).join('');
    }

    // 2. Populate Individual Consumer / Water Meter Owner dropdown (e.g., mario)
    if (consumerSelect) {
      const prevSelected = consumerSelect.value;
      consumerSelect.innerHTML = '<option value="">-- Select Consumer / Water Meter Owner --</option>';
      const sortedConsumers = [...this.cachedConsumers].sort((a, b) => (a.name || '').localeCompare(b.name || ''));
      sortedConsumers.forEach(c => {
        const meter = this.cachedMeters.find(m => m.consumerId === c.id);
        const opt = document.createElement('option');
        opt.value = c.id;
        opt.textContent = `${c.name} — ${meter ? meter.meterNo : 'No Meter'} (${this.cleanZoneString(c.zone)})`;
        consumerSelect.appendChild(opt);
      });
      if (prevSelected && sortedConsumers.some(c => c.id === prevSelected)) {
        consumerSelect.value = prevSelected;
      }
    }
  }

  async exportZoneOrConsumerReport({ zone = 'ALL', consumerId = null, format = 'pdf' }) {
    const allReadings = await window.db.getAll('readings');
    const periodMode = consumerId ? (this.recordsPeriodMode || 'all') : (this.recordsPeriodMode || 'today');

    const opts = {
      zone: zone,
      periodMode: periodMode,
      consumerId: consumerId,
      consumers: this.cachedConsumers,
      meters: this.cachedMeters,
      bills: this.cachedBills,
      readings: allReadings,
      activeBillingPeriod: this.activeBillingPeriod
    };

    if (format === 'excel') {
      const res = window.reportsEngine.downloadExcelReport(opts);
      this.showToast(`Downloaded Excel table: ${res.filename} (${res.count} row${res.count === 1 ? '' : 's'})`, 3200);
      return;
    }

    // Open Printable A4 PDF Preview Modal & allow immediate PDF download
    const html = window.reportsEngine.generateZoneOrConsumerReportHTML(opts);
    const consumer = consumerId ? this.cachedConsumers.find(c => c.id === consumerId) : null;
    const periodTag = periodMode === 'today' ? 'Today' : (periodMode === 'month' ? this.activeBillingPeriod : 'All_Records');
    const title = consumer
      ? `Consumer Reading & Billing Ledger — ${consumer.name} (${periodTag})`
      : `${zone === 'ALL' ? 'All Zones' : zone} Current Bills & Readings (${periodTag})`;

    document.getElementById('report-content-container').innerHTML = html;
    document.getElementById('report-modal-title').textContent = title;
    document.getElementById('modal-report-preview').classList.add('active');
  }

  async uploadReadingsToOfficePc() {
    const statusBadge = document.getElementById('pc-sync-status-badge');
    const lastSyncEl = document.getElementById('pc-sync-last-timestamp');
    try {
      const readings = await window.db.getAll('readings');
      const payload = {
        deviceLabel: navigator.userAgent.includes('Mobile') ? 'Field Reader Mobile' : 'Office Workstation',
        consumers: this.cachedConsumers,
        meters: this.cachedMeters,
        clusters: this.cachedClusters,
        readings: readings,
        bills: this.cachedBills,
        routes: this.cachedRoutes,
        settings: await window.db.getAll('settings')
      };

      const resp = await fetch('/api/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (resp.ok) {
        const result = await resp.json();
        const stamp = new Date(result.syncedAt || Date.now()).toLocaleString();
        localStorage.setItem('dicklum_last_pc_sync', stamp);
        if (statusBadge) {
          statusBadge.textContent = 'SYNCED TO OFFICE PC';
          statusBadge.className = 'badge badge-success';
        }
        if (lastSyncEl) {
          lastSyncEl.innerHTML = `Last synced to Office PC (<code>data/dicklum_master_db.json</code>): <strong>${stamp}</strong> (${result.counts.consumers} consumers, ${result.counts.readings} readings, ${result.counts.bills} bills)`;
        }
        this.showToast('Uploaded all current readings & bills to Office PC!', 3200);
        alert(
          `Successfully uploaded all current readings & bills to the Office PC!\n\n` +
          `Saved on PC Hard Drive:\n` +
          `• Master DB: data/dicklum_master_db.json\n` +
          `• Daily Backup: data/backups/\n\n` +
          `Records Uploaded:\n` +
          `• ${result.counts.consumers} Consumers\n` +
          `• ${result.counts.meters} Water Meters\n` +
          `• ${result.counts.readings} Meter Readings\n` +
          `• ${result.counts.bills} Billing Statements`
        );
        return;
      }
      throw new Error(`Server responded with status ${resp.status}`);
    } catch (err) {
      console.warn('Direct /api/sync not reachable, offering portable file export fallback:', err);
      if (confirm('Could not reach the Office PC server directly over Wi-Fi.\n\nWould you like to download the Field Readings Sync File (.json) to your phone so you can transfer or load it on the Office PC?')) {
        const exp = await window.backupEngine.exportBackup();
        this.showToast(`Exported field readings file: ${exp.filename}`, 3000);
      }
    }
  }

  async pullReadingsFromOfficePc() {
    const statusBadge = document.getElementById('pc-sync-status-badge');
    const lastSyncEl = document.getElementById('pc-sync-last-timestamp');
    try {
      const resp = await fetch('/api/sync', { method: 'GET' });
      if (!resp.ok) throw new Error(`Server status ${resp.status}`);
      const json = await resp.json();
      if (!json.success || !json.data) {
        alert('No uploaded field records found on the Office PC yet. Upload readings from the field reader phone first.');
        return;
      }

      const d = json.data;
      const cCount = (d.consumers || []).length;
      const mCount = (d.meters || []).length;
      const rCount = (d.readings || []).length;
      const bCount = (d.bills || []).length;

      if (!confirm(
        `Load uploaded field records from Office PC (Last uploaded: ${d.updatedAt ? new Date(d.updatedAt).toLocaleString() : 'Recently'})?\n\n` +
        `• ${cCount} Consumers\n` +
        `• ${mCount} Water Meters\n` +
        `• ${rCount} Meter Readings\n` +
        `• ${bCount} Bills\n\n` +
        `Click OK to load these records into your screen.`
      )) {
        return;
      }

      for (const c of (d.consumers || [])) await window.db.put('consumers', c);
      for (const m of (d.meters || [])) await window.db.put('meters', m);
      for (const cl of (d.clusters || [])) await window.db.put('clusters', cl);
      for (const r of (d.readings || [])) await window.db.put('readings', r);
      for (const b of (d.bills || [])) await window.db.put('bills', b);
      for (const rt of (d.routes || [])) await window.db.put('routes', rt);

      await this.refreshDataCache();
      this.syncPinsToMap();
      this.syncRoutesToMap();
      this.renderConsumerList();
      this.renderBillingList();
      this.renderStats();
      await this.renderZoneExportCenter();

      const stamp = new Date().toLocaleString();
      if (statusBadge) {
        statusBadge.textContent = 'LOADED FROM PC';
        statusBadge.className = 'badge badge-success';
      }
      if (lastSyncEl) {
        lastSyncEl.innerHTML = `Loaded from Office PC Master DB at <strong>${stamp}</strong> (${cCount} consumers, ${rCount} readings, ${bCount} bills).`;
      }
      this.showToast('Loaded all field readings & bills from Office PC!', 3000);
    } catch (err) {
      alert('Could not connect to Office PC server (/api/sync). You can also use "Import / Restore Backup File" below to load a transferred file.');
    }
  }

  async autoSyncToOfficePcSilent() {
    if (!this._isLocalOfficeServer()) return;
    try {
      const readings = await window.db.getAll('readings');
      const payload = {
        deviceLabel: 'Auto-Sync',
        consumers: this.cachedConsumers,
        meters: this.cachedMeters,
        clusters: this.cachedClusters,
        readings: readings,
        bills: this.cachedBills,
        routes: this.cachedRoutes,
        settings: await window.db.getAll('settings')
      };
      const resp = await fetch('/api/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (resp.ok) {
        const stamp = new Date().toLocaleString();
        localStorage.setItem('dicklum_last_pc_sync', stamp);
        const lastSyncEl = document.getElementById('pc-sync-last-timestamp');
        if (lastSyncEl) {
          lastSyncEl.innerHTML = `Auto-saved to Office PC (<code>data/dicklum_master_db.json</code>): <strong>${stamp}</strong>`;
        }
      }
    } catch (_) {
      // Silent when out in the field away from Office Wi-Fi
    }
  }

  // --- Server-Enforced + Offline-Capable Security PIN Gate ---

  async hashPinLocal(pin) {
    const clean = String(pin || '').trim();
    if (window.crypto && window.crypto.subtle) {
      const buf = new TextEncoder().encode(`dicklum_salt_v1:${clean}`);
      const digest = await window.crypto.subtle.digest('SHA-256', buf);
      return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('');
    }
    // Simple fallback hash if subtle crypto is unavailable on non-HTTPS LAN IP
    let h = 2166136261;
    const str = `dicklum_salt_v1:${clean}`;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return (h >>> 0).toString(16);
  }

  async initSecurityPinGate() {
    let serverHasPin = false;
    let serverAuthenticated = false;
    let serverHint = '';

    if (this._isLocalOfficeServer()) {
      try {
        const resp = await fetch('/api/auth/status');
        if (resp.ok && (resp.headers.get('content-type') || '').includes('application/json')) {
          const status = await resp.json();
          serverHasPin = Boolean(status.hasPinConfigured);
          serverAuthenticated = Boolean(status.authenticated);
          serverHint = status.hint || '';
        }
      } catch (_) {
        // Offline in the field: check local PIN storage
      }
    }

    const localPinHash = localStorage.getItem('dicklum_pin_hash_v1');
    const localSessionUnlocked = sessionStorage.getItem('dicklum_pin_unlocked_session') === 'true';
    const localHint = localStorage.getItem('dicklum_pin_hint_v1') || '';

    this.hasPinConfigured = serverHasPin || Boolean(localPinHash);
    this.pinHint = serverHint || localHint;
    this.refreshPinSecurityBadge();

    // If a PIN is configured and the user hasn't unlocked this session yet, show the Security PIN Gate!
    if (this.hasPinConfigured && !serverAuthenticated && !localSessionUnlocked) {
      this.openPinGateModal('unlock');
    }

    const savedSyncStamp = localStorage.getItem('dicklum_last_pc_sync');
    const lastSyncEl = document.getElementById('pc-sync-last-timestamp');
    if (savedSyncStamp && lastSyncEl) {
      lastSyncEl.innerHTML = `Last synced to Office PC: <strong>${savedSyncStamp}</strong>`;
    }
  }

  refreshPinSecurityBadge() {
    const badge = document.getElementById('pin-security-status-badge') || document.getElementById('security-pin-status-badge');
    const btnSetup = document.getElementById('btn-open-pin-setup');
    const btnLock = document.getElementById('btn-lock-app-now');
    if (badge) {
      if (this.hasPinConfigured) {
        badge.textContent = 'PIN ACTIVE & PROTECTED';
        badge.className = 'badge badge-success';
      } else {
        badge.textContent = 'NO PIN SET YET';
        badge.className = 'badge badge-warning';
      }
    }
    if (btnSetup) {
      btnSetup.innerHTML = this.hasPinConfigured
        ? `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg> Change Secret PIN`
        : `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg> Create / Set Secret PIN`;
    }
    if (btnLock) {
      btnLock.style.display = this.hasPinConfigured ? 'inline-flex' : 'none';
    }
  }

  openPinGateModal(mode = 'unlock') {
    if (mode === 'auto') {
      mode = this.hasPinConfigured ? 'change' : 'setup';
    }
    this.pinGateMode = mode;

    const modal = document.getElementById('modal-security-pin-gate');
    const titleEl = document.getElementById('pin-gate-title');
    const bannerEl = document.getElementById('pin-gate-info-banner');
    const currentGroup = document.getElementById('pin-gate-current-group');
    const mainLabel = document.getElementById('pin-gate-main-label');
    const confirmGroup = document.getElementById('pin-gate-confirm-group');
    const hintDisplay = document.getElementById('pin-gate-hint-display');
    const errorEl = document.getElementById('pin-gate-error');
    const btnClose = document.getElementById('btn-close-pin-gate');
    const btnCancel = document.getElementById('btn-cancel-pin-gate');
    const btnSubmit = document.getElementById('btn-submit-pin-gate');

    const currInput = document.getElementById('pin-gate-current-input');
    const mainInput = document.getElementById('pin-gate-main-input');
    const confInput = document.getElementById('pin-gate-confirm-input');
    const hintInput = document.getElementById('pin-gate-hint-input');

    if (currInput) currInput.value = '';
    if (mainInput) mainInput.value = '';
    if (confInput) confInput.value = '';
    if (hintInput) hintInput.value = this.pinHint || '';
    if (errorEl) {
      errorEl.style.display = 'none';
      errorEl.textContent = '';
    }

    if (mode === 'unlock') {
      if (titleEl) titleEl.textContent = 'Locked — Enter Secret Office PIN';
      if (bannerEl) bannerEl.textContent = 'This Dicklum Water Association system is protected. Enter your 4–8 digit Secret PIN to unlock the map, consumers, and billing records.';
      if (currentGroup) currentGroup.style.display = 'none';
      if (mainLabel) mainLabel.textContent = 'Secret PIN *';
      if (confirmGroup) confirmGroup.style.display = 'none';
      if (btnClose) btnClose.style.display = 'none';
      if (btnCancel) btnCancel.style.display = 'none';
      if (btnSubmit) btnSubmit.textContent = 'Unlock Application';
      if (hintDisplay) {
        if (this.pinHint) {
          hintDisplay.style.display = 'block';
          hintDisplay.textContent = `PIN Hint: ${this.pinHint}`;
        } else {
          hintDisplay.style.display = 'none';
        }
      }
    } else if (mode === 'setup') {
      if (titleEl) titleEl.textContent = 'Create Secret Office & Reader PIN';
      if (bannerEl) bannerEl.textContent = 'Set a 4 to 8 digit Secret PIN. Once created, anyone opening this app on the Office PC or Field Phone must enter this PIN first.';
      if (currentGroup) currentGroup.style.display = 'none';
      if (mainLabel) mainLabel.textContent = 'New Secret PIN (4–8 digits) *';
      if (confirmGroup) confirmGroup.style.display = 'block';
      if (btnClose) btnClose.style.display = 'inline-flex';
      if (btnCancel) btnCancel.style.display = 'inline-flex';
      if (btnSubmit) btnSubmit.textContent = 'Save & Activate Secret PIN';
      if (hintDisplay) hintDisplay.style.display = 'none';
    } else if (mode === 'change') {
      if (titleEl) titleEl.textContent = 'Change Secret Office & Reader PIN';
      if (bannerEl) bannerEl.textContent = 'Enter your current PIN first, then enter your new 4 to 8 digit Secret PIN.';
      if (currentGroup) currentGroup.style.display = 'block';
      if (mainLabel) mainLabel.textContent = 'New Secret PIN (4–8 digits) *';
      if (confirmGroup) confirmGroup.style.display = 'block';
      if (btnClose) btnClose.style.display = 'inline-flex';
      if (btnCancel) btnCancel.style.display = 'inline-flex';
      if (btnSubmit) btnSubmit.textContent = 'Update Secret PIN';
      if (hintDisplay) hintDisplay.style.display = 'none';
    }

    if (modal) {
      modal.classList.add('active');
      setTimeout(() => {
        if (mode === 'change' && currInput) currInput.focus();
        else if (mainInput) mainInput.focus();
      }, 80);
    }
  }

  async submitPinGate() {
    const mode = this.pinGateMode || 'unlock';
    const currPin = (document.getElementById('pin-gate-current-input')?.value || '').trim();
    const mainPin = (document.getElementById('pin-gate-main-input')?.value || '').trim();
    const confPin = (document.getElementById('pin-gate-confirm-input')?.value || '').trim();
    const hint = (document.getElementById('pin-gate-hint-input')?.value || '').trim();
    const errorEl = document.getElementById('pin-gate-error');

    const showErr = (msg) => {
      if (errorEl) {
        errorEl.textContent = msg;
        errorEl.style.display = 'block';
      } else {
        alert(msg);
      }
    };

    if (mode === 'unlock') {
      if (!mainPin) return showErr('Please enter your Secret PIN.');

      // 1. Try server-enforced login first
      try {
        const resp = await fetch('/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ pin: mainPin })
        });
        if (resp.ok) {
          const localHash = await this.hashPinLocal(mainPin);
          localStorage.setItem('dicklum_pin_hash_v1', localHash);
          sessionStorage.setItem('dicklum_pin_unlocked_session', 'true');
          document.getElementById('modal-security-pin-gate')?.classList.remove('active');
          this.showToast('Security Gate Unlocked — Welcome!', 2200);
          return;
        } else if (resp.status === 401) {
          return showErr('Incorrect PIN. Access denied.');
        }
      } catch (_) {
        // Fallback to local offline verification
      }

      // 2. Local offline PIN verification
      const savedHash = localStorage.getItem('dicklum_pin_hash_v1');
      const enteredHash = await this.hashPinLocal(mainPin);
      if (savedHash && enteredHash === savedHash) {
        sessionStorage.setItem('dicklum_pin_unlocked_session', 'true');
        document.getElementById('modal-security-pin-gate')?.classList.remove('active');
        this.showToast('Security Gate Unlocked (Offline Mode)', 2200);
      } else {
        showErr('Incorrect Secret PIN. Please try again.');
      }
      return;
    }

    // Setup or Change Mode
    if (mainPin.length < 4) {
      return showErr('Secret PIN must be at least 4 digits/characters.');
    }
    if (mainPin !== confPin) {
      return showErr('New PIN and Confirm PIN do not match.');
    }

    if (mode === 'change') {
      if (!currPin) return showErr('Please enter your current PIN.');
      let changedOnServer = false;
      try {
        const resp = await fetch('/api/auth/change-pin', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ currentPin: currPin, newPin: mainPin, hint })
        });
        if (resp.ok) {
          changedOnServer = true;
        } else if (resp.status === 401) {
          return showErr('Current PIN is incorrect.');
        }
      } catch (_) {
        // Offline fallback check
      }

      if (!changedOnServer) {
        const savedHash = localStorage.getItem('dicklum_pin_hash_v1');
        const currHash = await this.hashPinLocal(currPin);
        if (savedHash && currHash !== savedHash) {
          return showErr('Current PIN is incorrect.');
        }
      }
    } else {
      // First-time setup on server
      try {
        await fetch('/api/auth/setup', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ pin: mainPin, hint })
        });
      } catch (_) {
        // Saved locally below as well
      }
    }

    const newHash = await this.hashPinLocal(mainPin);
    localStorage.setItem('dicklum_pin_hash_v1', newHash);
    localStorage.setItem('dicklum_pin_hint_v1', hint);
    sessionStorage.setItem('dicklum_pin_unlocked_session', 'true');
    this.hasPinConfigured = true;
    this.pinHint = hint;
    this.refreshPinSecurityBadge();

    document.getElementById('modal-security-pin-gate')?.classList.remove('active');
    this.showToast('Secret PIN saved & Security Gate activated!', 3000);
    alert('Secret Office & Reader PIN is now active!\n\nWhenever the app is locked or opened in a new session, it will require this PIN before anyone can view the map or records.');
  }

  async lockAppNow() {
    if (!this.hasPinConfigured) {
      this.openPinGateModal('setup');
      return;
    }
    sessionStorage.removeItem('dicklum_pin_unlocked_session');
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
    } catch (_) {}
    this.openPinGateModal('unlock');
  }

  // --- Individual Consumer Billing & Payment History Ledger ---

  async openConsumerHistoryModal(consumerId) {
    const consumer = this.cachedConsumers.find(c => c.id === consumerId);
    if (!consumer) return;

    const meter = this.cachedMeters.find(m => m.consumerId === consumerId) || { meterNo: 'Unassigned', isClustered: false };
    const cluster = meter.clusterId ? this.cachedClusters.find(cl => cl.id === meter.clusterId) : null;
    const bills = (this.cachedBills || []).filter(b => b.consumerId === consumerId);
    bills.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));

    let readings = [];
    try {
      readings = await window.db.getReadingsByConsumer(consumerId);
      readings.sort((a, b) => new Date(b.readingDate || 0) - new Date(a.readingDate || 0));
    } catch (e) {
      readings = [];
    }

    document.getElementById('hist-modal-consumer-name').textContent = consumer.name;
    document.getElementById('hist-modal-acct-pill').textContent = consumer.accountNo;

    const totalBilled = bills.reduce((acc, b) => acc + (b.totalAmountDue || 0), 0);
    const totalPaid = bills.reduce((acc, b) => acc + (b.amountPaid || 0), 0);
    const balanceDue = Math.max(0, totalBilled - totalPaid);

    document.getElementById('hist-stat-billed').textContent = `PHP ${totalBilled.toFixed(2)}`;
    document.getElementById('hist-stat-paid').textContent = `PHP ${totalPaid.toFixed(2)}`;
    document.getElementById('hist-stat-balance').textContent = `PHP ${balanceDue.toFixed(2)}`;
    document.getElementById('hist-stat-balance').style.color = balanceDue > 0 ? '#DC2626' : '#059669';

    const summaryBox = document.getElementById('hist-consumer-summary-box');
    const hasHouseGps = Boolean(consumer.householdLat && consumer.householdLng);
    const hasMeterGps = Boolean(meter.meterLat && meter.meterLng);

    summaryBox.innerHTML = `
      <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(130px, 1fr)); gap: 6px;">
        <div><strong style="color:var(--text-muted); font-size:10px; text-transform:uppercase;">District / Zone:</strong><br>${consumer.zone}</div>
        <div><strong style="color:var(--text-muted); font-size:10px; text-transform:uppercase;">Address:</strong><br>${consumer.address}</div>
        <div><strong style="color:var(--text-muted); font-size:10px; text-transform:uppercase;">Water Meter:</strong><br>${meter.meterNo} ${cluster ? `(${cluster.name})` : ''}</div>
        <div><strong style="color:var(--text-muted); font-size:10px; text-transform:uppercase;">GPS Pin Status:</strong><br>
          <span style="color:${hasHouseGps ? '#059669' : '#DC2626'}; font-weight:600;">House: ${hasHouseGps ? 'Pinned' : 'Unpinned'}</span> • 
          <span style="color:${hasMeterGps ? '#059669' : '#DC2626'}; font-weight:600;">Meter: ${hasMeterGps ? 'Pinned' : 'Unpinned'}</span>
        </div>
      </div>
    `;

    const billsContainer = document.getElementById('hist-bills-list-container');
    document.getElementById('hist-bills-count').textContent = `${bills.length} Bill${bills.length === 1 ? '' : 's'}`;

    if (bills.length === 0) {
      billsContainer.innerHTML = '<div style="padding:14px; text-align:center; color:#64748B; font-size:12px; background:var(--surface); border:1px solid var(--border); border-radius:var(--radius-sm);">No billing records recorded yet. Record a reading to generate this consumer\'s first bill.</div>';
    } else {
      billsContainer.innerHTML = bills.map(b => {
        const isPaid = b.paymentStatus === 'PAID';
        const isPartial = b.paymentStatus === 'PARTIAL';
        const unpaidAmount = Math.max(0, (b.totalAmountDue || 0) - (b.amountPaid || 0));
        const statusBadgeClass = isPaid ? 'badge-success' : (isPartial ? 'badge-warning' : 'badge-danger');

        return `
          <div style="background:var(--surface); border:1px solid var(--border); border-radius:var(--radius-sm); padding:10px;">
            <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:6px;">
              <div>
                <strong style="font-size:13px; color:var(--primary);">${b.billingPeriod || 'Utility Bill'}</strong>
                <span style="font-size:10px; color:var(--text-muted); font-family:var(--font-mono); margin-left:6px;">#${b.id}</span>
              </div>
              <span class="badge ${statusBadgeClass}" style="font-size:10px;">${b.paymentStatus || 'UNPAID'}</span>
            </div>

            <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(110px, 1fr)); gap:6px; font-size:11px; margin-bottom:8px; background:var(--surface-alt); padding:6px 8px; border-radius:var(--radius-xs);">
              <div><span style="color:var(--text-muted);">Consumption:</span> <strong>${b.consumption || 0} m³</strong></div>
              <div><span style="color:var(--text-muted);">Amount Due:</span> <strong>PHP ${(b.totalAmountDue || 0).toFixed(2)}</strong></div>
              <div><span style="color:var(--text-muted);">Amount Paid:</span> <strong style="color:#059669;">PHP ${(b.amountPaid || 0).toFixed(2)}</strong></div>
              <div><span style="color:var(--text-muted);">Balance:</span> <strong style="color:${unpaidAmount > 0 ? '#DC2626' : '#64748B'};">PHP ${unpaidAmount.toFixed(2)}</strong></div>
            </div>

            ${isPaid || b.amountPaid > 0 ? `
              <div style="font-size:10.5px; color:#059669; margin-bottom:8px; display:flex; align-items:center; gap:4px;">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>
                <span>Paid OR: <strong>${b.officialReceiptNo || 'OR-PENDING'}</strong> • Collector: ${b.collectorName || 'Office'} ${b.paidAt ? `(${new Date(b.paidAt).toLocaleDateString()})` : ''}</span>
              </div>
            ` : ''}

            <div style="display:flex; gap:6px; flex-wrap:wrap;">
              <button class="btn btn-sm btn-outline" onclick="window.app.openThermalReceipt('${b.id}')" style="padding:4px 8px; font-size:11px;">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect width="12" height="8" x="6" y="14"/></svg>
                Print Receipt
              </button>
              <button class="btn btn-sm btn-outline" onclick="window.app.openA4Statement('${b.id}')" style="padding:4px 8px; font-size:11px;">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                A4 Statement
              </button>
              <button class="btn btn-sm btn-outline" onclick="window.app.deleteBillRecord('${b.id}')" style="color:var(--danger); border-color:#fca5a5; padding:4px 8px; font-size:11px;" title="Delete this billing record">
                Delete
              </button>
              ${!isPaid ? `
                <button class="btn btn-sm btn-success" onclick="window.app.openPaymentModal('${b.id}')" style="padding:4px 8px; font-size:11px;">
                  Record Payment
                </button>
              ` : ''}
            </div>
          </div>
        `;
      }).join('');
    }

    const readingsContainer = document.getElementById('hist-readings-list-container');
    document.getElementById('hist-readings-count').textContent = `${readings.length} Reading${readings.length === 1 ? '' : 's'}`;

    if (readings.length === 0) {
      readingsContainer.innerHTML = '<div style="padding:10px; text-align:center; color:#64748B; font-size:11px;">No meter readings recorded.</div>';
    } else {
      readingsContainer.innerHTML = readings.map(r => `
        <div style="display:flex; justify-content:space-between; align-items:center; background:var(--surface); border:1px solid var(--border); border-radius:var(--radius-xs); padding:6px 10px; font-size:11.5px;">
          <div>
            <strong>${r.readingDate ? new Date(r.readingDate).toLocaleDateString() : 'N/A'}</strong>
            <span style="color:var(--text-muted); margin-left:6px; font-size:10px;">${r.billingPeriod || ''}</span>
          </div>
          <div>
            <span style="color:var(--text-muted); font-size:10.5px;">Dial:</span>
            <strong style="color:var(--primary); font-size:12.5px;">${r.currentReading} m³</strong>
            ${r.consumption != null ? `<span style="color:#059669; font-weight:700; margin-left:4px;">(+${r.consumption} m³)</span>` : ''}
          </div>
        </div>
      `).join('');
    }

    const btnA4 = document.getElementById('hist-btn-print-statement');
    if (btnA4) {
      btnA4.onclick = () => {
        if (bills.length > 0) {
          this.openA4Statement(bills[0].id);
        } else {
          alert('No bills recorded for this consumer yet.');
        }
      };
    }

    document.getElementById('modal-consumer-history').classList.add('active');
  }

  // --- Map Layer Switcher & Offline Diclum Tile Downloader ---

  openLayerModal() {
    this.updateOfflineMapStatsUI();
    document.getElementById('modal-map-layers').classList.add('active');
  }

  async updateOfflineMapStatsUI() {
    if (!window.offlineTileEngine) return;
    try {
      const stats = await window.offlineTileEngine.getCacheStats();
      const statsEl = document.getElementById('offline-cache-stats-text');
      const badgeEl = document.getElementById('offline-cache-badge');
      const mbSize = (stats.totalBytes / (1024 * 1024)).toFixed(1);
      if (statsEl) {
        statsEl.textContent = `Offline Diclum Tile Storage: ${stats.count} tiles cached (${mbSize} MB). Works 100% offline with zero data or Wi-Fi.`;
      }
      if (badgeEl) {
        badgeEl.textContent = stats.count > 0 ? `${stats.count} TILES READY` : 'READY';
      }
    } catch (e) {
      console.warn('Could not read offline tile stats:', e);
    }
  }

  async startOfflineDiclumDownload() {
    if (!window.offlineTileEngine) return;
    const progressBox = document.getElementById('offline-download-progress-box');
    const progressBar = document.getElementById('offline-download-bar');
    const percentEl = document.getElementById('offline-download-percent');
    const labelEl = document.getElementById('offline-download-label');
    const btnDownload = document.getElementById('btn-download-offline-diclum');
    const btnCancel = document.getElementById('btn-cancel-offline-diclum');

    if (progressBox) progressBox.style.display = 'block';
    if (btnCancel) btnCancel.classList.remove('hidden');
    if (btnDownload) {
      btnDownload.disabled = true;
      btnDownload.textContent = 'Downloading Tiles...';
    }

    try {
      this.showToast('Starting Barangay Diclum offline map download...', 2000);
      const res = await window.offlineTileEngine.downloadDiclumMapPack({
        minZoom: 14,
        maxZoom: 18,
        onProgress: (p) => {
          if (progressBar) progressBar.style.width = `${p.percent}%`;
          if (percentEl) percentEl.textContent = `${p.percent}% (${p.current}/${p.total})`;
          if (labelEl) labelEl.textContent = `Caching Diclum zoom ${p.zoom}...`;
        }
      });

      if (labelEl) labelEl.textContent = 'Offline Diclum Map 100% Cached!';
      this.showToast(`Diclum Map Download Complete! ${res.saved} new tiles saved for 100% offline use.`, 3500);
      await this.updateOfflineMapStatsUI();
    } catch (err) {
      console.error('Offline map download failed:', err);
      this.showToast('Offline download cancelled or paused: ' + err.message, 3000);
    } finally {
      if (btnDownload) {
        btnDownload.disabled = false;
        btnDownload.textContent = 'Download Deep Zoom (Zooms 14–18)';
      }
      if (btnCancel) btnCancel.classList.add('hidden');
    }
  }

  cancelOfflineDiclumDownload() {
    if (window.offlineTileEngine) {
      window.offlineTileEngine.cancelDownload();
      this.showToast('Offline map download cancelled.', 1500);
    }
    const btnCancel = document.getElementById('btn-cancel-offline-diclum');
    if (btnCancel) btnCancel.classList.add('hidden');
    const btnDownload = document.getElementById('btn-download-offline-diclum');
    if (btnDownload) {
      btnDownload.disabled = false;
      btnDownload.textContent = 'Download Deep Zoom (Zooms 14–18)';
    }
  }

  setMapLayer(layerKey) {
    if (this.mapEngine) {
      this.mapEngine.setLayer(layerKey);
    }
    const currentLayerName = this.mapEngine.layerProviders[layerKey].name;
    document.getElementById('map-current-layer-label').textContent = currentLayerName;
    document.querySelectorAll('.layer-choice-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.layer === layerKey);
    });
    document.getElementById('modal-map-layers').classList.remove('active');
  }

  // --- Rendering UI Lists ---

  renderConsumerList(filterQuery = '') {
    const list = document.getElementById('consumers-list-container');
    if (!list) return;

    const query = filterQuery.toLowerCase();
    const filtered = this.cachedConsumers.filter(c => {
      const matchName = c.name.toLowerCase().includes(query);
      const matchAcct = c.accountNo.toLowerCase().includes(query);
      const matchZone = c.zone.toLowerCase().includes(query);
      return matchName || matchAcct || matchZone;
    });

    const countBadge = document.getElementById('consumer-records-count-badge');
    if (countBadge) {
      countBadge.textContent = `${this.cachedConsumers.length} CONSUMERS`;
    }

    list.innerHTML = '';
    if (filtered.length === 0) {
      list.innerHTML = '<div style="padding: 14px; text-align: center; color: #64748B; font-size: 11.5px;">No consumers registered. Tap any spot on the Map to add water meters or consumers.</div>';
      return;
    }

    filtered.forEach(c => {
      const meter = this.cachedMeters.find(m => m.consumerId === c.id);
      const hasHousePin = Boolean(c.householdLat && c.householdLng);
      const hasMeterPin = Boolean(meter && meter.meterLat && meter.meterLng);

      const card = document.createElement('div');
      card.className = 'consumer-card';
      card.innerHTML = `
        <div class="c-header">
          <div>
            <strong>${c.name}</strong>
            <span class="acct-pill">${c.accountNo}</span>
          </div>
          <div style="display: flex; gap: 4px; align-items: center;">
            <span class="badge ${c.status === 'Active' ? 'badge-success' : 'badge-danger'}">${c.status}</span>
            <button class="btn btn-xs btn-outline" onclick="window.app.deleteConsumerRecord('${c.id}')" style="color: var(--danger); border-color: #fca5a5; padding: 2px 6px;" title="Delete consumer record">
              Delete
            </button>
          </div>
        </div>
        <div class="c-body">
          <div class="c-row"><span>Address:</span> <span>${c.address}</span></div>
          <div class="c-row"><span>District:</span> <span>${c.zone}</span></div>
          <div class="c-row">
            <span>Water Meter:</span> 
            <span>${meter ? meter.meterNo + (meter.isClustered ? ' (Clustered Manifold)' : ' (Individual Standpipe)') : '<em class="text-muted">Unassigned</em>'}</span>
          </div>
          <div class="pins-status-row">
            <span class="pin-tag ${hasHousePin ? 'pinned' : 'unpinned'}">
              ${hasHousePin ? 'House Pinned' : 'No House GPS'}
            </span>
            <span class="pin-tag ${hasMeterPin ? 'pinned' : 'unpinned'}">
              ${hasMeterPin ? 'Meter Pinned' : 'No Meter GPS'}
            </span>
          </div>
        </div>
        <div class="c-actions">
          <button class="btn btn-sm btn-outline" onclick="window.app.openConsumerHistoryModal('${c.id}')">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 8v4l3 3"/><circle cx="12" cy="12" r="10"/></svg>
            History & Bills
          </button>
          <button class="btn btn-sm btn-outline" onclick="window.app.focusConsumerOnMap('${c.id}')">
            ${window.AppIcons.mapPin('', 13)} View on Map
          </button>
          <button class="btn btn-sm btn-primary" onclick="window.app.startReadingForConsumer('${c.id}')">
            ${window.AppIcons.reading('', 13)} Read Meter
          </button>
        </div>
      `;
      list.appendChild(card);
    });
  }

  focusConsumerOnMap(consumerId) {
    const consumer = this.cachedConsumers.find(c => c.id === consumerId);
    if (!consumer) return;

    this.switchView('view-map');
    if (consumer.householdLat && consumer.householdLng) {
      this.mapEngine.panTo(consumer.householdLat, consumer.householdLng, 17.5);
      this.mapEngine.selectPinById(consumer.id, 'household');
    } else {
      const meter = this.cachedMeters.find(m => m.consumerId === consumerId);
      if (meter && meter.meterLat) {
        this.mapEngine.panTo(meter.meterLat, meter.meterLng, 17.5);
        this.mapEngine.selectPinById(meter.id, 'meter');
      }
    }
  }

  renderBillingList(filterStatus = 'all') {
    const list = document.getElementById('billing-list-container');
    if (!list) return;

    const filtered = this.cachedBills.filter(b => {
      if (filterStatus === 'all') return true;
      return b.paymentStatus.toLowerCase() === filterStatus.toLowerCase();
    });

    list.innerHTML = '';
    if (filtered.length === 0) {
      list.innerHTML = '<div style="padding: 20px; text-align: center; color: #64748B;">No billing records found.</div>';
      return;
    }

    filtered.forEach(b => {
      const consumer = this.cachedConsumers.find(c => c.id === b.consumerId);
      const isPaid = b.paymentStatus === 'PAID';

      const card = document.createElement('div');
      card.className = `bill-card`;
      card.innerHTML = `
        <div class="b-header">
          <div>
            <strong>${consumer ? consumer.name : 'Unknown'}</strong>
            <span class="acct-pill">${b.id} • ${b.billingPeriod}</span>
          </div>
          <div style="display: flex; gap: 4px; align-items: center;">
            <span class="badge ${isPaid ? 'badge-success' : 'badge-danger'}">
              ${b.paymentStatus}
            </span>
            <button class="btn btn-xs btn-outline" onclick="window.app.deleteBillRecord('${b.id}')" style="color: var(--danger); border-color: #fca5a5; padding: 2px 6px;" title="Delete this billing statement">
              Delete
            </button>
          </div>
        </div>
        <div class="b-body">
          <div class="b-readings-grid">
            <div class="r-cell">
              <span class="lbl">Previous</span>
              <span class="val">${b.previousReading.toLocaleString()} m³</span>
            </div>
            <div class="r-cell">
              <span class="lbl">Current</span>
              <span class="val">${b.currentReading.toLocaleString()} m³</span>
            </div>
            <div class="r-cell highlight">
              <span class="lbl">Consumption</span>
              <span class="val">${b.consumption.toLocaleString()} m³</span>
            </div>
          </div>
          <div class="b-summary-row" style="display: flex; justify-content: space-between; align-items: center; margin-top: 4px;">
            <span style="font-size: 11px; color: #64748B;">Due: <strong>${b.dueDate}</strong></span>
            <span style="font-size: 13px; color: var(--primary);">Total Due: <strong>PHP ${b.totalAmountDue.toFixed(2)}</strong></span>
          </div>
        </div>
        <div class="b-actions">
          <button class="btn btn-sm btn-outline" onclick="window.app.openThermalReceiptModal('${b.id}')">
            ${window.AppIcons.printer('', 13)} Thermal Receipt
          </button>
          <button class="btn btn-sm btn-outline" onclick="window.app.openA4StatementModal('${b.id}')">
            ${window.AppIcons.fileText('', 13)} A4 Statement
          </button>
          ${!isPaid ? `
            <button class="btn btn-sm btn-success" onclick="window.app.openPaymentModal('${b.id}')">
              ${window.AppIcons.creditCard('', 13)} Receive Payment
            </button>
          ` : `
            <span style="font-size: 10.5px; color: #059669; font-weight: 600;">OR: ${b.orNumber || 'N/A'}</span>
          `}
        </div>
      `;
      list.appendChild(card);
    });
  }

  renderStats() {
    const totalConsumers = this.cachedConsumers.length;
    const totalMeters = this.cachedMeters.length;
    const totalBills = this.cachedBills.length;

    const elTotalC = document.getElementById('stat-total-consumers');
    if (elTotalC) elTotalC.textContent = totalConsumers;
    const elTotalM = document.getElementById('stat-total-meters');
    if (elTotalM) elTotalM.textContent = totalMeters;
    const elReadings = document.getElementById('stat-month-readings');
    if (elReadings) elReadings.textContent = totalBills;
  }

  // --- Event Binding ---

  bindNavigationEvents() {
    const cardMapping = document.getElementById('card-mode-mapping');
    if (cardMapping) {
      cardMapping.addEventListener('click', () => {
        this.switchView('view-map');
      });
    }

    const cardReading = document.getElementById('card-mode-reading');
    if (cardReading) {
      cardReading.addEventListener('click', () => {
        this.switchView('view-reading');
      });
    }

    document.querySelectorAll('.mode-toggle-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        this.setMode(e.target.dataset.mode);
      });
    });

    document.querySelectorAll('.nav-item').forEach(btn => {
      btn.addEventListener('click', () => {
        this.switchView(btn.dataset.view);
      });
    });

    document.querySelectorAll('.btn-back-home').forEach(btn => {
      btn.addEventListener('click', () => this.switchView('view-map'));
    });
  }

  focusSearchMatchOnMap(match) {
    if (!match || !this.mapEngine) return;

    const { consumerId, meterId, pinId, pinType, lat, lng, name, zone } = match;
    if (this.activeView !== 'view-map') {
      this.switchView('view-map');
    }

    // If pins are currently hidden, isolate this searched pin so ONLY this pin is shown on the map!
    if (this.mapEngine.isPinsHidden && pinId) {
      this.mapEngine.isolateSinglePin(pinId, pinType);
    }

    // Ensure active zone/type filters do not hide the searched pin
    if (this.mapEngine._zoneFilter && zone && this.mapEngine._zoneFilter !== zone) {
      this.mapEngine.setZoneFilter(null);
      const zoneChipsContainer = document.getElementById('map-zone-chips');
      if (zoneChipsContainer) {
        zoneChipsContainer.querySelectorAll('.zone-chip').forEach(c => {
          c.classList.toggle('active', (c.dataset.zone || '') === '');
        });
      }
    }
    if (this.mapEngine._filter && this.mapEngine._filter !== 'all' && this.mapEngine._filter !== pinType) {
      this.mapEngine.setFilter('all');
      const typeSegment = document.getElementById('map-type-segment');
      if (typeSegment) {
        typeSegment.querySelectorAll('.type-seg-btn').forEach(b => {
          b.classList.toggle('active', b.dataset.type === 'all');
        });
      }
    }
    this.updateMapTypeSegmentCounts();

    if (lat && lng) {
      this.mapEngine.panTo(lat, lng, 19);
    }

    // Highlight / hover the pin on the map and open its bottom sheet
    setTimeout(() => {
      if (pinId && pinType) {
        this.mapEngine.selectPinById(pinId, pinType);
      } else if (consumerId) {
        this.openConsumerSheet(consumerId, meterId || null);
      }
    }, 120);

    if (name) {
      this.showToast(`Located ${name}${zone ? ' • ' + this.shortZoneLabel(zone) : ''}`, 1800);
    }
  }

  bindMapEvents() {
    const searchInput = document.getElementById('map-search-input');
    const searchResults = document.getElementById('map-search-results');
    if (searchInput && searchResults) {
      this._lastSearchMatches = [];

      const computeSearchMatches = (rawQuery) => {
        const q = (rawQuery || '').toLowerCase().trim();
        if (!q) return [];
        const matches = [];

        this.cachedConsumers.forEach(c => {
          const meter = this.cachedMeters.find(m => m.consumerId === c.id);
          const nameMatch = c.name && c.name.toLowerCase().includes(q);
          const acctMatch = c.accountNo && c.accountNo.toLowerCase().includes(q);
          const meterMatch = meter && meter.meterNo && meter.meterNo.toLowerCase().includes(q);
          const addressMatch = c.address && c.address.toLowerCase().includes(q);
          const zoneMatch = c.zone && c.zone.toLowerCase().includes(q);

          if (nameMatch || acctMatch || meterMatch || addressMatch || zoneMatch) {
            const hasHouseCoords = Boolean(c.householdLat && c.householdLng);
            const hasMeterCoords = Boolean(meter && meter.meterLat && meter.meterLng);
            // Prefer household pin when searching by owner name unless only meter is pinned or query matched meterNo specifically
            const preferMeter = (!hasHouseCoords && hasMeterCoords) || (meterMatch && !nameMatch && hasMeterCoords);
            const pinType = preferMeter ? 'meter' : 'household';
            const pinId = preferMeter && meter ? meter.id : c.id;
            const lat = preferMeter ? Number(meter.meterLat) : Number(c.householdLat || (meter && meter.meterLat) || 0);
            const lng = preferMeter ? Number(meter.meterLng) : Number(c.householdLng || (meter && meter.meterLng) || 0);

            matches.push({
              consumer: c,
              meter,
              consumerId: c.id,
              meterId: meter ? meter.id : '',
              pinId,
              pinType,
              lat,
              lng,
              name: c.name,
              zone: c.zone || (meter && meter.zone) || 'Dicklum'
            });
          }
        });

        // Check standalone / unassigned meters
        this.cachedMeters.forEach(m => {
          if (!m.consumerId && m.meterNo && m.meterNo.toLowerCase().includes(q)) {
            matches.push({
              consumer: null,
              meter: m,
              consumerId: '',
              meterId: m.id,
              pinId: m.id,
              pinType: 'meter',
              lat: Number(m.meterLat || 0),
              lng: Number(m.meterLng || 0),
              name: `Meter ${m.meterNo}`,
              zone: m.zone || 'Dicklum'
            });
          }
        });

        return matches;
      };

      searchInput.addEventListener('input', (e) => {
        const q = e.target.value.toLowerCase().trim();
        if (!q) {
          this._lastSearchMatches = [];
          searchResults.classList.add('hidden');
          searchResults.innerHTML = '';
          // If pins are in hidden mode, clearing search clears any isolated pin
          if (this.mapEngine && this.mapEngine.isPinsHidden) {
            this.mapEngine.clearPinIsolation();
          }
          return;
        }

        const matches = computeSearchMatches(q);
        this._lastSearchMatches = matches;

        if (matches.length === 0) {
          searchResults.innerHTML = '<div style="padding: 12px; font-size: 12px; color: #64748B; text-align: center;">No matching water meters or consumers found.</div>';
          searchResults.classList.remove('hidden');
          return;
        }

        searchResults.innerHTML = matches.slice(0, 8).map((item, idx) => {
          const c = item.consumer;
          const m = item.meter;
          const name = c ? c.name : `Meter ${m ? m.meterNo : ''}`;
          const acct = c ? c.accountNo : 'Unassigned';
          const meterNo = m ? m.meterNo : 'Household Only';
          const zone = item.zone || 'Dicklum';
          const badgeColor = item.pinType === 'household' ? '#0F766E' : '#2563EB';
          const badgeLabel = item.pinType === 'household' ? 'House Pin' : 'Meter Pin';

          return `
            <div class="search-result-item" data-match-idx="${idx}" data-consumer-id="${item.consumerId}" data-meter-id="${item.meterId}" data-pin-id="${item.pinId}" data-pin-type="${item.pinType}" data-lat="${item.lat}" data-lng="${item.lng}">
              <div>
                <div class="search-result-title" style="display:flex; align-items:center; gap:6px;">
                  <span>${name}</span>
                  <span style="font-size:9.5px; font-weight:700; padding:1px 6px; border-radius:999px; background:${badgeColor}18; color:${badgeColor};">${badgeLabel}</span>
                </div>
                <div class="search-result-meta">
                  <span>${acct}</span>
                  <span>•</span>
                  <span>Meter: <strong>${meterNo}</strong></span>
                  <span>•</span>
                  <span>${zone}</span>
                </div>
              </div>
              <div class="search-result-action" style="display:flex; align-items:center; gap:6px;">
                <span style="font-size:11px; font-weight:700; color:var(--primary);">Locate ↵</span>
              </div>
            </div>
          `;
        }).join('');

        searchResults.classList.remove('hidden');
      });

      // Pressing Enter flies directly to the top matching owner/water meter on the map and hovers/highlights it
      searchInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          const q = searchInput.value.trim();
          if (!q) return;
          const matches = (this._lastSearchMatches && this._lastSearchMatches.length > 0)
            ? this._lastSearchMatches
            : computeSearchMatches(q);
          if (matches.length > 0) {
            const topMatch = matches[0];
            searchResults.classList.add('hidden');
            searchInput.blur();
            this.focusSearchMatchOnMap(topMatch);
          } else {
            this.showToast(`No consumer or water meter matching "${q}"`, 2000);
          }
        } else if (e.key === 'Escape') {
          searchResults.classList.add('hidden');
          searchInput.blur();
        }
      });

      // Clicking a search result flies to and hovers the pin on the map
      searchResults.addEventListener('click', (e) => {
        const item = e.target.closest('.search-result-item');
        if (!item) return;

        const idx = Number(item.dataset.matchIdx);
        const match = (this._lastSearchMatches && this._lastSearchMatches[idx]) || {
          consumerId: item.dataset.consumerId,
          meterId: item.dataset.meterId,
          pinId: item.dataset.pinId,
          pinType: item.dataset.pinType,
          lat: Number(item.dataset.lat),
          lng: Number(item.dataset.lng),
          name: item.querySelector('.search-result-title span') ? item.querySelector('.search-result-title span').textContent : 'Pin',
          zone: ''
        };

        searchResults.classList.add('hidden');
        this.focusSearchMatchOnMap(match);
      });

      // Hide dropdown when clicking outside
      document.addEventListener('click', (e) => {
        if (!e.target.closest('.map-search-row')) {
          searchResults.classList.add('hidden');
        }
      });
    }

    // Map Filter Chips (legacy fallback)
    document.querySelectorAll('.map-filter-chip').forEach(chip => {
      if (chip.classList.contains('billing-filter-chip')) return;
      chip.addEventListener('click', (e) => {
        document.querySelectorAll('.map-filter-chip:not(.billing-filter-chip)').forEach(c => c.classList.remove('active'));
        e.target.classList.add('active');
        if (this.mapEngine) this.mapEngine.setFilter(e.target.dataset.filter);
      });
    });

    // Zone Chip Filter Bar on Map (All Zones, Zone 1, Zone 2, Zone 3, Zone 4...)
    const zoneChipsContainer = document.getElementById('map-zone-chips');
    if (zoneChipsContainer) {
      zoneChipsContainer.addEventListener('click', (e) => {
        const chip = e.target.closest('.zone-chip');
        if (!chip) return;
        const zone = chip.dataset.zone || '';
        zoneChipsContainer.querySelectorAll('.zone-chip').forEach(c => {
          c.classList.toggle('active', (c.dataset.zone || '') === zone);
        });
        if (this.mapEngine) {
          this.mapEngine.setZoneFilter(zone || null);
          this.updateMapTypeSegmentCounts();
          this.mapEngine.fitToVisiblePins(18);
        }
        this.showToast(zone ? `Viewing ${this.shortZoneLabel(zone)}` : 'Viewing All Zones', 1600);
      });
    }

    // Type Segmented Control on Map (All / Houses / Meters)
    const typeSegment = document.getElementById('map-type-segment');
    if (typeSegment) {
      typeSegment.addEventListener('click', (e) => {
        const btn = e.target.closest('.type-seg-btn');
        if (!btn) return;
        const type = btn.dataset.type || 'all';
        typeSegment.querySelectorAll('.type-seg-btn').forEach(b => {
          b.classList.toggle('active', b.dataset.type === type);
        });
        if (this.mapEngine) {
          this.mapEngine.setFilter(type);
        }
      });
    }

    const btnGps = document.getElementById('btn-gps-my-location');
    if (btnGps) {
      btnGps.addEventListener('click', () => this.toggleRealtimeGps());
    }

    const btnCompass = document.getElementById('btn-map-compass');
    if (btnCompass) {
      btnCompass.addEventListener('click', () => {
        if (this.mapEngine) {
          this.mapEngine.resetNorth();
          this.showToast('Compass reset to North (0°)', 1500);
        }
      });
    }

    const btnLayers = document.getElementById('btn-map-layers');
    if (btnLayers) {
      btnLayers.addEventListener('click', () => this.openLayerModal());
    }

    document.querySelectorAll('.layer-choice-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const layerKey = e.currentTarget.dataset.layer;
        this.setMapLayer(layerKey);
      });
    });

    // Smooth 0.5x / 1x Zoom Presets
    const btnZoom05x = document.getElementById('btn-zoom-05x');
    const btnZoom1x = document.getElementById('btn-zoom-1x');

    if (btnZoom05x) {
      btnZoom05x.addEventListener('click', () => {
        if (this.mapEngine && this.mapEngine._map) {
          btnZoom05x.classList.add('active');
          if (btnZoom1x) btnZoom1x.classList.remove('active');
          if (typeof this.mapEngine.fitToDicklumBoundary === 'function') {
            this.mapEngine.fitToDicklumBoundary(15.2);
          } else {
            this.mapEngine._map.flyTo([8.3735, 124.8505], 15.0, { animate: true, duration: 0.5 });
          }
        }
      });
    }

    if (btnZoom1x) {
      btnZoom1x.addEventListener('click', () => {
        if (this.mapEngine && this.mapEngine._map) {
          btnZoom1x.classList.add('active');
          if (btnZoom05x) btnZoom05x.classList.remove('active');
          if (this.mapEngine.userGps) {
            this.mapEngine._map.flyTo([this.mapEngine.userGps.lat, this.mapEngine.userGps.lng], 18.0, { animate: true, duration: 0.5 });
          } else {
            const center = this.mapEngine._map.getCenter();
            this.mapEngine._map.flyTo(center, 18.0, { animate: true, duration: 0.5 });
          }
        }
      });
    }

    if (this.mapEngine && this.mapEngine._map) {
      this.mapEngine._map.on('zoomend', () => {
        const zoom = this.mapEngine._map.getZoom();
        if (zoom >= 17) {
          if (btnZoom1x) btnZoom1x.classList.add('active');
          if (btnZoom05x) btnZoom05x.classList.remove('active');
        } else {
          if (btnZoom05x) btnZoom05x.classList.add('active');
          if (btnZoom1x) btnZoom1x.classList.remove('active');
        }
      });
    }

    document.getElementById('btn-zoom-in').addEventListener('click', () => {
      if (this.mapEngine && this.mapEngine._map) {
        this.mapEngine._map.zoomIn();
      }
    });

    document.getElementById('btn-zoom-out').addEventListener('click', () => {
      if (this.mapEngine && this.mapEngine._map) {
        this.mapEngine._map.zoomOut();
      }
    });

    document.getElementById('btn-close-sheet').addEventListener('click', () => this.closeConsumerSheet());
    document.getElementById('btn-close-cluster-sheet').addEventListener('click', () => this.closeClusterSheet());

    const btnSheetUnpin = document.getElementById('sheet-btn-unpin');
    if (btnSheetUnpin) {
      btnSheetUnpin.addEventListener('click', () => this.unpinActiveConsumerOrMeter());
    }

    const btnClusterUnpin = document.getElementById('btn-unpin-cluster');
    if (btnClusterUnpin) {
      btnClusterUnpin.addEventListener('click', () => this.unpinActiveCluster());
    }

    // Toggle All Pins visibility (Header button & Floating FAB button)
    const btnTogglePins = document.getElementById('btn-toggle-all-pins');
    if (btnTogglePins) {
      btnTogglePins.addEventListener('click', () => this.toggleAllPinsVisibility());
    }
    const fabTogglePins = document.getElementById('fab-toggle-pins');
    if (fabTogglePins) {
      fabTogglePins.addEventListener('click', () => this.toggleAllPinsVisibility());
    }

    // Offline Diclum Tile Downloader triggers
    const btnDlOffline = document.getElementById('btn-download-offline-diclum');
    if (btnDlOffline) {
      btnDlOffline.addEventListener('click', () => this.startOfflineDiclumDownload());
    }
    const btnCancelOffline = document.getElementById('btn-cancel-offline-diclum');
    if (btnCancelOffline) {
      btnCancelOffline.addEventListener('click', () => this.cancelOfflineDiclumDownload());
    }

    document.getElementById('sheet-btn-read').addEventListener('click', () => {
      if (this.activeConsumer) {
        this.startReadingForConsumer(this.activeConsumer.id);
      }
    });

    const btnSheetHist = document.getElementById('sheet-btn-history');
    if (btnSheetHist) {
      btnSheetHist.addEventListener('click', () => {
        if (this.activeConsumer) {
          this.openConsumerHistoryModal(this.activeConsumer.id);
        }
      });
    }

    const fabPin = document.getElementById('fab-add-pin');
    if (fabPin) {
      fabPin.addEventListener('click', () => {
        const centerLat = (this.mapEngine && this.mapEngine.currentLat) ? this.mapEngine.currentLat : 8.3688;
        const centerLng = (this.mapEngine && this.mapEngine.currentLng) ? this.mapEngine.currentLng : 124.8630;
        this.openDropPinModal(centerLat, centerLng);
      });
    }
  }

  bindRouteRecordingEvents() {
    const btnStart = document.getElementById('btn-start-record-route');
    if (btnStart) {
      btnStart.addEventListener('click', () => this.startRouteRecording());
    }

    const btnStop = document.getElementById('btn-stop-record-route');
    if (btnStop) {
      btnStop.addEventListener('click', () => this.stopAndSaveRoute());
    }

    const btnCancel = document.getElementById('btn-cancel-record-route');
    if (btnCancel) {
      btnCancel.addEventListener('click', () => this.cancelRouteRecording());
    }
  }

  bindConsumerEvents() {
    const searchInput = document.getElementById('consumer-search-input');
    if (searchInput) {
      searchInput.addEventListener('input', (e) => {
        this.renderConsumerList(e.target.value);
      });
    }

    const btnAddConsumer = document.getElementById('btn-add-consumer-modal');
    if (btnAddConsumer) {
      btnAddConsumer.addEventListener('click', () => {
        this.openDropPinModal(8.3688, 124.8630);
      });
    }
  }

  bindReadingEvents() {
    const prevInput = document.getElementById('rdg-previous-input');
    const currInput = document.getElementById('rdg-current-input');

    if (prevInput) {
      prevInput.addEventListener('input', () => this.updateLiveConsumption());
      prevInput.addEventListener('change', () => this.updateLiveConsumption());
    }

    if (currInput) {
      currInput.addEventListener('input', () => this.updateLiveConsumption());
      currInput.addEventListener('change', () => this.updateLiveConsumption());
    }

    const btnPrevMinus = document.getElementById('rdg-btn-prev-minus');
    if (btnPrevMinus && prevInput) {
      btnPrevMinus.addEventListener('click', () => {
        const val = Number(prevInput.value) || 0;
        prevInput.value = Math.max(0, val - 1);
        this.updateLiveConsumption();
      });
    }

    const btnPrevPlus = document.getElementById('rdg-btn-prev-plus');
    if (btnPrevPlus && prevInput) {
      btnPrevPlus.addEventListener('click', () => {
        const val = Number(prevInput.value) || 0;
        prevInput.value = val + 1;
        this.updateLiveConsumption();
      });
    }

    const btnStepMinus = document.getElementById('rdg-btn-step-minus');
    if (btnStepMinus && currInput) {
      btnStepMinus.addEventListener('click', () => {
        const val = Number(currInput.value) || 0;
        currInput.value = Math.max(0, val - 1);
        this.updateLiveConsumption();
      });
    }

    const btnStepPlus = document.getElementById('rdg-btn-step-plus');
    if (btnStepPlus && currInput) {
      btnStepPlus.addEventListener('click', () => {
        const val = Number(currInput.value) || 0;
        currInput.value = val + 1;
        this.updateLiveConsumption();
      });
    }

    const quickConsumerSelect = document.getElementById('rdg-quick-consumer-select');
    if (quickConsumerSelect) {
      quickConsumerSelect.addEventListener('change', (e) => {
        const cId = e.target.value;
        if (cId) {
          this.startReadingForConsumer(cId);
        } else {
          this.resetReadingViewToEmpty();
        }
      });
    }

    const rdgDeleteConsumerBtn = document.getElementById('rdg-btn-delete-consumer');
    if (rdgDeleteConsumerBtn) {
      rdgDeleteConsumerBtn.addEventListener('click', () => {
        if (this.activeConsumer) {
          this.deleteConsumerRecord(this.activeConsumer.id);
        }
      });
    }

    document.getElementById('rdg-override-checkbox').addEventListener('change', () => {
      this.updateLiveConsumption();
    });

    const photoInput = document.getElementById('rdg-photo-input');
    if (photoInput) {
      photoInput.addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = async (event) => {
          try {
            const watermarked = await window.readingModule.watermarkPhoto(event.target.result, {
              meterNo: this.activeMeter ? this.activeMeter.meterNo : 'MTR',
              reading: currInput ? currInput.value : '0',
              consumerName: this.activeConsumer ? this.activeConsumer.name : '',
              timestamp: new Date().toLocaleString(),
              gps: this.activeMeter ? `${this.activeMeter.meterLat}, ${this.activeMeter.meterLng}` : 'Dicklum'
            });

            const imgPreview = document.getElementById('rdg-photo-preview');
            imgPreview.src = watermarked;
            imgPreview.dataset.src = watermarked;
            imgPreview.classList.remove('hidden');
          } catch (err) {
            console.warn('Watermark error:', err);
          }
        };
        reader.readAsDataURL(file);
      });
    }

    document.getElementById('btn-save-reading').addEventListener('click', () => {
      this.submitReading(false);
    });

    document.getElementById('btn-save-print-reading').addEventListener('click', () => {
      this.submitReading(true);
    });
  }

  bindBillingEvents() {
    document.querySelectorAll('.billing-filter-chip').forEach(chip => {
      chip.addEventListener('click', (e) => {
        document.querySelectorAll('.billing-filter-chip').forEach(c => c.classList.remove('active'));
        e.target.classList.add('active');
        this.renderBillingList(e.target.dataset.status);
      });
    });

    document.getElementById('btn-execute-thermal-print').addEventListener('click', () => {
      this.executeThermalPrint();
    });

    document.getElementById('btn-browser-thermal-print').addEventListener('click', () => {
      this.executeBrowserThermalPrint();
    });

    const btnDownloadA4 = document.getElementById('btn-download-a4-pdf');
    if (btnDownloadA4) {
      btnDownloadA4.addEventListener('click', async () => {
        const el = document.getElementById('a4-statement-content');
        if (!el) return;
        const filename = this.activeBill ? `Dicklum_SOA_${this.activeBill.id}.pdf` : 'Dicklum_Statement_of_Account.pdf';
        await this.downloadElementAsPdf(el, filename);
      });
    }

    const btnPrintA4 = document.getElementById('btn-execute-a4-print');
    if (btnPrintA4) {
      btnPrintA4.addEventListener('click', () => {
        document.body.classList.add('printing-a4');
        document.body.classList.remove('printing-thermal');
        window.print();
        setTimeout(() => {
          document.body.classList.remove('printing-a4');
        }, 1000);
      });
    }

    document.getElementById('btn-confirm-payment').addEventListener('click', () => {
      this.submitPayment();
    });
  }

  bindSettingsAndReportEvents() {
    // Tariff Configuration Save (Phase 5, Section 13)
    document.getElementById('btn-save-tariff').addEventListener('click', async () => {
      const minCharge = Number(document.getElementById('tariff-min-charge').value) || 100.00;
      const minAllowance = Number(document.getElementById('tariff-min-allowance').value) || 10;
      const rawExcessRate = document.getElementById('tariff-excess-rate').value.trim();
      const excessRate = rawExcessRate === '' ? null : Number(rawExcessRate);
      const period = document.getElementById('tariff-period-name').value.trim() || 'October 2026';

      const updated = {
        minimumCharge: minCharge,
        minimumAllowance: minAllowance,
        excessRate: excessRate,
        activeBillingPeriod: period,
        activeBillingCode: '2026-10',
        dueDays: 15
      };

      await window.db.setSetting('tariff', updated);
      await this.refreshDataCache();
      alert('Dicklum Water Association Tariff settings saved successfully.');
    });

    // Report Generation Triggers (Phase 7, Section 18)
    document.getElementById('btn-report-billing-summary').addEventListener('click', () => {
      this.openBillingSummaryReport();
    });

    document.getElementById('btn-report-consumer-directory').addEventListener('click', () => {
      this.openConsumerDirectoryReport();
    });

    const btnDownloadReport = document.getElementById('btn-download-report-pdf');
    if (btnDownloadReport) {
      btnDownloadReport.addEventListener('click', async () => {
        const el = document.getElementById('report-content-container');
        if (!el) return;
        const rawTitle = document.getElementById('report-modal-title')?.textContent || 'Dicklum_Report';
        const filename = rawTitle.replace(/[^a-zA-Z0-9_-]/g, '_') + '.pdf';
        await this.downloadElementAsPdf(el, filename);
      });
    }

    const btnPrintReport = document.getElementById('btn-print-report-modal');
    if (btnPrintReport) {
      btnPrintReport.addEventListener('click', () => {
        document.body.classList.add('printing-a4');
        document.body.classList.remove('printing-thermal');
        window.print();
        setTimeout(() => {
          document.body.classList.remove('printing-a4');
        }, 1000);
      });
    }

    // Bluetooth Printer
    document.getElementById('btn-connect-bluetooth').addEventListener('click', async () => {
      const res = await window.thermalPrinter.connect();
      if (!res.success) {
        alert(res.error || 'Could not connect to Bluetooth printer. Operating in direct browser print mode.');
      }
    });

    document.getElementById('btn-test-ticket').addEventListener('click', async () => {
      await window.thermalPrinter.printTestTicket();
    });

    document.getElementById('select-paper-width').addEventListener('change', (e) => {
      window.thermalPrinter.setPaperWidth(e.target.value);
    });

    // Backup Export & Restore (Phase 8, Section 21)
    document.getElementById('btn-export-backup').addEventListener('click', async () => {
      try {
        const res = await window.backupEngine.exportBackup();
        alert(`Backup file exported successfully: ${res.filename}`);
      } catch (err) {
        alert(`Backup export failed: ${err.message}`);
      }
    });

    const fileInput = document.getElementById('input-restore-backup');
    if (fileInput) {
      fileInput.addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (!file) return;

        // Preview before restore (Phase 8, Section 21)
        const reader = new FileReader();
        reader.onload = async (evt) => {
          try {
            const parsed = JSON.parse(evt.target.result);
            if (!parsed.appName || !parsed.data) {
              alert('Invalid backup file. Missing Dicklum Water Association data signature.');
              return;
            }

            const cCount = (parsed.data.consumers || []).length;
            const mCount = (parsed.data.meters || []).length;
            const rCount = (parsed.data.readings || []).length;
            const bCount = (parsed.data.bills || []).length;
            const rtCount = (parsed.data.routes || []).length;

            const confirmMsg = `Backup verification successful.\n\nFile contains:\n• ${cCount} Consumers\n• ${mCount} Water Meters\n• ${rCount} Readings\n• ${bCount} Bills\n• ${rtCount} Walking Routes\n\nAre you sure you want to restore? Current records will be replaced.`;
            
            if (!confirm(confirmMsg)) return;

            await window.backupEngine.restoreBackup(file);
            await this.refreshDataCache();
            this.syncPinsToMap();
            this.syncRoutesToMap();
            this.renderConsumerList();
            this.renderBillingList();
            alert('Database restored successfully from backup.');
          } catch (err) {
            alert(`Restore validation failed: ${err.message}`);
          }
        };
        reader.readAsText(file);
      });
    }

    const btnClearPins = document.getElementById('btn-clear-all-pins');
    if (btnClearPins) {
      btnClearPins.addEventListener('click', async () => {
        if (confirm('Clear all saved pinned GPS locations for households, meters, and clusters? This lets you start fresh and re-pin locations in the field.')) {
          await window.db.clearAllPins();
          await this.refreshDataCache();
          this.syncPinsToMap();
          this.syncRoutesToMap();
          this.renderConsumerList();
          this.renderStats();
          alert('All pinned locations have been cleared. The map is now fresh and ready for pinning in the field.');
        }
      });
    }

    const btnClearBills = document.getElementById('btn-clear-all-bills');
    if (btnClearBills) {
      btnClearBills.addEventListener('click', async () => {
        if (confirm('Clear all recorded bills and meter reading history? This resets monthly reports while keeping consumer profiles, water meters, and GPS pins.')) {
          if (confirm('Confirm reset: all billing statements for all consumers will be removed. Proceed?')) {
            await window.db.clearAllBills();
            await this.refreshDataCache();
            this.renderBillingList();
            this.renderStats();
            this.syncPinsToMap();
            alert('All billing and reading records have been cleared. Ready for fresh meter reading cycles.');
          }
        }
      });
    }

    const btnWipe = document.getElementById('btn-wipe-clean-slate');
    if (btnWipe) {
      btnWipe.addEventListener('click', async () => {
        if (confirm('WARNING: Wipe all consumers, meters, clusters, readings, and bills to start a 100% empty utility?')) {
          if (confirm('Are you absolutely sure? All mock records will be deleted so you can register real consumers from scratch.')) {
            await window.db.wipeCleanSlate();
            await this.refreshDataCache();
            this.syncPinsToMap();
            this.syncRoutesToMap();
            this.renderConsumerList();
            this.renderBillingList();
            this.renderStats();
            alert('Database wiped completely. You are now starting fresh with 0 consumers and 0 pins.');
          }
        }
      });
    }

    document.getElementById('btn-reset-seed-data').addEventListener('click', async () => {
      if (confirm('Reset database to default Dicklum Water Association sample records?')) {
        await window.backupEngine.resetToSeedData();
        await this.refreshDataCache();
        this.syncPinsToMap();
        this.syncRoutesToMap();
        this.renderConsumerList();
        this.renderBillingList();
        await this.populateZoneDropdowns();
        alert('Database reset complete.');
      }
    });

    // Purok & Zone Management in Settings
    const btnSettingsAddZone = document.getElementById('btn-settings-add-zone');
    if (btnSettingsAddZone) {
      btnSettingsAddZone.addEventListener('click', async () => {
        const input = document.getElementById('settings-new-zone-input');
        const name = input ? input.value.trim() : '';
        if (!name) {
          alert('Please enter a zone name (e.g. Zone 5).');
          return;
        }
        await window.db.addZone(name);
        if (input) input.value = '';
        await this.populateZoneDropdowns(name);
        await this.renderSettingsZonesAndClusters();
        alert(`District "${name}" added successfully.`);
      });
    }

    const zonesList = document.getElementById('settings-zones-list');
    if (zonesList) {
      zonesList.addEventListener('click', async (e) => {
        const delBtn = e.target.closest('.btn-delete-zone');
        if (!delBtn) return;
        const zone = delBtn.dataset.zone;
        if (!zone) return;
        if (confirm(`Remove zone "${zone}" from association zones?`)) {
          await window.db.deleteZone(zone);
          await this.renderSettingsZonesAndClusters();
          await this.populateZoneDropdowns();
        }
      });
    }

    const btnNewClusterPrompt = document.getElementById('btn-settings-new-cluster-prompt');
    if (btnNewClusterPrompt) {
      btnNewClusterPrompt.addEventListener('click', async () => {
        const clusterName = prompt('Enter name for the new meter cluster manifold (e.g. Purok 2 Center Manifold):');
        if (!clusterName || !clusterName.trim()) return;
        const zones = await window.db.getZones();
        const zoneChoice = prompt(`Enter Zone / Purok for this cluster manifold:\nAvailable: ${zones.join(', ')}`, zones[0] || 'Zone 1 - Dicklum Central');
        if (!zoneChoice) return;
        await window.db.saveCluster({
          name: clusterName.trim(),
          zone: zoneChoice.trim(),
          lat: null,
          lng: null,
          createdAt: new Date().toISOString()
        });
        this.cachedClusters = await window.db.getAll('clusters');
        await this.renderSettingsZonesAndClusters();
        await this.populateZoneDropdowns();
        alert(`Cluster manifold "${clusterName}" registered for ${zoneChoice}.`);
      });
    }

    const clustersList = document.getElementById('settings-clusters-list');
    if (clustersList) {
      clustersList.addEventListener('click', async (e) => {
        const delBtn = e.target.closest('.btn-delete-cluster');
        if (!delBtn) return;
        const clusterId = delBtn.dataset.clusterId;
        if (!clusterId) return;
        if (confirm('Delete this cluster manifold? Linked meters will become standalone.')) {
          await window.db.delete('clusters', clusterId);
          this.cachedClusters = await window.db.getAll('clusters');
          await this.renderSettingsZonesAndClusters();
          await this.populateZoneDropdowns();
          this.syncPinsToMap();
        }
      });
    }

    // Office PC Sync Buttons (Upload Field Readings to PC & Pull Readings from PC)
    const btnUploadToPc = document.getElementById('btn-upload-readings-to-pc');
    if (btnUploadToPc) {
      btnUploadToPc.addEventListener('click', () => this.uploadReadingsToOfficePc());
    }

    const btnPullFromPc = document.getElementById('btn-pull-readings-from-pc');
    if (btnPullFromPc) {
      btnPullFromPc.addEventListener('click', () => this.pullReadingsFromOfficePc());
    }

    // Records Time Filter Toggle ("Records I Made Today" | "Records of This Month" | "All Records")
    const periodToggle = document.getElementById('records-period-toggle');
    if (periodToggle) {
      periodToggle.addEventListener('click', async (e) => {
        const btn = e.target.closest('.records-period-btn');
        if (!btn) return;
        const period = btn.dataset.period || 'today';
        this.recordsPeriodMode = period;
        periodToggle.querySelectorAll('.records-period-btn').forEach(b => {
          const isAct = b.dataset.period === period;
          b.classList.toggle('active', isAct);
          b.style.background = isAct ? 'var(--primary)' : 'transparent';
          b.style.color = isAct ? '#FFF' : 'var(--text-secondary)';
        });
        await this.renderZoneExportCenter();
      });
    }

    // Zone 1, Zone 2, Zone 3, Zone 4, and All Zones PDF / Excel Export Buttons
    const zoneCardsContainer = document.getElementById('zone-export-cards-container');
    if (zoneCardsContainer) {
      zoneCardsContainer.addEventListener('click', (e) => {
        const btn = e.target.closest('.btn-zone-export');
        if (!btn) return;
        const zone = btn.dataset.zone || 'ALL';
        const format = btn.dataset.format || 'pdf';
        this.exportZoneOrConsumerReport({ zone, consumerId: null, format });
      });
    }

    // Individual Consumer / Water Meter Owner (e.g., mario) PDF & Excel Export Buttons
    const btnConsumerPdf = document.getElementById('btn-export-consumer-pdf');
    if (btnConsumerPdf) {
      btnConsumerPdf.addEventListener('click', () => {
        const sel = document.getElementById('export-consumer-select');
        const cId = sel ? sel.value : '';
        if (!cId) {
          alert('Please select a Consumer / Water Meter Owner first (e.g., mario).');
          return;
        }
        this.exportZoneOrConsumerReport({ zone: 'ALL', consumerId: cId, format: 'pdf' });
      });
    }

    const btnConsumerExcel = document.getElementById('btn-export-consumer-excel');
    if (btnConsumerExcel) {
      btnConsumerExcel.addEventListener('click', () => {
        const sel = document.getElementById('export-consumer-select');
        const cId = sel ? sel.value : '';
        if (!cId) {
          alert('Please select a Consumer / Water Meter Owner first (e.g., mario).');
          return;
        }
        this.exportZoneOrConsumerReport({ zone: 'ALL', consumerId: cId, format: 'excel' });
      });
    }

    // Server-Enforced Security Gate & Secret PIN Setup Buttons
    const btnOpenPinSetup = document.getElementById('btn-open-pin-setup');
    if (btnOpenPinSetup) {
      btnOpenPinSetup.addEventListener('click', () => this.openPinGateModal('auto'));
    }

    const btnLockAppNow = document.getElementById('btn-lock-app-now');
    if (btnLockAppNow) {
      btnLockAppNow.addEventListener('click', () => this.lockAppNow());
    }

    const btnSubmitPinGate = document.getElementById('btn-submit-pin-gate');
    if (btnSubmitPinGate) {
      btnSubmitPinGate.addEventListener('click', () => this.submitPinGate());
    }

    const btnClosePinGate = document.getElementById('btn-close-pin-gate');
    if (btnClosePinGate) {
      btnClosePinGate.addEventListener('click', () => {
        if (this.pinGateMode !== 'unlock') {
          document.getElementById('modal-security-pin-gate')?.classList.remove('active');
        }
      });
    }

    const btnCancelPinGate = document.getElementById('btn-cancel-pin-gate');
    if (btnCancelPinGate) {
      btnCancelPinGate.addEventListener('click', () => {
        if (this.pinGateMode !== 'unlock') {
          document.getElementById('modal-security-pin-gate')?.classList.remove('active');
        }
      });
    }

    ['pin-gate-current-input', 'pin-gate-main-input', 'pin-gate-confirm-input', 'pin-gate-hint-input'].forEach(id => {
      const inp = document.getElementById(id);
      if (inp) {
        inp.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            this.submitPinGate();
          }
        });
      }
    });
  }

  bindModalEvents() {
    document.querySelectorAll('.modal-close, .modal-backdrop').forEach(el => {
      el.addEventListener('click', (e) => {
        const modal = e.target.closest('.app-modal');
        if (!modal) return;
        // Never allow clicking backdrop to bypass the locked Security PIN Gate
        if (modal.id === 'modal-security-pin-gate' && this.pinGateMode === 'unlock') {
          return;
        }
        modal.classList.remove('active');
      });
    });

    document.querySelectorAll('input[name="pin-type"]').forEach(radio => {
      radio.addEventListener('change', (e) => {
        const isHouse = e.target.value === 'household';
        const formHouse = document.getElementById('form-pin-household');
        const formMeter = document.getElementById('form-pin-meter');
        if (formHouse) formHouse.style.display = isHouse ? 'block' : 'none';
        if (formMeter) formMeter.style.display = isHouse ? 'none' : 'block';
        const zoneSelect = document.getElementById('pin-zone-select');
        this.updatePinContextBar(isHouse ? 'household' : 'meter', zoneSelect ? zoneSelect.value : '');
      });
    });

    // Add-Pin Wizard: Step 1 (Household vs Water Meter)
    document.querySelectorAll('.wizard-type-card').forEach(card => {
      card.addEventListener('click', () => {
        this._wizardPinType = card.dataset.type || 'household';
        document.querySelectorAll('.wizard-type-card').forEach(c => {
          c.classList.toggle('active', c.dataset.type === this._wizardPinType);
        });
      });
    });

    // Add-Pin Wizard: "Use my current GPS (where I am standing)" inside popup
    const btnWizardGps = document.getElementById('btn-wizard-use-gps');
    if (btnWizardGps) {
      btnWizardGps.addEventListener('click', () => {
        if (!navigator.geolocation) {
          alert('Geolocation is not supported by your browser.');
          return;
        }
        const gpsLabel = document.getElementById('wizard-gps-label');
        const locText = document.getElementById('wizard-location-text');

        const applyWizardGps = (lat, lng, acc) => {
          this._wizardLat = Number(lat);
          this._wizardLng = Number(lng);
          this._wizardFromGps = true;
          btnWizardGps.classList.remove('locking');
          btnWizardGps.classList.add('locked');
          if (gpsLabel) {
            gpsLabel.textContent = `GPS Locked (±${Math.round(acc || 10)}m) — Tap a Zone below`;
          }
          if (locText) {
            locText.textContent = `Standing GPS · ${this._wizardLat.toFixed(5)}, ${this._wizardLng.toFixed(5)}`;
          }
          if (this.mapEngine) {
            this.mapEngine.setUserGps(this._wizardLat, this._wizardLng, acc || 10);
            this.mapEngine.panTo(this._wizardLat, this._wizardLng, 19);
          }
        };

        if (this.mapEngine && this.mapEngine.userGps && this.mapEngine.userGps.accuracy <= 25) {
          const { lat, lng, accuracy } = this.mapEngine.userGps;
          applyWizardGps(lat, lng, accuracy);
          return;
        }

        btnWizardGps.classList.add('locking');
        if (gpsLabel) gpsLabel.textContent = 'Locking onto GPS satellites...';

        let bestAcc = Infinity;
        const watchId = navigator.geolocation.watchPosition(
          (pos) => {
            const { latitude, longitude, accuracy } = pos.coords;
            if (accuracy < bestAcc) {
              bestAcc = accuracy;
              applyWizardGps(latitude, longitude, accuracy);
              if (accuracy <= 15) {
                navigator.geolocation.clearWatch(watchId);
              }
            }
          },
          (err) => {
            navigator.geolocation.clearWatch(watchId);
            btnWizardGps.classList.remove('locking');
            if (gpsLabel) gpsLabel.textContent = 'Use my current GPS (where I am standing)';
            alert(`GPS Signal Error: ${err.message}`);
          },
          { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
        );
        setTimeout(() => navigator.geolocation.clearWatch(watchId), 8000);
      });
    }

    // Add-Pin Wizard: Step 2 (Tap a Zone Card -> open form for that Type + Zone)
    const wizardZoneGrid = document.getElementById('wizard-zone-grid');
    if (wizardZoneGrid) {
      wizardZoneGrid.addEventListener('click', async (e) => {
        const card = e.target.closest('.wizard-zone-card');
        if (!card) return;

        if (card.dataset.action === 'new-zone') {
          const newZoneName = prompt('Enter new Zone / Purok name (e.g. Zone 5 - Upper Hillside):');
          if (!newZoneName || !newZoneName.trim()) return;
          await window.db.addZone(newZoneName.trim());
          this._lastSelectedZone = newZoneName.trim();
          await this.populateZoneDropdowns(newZoneName.trim());
          await this.renderWizardZoneCards();
          return;
        }

        const chosenZone = card.dataset.zone;
        if (!chosenZone) return;

        const wizModal = document.getElementById('modal-add-pin-wizard');
        if (wizModal) wizModal.classList.remove('active');

        const preserve = Boolean(this._wizardPreserveInputs);
        this._wizardPreserveInputs = false;

        await this.openDropPinModal(this._wizardLat, this._wizardLng, {
          pinType: this._wizardPinType || 'household',
          zone: chosenZone,
          skipWizard: true,
          preserveInputs: preserve
        });
      });
    }

    // "Change" button on the Pin Context Bar inside Drop Pin Modal
    const btnChangeContext = document.getElementById('btn-pin-change-context');
    if (btnChangeContext) {
      btnChangeContext.addEventListener('click', () => {
        const lat = Number(document.getElementById('pin-lat-input')?.value) || this._wizardLat || 8.3688;
        const lng = Number(document.getElementById('pin-lng-input')?.value) || this._wizardLng || 124.8630;
        const checkedRadio = document.querySelector('input[name="pin-type"]:checked');
        const currentType = checkedRadio ? checkedRadio.value : 'household';
        this._wizardPreserveInputs = true;
        this.openAddPinWizard(lat, lng, { pinType: currentType });
      });
    }

    // Dynamic Purok & Zone Add in Drop Pin Modal
    const btnToggleAddZone = document.getElementById('btn-pin-toggle-add-zone');
    const addZoneBox = document.getElementById('pin-add-zone-box');
    const inputNewZone = document.getElementById('input-new-zone-name');
    if (btnToggleAddZone && addZoneBox) {
      btnToggleAddZone.addEventListener('click', () => {
        const isShown = addZoneBox.style.display === 'block';
        addZoneBox.style.display = isShown ? 'none' : 'block';
        if (!isShown && inputNewZone) inputNewZone.focus();
      });
    }

    const btnSaveNewZone = document.getElementById('btn-save-new-zone');
    if (btnSaveNewZone) {
      btnSaveNewZone.addEventListener('click', async () => {
        const newZoneName = inputNewZone ? inputNewZone.value.trim() : '';
        if (!newZoneName) {
          alert('Please enter a Purok or Zone district name (e.g. Zone 5, Purok 5 - Riverside).');
          return;
        }
        await window.db.addZone(newZoneName);
        if (inputNewZone) inputNewZone.value = '';
        if (addZoneBox) addZoneBox.style.display = 'none';
        await this.populateZoneDropdowns(newZoneName);
        alert(`Purok/Zone "${newZoneName}" added and selected.`);
      });
    }

    const btnCancelNewZone = document.getElementById('btn-cancel-new-zone');
    if (btnCancelNewZone && addZoneBox) {
      btnCancelNewZone.addEventListener('click', () => {
        addZoneBox.style.display = 'none';
        if (inputNewZone) inputNewZone.value = '';
      });
    }

    // When Zone changes, filter clusters specifically for this Zone
    const pinZoneSelect = document.getElementById('pin-zone-select');
    if (pinZoneSelect) {
      pinZoneSelect.addEventListener('change', async (e) => {
        await this.updateClusterDropdownForZone(e.target.value);
      });
    }

    // Dynamic Cluster Manifold Add in Drop Pin Modal
    const btnToggleAddCluster = document.getElementById('btn-pin-toggle-add-cluster');
    const addClusterBox = document.getElementById('pin-add-cluster-box');
    const inputNewCluster = document.getElementById('input-new-cluster-name');
    if (btnToggleAddCluster && addClusterBox) {
      btnToggleAddCluster.addEventListener('click', () => {
        const isShown = addClusterBox.style.display === 'block';
        addClusterBox.style.display = isShown ? 'none' : 'block';
        if (!isShown && inputNewCluster) inputNewCluster.focus();
      });
    }

    const btnSaveNewCluster = document.getElementById('btn-save-new-cluster');
    if (btnSaveNewCluster) {
      btnSaveNewCluster.addEventListener('click', async () => {
        const clusterName = inputNewCluster ? inputNewCluster.value.trim() : '';
        if (!clusterName) {
          alert('Please enter a cluster manifold name (e.g. Manifold B - Purok Curve).');
          return;
        }
        const activeZone = (pinZoneSelect && pinZoneSelect.value) ? pinZoneSelect.value : 'Zone 1 - Dicklum Central';
        const lat = Number(document.getElementById('pin-lat-input').value) || 8.3688;
        const lng = Number(document.getElementById('pin-lng-input').value) || 124.8630;

        const newCl = await window.db.saveCluster({
          name: clusterName,
          zone: activeZone,
          lat: lat,
          lng: lng,
          createdAt: new Date().toISOString()
        });

        if (inputNewCluster) inputNewCluster.value = '';
        if (addClusterBox) addClusterBox.style.display = 'none';
        this.cachedClusters = await window.db.getAll('clusters');
        await this.updateClusterDropdownForZone(activeZone, newCl.id);
        this.syncPinsToMap();
        alert(`Cluster manifold "${clusterName}" saved in ${activeZone} and selected.`);
      });
    }

    const btnCancelNewCluster = document.getElementById('btn-cancel-new-cluster');
    if (btnCancelNewCluster && addClusterBox) {
      btnCancelNewCluster.addEventListener('click', () => {
        addClusterBox.style.display = 'none';
        if (inputNewCluster) inputNewCluster.value = '';
      });
    }

    const btnPinUseGps = document.getElementById('btn-pin-use-gps');
    if (btnPinUseGps) {
      btnPinUseGps.addEventListener('click', () => {
        if (!navigator.geolocation) {
          alert('Geolocation is not supported by your browser.');
          return;
        }

        const checkedRadio = document.querySelector('input[name="pin-type"]:checked');
        const currentPinType = checkedRadio ? checkedRadio.value : (this._wizardPinType || 'household');

        const promptZoneAfterGps = (lat, lng, accuracy) => {
          const latInput = document.getElementById('pin-lat-input');
          const lngInput = document.getElementById('pin-lng-input');
          if (latInput) latInput.value = lat.toFixed(6);
          if (lngInput) lngInput.value = lng.toFixed(6);
          btnPinUseGps.innerHTML = `
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="12" cy="12" r="10"/><line x1="22" x2="18" y1="12" y2="12"/><line x1="6" x2="2" y1="12" y2="12"/><line x1="12" x2="12" y1="6" y2="2"/><line x1="12" x2="12" y1="22" y2="18"/>
            </svg>
            GPS Locked (±${Math.round(accuracy)}m): ${lat.toFixed(5)}, ${lng.toFixed(5)}
          `;
          if (this.mapEngine) {
            this.mapEngine.setUserGps(lat, lng, accuracy);
            this.mapEngine.panTo(lat, lng, 19);
          }
          // Open the Zone Picker popup so the user confirms which Zone this standing GPS pin belongs to
          this._wizardPreserveInputs = true;
          this.openAddPinWizard(lat, lng, { pinType: currentPinType, fromGpsButton: true });
        };

        // If real-time GPS is already active with high precision, use it immediately
        if (this.mapEngine && this.mapEngine.userGps && this.mapEngine.userGps.accuracy <= 25) {
          const { lat, lng, accuracy } = this.mapEngine.userGps;
          promptZoneAfterGps(lat, lng, accuracy);
          return;
        }

        btnPinUseGps.innerHTML = `${window.AppIcons.crosshair()} Locking onto GPS satellites...`;

        // Progressive high-accuracy GPS refinement
        let bestAccuracy = Infinity;
        let promptedZone = false;
        const watchId = navigator.geolocation.watchPosition(
          (pos) => {
            const { latitude, longitude, accuracy } = pos.coords;
            if (accuracy < bestAccuracy) {
              bestAccuracy = accuracy;
              if (!promptedZone) {
                promptedZone = true;
                promptZoneAfterGps(latitude, longitude, accuracy);
              } else {
                this._wizardLat = latitude;
                this._wizardLng = longitude;
                const latInput = document.getElementById('pin-lat-input');
                const lngInput = document.getElementById('pin-lng-input');
                if (latInput) latInput.value = latitude.toFixed(6);
                if (lngInput) lngInput.value = longitude.toFixed(6);
                if (this.mapEngine) {
                  this.mapEngine.setUserGps(latitude, longitude, accuracy);
                }
              }

              // Once satellite accuracy drops to 15 meters or better, stop watching
              if (accuracy <= 15) {
                navigator.geolocation.clearWatch(watchId);
              }
            }
          },
          (err) => {
            navigator.geolocation.clearWatch(watchId);
            alert(`GPS Signal Error: ${err.message}. Make sure device Location and "Precise Location" are turned ON.`);
            btnPinUseGps.innerHTML = `
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="12" cy="12" r="10"/><line x1="22" x2="18" y1="12" y2="12"/><line x1="6" x2="2" y1="12" y2="12"/><line x1="12" x2="12" y1="6" x2="2"/><line x1="12" x2="12" y1="22" y2="18"/>
              </svg>
              Use My Current GPS (Where I Am Standing)
            `;
          },
          { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 }
        );

        // Stop watching after 8 seconds
        setTimeout(() => {
          navigator.geolocation.clearWatch(watchId);
        }, 8000);
      });
    }

    const houseLinkMeter = document.getElementById('pin-house-link-meter');
    if (houseLinkMeter) {
      houseLinkMeter.addEventListener('change', (e) => {
        const fields = document.getElementById('pin-house-meter-fields');
        if (fields) fields.style.display = e.target.checked ? 'block' : 'none';
      });
    }

    document.getElementById('btn-save-drop-pin').addEventListener('click', () => {
      this.saveDroppedPin();
    });
  }
}

window.addEventListener('DOMContentLoaded', () => {
  window.app = new WaterBillingApp();
  window.app.init();
});
