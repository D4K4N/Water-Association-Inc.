/**
 * Dicklum Water Association, Inc. — Mobile Map Engine (Leaflet Powered)
 * 100% Free Lifetime Open-Source Map Engine
 * 
 * Capabilities:
 * - Deep Zoom Support (Zoom up to level 22 right down to pipes & water meters)
 * - Real Google Hybrid Satellite (mt0-mt3 tile servers) + ESRI World Imagery + OpenStreetMap
 * - Zero API keys, zero tokens, zero credit card requirements, zero usage limits
 * - Real-time device GPS with compass heading rotation cone
 * - Custom Water Blue pin markers for households, water meters, and meter clusters
 * - Active pipe tour route tracing
 */

// Barangay Diclum (Dicklum), Manolo Fortich, Bukidnon — Official Boundary Polygon
// Matches Google Maps Place Boundary: https://www.google.com/maps/place/Diclum,+Manolo+Fortich,+Bukidnon/@8.3747301,124.8519816,14z
const DICLUM_CENTER = [8.3735, 124.8505];
const DICLUM_MAX_BOUNDS = [
  [8.3420, 124.8320], // South-West lock bound (includes Diclum + immediate border buffer)
  [8.4050, 124.8720]  // North-East lock bound
];
const DICLUM_BOUNDARY_COORDS = [
  // Northern border (West to East)
  [8.39760, 124.84963],
  [8.39649, 124.85454],
  [8.39490, 124.86154],
  // Eastern border (North to South along creek / Tankulan & Manolo Fortich boundary)
  [8.39315, 124.86090],
  [8.39140, 124.86074],
  [8.39012, 124.86154],
  [8.38869, 124.86066],
  [8.38694, 124.86082],
  [8.38582, 124.86146],
  [8.38463, 124.86025],
  [8.38375, 124.85913],
  [8.38232, 124.85864],
  [8.38105, 124.85776],
  [8.37946, 124.85711],
  [8.37786, 124.85655],
  [8.37627, 124.85575],
  [8.37452, 124.85526],
  [8.37285, 124.85462],
  [8.37086, 124.85462],
  [8.36807, 124.85438],
  [8.36489, 124.85422],
  [8.36170, 124.85414],
  [8.35812, 124.85397],
  [8.35454, 124.85373],
  [8.35175, 124.85333],
  [8.34952, 124.85285],
  // Southern border (East to West)
  [8.35016, 124.84810],
  [8.35088, 124.84351],
  // Western border (South to North along river / San Miguel boundary)
  [8.35335, 124.84230],
  [8.35558, 124.84278],
  [8.35780, 124.84246],
  [8.35924, 124.84335],
  [8.36019, 124.84464],
  [8.36250, 124.84472],
  [8.36529, 124.84480],
  [8.36656, 124.84560],
  [8.36815, 124.84512],
  [8.36967, 124.84560],
  [8.37126, 124.84624],
  [8.37309, 124.84592],
  [8.37516, 124.84520],
  [8.37707, 124.84576],
  [8.37922, 124.84512],
  [8.38152, 124.84488],
  [8.38264, 124.84624],
  [8.38407, 124.84665],
  [8.38535, 124.84568],
  [8.38678, 124.84713],
  [8.38853, 124.84753],
  [8.39012, 124.84713],
  [8.39156, 124.84834],
  [8.39331, 124.84769],
  [8.39522, 124.84874]
];

// Helper to build fast, smooth tile layer with aggressive caching and automatic fallback
function createRobustTileLayer(primaryUrl, options = {}, fallbackUrl = null) {
  const mergedOpts = Object.assign({
    referrerPolicy: 'no-referrer',
    crossOrigin: false,
    updateWhenIdle: false,    // Fetch tiles immediately while panning for zero-lag feel
    updateWhenZooming: false, // Avoid thrashing intermediate zoom tiles
    keepBuffer: 4             // Keep surrounding Diclum tiles warm in memory
  }, options);

  const layer = L.tileLayer(primaryUrl, mergedOpts);

  if (fallbackUrl) {
    layer.on('tileerror', function(error) {
      if (error.tile && !error.tile._hasFallback) {
        error.tile._hasFallback = true;
        const coords = error.coords;
        if (coords) {
          error.tile.src = fallbackUrl
            .replace('{z}', coords.z)
            .replace('{y}', coords.y)
            .replace('{x}', coords.x);
        }
      }
    });
  }

  return layer;
}

// Available high-performance tile layer configurations (Google Satellite Hybrid & Standard Streets)
const LAYER_PROVIDERS = {
  google_hybrid: {
    name: 'Google Satellite (Hybrid)',
    createLayer: () => createRobustTileLayer(
      'https://{s}.google.com/vt/lyrs=s,h&x={x}&y={y}&z={z}',
      {
        subdomains: ['mt0', 'mt1', 'mt2', 'mt3'],
        maxZoom: 22,
        maxNativeZoom: 20,
        attribution: '© Google Maps'
      },
      'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'
    )
  },
  hybrid: {
    name: 'Google Satellite (Hybrid)',
    createLayer: () => LAYER_PROVIDERS.google_hybrid.createLayer()
  },
  streets: {
    name: 'Standard Streets (OpenStreetMap)',
    createLayer: () => createRobustTileLayer(
      'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
      {
        subdomains: ['a', 'b', 'c'],
        maxZoom: 22,
        maxNativeZoom: 19,
        attribution: '© OpenStreetMap contributors'
      }
    )
  }
};

class FieldMapEngine {
  constructor(containerOrSelector, opts = {}) {
    let container;
    if (typeof containerOrSelector === 'string') {
      container = document.getElementById(containerOrSelector) || document.querySelector(containerOrSelector);
    } else {
      container = containerOrSelector;
    }

    if (!container) {
      console.error('[MapEngine] Container element not found:', containerOrSelector);
      return;
    }

    const {
      centerLat = DICLUM_CENTER[0],
      centerLng = DICLUM_CENTER[1],
      zoom = 15.2,
      layer = 'google_hybrid'
    } = opts;

    this._currentLayerKey = LAYER_PROVIDERS[layer] ? layer : 'google_hybrid';
    this._currentLat = centerLat;
    this._currentLng = centerLng;
    this._zoom = zoom;
    this._pins = [];
    this._filterMode = 'all';
    this._mappingMode = 'mapping';

    // Markers and Layer Groups
    this._pinMarkers = new Map(); // id_type -> L.marker
    this._pinsLayerGroup = null;
    this._gpsMarker = null;
    this._gpsAccuracyCircle = null;
    this._userGps = null;
    this._activeRoutePolyline = null;
    this._savedRoutesLayerGroup = null;
    this._activeRoutePts = null;
    this._savedRoutes = [];
    this._activeTileLayer = null;

    // Public callbacks
    this.selectPinCallback = null;
    this.dropPinCallback = null;

    // Layer providers for app.js UI compatibility
    this.layerProviders = LAYER_PROVIDERS;

    if (typeof L === 'undefined') {
      console.error('[MapEngine] Leaflet library (L) is not loaded.');
      return;
    }

    this._container = container;
    this._bearing = 0;
    this._targetBearing = 0;
    this._angularVelocity = 0;
    this._inertiaActive = false;
    this._rotationRaf = null;
    this._suppressMapClickUntil = 0;

    // Initialize Leaflet Map locked to Barangay Diclum with deep zoom & hardware canvas rendering
    this._map = L.map(container, {
      center: [centerLat, centerLng],
      zoom: zoom,
      minZoom: 13.5,
      maxZoom: 22,
      maxBounds: DICLUM_MAX_BOUNDS,
      maxBoundsViscosity: 0.90,
      preferCanvas: true,
      zoomSnap: 0.25,
      zoomDelta: 0.75,
      wheelPxPerZoomLevel: 80,
      zoomControl: false, // UI has its own floating +/- buttons
      boxZoom: false,     // Reserve Shift + Left-Click drag for desktop 360° map rotation
      attributionControl: false // Hide Leaflet attribution logo banner
    });

    // Create a dedicated non-interactive SVG pane for the Diclum boundary & mask
    // so polygons never intercept map clicks or pin taps on the shared Canvas
    const boundaryPane = this._map.createPane('dicklumBoundaryPane');
    if (boundaryPane) {
      boundaryPane.style.pointerEvents = 'none';
      boundaryPane.style.zIndex = '350';
    }
    this._boundarySvgRenderer = L.svg({ pane: 'dicklumBoundaryPane', padding: 0.5 });

    // Initialize Layer Groups
    this._boundaryLayerGroup = L.layerGroup().addTo(this._map);
    this._pinsLayerGroup = L.layerGroup().addTo(this._map);
    this._savedRoutesLayerGroup = L.layerGroup().addTo(this._map);

    // Set initial tile layer & render Barangay Diclum Red Border Line
    this.setLayer(this._currentLayerKey);
    this._renderDicklumBoundary();

    // Initialize 360° Touch & Mouse Rotation Engine + Compass Sync
    this._initRotationEngine(container);

    // Map Event Listeners
    this._map.on('click', (e) => {
      if (this._suppressMapClickUntil && Date.now() < this._suppressMapClickUntil) return;
      if (this._mappingMode === 'mapping' && this.dropPinCallback) {
        this.dropPinCallback(e.latlng.lat, e.latlng.lng);
      }
    });

    this._map.on('move', () => {
      const c = this._map.getCenter();
      this._currentLat = c.lat;
      this._currentLng = c.lng;
    });

    this._map.on('zoomend', () => {
      this._zoom = this._map.getZoom();
    });

    // Automatic container resize observer (vital for hidden views, responsive layout, PWA orientation)
    if (typeof ResizeObserver !== 'undefined' && container) {
      this._resizeObserver = new ResizeObserver(() => {
        if (this._map) {
          this._map.invalidateSize();
        }
      });
      this._resizeObserver.observe(container);
    }

    // Immediate and delayed resize triggers to guarantee tile painting
    [50, 150, 400, 1000].forEach(delay => {
      setTimeout(() => {
        if (this._map) {
          this._map.invalidateSize();
        }
      }, delay);
    });
  }

  // ─── Public Getters / Setters ─────────────────────────────────────────────

  get userGps() { return this._userGps; }
  get currentLat() { return this._currentLat; }
  get currentLng() { return this._currentLng; }

  get zoom() {
    return this._map ? this._map.getZoom() : this._zoom;
  }
  set zoom(v) {
    this._zoom = v;
    if (this._map) this._map.setZoom(v);
  }

  // ─── Layer / Map Style Switching ──────────────────────────────────────────

  setLayer(layerKey) {
    const config = LAYER_PROVIDERS[layerKey] || LAYER_PROVIDERS.google_hybrid;
    this._currentLayerKey = layerKey;

    if (this._activeTileLayer) {
      this._map.removeLayer(this._activeTileLayer);
    }

    this._activeTileLayer = config.createLayer();
    this._activeTileLayer.addTo(this._map);
    this._activeTileLayer.bringToBack();
  }

  // ─── Barangay Diclum (Dicklum) Elastic Red Border Line & Focus Mask ───────

  _isPointInPolygon(lat, lng, poly) {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const yi = poly[i][0], xi = poly[i][1];
      const yj = poly[j][0], xj = poly[j][1];
      const intersect = ((yi > lat) !== (yj > lat)) &&
        (lng < (xj - xi) * (lat - yi) / ((yj - yi) || 1e-12) + xi);
      if (intersect) inside = !inside;
    }
    return inside;
  }

  _subdividePolygon(poly, maxSegDeg = 0.00035) {
    const out = [];
    const n = poly.length;
    for (let i = 0; i < n; i++) {
      const a = poly[i];
      const b = poly[(i + 1) % n];
      out.push([a[0], a[1]]);
      const dLat = b[0] - a[0];
      const dLng = b[1] - a[1];
      const dist = Math.hypot(dLat, dLng);
      if (dist > maxSegDeg) {
        const steps = Math.min(32, Math.ceil(dist / maxSegDeg));
        for (let s = 1; s < steps; s++) {
          const frac = s / steps;
          out.push([a[0] + dLat * frac, a[1] + dLng * frac]);
        }
      }
    }
    return out;
  }

  /**
   * Dynamically stretches the continuous Barangay Diclum red border outward
   * to enclose ("eat") any pinned household, water meter, or cluster outside the base border,
   * keeping a single unbroken closed loop with a 40-meter clearance from the pin to the red line.
   */
  _computeExpandedDicklumBoundary(pins) {
    let poly = this._subdividePolygon(DICLUM_BOUNDARY_COORDS, 0.00035);

    const validPts = [];
    if (pins && pins.length > 0) {
      for (const p of pins) {
        const lat = Number(p.lat ?? p.householdLat ?? p.meterLat);
        const lng = Number(p.lng ?? p.householdLng ?? p.meterLng);
        if (!isNaN(lat) && !isNaN(lng) && lat > 7 && lat < 10 && lng > 123 && lng < 126) {
          validPts.push([lat, lng]);
        }
      }
    }

    // Also include the user's live GPS sign/dot so the red border dynamically adjusts for the user
    if (this._userGps) {
      const gLat = Number(this._userGps.lat);
      const gLng = Number(this._userGps.lng);
      if (!isNaN(gLat) && !isNaN(gLng) && gLat > 8.28 && gLat < 8.45 && gLng > 124.78 && gLng < 124.92) {
        validPts.push([gLat, gLng]);
      }
    }

    if (validPts.length === 0) return poly;

    // 40 meters clearance in degrees (~1m = 0.000009 deg at 8.36°N => 40m ≈ 0.00036 deg)
    const bufferMargin = 0.00036;

    for (const pt of validPts) {
      const pLat = pt[0];
      const pLng = pt[1];
      const inside = this._isPointInPolygon(pLat, pLng, poly);

      // Find closest vertex on current polygon
      let kNear = 0;
      let minDist = Infinity;
      for (let i = 0; i < poly.length; i++) {
        const d = Math.hypot(poly[i][0] - pLat, poly[i][1] - pLng);
        if (d < minDist) {
          minDist = d;
          kNear = i;
        }
      }

      if (inside && minDist >= bufferMargin * 0.95) {
        continue; // Already inside with at least ~40m clearance from the red border
      }

      const nearVertex = poly[kNear];
      let uLat = pLat - nearVertex[0];
      let uLng = pLng - nearVertex[1];
      let uLen = Math.hypot(uLat, uLng);

      // If the pin is slightly inside or right on the vertex, compute outward normal from adjacent edges
      if (uLen < 1e-6 || inside) {
        const prevV = poly[(kNear - 1 + poly.length) % poly.length];
        const nextV = poly[(kNear + 1) % poly.length];
        // Clockwise polygon in (lat, lng): tangent is (dLat, dLng), outward normal is (dLng, -dLat)
        const tLat = nextV[0] - prevV[0];
        const tLng = nextV[1] - prevV[1];
        const nLen = Math.hypot(tLat, tLng) || 1;
        uLat = tLng / nLen;
        uLng = -tLat / nLen;
        uLen = 1;
      } else {
        uLat /= uLen;
        uLng /= uLen;
      }

      // Target outer wall point: exactly 40 meters (0.00036 deg) past the pinned location
      const targetLat = pLat + uLat * bufferMargin;
      const targetLng = pLng + uLng * bufferMargin;
      const neededShift = (targetLat - nearVertex[0]) * uLat + (targetLng - nearVertex[1]) * uLng;
      if (neededShift <= 0) continue;

      // Compute arc-length distances along the loop in both directions from kNear
      const n = poly.length;
      const arcDist = new Array(n).fill(Infinity);
      arcDist[kNear] = 0;

      let accFwd = 0;
      for (let step = 1; step < n; step++) {
        const prevIdx = (kNear + step - 1) % n;
        const currIdx = (kNear + step) % n;
        accFwd += Math.hypot(poly[currIdx][0] - poly[prevIdx][0], poly[currIdx][1] - poly[prevIdx][1]);
        if (accFwd < arcDist[currIdx]) arcDist[currIdx] = accFwd;
      }

      let accBwd = 0;
      for (let step = 1; step < n; step++) {
        const prevIdx = (kNear - step + 1 + n) % n;
        const currIdx = (kNear - step + n) % n;
        accBwd += Math.hypot(poly[currIdx][0] - poly[prevIdx][0], poly[currIdx][1] - poly[prevIdx][1]);
        if (accBwd < arcDist[currIdx]) arcDist[currIdx] = accBwd;
      }

      // Smooth local window proportional to shift so the border hugs the pin at 40m clearance
      const halfWindow = Math.max(0.0018, Math.min(0.0095, neededShift * 1.15 + 0.0012));

      for (let i = 0; i < n; i++) {
        const s = arcDist[i];
        if (s > halfWindow) continue;

        const t = s / halfWindow;
        // Flat plateau opposite the pin (t <= 0.35), smooth cosine bridge on both sides (0.35 < t <= 1.0)
        const weight = t <= 0.35
          ? 1.0
          : 0.5 * (1 + Math.cos(Math.PI * (t - 0.35) / 0.65));

        const projNeeded = (targetLat - poly[i][0]) * uLat + (targetLng - poly[i][1]) * uLng;
        if (projNeeded > 0) {
          const moveDist = projNeeded * weight;
          poly[i] = [
            poly[i][0] + uLat * moveDist,
            poly[i][1] + uLng * moveDist
          ];
        }
      }

      poly = this._subdividePolygon(poly, 0.00035);
    }

    return poly;
  }

  _renderDicklumBoundary() {
    if (!this._map || !this._boundaryLayerGroup) return;
    this._boundaryLayerGroup.clearLayers();

    const activeBoundary = this._computeExpandedDicklumBoundary(this._pins);
    this._currentBoundaryCoords = activeBoundary;

    // Dynamically expand map maxBounds if pins stretched the Diclum border outward
    const polyBounds = L.latLngBounds(activeBoundary);
    const sw = polyBounds.getSouthWest();
    const ne = polyBounds.getNorthEast();
    const dynamicMaxBounds = [
      [Math.min(DICLUM_MAX_BOUNDS[0][0], sw.lat - 0.007), Math.min(DICLUM_MAX_BOUNDS[0][1], sw.lng - 0.007)],
      [Math.max(DICLUM_MAX_BOUNDS[1][0], ne.lat + 0.007), Math.max(DICLUM_MAX_BOUNDS[1][1], ne.lng + 0.007)]
    ];
    this._map.setMaxBounds(dynamicMaxBounds);

    // 1. Subtle exterior dim mask outside Barangay Diclum so the map focuses inside Diclum
    const outerWorldRing = [
      [8.15, 124.65],
      [8.60, 124.65],
      [8.60, 125.05],
      [8.15, 125.05]
    ];
    const boundaryPaneOpts = this._boundarySvgRenderer
      ? { pane: 'dicklumBoundaryPane', renderer: this._boundarySvgRenderer, interactive: false }
      : { interactive: false };

    const outsideMask = L.polygon([outerWorldRing, activeBoundary], Object.assign({
      stroke: false,
      fillColor: '#0F172A',
      fillOpacity: 0.22
    }, boundaryPaneOpts));
    this._boundaryLayerGroup.addLayer(outsideMask);

    // 2. Soft Google-Maps-style red outer glow along the Diclum boundary
    const redGlow = L.polygon(activeBoundary, Object.assign({
      color: '#EA4335',
      weight: 6,
      opacity: 0.32,
      fill: false,
      lineJoin: 'round',
      lineCap: 'round'
    }, boundaryPaneOpts));
    this._boundaryLayerGroup.addLayer(redGlow);

    // 3. Crisp Google-Maps-style red dashed/dotted border line around Barangay Diclum
    const redBorder = L.polygon(activeBoundary, Object.assign({
      color: '#D93025',
      weight: 2.5,
      opacity: 0.96,
      dashArray: '5, 5',
      fill: false,
      lineJoin: 'round',
      lineCap: 'round'
    }, boundaryPaneOpts));
    this._boundaryLayerGroup.addLayer(redBorder);
  }

  fitToDicklumBoundary(maxZoom = 15.2) {
    if (!this._map) return;
    const coords = (this._currentBoundaryCoords && this._currentBoundaryCoords.length > 0)
      ? this._currentBoundaryCoords
      : DICLUM_BOUNDARY_COORDS;
    const bounds = L.latLngBounds(coords);
    this._map.flyToBounds(bounds, { padding: [24, 24], maxZoom, duration: 0.6 });
  }

  // ─── Pin Management & Rendering ───────────────────────────────────────────

  setPins(pins) {
    this._pins = pins || [];
    this._renderDicklumBoundary();
    this._renderAllPins();
  }

  setFilter(filterMode) {
    // Normalise legacy values: 'both' | 'households' | 'meters' → 'all' | 'household' | 'meter'
    const map = { both: 'all', all: 'all', households: 'household', household: 'household', meters: 'meter', meter: 'meter', clusters: 'meter' };
    this._filterMode = map[filterMode] || 'all';
    this._renderAllPins();
  }

  setZoneFilter(zone) {
    this._zoneFilter = zone || null;
    this._renderAllPins();
  }

  /** Returns pins that pass the current zone + type filters. */
  getVisiblePins() {
    const fm = this._filterMode || 'all';
    const zf = this._zoneFilter || null;
    return (this._pins || []).filter(pin => {
      const type = pin.type;
      if (fm === 'household' && type !== 'household') return false;
      // "Meters" view shows individual meters plus grouped meter manifolds (clusters)
      if (fm === 'meter' && type !== 'meter' && type !== 'cluster') return false;
      if (zf) {
        const z = (pin.data && pin.data.zone) || pin.zone || '';
        if (z !== zf) return false;
      }
      return true;
    });
  }

  /** Smoothly frames all currently visible pins. */
  fitToVisiblePins(maxZoom = 18) {
    if (!this._map) return false;
    const pts = this.getVisiblePins()
      .map(p => [Number(p.lat), Number(p.lng)])
      .filter(([a, b]) => !isNaN(a) && !isNaN(b));
    if (pts.length === 0) return false;
    if (pts.length === 1) {
      this._map.flyTo(pts[0], Math.min(maxZoom, 18), { duration: 0.6 });
    } else {
      this._map.flyToBounds(L.latLngBounds(pts), { padding: [60, 60], maxZoom, duration: 0.6 });
    }
    return true;
  }

  _renderAllPins() {
    if (!this._map || !this._pinsLayerGroup) return;

    this._pinsLayerGroup.clearLayers();
    this._pinMarkers.clear();

    const visible = this.getVisiblePins();

    // Household positions — used to stack a meter that sits on the exact same spot
    const houseSpots = new Set(
      visible.filter(p => p.type === 'household')
        .map(p => `${Number(p.lat).toFixed(6)},${Number(p.lng).toFixed(6)}`)
    );

    for (const pin of visible) {
      const type = pin.type;
      const lat = pin.lat ?? pin.householdLat ?? pin.meterLat;
      const lng = pin.lng ?? pin.householdLng ?? pin.meterLng;
      if (lat == null || lng == null) continue;

      const html = this._createPinHTML(pin);
      const overlapsHouse = type !== 'household' &&
        houseSpots.has(`${Number(lat).toFixed(6)},${Number(lng).toFixed(6)}`);

      const customIcon = L.divIcon({
        className: 'custom-map-pin',
        html: html,
        iconSize: [190, 40],
        // A meter sharing a house's exact spot is lifted above it so both stay visible
        iconAnchor: overlapsHouse ? [95, 76] : [95, 40]
      });

      const marker = L.marker([lat, lng], {
        icon: customIcon,
        riseOnHover: true,
        zIndexOffset: type === 'household' ? 400 : (type === 'cluster' ? 200 : 300)
      });

      marker.on('click', (e) => {
        L.DomEvent.stopPropagation(e);
        if (this.selectPinCallback) this.selectPinCallback(pin);
      });

      marker._pinData = pin;
      this._pinsLayerGroup.addLayer(marker);

      const key = (pin.id || pin.accountNo || Math.random()) + '_' + type;
      this._pinMarkers.set(key, marker);
    }
  }

  _createPinHTML(pin) {
    const type = pin.type;
    const d = pin.data || {};
    const colors = {
      household: '#0F766E',
      meter:     '#2563EB',
      cluster:   '#7C3AED'
    };
    const accent = colors[type] || colors.household;

    let svgIcon = '';
    if (type === 'household') {
      svgIcon = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#FFFFFF" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round">
        <path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>
      </svg>`;
    } else if (type === 'meter') {
      svgIcon = `<svg width="14" height="14" viewBox="0 0 24 24" fill="#FFFFFF" stroke="#FFFFFF" stroke-width="1.5" stroke-linejoin="round">
        <path d="M12 2.7c3.6 4.2 6 7.5 6 10.8a6 6 0 0 1-12 0c0-3.3 2.4-6.6 6-10.8z"/>
      </svg>`;
    } else {
      svgIcon = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#FFFFFF" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round">
        <rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/>
        <rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>
      </svg>`;
    }

    let label = '';
    if (type === 'household') {
      label = d.name || pin.title || '';
    } else if (type === 'meter') {
      const ownerName = (d.name && d.name !== 'Unassigned') ? d.name : (d.ownerName || '');
      label = ownerName || d.meterNo || pin.title || '';
    } else {
      label = d.name || pin.title || '';
    }
    label = String(label).replace(/^Meter\s+/i, '').replace(/\s*\|\s*WM$/i, '').trim();
    const maxLen = type === 'meter' ? 18 : 20;
    const shortLabel = label.length > maxLen ? label.slice(0, maxLen - 1) + '…' : label;
    const safeLabel = shortLabel.replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
    const wmSuffix = type === 'meter'
      ? `<span class="pin-wm-sep">|</span><span class="pin-wm-tag">WM</span>`
      : '';

    return `
      <div class="map-pin map-pin-${type}" data-pin-id="${pin.id || ''}" data-pin-type="${type}">
        <div class="pin-body">
          <span class="pin-icon" style="background:${accent};">${svgIcon}</span>
          ${safeLabel ? `<span class="pin-label">${safeLabel}</span>` : ''}
          ${wmSuffix}
        </div>
        <div class="pin-tail"></div>
      </div>
    `;
  }

  selectPinById(id, type) {
    const pin = this._pins.find(p => String(p.id) === String(id) && (!type || p.type === type));
    if (pin && this.selectPinCallback) {
      this.selectPinCallback(pin);
    }

    // Highlight marker DOM and elevate z-index so hovered pin stands out clearly
    document.querySelectorAll('.map-pin').forEach(el => {
      const match = el.dataset.pinId === String(id) && (!type || el.dataset.pinType === type);
      el.classList.toggle('selected', match);
      el.classList.remove('search-hovered');
      const wrapper = el.closest('.leaflet-marker-icon');
      if (wrapper) {
        wrapper.style.zIndex = match ? '9500' : '';
      }
      if (match) {
        void el.offsetWidth; // trigger reflow for animation restart
        el.classList.add('search-hovered');
      }
    });
  }

  // ─── GPS / Real Device Location ───────────────────────────────────────────

  _calculateDistanceMeters(lat1, lon1, lat2, lon2) {
    const R = 6371e3; // Earth radius in meters
    const phi1 = lat1 * Math.PI / 180;
    const phi2 = lat2 * Math.PI / 180;
    const dPhi = (lat2 - lat1) * Math.PI / 180;
    const dLam = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dPhi / 2) * Math.sin(dPhi / 2) +
              Math.cos(phi1) * Math.cos(phi2) *
              Math.sin(dLam / 2) * Math.sin(dLam / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }

  setUserHeading(headingDeg, isCompass = false) {
    if (headingDeg == null || isNaN(headingDeg)) return;
    if (isCompass) this._hasCompassHeading = true;
    const target = ((Number(headingDeg) % 360) + 360) % 360;

    if (this._userHeading == null) {
      this._userHeading = target;
    } else {
      // Smooth shortest-angle interpolation so the directional beam never spins 360° across 0°/360°
      let delta = ((target - this._userHeading + 540) % 360) - 180;
      this._userHeading = (this._userHeading + delta * 0.35 + 360) % 360;
    }

    if (this._userGps) {
      this._userGps.heading = this._userHeading;
    }

    const cone = document.getElementById('gps-marker-cone');
    if (cone) {
      cone.style.transform = `rotate(${this._userHeading.toFixed(1)}deg)`;
    }
  }

  setUserGps(lat, lng, accuracy, heading) {
    if (!this._map) return;

    let posChanged = false;
    if (this._lastGpsRenderPos) {
      const movedDist = this._calculateDistanceMeters(
        this._lastGpsRenderPos.lat,
        this._lastGpsRenderPos.lng,
        lat,
        lng
      );

      // Derive facing direction from movement vector when walking if compass heading is not overriding
      if (movedDist >= 0.8 && (heading == null || isNaN(heading)) && !this._hasCompassHeading) {
        const dLon = (lng - this._lastGpsRenderPos.lng) * Math.PI / 180;
        const lat1 = this._lastGpsRenderPos.lat * Math.PI / 180;
        const lat2 = lat * Math.PI / 180;
        const y = Math.sin(dLon) * Math.cos(lat2);
        const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
        const moveBrng = ((Math.atan2(y, x) * 180 / Math.PI) + 360) % 360;
        this.setUserHeading(moveBrng, false);
      }

      // Ultra-tight 0.25m deadband so real-time footsteps update immediately
      if (movedDist < 0.25) {
        lat = this._lastGpsRenderPos.lat;
        lng = this._lastGpsRenderPos.lng;
      } else {
        this._lastGpsRenderPos = { lat, lng };
        posChanged = true;
      }
    } else {
      this._lastGpsRenderPos = { lat, lng };
      posChanged = true;
    }

    if (heading != null && !isNaN(heading)) {
      this.setUserHeading(heading, false);
    } else if (this._userHeading == null) {
      this._userHeading = 0;
    }

    this._userGps = { lat, lng, accuracy, heading: this._userHeading };

    // Dynamically adjust the Barangay Diclum red border if user's GPS dot gets close to or outside the border
    if (posChanged) {
      this._renderDicklumBoundary();
    }

    // Clamped visual accuracy circle so coarse fixes do not flood the screen
    const visualRadius = Math.min(Math.max(accuracy || 10, 6), 55);

    if (!this._gpsAccuracyCircle) {
      this._gpsAccuracyCircle = L.circle([lat, lng], {
        radius: visualRadius,
        color: '#1A73E8',
        weight: 1.2,
        opacity: 0.45,
        fillColor: '#4285F4',
        fillOpacity: 0.12,
        interactive: false
      }).addTo(this._map);
    } else {
      this._gpsAccuracyCircle.setLatLng([lat, lng]);
      this._gpsAccuracyCircle.setRadius(visualRadius);
    }

    // "New" (3rd Design): Crisp white-ringed blue circle + wide radial-gradient directional beam cone
    const deg = (this._userHeading || 0).toFixed(1);
    if (!this._gpsMarker) {
      const gpsHtml = `
        <div class="gps-new-marker-wrap">
          <div class="gps-new-beam-rotator" id="gps-marker-cone" style="transform:rotate(${deg}deg);">
            <svg class="gps-new-beam-svg" width="88" height="88" viewBox="0 0 88 88" aria-hidden="true">
              <defs>
                <radialGradient id="gpsNewBeamGrad" cx="44" cy="44" r="42" gradientUnits="userSpaceOnUse">
                  <stop offset="0%" stop-color="#1A73E8" stop-opacity="0.72" />
                  <stop offset="32%" stop-color="#1A73E8" stop-opacity="0.52" />
                  <stop offset="72%" stop-color="#4285F4" stop-opacity="0.20" />
                  <stop offset="100%" stop-color="#4285F4" stop-opacity="0" />
                </radialGradient>
              </defs>
              <path d="M 44 44 L 18.14 10.90 A 42 42 0 0 1 69.86 10.90 Z" fill="url(#gpsNewBeamGrad)" />
            </svg>
          </div>
          <div class="gps-new-dot"></div>
        </div>
      `;

      const gpsIcon = L.divIcon({
        className: 'custom-gps-icon',
        html: gpsHtml,
        iconSize: [88, 88],
        iconAnchor: [44, 44]
      });

      this._gpsMarker = L.marker([lat, lng], {
        icon: gpsIcon,
        zIndexOffset: 1000,
        interactive: false
      }).addTo(this._map);
    } else {
      this._gpsMarker.setLatLng([lat, lng]);
      const cone = document.getElementById('gps-marker-cone');
      if (cone) {
        cone.style.transform = `rotate(${deg}deg)`;
      }
    }
  }

  clearUserGps() {
    this._userGps = null;
    this._lastGpsRenderPos = null;
    if (this._gpsMarker) {
      this._map.removeLayer(this._gpsMarker);
      this._gpsMarker = null;
    }
    if (this._gpsAccuracyCircle) {
      this._map.removeLayer(this._gpsAccuracyCircle);
      this._gpsAccuracyCircle = null;
    }
    this._renderDicklumBoundary();
  }

  // ─── Map Navigation ───────────────────────────────────────────────────────

  panTo(lat, lng, zoom) {
    if (!this._map) return;
    if (zoom != null) {
      this._map.flyTo([lat, lng], zoom, { duration: 0.8 });
    } else {
      this._map.panTo([lat, lng], { animate: true, duration: 0.6 });
    }
  }

  resize() {
    if (this._map) {
      this._map.invalidateSize();
    }
  }

  requestRender() {
    if (this._map) {
      this._map.invalidateSize();
    }
  }

  setMappingMode(mode) {
    this._mappingMode = mode;
  }

  // ─── 360° Map Rotation Engine (Two-Finger Twist + Shift/Right-Click Mouse Drag) ───

  get bearing() {
    return ((this._bearing % 360) + 360) % 360;
  }

  setBearing(angleDeg, opts = {}) {
    this._targetBearing = Number(angleDeg) || 0;
    if (opts.immediate) {
      this._bearing = this._targetBearing;
      this._inertiaActive = false;
      this._angularVelocity = 0;
      this._applyBearingTransform();
    } else {
      this._startRotationLoop();
    }
  }

  resetNorth() {
    const remainder = ((this._bearing % 360) + 360) % 360;
    const shortestDelta = remainder > 180 ? (360 - remainder) : -remainder;
    this._inertiaActive = false;
    this._angularVelocity = 0;
    this._targetBearing = this._bearing + shortestDelta;
    this._startRotationLoop();
  }

  _startRotationLoop() {
    if (this._rotationRaf) return;
    const step = () => {
      if (this._inertiaActive) {
        this._targetBearing += this._angularVelocity;
        this._angularVelocity *= 0.91;
        if (Math.abs(this._angularVelocity) < 0.04) {
          this._angularVelocity = 0;
          this._inertiaActive = false;
        }
      }

      const diff = this._targetBearing - this._bearing;
      if (Math.abs(diff) > 0.04 || this._inertiaActive) {
        this._bearing += diff * 0.28;
        this._applyBearingTransform();
        this._rotationRaf = requestAnimationFrame(step);
      } else {
        this._bearing = this._targetBearing;
        // Snap cleanly to 0 if within 0.25° of North after reset
        const norm = ((this._bearing % 360) + 360) % 360;
        if (norm < 0.25 || norm > 359.75) {
          this._bearing = 0;
          this._targetBearing = 0;
        }
        this._applyBearingTransform();
        this._rotationRaf = null;
      }
    };
    this._rotationRaf = requestAnimationFrame(step);
  }

  _applyBearingTransform() {
    if (!this._container) return;
    const norm = ((this._bearing % 360) + 360) % 360;
    const isZero = norm < 0.08 || norm > 359.92;

    if (isZero) {
      this._container.style.transform = '';
      this._container.style.setProperty('--map-counter-rotate', '0deg');
    } else {
      this._container.style.transform = `rotate(${this._bearing.toFixed(2)}deg)`;
      this._container.style.setProperty('--map-counter-rotate', `${(-this._bearing).toFixed(2)}deg`);
    }

    // Update UI Compass Indicator in real time
    const needle = document.getElementById('compass-needle-svg');
    const badge = document.getElementById('compass-degree-badge');
    const compassBtn = document.getElementById('btn-map-compass');

    if (needle) {
      needle.style.transform = isZero ? '' : `rotate(${this._bearing.toFixed(2)}deg)`;
    }
    if (compassBtn) {
      compassBtn.classList.toggle('rotated', !isZero);
    }
    if (badge) {
      const deg = Math.round(norm) % 360;
      if (deg === 0) {
        badge.classList.add('hidden');
      } else {
        const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
        const dir = dirs[Math.round(deg / 45) % 8];
        badge.textContent = `${deg}° ${dir}`;
        badge.classList.remove('hidden');
      }
    }
  }

  _initRotationEngine(container) {
    if (!this._map || !container) return;

    // 1. Rotation-aware mouseEventToContainerPoint so tapping/pinning at any angle is pixel-accurate
    const origMouseToContainer = this._map.mouseEventToContainerPoint.bind(this._map);
    this._map.mouseEventToContainerPoint = (e) => {
      if (Math.abs(this._bearing) < 0.05) {
        return origMouseToContainer(e);
      }
      const rect = container.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      const dx = e.clientX - cx;
      const dy = e.clientY - cy;
      const rad = -this._bearing * Math.PI / 180;
      const cos = Math.cos(rad);
      const sin = Math.sin(rad);
      const localX = dx * cos - dy * sin + container.clientWidth / 2 - (container.clientLeft || 0);
      const localY = dx * sin + dy * cos + container.clientHeight / 2 - (container.clientTop || 0);
      return L.point(localX, localY);
    };

    // 2. Rotation-aware 1-finger / left-click panning so dragging follows the finger/cursor at any rotation angle
    const draggable = this._map.dragging && this._map.dragging._draggable;
    if (draggable) {
      draggable.on('predrag', () => {
        if (Math.abs(this._bearing) < 0.05 || !draggable._startPos || !draggable._newPos) return;
        const dx = draggable._newPos.x - draggable._startPos.x;
        const dy = draggable._newPos.y - draggable._startPos.y;
        const rad = -this._bearing * Math.PI / 180;
        const cos = Math.cos(rad);
        const sin = Math.sin(rad);
        draggable._newPos = L.point(
          draggable._startPos.x + (dx * cos - dy * sin),
          draggable._startPos.y + (dx * sin + dy * cos)
        );
      });
    }

    const wrapper = container.parentElement || container;

    // 3. Two-Finger Touch Twist Rotation (Mobile)
    this._touchPrevAngle = null;
    this._touchTotalTwist = 0;

    wrapper.addEventListener('touchstart', (e) => {
      if (e.touches && e.touches.length === 2) {
        const t0 = e.touches[0];
        const t1 = e.touches[1];
        this._touchPrevAngle = Math.atan2(t1.clientY - t0.clientY, t1.clientX - t0.clientX) * 180 / Math.PI;
        this._touchTotalTwist = 0;
        this._angularVelocity = 0;
        this._inertiaActive = false;
      }
    }, { passive: true });

    wrapper.addEventListener('touchmove', (e) => {
      if (e.touches && e.touches.length === 2) {
        const t0 = e.touches[0];
        const t1 = e.touches[1];
        const currentAngle = Math.atan2(t1.clientY - t0.clientY, t1.clientX - t0.clientX) * 180 / Math.PI;

        if (this._touchPrevAngle !== null) {
          let delta = ((currentAngle - this._touchPrevAngle + 540) % 360) - 180;
          this._touchPrevAngle = currentAngle;
          this._touchTotalTwist += Math.abs(delta);

          // Deadband of 1.2° prevents unintentional wobble during pure 2-finger pinch zoom
          if (this._touchTotalTwist > 1.2 && Math.abs(delta) < 45) {
            this._targetBearing += delta;
            this._angularVelocity = 0.65 * delta + 0.35 * this._angularVelocity;
            this._startRotationLoop();
          }
        } else {
          this._touchPrevAngle = currentAngle;
        }
      }
    }, { passive: true });

    const endTouchRotate = (e) => {
      if (!e.touches || e.touches.length < 2) {
        if (this._touchPrevAngle !== null) {
          this._touchPrevAngle = null;
          this._suppressMapClickUntil = Date.now() + 380;
          if (Math.abs(this._angularVelocity) > 0.2) {
            this._inertiaActive = true;
            this._startRotationLoop();
          }
        }
      }
    };
    wrapper.addEventListener('touchend', endTouchRotate, { passive: true });
    wrapper.addEventListener('touchcancel', endTouchRotate, { passive: true });

    // 4. Desktop Mouse Rotation (Shift + Left-Click Drag OR Right-Click Drag)
    this._isMouseRotating = false;
    this._mousePrevX = 0;
    this._mouseMovedPx = 0;

    wrapper.addEventListener('mousedown', (e) => {
      if (e.target.closest('.map-top-bar, .map-floating-controls, .gps-locate-btn')) return;
      const isShiftLeft = (e.button === 0 && e.shiftKey);
      const isRightClick = (e.button === 2);
      if (!isShiftLeft && !isRightClick) return;

      e.preventDefault();
      this._isMouseRotating = true;
      this._mousePrevX = e.clientX;
      this._mouseMovedPx = 0;
      this._angularVelocity = 0;
      this._inertiaActive = false;

      if (this._map && this._map.dragging) {
        this._map.dragging.disable();
      }
    });

    window.addEventListener('mousemove', (e) => {
      if (!this._isMouseRotating) return;
      const dx = e.clientX - this._mousePrevX;
      this._mousePrevX = e.clientX;
      this._mouseMovedPx += Math.abs(dx);

      // Dragging left (dx < 0) rotates counter-clockwise; dragging right (dx > 0) rotates clockwise
      const deltaDeg = dx * 0.55;
      this._targetBearing += deltaDeg;
      this._angularVelocity = 0.65 * deltaDeg + 0.35 * this._angularVelocity;
      this._startRotationLoop();
    });

    window.addEventListener('mouseup', () => {
      if (!this._isMouseRotating) return;
      this._isMouseRotating = false;
      if (this._map && this._map.dragging) {
        this._map.dragging.enable();
      }
      if (this._mouseMovedPx > 3) {
        this._suppressMapClickUntil = Date.now() + 300;
      }
      if (Math.abs(this._angularVelocity) > 0.2) {
        this._inertiaActive = true;
        this._startRotationLoop();
      }
    });

    wrapper.addEventListener('contextmenu', (e) => {
      if (!e.target.closest('.map-top-bar, .map-floating-controls, .gps-locate-btn')) {
        e.preventDefault();
      }
    });
  }

  // ─── Route Recording & Display ────────────────────────────────────────────

  setActiveRoute(points) {
    this._activeRoutePts = points;

    if (this._activeRoutePolyline) {
      this._map.removeLayer(this._activeRoutePolyline);
      this._activeRoutePolyline = null;
    }

    if (points && points.length >= 2) {
      const latlngs = points.map(p => [p.lat, p.lng]);
      this._activeRoutePolyline = L.polyline(latlngs, {
        color: '#9FC6D4',
        weight: 3.5,
        opacity: 0.85,
        dashArray: '6, 6'
      }).addTo(this._map);
    }
  }

  setSavedRoutes(routes) {
    this._savedRoutes = routes || [];
    if (!this._savedRoutesLayerGroup) return;

    this._savedRoutesLayerGroup.clearLayers();

    for (const route of this._savedRoutes) {
      if (route.points && route.points.length >= 2) {
        const latlngs = route.points.map(p => [p.lat, p.lng]);
        const polyline = L.polyline(latlngs, {
          color: '#62949A',
          weight: 2.5,
          opacity: 0.6
        });
        this._savedRoutesLayerGroup.addLayer(polyline);
      }
    }
  }
}

if (typeof window !== 'undefined') {
  window.FieldMapEngine = FieldMapEngine;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { FieldMapEngine, LAYER_PROVIDERS };
}
