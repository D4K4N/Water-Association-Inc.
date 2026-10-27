/**
 * Dicklum Water Association - Central Application Coordinator
 * Connects UI, DB, Real-Time Satellite Map, Route Recording, Reading Module, Billing,
 * Thermal Printing, Official Reports, and Offline Disaster Recovery.
 * 100% English Language & Clean Human-Crafted Vector Icons (Zero emojis).
 */

class WaterBillingApp {
  constructor() {
    this.activeView = 'view-splash';
    this.currentMode = 'mapping'; // 'mapping' or 'reading'
    this.activeConsumer = null;
    this.activeMeter = null;
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

    // 3. Initialize Satellite Map Engine
    const mapContainer = document.getElementById('field-map');
    if (mapContainer) {
      this.mapEngine = new window.FieldMapEngine(mapContainer, {
        centerLat: 8.3688,
        centerLng: 124.8630,
        zoom: 16.5,
        layer: 'google_hybrid'
      });

      this.mapEngine.selectPinCallback = (pin) => this.handlePinSelect(pin);
      this.mapEngine.dropPinCallback = (lat, lng) => this.handleMapTapToPin(lat, lng);
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

    console.log('Dicklum Water Billing System ready.');
  }

  async refreshDataCache() {
    this.cachedConsumers = await window.db.getAll('consumers');
    this.cachedMeters = await window.db.getAll('meters');
    this.cachedClusters = await window.db.getAll('clusters');
    this.cachedBills = await window.db.getAll('bills');
    this.cachedRoutes = await window.db.getRoutes();

    const settings = await window.db.getAll('settings');
    this.cachedSettings = {};
    settings.forEach(s => { this.cachedSettings[s.key] = s.value; });

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
    this.currentMode = mode; // 'mapping' or 'reading'

    const modeBadge = document.getElementById('current-mode-badge');
    if (modeBadge) {
      if (mode === 'mapping') {
        modeBadge.className = 'mode-badge mapping';
        modeBadge.textContent = 'MAPPING MODE';
      } else {
        modeBadge.className = 'mode-badge reading';
        modeBadge.textContent = 'READING MODE';
      }
    }

    if (this.mapEngine) {
      this.mapEngine.setMappingMode(mode);
    }

    document.querySelectorAll('.mode-toggle-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.mode === mode);
    });

    const fabPin = document.getElementById('fab-add-pin');
    if (fabPin) {
      fabPin.style.display = mode === 'mapping' ? 'flex' : 'none';
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
        pins.push({
          id: m.id,
          type: 'meter',
          lat: Number(m.meterLat),
          lng: Number(m.meterLng),
          title: `Meter ${m.meterNo}`,
          data: {
            meterId: m.id,
            meterNo: m.meterNo,
            consumerId: m.consumerId,
            name: consumer ? consumer.name : 'Unassigned',
            accountNo: consumer ? consumer.accountNo : '',
            zone: consumer ? consumer.zone : '',
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
  }

  syncRoutesToMap() {
    if (!this.mapEngine) return;
    this.mapEngine.setSavedRoutes(this.cachedRoutes);
  }

  handlePinSelect(pin) {
    if (pin.type === 'cluster') {
      this.openClusterSheet(pin.data.clusterId);
    } else if (pin.type === 'meter') {
      this.openConsumerSheet(pin.data.consumerId, pin.data.meterId);
    } else {
      this.openConsumerSheet(pin.data.consumerId);
    }
  }

  handleMapTapToPin(lat, lng) {
    this.openDropPinModal(lat, lng);
  }

  openConsumerSheet(consumerId, highlightMeterId = null) {
    const consumer = this.cachedConsumers.find(c => c.id === consumerId);
    if (!consumer) return;

    this.activeConsumer = consumer;
    const meter = this.cachedMeters.find(m => m.consumerId === consumerId);
    this.activeMeter = meter;

    const sheet = document.getElementById('map-bottom-sheet');
    if (!sheet) return;

    document.getElementById('sheet-consumer-name').textContent = consumer.name;
    document.getElementById('sheet-account-no').textContent = consumer.accountNo;
    document.getElementById('sheet-zone').textContent = consumer.zone;
    document.getElementById('sheet-address').textContent = consumer.address;

    const meterNoEl = document.getElementById('sheet-meter-no');
    if (meter) {
      meterNoEl.textContent = meter.meterNo + (meter.isClustered ? ' (Clustered Manifold)' : ' (Individual Standpipe)');
    } else {
      meterNoEl.textContent = 'No meter assigned';
    }

    const latestBill = this.cachedBills.find(b => b.consumerId === consumerId);
    document.getElementById('sheet-prev-reading').textContent = latestBill ? `${latestBill.currentReading} m³` : 'N/A';

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

  // --- Real-Time Geolocation Tracking (Phase 2, Section 5) ---

  toggleRealtimeGps() {
    if (!navigator.geolocation) {
      alert('Geolocation is not supported by this browser/device.\n\nFor GPS to work:\n• Use Chrome or Edge on Android\n• Access the app via HTTPS or localhost\n• Enable Location Services in device settings');
      return;
    }

    if (this.gpsWatchId !== null) {
      // Already tracking — recenter map on current GPS position instead of stopping
      if (this.mapEngine && this.mapEngine.userGps) {
        this.mapEngine.panTo(this.mapEngine.userGps.lat, this.mapEngine.userGps.lng);
      } else {
        this.stopRealtimeGps();
      }
    } else {
      this.startRealtimeGps();
    }
  }

  startRealtimeGps() {
    const btn = document.getElementById('btn-gps-my-location');
    if (!btn) return;
    btn.classList.add('active');
    btn.innerHTML = `${window.AppIcons.crosshair()} Acquiring GPS...`;

    // Track whether we've already panned to the first location
    this._gpsPannedOnce = false;

    this.gpsWatchId = navigator.geolocation.watchPosition(
      (pos) => {
        const { latitude, longitude, accuracy, heading, speed } = pos.coords;

        if (this.mapEngine) {
          // Update the GPS marker with real coordinates and heading
          this.mapEngine.setUserGps(latitude, longitude, accuracy, heading);

          // Auto-pan to device only on the FIRST GPS fix, not on every update
          // (so the user can pan the map freely after initial centering)
          if (!this._gpsPannedOnce) {
            this._gpsPannedOnce = true;
            this.mapEngine.panTo(latitude, longitude);
          }
        }

        // Update button with accuracy indicator
        const accuracyIcon = accuracy <= 10 ? '●' : accuracy <= 30 ? '◉' : '○';
        btn.innerHTML = `${window.AppIcons.crosshair()} ${accuracyIcon} ±${Math.round(accuracy)}m`;
        btn.title = `GPS Active\nLat: ${latitude.toFixed(6)}\nLng: ${longitude.toFixed(6)}\nAccuracy: ±${Math.round(accuracy)}m${heading !== null ? '\nHeading: ' + Math.round(heading) + '°' : ''}`;

        // If recording route, append point
        if (this.isRecordingRoute) {
          this.appendRoutePoint(latitude, longitude, accuracy);
        }
      },
      (err) => {
        console.warn('GPS location error:', err);
        let msg = '';
        switch(err.code) {
          case 1:
            msg = 'Location permission denied.\n\nTo enable GPS:\n1. Tap the lock icon in the address bar\n2. Allow Location access\n3. Refresh the page';
            break;
          case 2:
            msg = 'GPS signal unavailable. Make sure:\n• Location services are enabled on your device\n• You are outdoors or near a window for better signal';
            break;
          case 3:
            msg = 'GPS request timed out. This can happen in areas with poor satellite coverage. Please try again outdoors.';
            break;
          default:
            msg = 'Unable to acquire GPS location: ' + err.message;
        }

        btn.classList.remove('active');
        btn.innerHTML = `${window.AppIcons.crosshair()} GPS Error`;
        btn.title = msg;
        alert(msg);
        this.gpsWatchId = null;
      },
      {
        enableHighAccuracy: true,
        timeout: 20000,
        maximumAge: 5000
      }
    );
  }

  stopRealtimeGps() {
    if (this.gpsWatchId !== null) {
      navigator.geolocation.clearWatch(this.gpsWatchId);
      this.gpsWatchId = null;
    }
    this._gpsPannedOnce = false;
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
    const pt = {
      lat: Number(lat),
      lng: Number(lng),
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

    const calculation = window.billingEngine.calculate(prev, curr, this.cachedSettings.tariff);
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

  async openDropPinModal(lat, lng) {
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

    const latInput = document.getElementById('pin-lat-input');
    const lngInput = document.getElementById('pin-lng-input');
    if (latInput) latInput.value = lat.toFixed(6);
    if (lngInput) lngInput.value = lng.toFixed(6);

    // Hide inline add boxes
    const addZoneBox = document.getElementById('pin-add-zone-box');
    if (addZoneBox) addZoneBox.style.display = 'none';
    const addClusterBox = document.getElementById('pin-add-cluster-box');
    if (addClusterBox) addClusterBox.style.display = 'none';

    // Populate zones and zone-separated clusters
    await this.populateZoneDropdowns();

    // Reset fields for fresh entry
    const ownerInput = document.getElementById('pin-meter-owner-name');
    const meterNoInput = document.getElementById('pin-meter-no');
    const initRdgInput = document.getElementById('pin-meter-initial-reading');
    const meterAddrInput = document.getElementById('pin-meter-address');
    const meterNotesInput = document.getElementById('pin-meter-notes');
    const linkHouseCheckbox = document.getElementById('pin-meter-link-household');

    if (ownerInput) ownerInput.value = '';
    if (meterNoInput) meterNoInput.value = `WM-2026-${String(this.cachedMeters.length + 1).padStart(3, '0')}`;
    if (initRdgInput) initRdgInput.value = 0;
    if (meterAddrInput) meterAddrInput.value = '';
    if (meterNotesInput) meterNotesInput.value = '';
    if (linkHouseCheckbox) linkHouseCheckbox.checked = true;

    const houseNameInput = document.getElementById('pin-house-name');
    const houseAddrInput = document.getElementById('pin-house-address');
    const houseContactInput = document.getElementById('pin-house-contact');
    const houseNotesInput = document.getElementById('pin-house-notes');
    const houseMeterNoInput = document.getElementById('pin-house-meter-no');
    const houseMeterInitInput = document.getElementById('pin-house-meter-initial');

    if (houseNameInput) houseNameInput.value = '';
    if (houseAddrInput) houseAddrInput.value = '';
    if (houseContactInput) houseContactInput.value = '';
    if (houseNotesInput) houseNotesInput.value = '';
    if (houseMeterNoInput) houseMeterNoInput.value = `WM-2026-${String(this.cachedMeters.length + 1).padStart(3, '0')}`;
    if (houseMeterInitInput) houseMeterInitInput.value = 0;

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

    // Default to water meter tab
    const meterRadio = document.querySelector('input[name="pin-type"][value="meter"]');
    if (meterRadio) {
      meterRadio.checked = true;
      const formMeter = document.getElementById('form-pin-meter');
      const formHouse = document.getElementById('form-pin-household');
      if (formMeter) formMeter.style.display = 'block';
      if (formHouse) formHouse.style.display = 'none';
    }

    document.getElementById('modal-drop-pin').classList.add('active');
  }

  async saveDroppedPin() {
    const pinType = document.querySelector('input[name="pin-type"]:checked').value;
    const lat = Number(document.getElementById('pin-lat-input').value);
    const lng = Number(document.getElementById('pin-lng-input').value);

    if (!lat || !lng || isNaN(lat) || isNaN(lng)) {
      alert('Please provide valid Latitude and Longitude coordinates (tap the map or use GPS).');
      return;
    }

    // Obtain selected Purok/Zone from the main selector
    const zone = (document.getElementById('pin-zone-select') && document.getElementById('pin-zone-select').value) 
      ? document.getElementById('pin-zone-select').value 
      : 'Zone 1 - Dicklum Central';

    let targetConsumerId = null;
    let targetConsumerName = '';
    let savedMeterNo = '';

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

      // Check duplicate meter serial
      const dupMeter = await window.db.findDuplicateMeterNo(meterNo);
      if (dupMeter) {
        alert(`Water meter serial number "${meterNo}" is already registered.`);
        return;
      }

      if (existingConsumerId) {
        targetConsumerId = existingConsumerId;
        const existing = this.cachedConsumers.find(c => c.id === existingConsumerId);
        targetConsumerName = existing ? existing.name : 'Consumer';
        if (linkHousehold && existing && (!existing.householdLat || !existing.householdLng)) {
          existing.householdLat = lat;
          existing.householdLng = lng;
          await window.db.put('consumers', existing);
        }
      } else {
        // Register new consumer
        targetConsumerId = `c-${Date.now().toString().slice(-5)}`;
        targetConsumerName = ownerName;
        const accountNo = `DWA-2026-${String(this.cachedConsumers.length + 1).padStart(3, '0')}`;

        const newConsumer = {
          id: targetConsumerId,
          accountNo: accountNo,
          name: ownerName,
          zone: zone,
          address: address || `${zone}, Dicklum`,
          contact: '',
          status: 'Active',
          householdLat: linkHousehold ? lat : null,
          householdLng: linkHousehold ? lng : null,
          notes: notes,
          createdAt: new Date().toISOString()
        };
        await window.db.put('consumers', newConsumer);
      }

      // Register new water meter
      const meterId = `m-${Date.now().toString().slice(-5)}`;
      savedMeterNo = meterNo;
      const newMeter = {
        id: meterId,
        meterNo: meterNo,
        consumerId: targetConsumerId,
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
      // Household Pin
      const name = document.getElementById('pin-house-name').value.trim();
      const address = document.getElementById('pin-house-address').value.trim();
      const contact = document.getElementById('pin-house-contact').value.trim();
      const linkMeter = document.getElementById('pin-house-link-meter').checked;
      const meterNo = document.getElementById('pin-house-meter-no').value.trim();
      const initialReading = Number(document.getElementById('pin-house-meter-initial').value) || 0;
      const notes = document.getElementById('pin-house-notes').value.trim();

      if (!name) {
        alert('Please enter consumer full name.');
        return;
      }

      targetConsumerId = `c-${Date.now().toString().slice(-5)}`;
      targetConsumerName = name;
      const accountNo = `DWA-2026-${String(this.cachedConsumers.length + 1).padStart(3, '0')}`;

      const newConsumer = {
        id: targetConsumerId,
        accountNo: accountNo,
        name: name,
        zone: zone,
        address: address || `${zone}, Dicklum`,
        contact: contact,
        status: 'Active',
        householdLat: lat,
        householdLng: lng,
        notes: notes,
        createdAt: new Date().toISOString()
      };
      await window.db.put('consumers', newConsumer);

      if (linkMeter && meterNo) {
        const dupMeter = await window.db.findDuplicateMeterNo(meterNo);
        if (!dupMeter) {
          const meterId = `m-${Date.now().toString().slice(-5)}`;
          savedMeterNo = meterNo;
          const newMeter = {
            id: meterId,
            meterNo: meterNo,
            consumerId: targetConsumerId,
            meterLat: lat,
            meterLng: lng,
            isClustered: false,
            clusterId: null,
            installDate: new Date().toISOString().split('T')[0],
            initialReading: initialReading,
            status: 'Operational',
            notes: notes
          };
          await window.db.put('meters', newMeter);
        }
      }
    }

    await this.refreshDataCache();
    this.syncPinsToMap();
    this.renderConsumerList();
    this.populateQuickConsumerSelect();
    document.getElementById('modal-drop-pin').classList.remove('active');

    // Smooth navigation confirmation to Meter Reading & Computation
    const meterText = savedMeterNo ? ` and water meter (${savedMeterNo})` : '';
    if (confirm(`Location${meterText} saved for ${targetConsumerName} in ${zone}!\n\nWould you like to open "Meter Reading & Computation" for this consumer now?`)) {
      this.startReadingForConsumer(targetConsumerId);
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

  // --- Map Layer Switcher ---

  openLayerModal() {
    document.getElementById('modal-map-layers').classList.add('active');
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

    list.innerHTML = '';
    if (filtered.length === 0) {
      list.innerHTML = '<div style="padding: 20px; text-align: center; color: #64748B;">No consumers found.</div>';
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
          <span class="badge ${c.status === 'Active' ? 'badge-success' : 'badge-danger'}">${c.status}</span>
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
          <span class="badge ${isPaid ? 'badge-success' : 'badge-danger'}">
            ${b.paymentStatus}
          </span>
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
    document.getElementById('card-mode-mapping').addEventListener('click', () => {
      this.setMode('mapping');
      this.switchView('view-map');
    });

    document.getElementById('card-mode-reading').addEventListener('click', () => {
      this.setMode('reading');
      this.switchView('view-map');
    });

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

  bindMapEvents() {
    const searchInput = document.getElementById('map-search-input');
    const searchResults = document.getElementById('map-search-results');
    if (searchInput && searchResults) {
      searchInput.addEventListener('input', (e) => {
        const q = e.target.value.toLowerCase().trim();
        if (!q) {
          searchResults.classList.add('hidden');
          searchResults.innerHTML = '';
          return;
        }

        // Search consumers and meters
        const matches = [];
        this.cachedConsumers.forEach(c => {
          const meter = this.cachedMeters.find(m => m.consumerId === c.id);
          const nameMatch = c.name && c.name.toLowerCase().includes(q);
          const acctMatch = c.accountNo && c.accountNo.toLowerCase().includes(q);
          const meterMatch = meter && meter.meterNo && meter.meterNo.toLowerCase().includes(q);
          const addressMatch = c.address && c.address.toLowerCase().includes(q);
          const zoneMatch = c.zone && c.zone.toLowerCase().includes(q);

          if (nameMatch || acctMatch || meterMatch || addressMatch || zoneMatch) {
            matches.push({ consumer: c, meter });
          }
        });

        // Check standalone / unassigned meters
        this.cachedMeters.forEach(m => {
          if (!m.consumerId && m.meterNo && m.meterNo.toLowerCase().includes(q)) {
            matches.push({ consumer: null, meter: m });
          }
        });

        if (matches.length === 0) {
          searchResults.innerHTML = '<div style="padding: 12px; font-size: 12px; color: #64748B; text-align: center;">No matching water meters or consumers found.</div>';
          searchResults.classList.remove('hidden');
          return;
        }

        searchResults.innerHTML = matches.slice(0, 8).map(item => {
          const c = item.consumer;
          const m = item.meter;
          const name = c ? c.name : 'Unassigned Meter';
          const acct = c ? c.accountNo : '—';
          const meterNo = m ? m.meterNo : 'No meter';
          const zone = c ? c.zone : 'Dicklum';
          const consumerId = c ? c.id : '';
          const lat = (m && m.meterLat) || (c && c.householdLat) || '';
          const lng = (m && m.meterLng) || (c && c.householdLng) || '';
          return `
            <div class="search-result-item" data-consumer-id="${consumerId}" data-lat="${lat}" data-lng="${lng}">
              <div>
                <div class="search-result-title">${name}</div>
                <div class="search-result-meta">
                  <span>${acct}</span>
                  <span>•</span>
                  <span>Meter: <strong>${meterNo}</strong></span>
                  <span>•</span>
                  <span>${zone}</span>
                </div>
              </div>
              <div class="search-result-action">
                Read Meter &rarr;
              </div>
            </div>
          `;
        }).join('');

        searchResults.classList.remove('hidden');
      });

      // Handle clicking a search result: sends directly to "Meter Reading & Computation"
      searchResults.addEventListener('click', (e) => {
        const item = e.target.closest('.search-result-item');
        if (!item) return;

        const consumerId = item.dataset.consumerId;
        const lat = Number(item.dataset.lat);
        const lng = Number(item.dataset.lng);

        searchResults.classList.add('hidden');
        searchInput.value = '';

        if (lat && lng && this.mapEngine) {
          this.mapEngine.panTo(lat, lng, 18);
        }

        if (consumerId) {
          this.startReadingForConsumer(consumerId);
        }
      });

      // Hide dropdown when clicking outside
      document.addEventListener('click', (e) => {
        if (!e.target.closest('.map-search-row')) {
          searchResults.classList.add('hidden');
        }
      });
    }

    // Map Filter Chips: Both, Households, Water Meters (Phase 2, Section 6)
    document.querySelectorAll('.map-filter-chip').forEach(chip => {
      chip.addEventListener('click', (e) => {
        document.querySelectorAll('.map-filter-chip').forEach(c => c.classList.remove('active'));
        e.target.classList.add('active');
        if (this.mapEngine) this.mapEngine.setFilter(e.target.dataset.filter);
      });
    });

    const btnGps = document.getElementById('btn-gps-my-location');
    if (btnGps) {
      btnGps.addEventListener('click', () => this.toggleRealtimeGps());
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

    document.getElementById('btn-execute-a4-print').addEventListener('click', () => {
      document.body.classList.add('printing-a4');
      document.body.classList.remove('printing-thermal');
      window.print();
      setTimeout(() => {
        document.body.classList.remove('printing-a4');
      }, 1000);
    });

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

    document.getElementById('btn-print-report-modal').addEventListener('click', () => {
      document.body.classList.add('printing-a4');
      document.body.classList.remove('printing-thermal');
      window.print();
      setTimeout(() => {
        document.body.classList.remove('printing-a4');
      }, 1000);
    });

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
  }

  bindModalEvents() {
    document.querySelectorAll('.modal-close, .modal-backdrop').forEach(el => {
      el.addEventListener('click', (e) => {
        const modal = e.target.closest('.app-modal');
        if (modal) modal.classList.remove('active');
      });
    });

    document.querySelectorAll('input[name="pin-type"]').forEach(radio => {
      radio.addEventListener('change', (e) => {
        const isHouse = e.target.value === 'household';
        const formHouse = document.getElementById('form-pin-household');
        const formMeter = document.getElementById('form-pin-meter');
        if (formHouse) formHouse.style.display = isHouse ? 'block' : 'none';
        if (formMeter) formMeter.style.display = isHouse ? 'none' : 'block';
      });
    });

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
        btnPinUseGps.textContent = 'Locating GPS position...';
        navigator.geolocation.getCurrentPosition(
          (pos) => {
            const lat = pos.coords.latitude;
            const lng = pos.coords.longitude;
            const latInput = document.getElementById('pin-lat-input');
            const lngInput = document.getElementById('pin-lng-input');
            if (latInput) latInput.value = lat.toFixed(6);
            if (lngInput) lngInput.value = lng.toFixed(6);
            btnPinUseGps.innerHTML = `
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="12" cy="12" r="10"/><line x1="22" x2="18" y1="12" y2="12"/><line x1="6" x2="2" y1="12" y2="12"/><line x1="12" x2="12" y1="6" x2="2"/><line x1="12" x2="12" y1="22" y2="18"/>
              </svg>
              GPS Locked: ${lat.toFixed(5)}, ${lng.toFixed(5)}
            `;
            if (this.mapEngine) {
              this.mapEngine.panTo(lat, lng, 18);
            }
          },
          (err) => {
            alert(`Could not get GPS location: ${err.message}. You can still enter coordinates or tap anywhere on the map.`);
            btnPinUseGps.innerHTML = `
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="12" cy="12" r="10"/><line x1="22" x2="18" y1="12" y2="12"/><line x1="6" x2="2" y1="12" y2="12"/><line x1="12" x2="12" y1="6" x2="2"/><line x1="12" x2="12" y1="22" y2="18"/>
              </svg>
              Use My Current GPS (Where I Am Standing)
            `;
          },
          { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
        );
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
