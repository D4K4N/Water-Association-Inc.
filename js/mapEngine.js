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

// Helper to build robust tile layer with automatic fallback on network/referrer errors
function createRobustTileLayer(primaryUrl, options = {}, fallbackUrl = null) {
  const mergedOpts = Object.assign({
    referrerPolicy: 'no-referrer',
    crossOrigin: false
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

// Available high-performance tile layer configurations
const LAYER_PROVIDERS = {
  google_hybrid: {
    name: 'Google Satellite (Hybrid)',
    createLayer: () => createRobustTileLayer(
      'https://mt{s}.google.com/vt/lyrs=y&x={x}&y={y}&z={z}',
      {
        subdomains: ['0', '1', '2', '3'],
        maxZoom: 22,
        maxNativeZoom: 20,
        attribution: '© Google Maps'
      },
      'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'
    )
  },
  hybrid: {
    name: 'Google Satellite (Hybrid)',
    createLayer: () => createRobustTileLayer(
      'https://mt{s}.google.com/vt/lyrs=y&x={x}&y={y}&z={z}',
      {
        subdomains: ['0', '1', '2', '3'],
        maxZoom: 22,
        maxNativeZoom: 20,
        attribution: '© Google Maps'
      },
      'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'
    )
  },
  satellite: {
    name: 'Satellite (ESRI World Imagery)',
    createLayer: () => createRobustTileLayer(
      'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
      {
        maxZoom: 22,
        maxNativeZoom: 18,
        attribution: '© ESRI World Imagery, Maxar'
      },
      'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png'
    )
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
  },
  terrain: {
    name: 'Topographic Terrain (ESRI Topo)',
    createLayer: () => createRobustTileLayer(
      'https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}',
      {
        maxZoom: 22,
        maxNativeZoom: 18,
        attribution: '© ESRI World Topo'
      }
    )
  },
  dark: {
    name: 'Dark Canvas (CartoDB)',
    createLayer: () => createRobustTileLayer(
      'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
      {
        subdomains: ['a', 'b', 'c', 'd'],
        maxZoom: 22,
        maxNativeZoom: 19,
        attribution: '© CARTO, © OpenStreetMap'
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
      centerLat = 8.3688,
      centerLng = 124.8630,
      zoom = 16.5,
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

    // Initialize Leaflet Map with deep zoom support (clean fullscreen without logo overlap)
    this._map = L.map(container, {
      center: [centerLat, centerLng],
      zoom: zoom,
      minZoom: 2,
      maxZoom: 22,
      zoomControl: false, // UI has its own floating +/- buttons
      attributionControl: false // Hide Leaflet attribution logo banner
    });

    // Initialize Layer Groups
    this._pinsLayerGroup = L.layerGroup().addTo(this._map);
    this._savedRoutesLayerGroup = L.layerGroup().addTo(this._map);

    // Set initial tile layer
    this.setLayer(this._currentLayerKey);

    // Map Event Listeners
    this._map.on('click', (e) => {
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

  // ─── Pin Management & Rendering ───────────────────────────────────────────

  setPins(pins) {
    this._pins = pins || [];
    this._renderAllPins();
  }

  setFilter(filterMode) {
    this._filterMode = filterMode || 'all';
    this._renderAllPins();
  }

  _renderAllPins() {
    if (!this._map || !this._pinsLayerGroup) return;

    this._pinsLayerGroup.clearLayers();
    this._pinMarkers.clear();

    const fm = this._filterMode;

    for (const pin of this._pins) {
      const type = pin.type;
      if (fm !== 'all' && fm !== type + 's' && !(fm === 'clusters' && type === 'cluster')) {
        if (fm === 'households' && type !== 'household') continue;
        if (fm === 'meters' && type !== 'meter') continue;
        if (fm === 'clusters' && type !== 'cluster') continue;
      }

      const lat = pin.lat ?? pin.householdLat ?? pin.meterLat;
      const lng = pin.lng ?? pin.householdLng ?? pin.meterLng;
      if (lat == null || lng == null) continue;

      const html = this._createPinHTML(pin);

      const customIcon = L.divIcon({
        className: 'custom-map-pin',
        html: html,
        iconSize: [120, 38],
        iconAnchor: [60, 38]
      });

      const marker = L.marker([lat, lng], {
        icon: customIcon,
        riseOnHover: true
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
    const colors = {
      household: { bg: '#4C6972', text: '#EBF7FA', border: '#62949A' },
      meter:     { bg: '#9FC6D4', text: '#1E293B', border: '#62949A' },
      cluster:   { bg: '#C5F0F7', text: '#1E293B', border: '#9FC6D4' }
    };
    const c = colors[type] || colors.household;

    let svgIcon = '';
    if (type === 'household') {
      svgIcon = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="${c.text}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
        <path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
        <polyline points="9 22 9 12 15 12 15 22"/>
      </svg>`;
    } else if (type === 'meter') {
      svgIcon = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="${c.text}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="12" cy="12" r="10"/>
        <polyline points="12 6 12 12 16 14"/>
      </svg>`;
    } else {
      svgIcon = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="${c.text}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="12" cy="12" r="3"/>
        <circle cx="19" cy="5" r="2"/>
        <circle cx="5" cy="5" r="2"/>
        <circle cx="5" cy="19" r="2"/>
        <circle cx="19" cy="19" r="2"/>
        <line x1="12" y1="9" x2="19" y2="7"/>
        <line x1="12" y1="9" x2="5" y2="7"/>
        <line x1="12" y1="15" x2="19" y2="17"/>
        <line x1="12" y1="15" x2="5" y2="17"/>
      </svg>`;
    }

    const label = pin.consumerName || pin.meterNo || pin.clusterName || '';
    const shortLabel = label.length > 12 ? label.slice(0, 11) + '…' : label;

    return `
      <div class="map-pin map-pin-${type}" data-pin-id="${pin.id || ''}" data-pin-type="${type}" style="display:flex; flex-direction:column; align-items:center;">
        <div class="pin-body" style="background:${c.bg}; border-color:${c.border}; display:flex; align-items:center; gap:4px; padding:3px 7px; border-radius:10px; border:1.5px solid ${c.border};">
          <div class="pin-icon" style="display:flex; align-items:center;">${svgIcon}</div>
          ${shortLabel ? `<div class="pin-label" style="color:${c.text}; font-size:10px; font-weight:600; white-space:nowrap;">${shortLabel}</div>` : ''}
        </div>
        <div class="pin-tail" style="width:0; height:0; border-left:5px solid transparent; border-right:5px solid transparent; border-top:6px solid ${c.bg};"></div>
      </div>
    `;
  }

  selectPinById(id, type) {
    const pin = this._pins.find(p => p.id === id && p.type === type);
    if (pin && this.selectPinCallback) {
      this.selectPinCallback(pin);
    }

    // Highlight marker DOM
    document.querySelectorAll('.map-pin').forEach(el => {
      const match = el.dataset.pinId === String(id) && el.dataset.pinType === type;
      el.classList.toggle('selected', match);
    });
  }

  // ─── GPS / Real Device Location ───────────────────────────────────────────

  setUserGps(lat, lng, accuracy, heading) {
    if (!this._map) return;
    this._userGps = { lat, lng, accuracy, heading };

    // Update Accuracy Circle
    if (!this._gpsAccuracyCircle) {
      this._gpsAccuracyCircle = L.circle([lat, lng], {
        radius: accuracy || 10,
        color: '#4C6972',
        weight: 1.5,
        opacity: 0.5,
        fillColor: '#4C6972',
        fillOpacity: 0.12
      }).addTo(this._map);
    } else {
      this._gpsAccuracyCircle.setLatLng([lat, lng]);
      if (accuracy != null) this._gpsAccuracyCircle.setRadius(accuracy);
    }

    // Update GPS Dot Marker with Heading Cone
    const coneStyle = (heading != null && !isNaN(heading))
      ? `display:block; transform:rotate(${heading}deg);`
      : 'display:none;';

    const gpsHtml = `
      <div class="gps-dot-container" style="position:relative; width:24px; height:24px; display:flex; align-items:center; justify-content:center;">
        <div class="gps-heading-cone" style="${coneStyle}"></div>
        <div class="gps-dot-halo"></div>
        <div class="gps-dot"></div>
        <div class="gps-dot-core"></div>
      </div>
    `;

    const gpsIcon = L.divIcon({
      className: 'custom-gps-icon',
      html: gpsHtml,
      iconSize: [24, 24],
      iconAnchor: [12, 12]
    });

    if (!this._gpsMarker) {
      this._gpsMarker = L.marker([lat, lng], {
        icon: gpsIcon,
        zIndexOffset: 1000
      }).addTo(this._map);
    } else {
      this._gpsMarker.setLatLng([lat, lng]);
      this._gpsMarker.setIcon(gpsIcon);
    }
  }

  clearUserGps() {
    this._userGps = null;
    if (this._gpsMarker) {
      this._map.removeLayer(this._gpsMarker);
      this._gpsMarker = null;
    }
    if (this._gpsAccuracyCircle) {
      this._map.removeLayer(this._gpsAccuracyCircle);
      this._gpsAccuracyCircle = null;
    }
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
