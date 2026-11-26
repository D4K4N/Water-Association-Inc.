/**
 * Dicklum Water Association, Inc. - Offline-First Service Worker + Background GitHub Auto-Updater
 * - Instant 0ms offline boot after phone restart (Cache-First + Stale-While-Revalidate)
 * - Full pre-caching of HTML, CSS, JS, MapLibre GL WebGL, Leaflet, html2pdf, and Icons
 * - Multi-tier offline satellite & street tile resolution (CacheStorage -> IndexedDB -> Bundled Diclum Tiles)
 * - Automatic background silent updates when internet is available (zero data loss; IndexedDB is never touched)
 */

const CACHE_VERSION = '35';
const CACHE_NAME = `dicklum-water-v${CACHE_VERSION}`;
const OTA_OVERRIDE_CACHE = 'dicklum-ota-override-v1';
const TILE_CACHE_NAME = 'dicklum-tiles-cache-v3';

const ASSETS_TO_CACHE = [
  './',
  './index.html',
  './manifest.webmanifest',
  './version.json',
  './css/styles.css',
  './css/print-thermal.css',
  './css/print-a4.css',
  './vendor/leaflet/leaflet.css',
  './vendor/leaflet/leaflet.js',
  './vendor/maplibre/maplibre-gl.css',
  './vendor/maplibre/maplibre-gl.js',
  './vendor/html2pdf/html2pdf.bundle.min.js',
  './js/icons.js',
  './js/db.js',
  './js/sampleData.js',
  './js/billing.js',
  './js/reading.js',
  './js/thermalPrinter.js',
  './js/a4Statement.js',
  './js/reports.js',
  './js/backup.js',
  './js/offlineTileEngine.js',
  './js/mapEngine.js',
  './js/maplibreEngine.js',
  './js/otaUpdater.js',
  './js/app.js',
  './assets/logo.png',
  './assets/logo.svg',
  './assets/dicklum-tiles/manifest.json'
];

/**
 * Normalize map tile URLs across subdomains (mt0..mt3, a..c) and query params (lyrs=y vs lyrs=s,h)
 * so any cached tile is matched 100% reliably by MapLibre and Leaflet when offline.
 */
function parseMapTileDescriptor(urlObj) {
  const host = urlObj.hostname.toLowerCase();
  const path = urlObj.pathname;

  // 1. Google Satellite / Hybrid: supports both /vt?lyrs=y&x=... and /vt/lyrs=y&x=...
  if (host.includes('google.com') && path.includes('/vt')) {
    let x = urlObj.searchParams.get('x');
    let y = urlObj.searchParams.get('y');
    let z = urlObj.searchParams.get('z');
    if (x === null || y === null || z === null) {
      const mx = path.match(/[&/]x=(\d+)/);
      const my = path.match(/[&/]y=(\d+)/);
      const mz = path.match(/[&/]z=(\d+)/);
      if (mx && my && mz) { x = mx[1]; y = my[1]; z = mz[1]; }
    }
    if (x !== null && y !== null && z !== null) {
      return {
        layer: 'google_hybrid',
        z: Number(z),
        x: Number(x),
        y: Number(y),
        ext: 'jpg',
        canonicalUrl: `https://tile-cache.dicklum.local/google_hybrid/${z}/${x}/${y}.jpg`,
        idbKey: `google_hybrid_${z}_${x}_${y}`
      };
    }
  }

  // 2. OpenStreetMap Standard Streets: https://a.tile.openstreetmap.org/{z}/{x}/{y}.png
  if (host.includes('openstreetmap.org')) {
    const m = path.match(/\/(\d+)\/(\d+)\/(\d+)\.png$/i);
    if (m) {
      const [, z, x, y] = m;
      return {
        layer: 'streets',
        z: Number(z),
        x: Number(x),
        y: Number(y),
        ext: 'png',
        canonicalUrl: `https://tile-cache.dicklum.local/streets/${z}/${x}/${y}.png`,
        idbKey: `streets_${z}_${x}_${y}`
      };
    }
  }

  // 3. ESRI World Imagery + Reference Hybrid Overlays
  if (host.includes('arcgisonline.com')) {
    const m = path.match(/\/tile\/(\d+)\/(\d+)\/(\d+)$/i);
    if (m) {
      const [, z, y, x] = m;
      const isLabels = path.includes('World_Boundaries_and_Places');
      const isRoads = path.includes('World_Transportation');
      const layer = isLabels ? 'esri_labels' : (isRoads ? 'esri_roads' : 'esri_satellite');
      const ext = (isLabels || isRoads) ? 'png' : 'jpg';
      return {
        layer,
        z: Number(z),
        x: Number(x),
        y: Number(y),
        ext,
        canonicalUrl: `https://tile-cache.dicklum.local/${layer}/${z}/${x}/${y}.${ext}`,
        idbKey: `${layer}_${z}_${x}_${y}`
      };
    }
  }

  return null;
}

/**
 * Reads a tile blob from the `dicklum_offline_maps` IndexedDB store if the user downloaded the Offline Map Pack
 */
function getTileBlobFromIndexedDB(idbKey) {
  if (!idbKey || typeof indexedDB === 'undefined') return Promise.resolve(null);
  return new Promise((resolve) => {
    let settled = false;
    const finish = (val) => {
      if (settled) return;
      settled = true;
      resolve(val);
    };
    const timer = setTimeout(() => finish(null), 250);
    try {
      const req = indexedDB.open('dicklum_offline_maps', 1);
      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains('tiles')) {
          db.createObjectStore('tiles', { keyPath: 'key' });
        }
      };
      req.onsuccess = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains('tiles')) {
          db.close();
          clearTimeout(timer);
          return finish(null);
        }
        try {
          const tx = db.transaction('tiles', 'readonly');
          const store = tx.objectStore('tiles');
          const getReq = store.get(idbKey);
          getReq.onsuccess = () => {
            const rec = getReq.result;
            db.close();
            clearTimeout(timer);
            finish(rec && rec.blob ? rec.blob : null);
          };
          getReq.onerror = () => {
            db.close();
            clearTimeout(timer);
            finish(null);
          };
        } catch (_) {
          db.close();
          clearTimeout(timer);
          finish(null);
        }
      };
      req.onerror = () => {
        clearTimeout(timer);
        finish(null);
      };
      req.onblocked = () => {
        clearTimeout(timer);
        finish(null);
      };
    } catch (_) {
      clearTimeout(timer);
      finish(null);
    }
  });
}

/**
 * Pre-cache all app shell assets resiliently
 */
async function cacheAppShell() {
  const cache = await caches.open(CACHE_NAME);
  await Promise.all(
    ASSETS_TO_CACHE.map(async (assetUrl) => {
      try {
        const req = new Request(assetUrl, { cache: 'reload' });
        const resp = await fetch(req);
        if (resp && resp.ok) {
          await cache.put(assetUrl, resp);
        }
      } catch (err) {
        // Fallback to standard cache.add if reload fails
        try {
          await cache.add(assetUrl);
        } catch (_) {}
      }
    })
  );
}

self.addEventListener('install', (e) => {
  e.waitUntil(
    cacheAppShell().then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME && key !== OTA_OVERRIDE_CACHE && key !== TILE_CACHE_NAME)
          .map((key) => caches.delete(key))
      );
    }).then(() => self.clients.claim())
  );
});

// Listen for OTA / Manual Update messages from the client app
self.addEventListener('message', (e) => {
  if (!e.data) return;
  if (e.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  } else if (e.data.type === 'FORCE_UPDATE_CACHE') {
    e.waitUntil(
      cacheAppShell().then(async () => {
        const clients = await self.clients.matchAll({ type: 'window' });
        for (const client of clients) {
          client.postMessage({ type: 'CACHE_UPDATED', version: CACHE_VERSION });
        }
      })
    );
  }
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;

  let url;
  try {
    url = new URL(e.request.url);
  } catch (_) {
    return;
  }

  // Never intercept local Office PC /api/ sync endpoints
  if (url.pathname.includes('/api/')) return;

  // 1. Intercept and cache Map Tiles (Google Satellite, OpenStreetMap, ESRI, and bundled Diclum tiles)
  const tileDesc = parseMapTileDescriptor(url);
  const isBundledTilePath = url.pathname.includes('/dicklum-tiles/');

  if (tileDesc || isBundledTilePath) {
    e.respondWith(
      (async () => {
        const tileCache = await caches.open(TILE_CACHE_NAME);

        // 1A. Check canonical tile cache key first (normalizes mt0..mt3 and lyrs=y vs lyrs=s,h)
        if (tileDesc) {
          const canonicalMatch = await tileCache.match(tileDesc.canonicalUrl);
          if (canonicalMatch && (e.request.mode !== 'cors' || canonicalMatch.type !== 'opaque')) {
            return canonicalMatch;
          }
        }

        // 1B. Check exact request URL in tile cache
        const directMatch = await tileCache.match(e.request, { ignoreSearch: isBundledTilePath });
        if (directMatch && (e.request.mode !== 'cors' || directMatch.type !== 'opaque')) {
          return directMatch;
        }

        // 1C. Check IndexedDB (`dicklum_offline_maps`) for user-downloaded offline map packs
        if (tileDesc) {
          const idbBlob = await getTileBlobFromIndexedDB(tileDesc.idbKey);
          if (idbBlob) {
            const contentType = tileDesc.ext === 'png' ? 'image/png' : 'image/jpeg';
            const resp = new Response(idbBlob, {
              status: 200,
              headers: { 'Content-Type': contentType, 'X-Offline-Source': 'indexeddb' }
            });
            try {
              tileCache.put(tileDesc.canonicalUrl, resp.clone());
            } catch (_) {}
            return resp;
          }
        }

        // 1D. Try live network fetch if online (with fast 5s timeout so weak mobile data falls back to offline tiles instead of hanging)
        try {
          const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
          const timer = controller ? setTimeout(() => controller.abort(), 5000) : null;
          const networkResponse = await fetch(e.request, {
            signal: controller ? controller.signal : undefined
          });
          if (timer) clearTimeout(timer);
          if (networkResponse && (networkResponse.ok || networkResponse.type === 'opaque')) {
            if (tileDesc && networkResponse.ok) {
              tileCache.put(tileDesc.canonicalUrl, networkResponse.clone());
            }
            tileCache.put(e.request, networkResponse.clone());
            return networkResponse;
          }
        } catch (_) {
          // Network offline, slow mobile data, or unreachable — proceed to bundled Diclum tile fallback
        }

        // 1E. Bundled Barangay Diclum tile fallback (checks requested layer first, then cross-falls back to bundled Diclum streets Z14-Z16)
        if (tileDesc) {
          const candidates = [];
          if (tileDesc.layer === 'google_hybrid' || tileDesc.layer === 'esri_satellite') {
            candidates.push(`./assets/dicklum-tiles/google_hybrid/${tileDesc.z}/${tileDesc.x}/${tileDesc.y}.jpg`);
          }
          // Always include the 90 bundled Barangay Diclum street tiles (Z14-Z16) as a guaranteed offline fallback
          if (tileDesc.z >= 14 && tileDesc.z <= 16) {
            candidates.push(`./assets/dicklum-tiles/streets/${tileDesc.z}/${tileDesc.x}/${tileDesc.y}.png`);
          }

          for (const bundledRelUrl of candidates) {
            const cachedBundled = await caches.match(bundledRelUrl, { ignoreSearch: true }) ||
                                  await tileCache.match(bundledRelUrl, { ignoreSearch: true });
            if (cachedBundled) return cachedBundled;

            try {
              const bundledResp = await fetch(bundledRelUrl);
              if (bundledResp && bundledResp.ok) {
                return bundledResp;
              }
            } catch (_) {}
          }
        }

        return new Response('', { status: 408, statusText: 'Offline Tile Unavailable' });
      })()
    );
    return;
  }

  // 2. Same-Origin App Shell Assets (HTML, CSS, JS, Vendor Libraries, Icons, Manifest)
  // Strategy: OTA_OVERRIDE_CACHE -> NETWORK-FIRST (1.8s timeout) for code assets -> CACHE-FIRST fallback
  if (url.origin === self.location.origin) {
    // Always fetch version.json fresh when checking for updates (fallback to cache offline)
    if (url.pathname.endsWith('/version.json')) {
      e.respondWith(
        fetch(e.request, { cache: 'no-store' })
          .then((resp) => {
            if (resp && resp.ok) {
              const copy = resp.clone();
              caches.open(CACHE_NAME).then((c) => c.put('./version.json', copy));
            }
            return resp;
          })
          .catch(() => caches.match('./version.json', { ignoreSearch: true }))
      );
      return;
    }

    const isNavigation = e.request.mode === 'navigate' ||
                         e.request.destination === 'document' ||
                         url.pathname.endsWith('/') ||
                         url.pathname.endsWith('/index.html');

    const isCodeAsset = isNavigation ||
                        url.pathname.endsWith('.js') ||
                        url.pathname.endsWith('.css') ||
                        url.pathname.endsWith('.html');

    e.respondWith(
      (async () => {
        const cache = await caches.open(CACHE_NAME);
        const otaCache = await caches.open(OTA_OVERRIDE_CACHE);

        // 2A. Check if OTA updater stored a newer file from GitHub in OTA_OVERRIDE_CACHE
        let otaMatch = await otaCache.match(e.request, { ignoreSearch: true });
        if (!otaMatch && isNavigation) {
          otaMatch = await otaCache.match('./index.html', { ignoreSearch: true }) ||
                     await otaCache.match('./', { ignoreSearch: true });
        }

        // 2B. Look up in current app shell cache
        let cachedResponse = otaMatch || await cache.match(e.request, { ignoreSearch: true });
        if (!cachedResponse && isNavigation) {
          cachedResponse = await cache.match('./index.html', { ignoreSearch: true }) ||
                           await cache.match('./', { ignoreSearch: true }) ||
                           await caches.match('./index.html', { ignoreSearch: true });
        }
        if (!cachedResponse) {
          cachedResponse = await caches.match(e.request, { ignoreSearch: true });
        }

        // 2C. If OTA override exists (used by Capacitor APK), serve it immediately
        if (otaMatch) {
          return otaMatch;
        }

        // 2D. For HTML/JS/CSS on GitHub Pages PWA, try Network-First with 1.8s fast timeout
        if (isCodeAsset) {
          try {
            const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
            const timeoutId = controller ? setTimeout(() => controller.abort(), 1800) : null;
            const networkResp = await fetch(e.request, {
              cache: 'no-cache',
              signal: controller ? controller.signal : undefined
            });
            if (timeoutId) clearTimeout(timeoutId);
            if (networkResp && networkResp.status === 200) {
              cache.put(e.request, networkResp.clone());
              if (isNavigation) {
                cache.put('./index.html', networkResp.clone());
              }
              return networkResp;
            }
          } catch (_) {
            // Network timeout or offline — fall through to instant cachedResponse
          }
        } else {
          // Non-code static assets (icons, vendor libs): background revalidate
          const networkUpdatePromise = fetch(e.request, { cache: 'no-cache' })
            .then((networkResp) => {
              if (networkResp && networkResp.status === 200) {
                cache.put(e.request, networkResp.clone());
              }
              return networkResp;
            })
            .catch(() => null);

          if (cachedResponse) {
            e.waitUntil(networkUpdatePromise);
            return cachedResponse;
          }
        }

        if (cachedResponse) {
          return cachedResponse;
        }

        // Ultimate offline fallback for document navigation
        if (isNavigation) {
          const fallbackDoc = await caches.match('./index.html', { ignoreSearch: true });
          if (fallbackDoc) return fallbackDoc;
        }

        return new Response('Offline — asset not cached yet.', {
          status: 503,
          headers: { 'Content-Type': 'text/plain; charset=utf-8' }
        });
      })()
    );
  }
});
