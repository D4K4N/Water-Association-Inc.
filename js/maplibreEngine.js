/**
 * Dicklum Water Association - MapLibre GL WebGL Map Engine
 * Hardware-accelerated GPU Canvas rendering (60fps, zero HTML <img> boxes, seamless 4K satellite blending)
 * 100% Free & Open-Source, offline-capable, and API-compatible with FieldMapEngine.
 */

(function(window) {
  'use strict';

  // Official Barangay Diclum Boundary Coordinates (lat, lng)
  const DICLUM_BOUNDARY_COORDS = [
    [8.39760, 124.84963], [8.39649, 124.85454], [8.39490, 124.86154],
    [8.39315, 124.86090], [8.39140, 124.86074], [8.39012, 124.86154],
    [8.38869, 124.86066], [8.38694, 124.86082], [8.38582, 124.86146],
    [8.38463, 124.86025], [8.38375, 124.85913], [8.38232, 124.85864],
    [8.38105, 124.85776], [8.37946, 124.85711], [8.37786, 124.85655],
    [8.37627, 124.85575], [8.37452, 124.85526], [8.37285, 124.85462],
    [8.37086, 124.85462], [8.36807, 124.85438], [8.36489, 124.85422],
    [8.36170, 124.85414], [8.35812, 124.85397], [8.35454, 124.85373],
    [8.35175, 124.85333], [8.34952, 124.85285],
    [8.35016, 124.84810], [8.35088, 124.84351],
    [8.35335, 124.84230], [8.35558, 124.84278], [8.35780, 124.84246],
    [8.35924, 124.84335], [8.36019, 124.84464], [8.36250, 124.84472],
    [8.36529, 124.84480], [8.36656, 124.84560], [8.36815, 124.84512],
    [8.36967, 124.84560], [8.37126, 124.84624], [8.37309, 124.84592],
    [8.37516, 124.84520], [8.37707, 124.84576], [8.37922, 124.84512],
    [8.38152, 124.84488], [8.38264, 124.84624], [8.38407, 124.84665],
    [8.38535, 124.84568], [8.38678, 124.84713], [8.38853, 124.84753],
    [8.39012, 124.84713], [8.39156, 124.84834], [8.39331, 124.84769],
    [8.39522, 124.84874]
  ];

  const DICLUM_MAX_BOUNDS = [
    [124.825, 8.330], // [minLng, minLat] (MapLibre format)
    [124.885, 8.415]  // [maxLng, maxLat]
  ];

  // MapLibre raster tile styles
  const MAPLIBRE_TILE_STYLES = {
    google_hybrid: {
      version: 8,
      sources: {
        'base-tiles': {
          type: 'raster',
          tiles: [
            'https://mt0.google.com/vt/lyrs=y&x={x}&y={y}&z={z}',
            'https://mt1.google.com/vt/lyrs=y&x={x}&y={y}&z={z}',
            'https://mt2.google.com/vt/lyrs=y&x={x}&y={y}&z={z}',
            'https://mt3.google.com/vt/lyrs=y&x={x}&y={y}&z={z}'
          ],
          tileSize: 256,
          maxzoom: 22
        }
      },
      layers: [
        {
          id: 'base-tiles-layer',
          type: 'raster',
          source: 'base-tiles',
          paint: {
            'raster-fade-duration': 120
          }
        }
      ]
    },
    hybrid: {
      version: 8,
      sources: {
        'base-tiles': {
          type: 'raster',
          tiles: [
            'https://mt0.google.com/vt/lyrs=y&x={x}&y={y}&z={z}',
            'https://mt1.google.com/vt/lyrs=y&x={x}&y={y}&z={z}',
            'https://mt2.google.com/vt/lyrs=y&x={x}&y={y}&z={z}',
            'https://mt3.google.com/vt/lyrs=y&x={x}&y={y}&z={z}'
          ],
          tileSize: 256,
          maxzoom: 22
        }
      },
      layers: [
        {
          id: 'base-tiles-layer',
          type: 'raster',
          source: 'base-tiles',
          paint: {
            'raster-fade-duration': 120
          }
        }
      ]
    },
    esri_satellite: {
      version: 8,
      sources: {
        'base-tiles': {
          type: 'raster',
          tiles: [
            'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'
          ],
          tileSize: 256,
          maxzoom: 20
        }
      },
      layers: [
        {
          id: 'base-tiles-layer',
          type: 'raster',
          source: 'base-tiles',
          paint: {
            'raster-fade-duration': 120
          }
        }
      ]
    },
    streets: {
      version: 8,
      sources: {
        'base-tiles': {
          type: 'raster',
          tiles: [
            'https://a.tile.openstreetmap.org/{z}/{x}/{y}.png',
            'https://b.tile.openstreetmap.org/{z}/{x}/{y}.png',
            'https://c.tile.openstreetmap.org/{z}/{x}/{y}.png'
          ],
          tileSize: 256,
          maxzoom: 19
        }
      },
      layers: [
        {
          id: 'base-tiles-layer',
          type: 'raster',
          source: 'base-tiles',
          paint: {
            'raster-fade-duration': 120
          }
        }
      ]
    }
  };

  const LAYER_PROVIDERS = {
    google_hybrid: { name: 'Google Satellite (4K Ultra-HD Hybrid)' },
    hybrid: { name: 'Google Satellite (4K Ultra-HD Hybrid)' },
    esri_satellite: { name: 'ESRI World Imagery (High Resolution)' },
    streets: { name: 'Standard Streets (OpenStreetMap)' }
  };

  class MapLibreFieldMapEngine {
    constructor(containerOrSelector, opts = {}) {
      let container;
      if (typeof containerOrSelector === 'string') {
        container = document.getElementById(containerOrSelector) || document.querySelector(containerOrSelector);
      } else {
        container = containerOrSelector;
      }

      if (!container) {
        console.error('[MapLibreEngine] Map container element not found.');
        return;
      }

      if (typeof maplibregl === 'undefined') {
        console.error('[MapLibreEngine] maplibregl library is not loaded.');
        return;
      }

      const centerLat = Number(opts.centerLat) || 8.3735;
      const centerLng = Number(opts.centerLng) || 124.8505;
      const zoom = Number(opts.zoom) || 15.0;

      this._container = container;
      this._currentLayerKey = opts.layer || 'google_hybrid';
      this._pins = [];
      this._pinMarkers = new Map();
      this._selectedPinKey = null;
      this._filterMode = 'all';
      this._zoneFilter = null;
      this._pinsHidden = false;
      this._isolatedPinId = null;
      this._mappingMode = 'view';
      this._userGps = null;
      this._userHeading = 0;
      this._lastGpsRenderPos = null;
      this._hasCompassHeading = false;
      this._bearing = 0;
      this._currentLat = centerLat;
      this._currentLng = centerLng;
      this._zoom = zoom;
      this._suppressMapClickUntil = 0;
      this.layerProviders = LAYER_PROVIDERS;

      this.selectPinCallback = null;
      this.dropPinCallback = null;

      // Select initial style
      const initialStyle = MAPLIBRE_TILE_STYLES[this._currentLayerKey] || MAPLIBRE_TILE_STYLES.google_hybrid;

      // Initialize WebGL GPU Canvas Map
      this._map = new maplibregl.Map({
        container: container,
        style: initialStyle,
        center: [centerLng, centerLat],
        zoom: zoom,
        minZoom: 13.0,
        maxZoom: 22.0,
        maxBounds: DICLUM_MAX_BOUNDS,
        bearing: 0,
        pitch: 0,
        dragRotate: true,
        touchZoomRotate: true,
        attributionControl: false,
        fadeDuration: 120
      });

      // Compatibility reference for Leaflet code that inspects _map
      this.isMapLibre = true;

      // Compatibility shim for Leaflet-style flyTo([lat, lng], zoom)
      const origFlyTo = this._map.flyTo.bind(this._map);
      this._map.flyTo = (target, zoom, opts) => {
        if (Array.isArray(target)) {
          let lng, lat;
          if (target[0] < 20 && target[1] > 100) {
            lat = target[0];
            lng = target[1];
          } else {
            lng = target[0];
            lat = target[1];
          }
          return origFlyTo({
            center: [lng, lat],
            zoom: zoom !== undefined ? zoom : this._map.getZoom(),
            duration: 600,
            ...(opts || {})
          });
        } else if (target && typeof target === 'object' && ('lat' in target || 'lng' in target)) {
          return origFlyTo({
            center: [target.lng, target.lat],
            zoom: zoom !== undefined ? zoom : this._map.getZoom(),
            duration: 600,
            ...(opts || {})
          });
        }
        return origFlyTo(target, zoom, opts);
      };

      this._map.on('load', () => {
        this._initVectorLayers();
        this._renderDicklumBoundary();
        this._renderAllPins();
      });

      this._map.on('style.load', () => {
        this._initVectorLayers();
        this._renderDicklumBoundary();
        if (this._activeRoutePts) this.setActiveRoute(this._activeRoutePts);
        if (this._savedRoutes) this.setSavedRoutes(this._savedRoutes);
      });

      this._map.on('click', (e) => {
        if (this._suppressMapClickUntil && Date.now() < this._suppressMapClickUntil) return;
        if (this._selectedPinKey) {
          this.clearSelectedPin();
        }
        if (this._mappingMode === 'mapping' && this.dropPinCallback) {
          this.dropPinCallback(e.lngLat.lat, e.lngLat.lng);
        }
      });

      this._map.on('move', () => {
        const c = this._map.getCenter();
        this._currentLat = c.lat;
        this._currentLng = c.lng;
      });

      this._map.on('zoom', () => {
        this._zoom = this._map.getZoom();
      });

      this._map.on('rotate', () => {
        this._bearing = this._map.getBearing();
        this._syncCompassUI();
      });

      // Resize observer
      if (typeof ResizeObserver !== 'undefined' && container) {
        this._resizeObserver = new ResizeObserver(() => {
          if (this._map) this._map.resize();
        });
        this._resizeObserver.observe(container);
      }

      [60, 200, 500, 1000].forEach(d => {
        setTimeout(() => {
          if (this._map) this._map.resize();
        }, d);
      });
    }

    _syncCompassUI() {
      const norm = ((this._bearing % 360) + 360) % 360;
      const isZero = norm < 0.2 || norm > 359.8;

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

    _initVectorLayers() {
      if (!this._map) return;

      // 1. Diclum Outer Mask Source & Fill Layer (dim exterior)
      if (!this._map.getSource('diclum-mask-src')) {
        this._map.addSource('diclum-mask-src', {
          type: 'geojson',
          data: { type: 'FeatureCollection', features: [] }
        });
        this._map.addLayer({
          id: 'diclum-mask-layer',
          type: 'fill',
          source: 'diclum-mask-src',
          paint: {
            'fill-color': '#0F172A',
            'fill-opacity': 0.22
          }
        });
      }

      // 2. Diclum Red Border Glow & Dash Line
      if (!this._map.getSource('diclum-border-src')) {
        this._map.addSource('diclum-border-src', {
          type: 'geojson',
          data: { type: 'FeatureCollection', features: [] }
        });

        this._map.addLayer({
          id: 'diclum-border-glow',
          type: 'line',
          source: 'diclum-border-src',
          paint: {
            'line-color': '#EA4335',
            'line-width': 6,
            'line-opacity': 0.32
          }
        });

        this._map.addLayer({
          id: 'diclum-border-line',
          type: 'line',
          source: 'diclum-border-src',
          paint: {
            'line-color': '#D93025',
            'line-width': 2.5,
            'line-dasharray': [3, 2],
            'line-opacity': 0.96
          }
        });
      }

      // 3. Routes: Active Route
      if (!this._map.getSource('active-route-src')) {
        this._map.addSource('active-route-src', {
          type: 'geojson',
          data: { type: 'FeatureCollection', features: [] }
        });
        this._map.addLayer({
          id: 'active-route-line',
          type: 'line',
          source: 'active-route-src',
          paint: {
            'line-color': '#9FC6D4',
            'line-width': 3.5,
            'line-opacity': 0.85,
            'line-dasharray': [3, 2]
          }
        });
      }

      // 4. Routes: Saved Routes
      if (!this._map.getSource('saved-routes-src')) {
        this._map.addSource('saved-routes-src', {
          type: 'geojson',
          data: { type: 'FeatureCollection', features: [] }
        });
        this._map.addLayer({
          id: 'saved-routes-line',
          type: 'line',
          source: 'saved-routes-src',
          paint: {
            'line-color': '#62949A',
            'line-width': 2.5,
            'line-opacity': 0.6
          }
        });
      }
    }

    setLayer(layerKey) {
      this._currentLayerKey = layerKey;
      const style = MAPLIBRE_TILE_STYLES[layerKey] || MAPLIBRE_TILE_STYLES.google_hybrid;
      if (this._map) {
        this._map.setStyle(style);
      }
    }

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

      if (this._userGps) {
        const gLat = Number(this._userGps.lat);
        const gLng = Number(this._userGps.lng);
        if (!isNaN(gLat) && !isNaN(gLng) && gLat > 8.28 && gLat < 8.45 && gLng > 124.78 && gLng < 124.92) {
          validPts.push([gLat, gLng]);
        }
      }

      if (validPts.length === 0) return poly;
      const bufferMargin = 0.00036;

      for (const pt of validPts) {
        const pLat = pt[0];
        const pLng = pt[1];
        const inside = this._isPointInPolygon(pLat, pLng, poly);

        let kNear = 0;
        let minDist = Infinity;
        for (let i = 0; i < poly.length; i++) {
          const d = Math.hypot(poly[i][0] - pLat, poly[i][1] - pLng);
          if (d < minDist) {
            minDist = d;
            kNear = i;
          }
        }

        if (inside && minDist >= bufferMargin * 0.95) continue;

        const nearVertex = poly[kNear];
        let uLat = pLat - nearVertex[0];
        let uLng = pLng - nearVertex[1];
        let uLen = Math.hypot(uLat, uLng);

        if (uLen < 1e-6 || inside) {
          const prevV = poly[(kNear - 1 + poly.length) % poly.length];
          const nextV = poly[(kNear + 1) % poly.length];
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

        const targetLat = pLat + uLat * bufferMargin;
        const targetLng = pLng + uLng * bufferMargin;
        const neededShift = (targetLat - nearVertex[0]) * uLat + (targetLng - nearVertex[1]) * uLng;
        if (neededShift <= 0) continue;

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

        const halfWindow = Math.max(0.0018, Math.min(0.0095, neededShift * 1.15 + 0.0012));

        for (let i = 0; i < n; i++) {
          const s = arcDist[i];
          if (s > halfWindow) continue;
          const t = s / halfWindow;
          const weight = t <= 0.35 ? 1.0 : 0.5 * (1 + Math.cos(Math.PI * (t - 0.35) / 0.65));
          const projNeeded = (targetLat - poly[i][0]) * uLat + (targetLng - poly[i][1]) * uLng;
          if (projNeeded > 0) {
            const moveDist = projNeeded * weight;
            poly[i] = [poly[i][0] + uLat * moveDist, poly[i][1] + uLng * moveDist];
          }
        }
        poly = this._subdividePolygon(poly, 0.00035);
      }
      return poly;
    }

    _renderDicklumBoundary() {
      if (!this._map) return;
      const activeBoundary = this._computeExpandedDicklumBoundary(this._pins);
      this._currentBoundaryCoords = activeBoundary;

      // MapLibre requires [lng, lat] coordinate pairs for GeoJSON
      const boundaryLngLat = activeBoundary.map(pt => [pt[1], pt[0]]);
      if (boundaryLngLat.length > 0) {
        // Close polygon loop
        const first = boundaryLngLat[0];
        const last = boundaryLngLat[boundaryLngLat.length - 1];
        if (first[0] !== last[0] || first[1] !== last[1]) {
          boundaryLngLat.push([first[0], first[1]]);
        }
      }

      // Update Red Boundary Line
      const borderSrc = this._map.getSource('diclum-border-src');
      if (borderSrc) {
        borderSrc.setData({
          type: 'Feature',
          geometry: {
            type: 'LineString',
            coordinates: boundaryLngLat
          }
        });
      }

      // Update Outer Dim Mask (World Box with Diclum as hole)
      const maskSrc = this._map.getSource('diclum-mask-src');
      if (maskSrc) {
        const worldRing = [
          [124.60, 8.10],
          [125.10, 8.10],
          [125.10, 8.65],
          [124.60, 8.65],
          [124.60, 8.10]
        ];

        maskSrc.setData({
          type: 'Feature',
          geometry: {
            type: 'Polygon',
            coordinates: [worldRing, boundaryLngLat]
          }
        });
      }
    }

    fitToDicklumBoundary(maxZoom = 15.2) {
      if (!this._map) return;
      const coords = (this._currentBoundaryCoords && this._currentBoundaryCoords.length > 0)
        ? this._currentBoundaryCoords
        : DICLUM_BOUNDARY_COORDS;

      let minLng = Infinity, maxLng = -Infinity, minLat = Infinity, maxLat = -Infinity;
      for (const pt of coords) {
        if (pt[1] < minLng) minLng = pt[1];
        if (pt[1] > maxLng) maxLng = pt[1];
        if (pt[0] < minLat) minLat = pt[0];
        if (pt[0] > maxLat) maxLat = pt[0];
      }

      this._map.fitBounds([[minLng, minLat], [maxLng, maxLat]], {
        padding: 30,
        maxZoom: maxZoom,
        duration: 700
      });
    }

    setPins(pins) {
      this._pins = pins || [];
      this._renderDicklumBoundary();
      this._renderAllPins();
    }

    setPinsHidden(hidden) {
      this._pinsHidden = Boolean(hidden);
      this._isolatedPinId = null;
      this._renderAllPins();
    }

    get isPinsHidden() {
      return this._pinsHidden;
    }

    isolateSinglePin(pinId, pinType) {
      this._isolatedPinId = `${pinId}_${pinType}`;
      this._renderAllPins();
    }

    clearPinIsolation() {
      this._isolatedPinId = null;
      this._renderAllPins();
    }

    setFilter(filterMode) {
      const map = { both: 'all', all: 'all', households: 'household', household: 'household', meters: 'meter', meter: 'meter', clusters: 'meter' };
      this._filterMode = map[filterMode] || 'all';
      this._renderAllPins();
    }

    setZoneFilter(zone) {
      this._zoneFilter = zone || null;
      this._renderAllPins();
    }

    getVisiblePins() {
      if (this._isolatedPinId) {
        return (this._pins || []).filter(pin => {
          const idKey = `${pin.id}_${pin.type}`;
          return idKey === this._isolatedPinId || pin.id === this._isolatedPinId;
        });
      }

      if (this._pinsHidden) return [];

      const fm = this._filterMode || 'all';
      const zf = this._zoneFilter || null;
      return (this._pins || []).filter(pin => {
        const type = pin.type;
        if (fm === 'household' && type !== 'household') return false;
        if (fm === 'meter' && type !== 'meter' && type !== 'cluster') return false;
        if (zf) {
          const z = (pin.data && pin.data.zone) || pin.zone || '';
          if (z !== zf) return false;
        }
        return true;
      });
    }

    fitToVisiblePins(maxZoom = 18) {
      if (!this._map) return false;
      const pts = this.getVisiblePins()
        .map(p => [Number(p.lng), Number(p.lat)])
        .filter(([lng, lat]) => !isNaN(lng) && !isNaN(lat));

      if (pts.length === 0) return false;
      if (pts.length === 1) {
        this._map.flyTo({ center: pts[0], zoom: Math.min(maxZoom, 18), duration: 600 });
      } else {
        let minLng = Infinity, maxLng = -Infinity, minLat = Infinity, maxLat = -Infinity;
        for (const pt of pts) {
          if (pt[0] < minLng) minLng = pt[0];
          if (pt[0] > maxLng) maxLng = pt[0];
          if (pt[1] < minLat) minLat = pt[1];
          if (pt[1] > maxLat) maxLat = pt[1];
        }
        this._map.fitBounds([[minLng, minLat], [maxLng, maxLat]], {
          padding: 60,
          maxZoom: maxZoom,
          duration: 600
        });
      }
      return true;
    }

    _renderAllPins() {
      if (!this._map) return;

      // Clear existing MapLibre Markers
      for (const m of this._pinMarkers.values()) {
        m.remove();
      }
      this._pinMarkers.clear();

      const visible = this.getVisiblePins();
      const houseSpots = new Set(
        visible.filter(p => p.type === 'household')
          .map(p => `${Number(p.lat).toFixed(6)},${Number(p.lng).toFixed(6)}`)
      );

      for (const pin of visible) {
        const type = pin.type;
        const lat = Number(pin.lat ?? pin.householdLat ?? pin.meterLat);
        const lng = Number(pin.lng ?? pin.householdLng ?? pin.meterLng);
        if (isNaN(lat) || isNaN(lng)) continue;

        const html = this._createPinHTML(pin);
        const overlapsHouse = type !== 'household' &&
          houseSpots.has(`${lat.toFixed(6)},${lng.toFixed(6)}`);

        const wrapper = document.createElement('div');
        wrapper.className = 'custom-map-pin-wrap';
        wrapper.style.cursor = 'pointer';
        wrapper.innerHTML = html;

        if (overlapsHouse) {
          wrapper.style.transform = 'translateY(-34px)';
        }

        wrapper.addEventListener('click', (e) => {
          e.stopPropagation();
          this.selectPinById(pin.id, pin.type);
        });

        const marker = new maplibregl.Marker({
          element: wrapper,
          anchor: 'bottom'
        })
        .setLngLat([lng, lat])
        .addTo(this._map);

        const key = `${pin.id || pin.accountNo || Math.random()}_${type}`;
        this._pinMarkers.set(key, marker);
      }

      if (this._selectedPinKey) {
        const [selId, selType] = this._selectedPinKey.split('_');
        this._applyPinSelectionDOM(selId, selType, false);
      }
    }

    _createPinHTML(pin) {
      const type = pin.type;
      const d = pin.data || {};
      const colors = {
        household: '#0D9488',
        meter:     '#0284C7',
        cluster:   '#6D28D9'
      };
      const accent = colors[type] || colors.household;

      let svgIcon = '';
      if (type === 'household') {
        svgIcon = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#FFFFFF" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
          <path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>
        </svg>`;
      } else if (type === 'meter') {
        svgIcon = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#FFFFFF" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M12 2.7c3.6 4.2 6 7.5 6 10.8a6 6 0 0 1-12 0c0-3.3 2.4-6.6 6-10.8z"/>
        </svg>`;
      } else {
        svgIcon = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#FFFFFF" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="12" r="8"/><polyline points="12 8 12 12 15 14"/><path d="M9 2h6"/>
        </svg>`;
      }

      let label = '';
      if (type === 'household') {
        label = d.name || pin.title || '';
      } else if (type === 'meter') {
        const ownerName = (d.name && d.name !== 'Unassigned') ? d.name : (d.ownerName || '');
        label = ownerName || d.meterNo || pin.title || '';
      } else {
        label = d.ownerSummary || d.name || pin.title || 'Clustered Meters';
      }
      label = String(label).replace(/^Meter\s+/i, '').replace(/\s*\|\s*WM$/i, '').trim();
      const maxLen = type === 'meter' ? 20 : (type === 'cluster' ? 20 : 22);
      const shortLabel = label.length > maxLen ? label.slice(0, maxLen - 1) + '…' : label;
      const safeLabel = shortLabel.replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));

      const mCount = Number(d.meterCount || (d.meters && d.meters.length) || 0);
      const isCutOff = Boolean(d.isCutOff || d.status === 'Disconnected' || d.status === 'Cut-Off');
      const cutOffBadge = isCutOff ? `<span class="pin-cutoff-badge">CUT-OFF</span>` : '';
      const cutOffClass = isCutOff ? ' pin-cutoff' : '';
      const effectiveAccent = isCutOff ? '#DC2626' : accent;

      const wmSuffix = type === 'meter'
        ? `<span class="pin-wm-tag">WM</span>`
        : (type === 'cluster'
            ? `<span class="pin-cluster-count-tag">${mCount > 0 ? mCount : ''} WM</span>`
            : '');

      const clusterDotBadge = (type === 'cluster' && mCount > 0)
        ? `<span class="pin-cluster-dot-count">${mCount}</span>`
        : '';

      const iconClass = type === 'cluster' ? 'pin-icon pin-icon-cluster' : 'pin-icon';

      return `
        <div class="map-pin map-pin-${type}${cutOffClass}" data-pin-id="${pin.id || ''}" data-pin-type="${type}">
          <div class="pin-popup-label">
            <span class="pin-label">${safeLabel || 'Pin'}</span>
            ${wmSuffix}
            ${cutOffBadge}
          </div>
          <div class="pin-body" style="background:${effectiveAccent};">
            <span class="${iconClass}">${svgIcon}</span>
            ${clusterDotBadge}
          </div>
          <div class="pin-tail" style="border-top-color:${effectiveAccent};"></div>
        </div>
      `;
    }

    _applyPinSelectionDOM(id, type, isSearchHighlight = false) {
      document.querySelectorAll('.map-pin').forEach(el => {
        const match = el.dataset.pinId === String(id) && (!type || el.dataset.pinType === type);
        el.classList.toggle('selected', match);
        el.classList.toggle('search-hovered', Boolean(match && isSearchHighlight));
        const wrapper = el.closest('.maplibregl-marker') || el.closest('.custom-map-pin-wrap');
        if (wrapper) {
          wrapper.style.zIndex = match ? '9500' : '';
        }
      });
    }

    clearSelectedPin() {
      this._selectedPinKey = null;
      document.querySelectorAll('.map-pin.selected, .map-pin.search-hovered').forEach(el => {
        el.classList.remove('selected', 'search-hovered');
        const wrapper = el.closest('.maplibregl-marker') || el.closest('.custom-map-pin-wrap');
        if (wrapper) wrapper.style.zIndex = '';
      });
    }

    selectPinById(id, type, isSearchHighlight = true) {
      const pin = this._pins.find(p => String(p.id) === String(id) && (!type || p.type === type));
      this._selectedPinKey = `${id}_${type || (pin ? pin.type : '')}`;
      this._applyPinSelectionDOM(id, type || (pin ? pin.type : ''), isSearchHighlight);

      if (pin && this.selectPinCallback) {
        this.selectPinCallback(pin);
      }
    }

    _calculateDistanceMeters(lat1, lon1, lat2, lon2) {
      const R = 6371e3;
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

        if (movedDist >= 0.8 && (heading == null || isNaN(heading)) && !this._hasCompassHeading) {
          const dLon = (lng - this._lastGpsRenderPos.lng) * Math.PI / 180;
          const lat1 = this._lastGpsRenderPos.lat * Math.PI / 180;
          const lat2 = lat * Math.PI / 180;
          const y = Math.sin(dLon) * Math.cos(lat2);
          const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
          const moveBrng = ((Math.atan2(y, x) * 180 / Math.PI) + 360) % 360;
          this.setUserHeading(moveBrng, false);
        }

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

      if (posChanged) {
        this._renderDicklumBoundary();
      }

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

        const el = document.createElement('div');
        el.className = 'custom-gps-icon-wrap';
        el.innerHTML = gpsHtml;

        this._gpsMarker = new maplibregl.Marker({
          element: el,
          anchor: 'center'
        })
        .setLngLat([lng, lat])
        .addTo(this._map);
      } else {
        this._gpsMarker.setLngLat([lng, lat]);
        const cone = document.getElementById('gps-marker-cone');
        if (cone) cone.style.transform = `rotate(${deg}deg)`;
      }
    }

    clearUserGps() {
      this._userGps = null;
      this._lastGpsRenderPos = null;
      if (this._gpsMarker) {
        this._gpsMarker.remove();
        this._gpsMarker = null;
      }
      this._renderDicklumBoundary();
    }

    panTo(lat, lng, zoom) {
      if (!this._map) return;
      if (zoom != null) {
        this._map.flyTo({ center: [lng, lat], zoom: zoom, duration: 800 });
      } else {
        this._map.panTo([lng, lat], { duration: 500 });
      }
    }

    resize() {
      if (this._map) this._map.resize();
    }

    requestRender() {
      if (this._map) this._map.triggerRepaint();
    }

    setMappingMode(mode) {
      this._mappingMode = mode;
    }

    get bearing() {
      return this._map ? this._map.getBearing() : this._bearing;
    }

    setBearing(angleDeg, opts = {}) {
      if (!this._map) return;
      const deg = Number(angleDeg) || 0;
      if (opts.immediate) {
        this._map.setBearing(deg);
      } else {
        this._map.easeTo({ bearing: deg, duration: 400 });
      }
    }

    resetNorth() {
      if (this._map) {
        this._map.resetNorth({ duration: 500 });
      }
    }

    setActiveRoute(points) {
      this._activeRoutePts = points;
      if (!this._map) return;
      const src = this._map.getSource('active-route-src');
      if (!src) return;

      if (points && points.length >= 2) {
        const coords = points.map(p => [Number(p.lng), Number(p.lat)]);
        src.setData({
          type: 'Feature',
          geometry: {
            type: 'LineString',
            coordinates: coords
          }
        });
      } else {
        src.setData({ type: 'FeatureCollection', features: [] });
      }
    }

    setSavedRoutes(routes) {
      this._savedRoutes = routes || [];
      if (!this._map) return;
      const src = this._map.getSource('saved-routes-src');
      if (!src) return;

      const features = [];
      for (const r of this._savedRoutes) {
        if (r.points && r.points.length >= 2) {
          features.push({
            type: 'Feature',
            geometry: {
              type: 'LineString',
              coordinates: r.points.map(p => [Number(p.lng), Number(p.lat)])
            }
          });
        }
      }

      src.setData({
        type: 'FeatureCollection',
        features: features
      });
    }

    get userGps() { return this._userGps; }
    get currentLat() { return this._currentLat; }
    get currentLng() { return this._currentLng; }
    get zoom() { return this._map ? this._map.getZoom() : this._zoom; }
    set zoom(v) {
      this._zoom = v;
      if (this._map) this._map.setZoom(v);
    }
  }

  // Export to window
  if (typeof window !== 'undefined') {
    window.MapLibreFieldMapEngine = MapLibreFieldMapEngine;
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { MapLibreFieldMapEngine };
  }
})(typeof window !== 'undefined' ? window : this);
