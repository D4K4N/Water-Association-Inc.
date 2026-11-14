/**
 * Dicklum Water Association, Inc. - Offline-First Service Worker + Background GitHub Auto-Updater
 * - Instant 0ms offline boot after phone restart (Cache-First + Stale-While-Revalidate)
 * - Full pre-caching of HTML, CSS, JS, MapLibre GL WebGL, Leaflet, html2pdf, and Icons
 * - Multi-tier offline satellite & street tile resolution (CacheStorage -> IndexedDB -> Bundled Diclum Tiles)
 * - Automatic background silent updates when internet is available (zero data loss; IndexedDB is never touched)
 */

const CACHE_VERSION = '25';
const CACHE_NAME = `dicklum-water-v${CACHE_VERSION}`;
const TILE_CACHE_NAME = 'dicklum-tiles-cache-v2';

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

  // 1. Google Satellite / Hybrid: https://mt0.google.com/vt/lyrs=y&x=13873&y=7808&z=14
  if (host.includes('google.com') && path.includes('/vt')) {
    const x = urlObj.searchParams.get('x');
    const y = urlObj.searchParams.get('y');
    const z = urlObj.searchParams.get('z');
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

  // 3. ESRI World Imagery: https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}
  if (host.includes('arcgisonline.com')) {
    const m = path.match(/\/tile\/(\d+)\/(\d+)\/(\d+)$/i);
    if (m) {
      const [, z, y, x] = m;
      return {
        layer: 'esri_satellite',
        z: Number(z),
        x: Number(x),
        y: Number(y),
        ext: 'jpg',
        canonicalUrl: `https://tile-cache.dicklum.local/esri_satellite/${z}/${x}/${y}.jpg`,
        idbKey: `esri_satellite_${z}_${x}_${y}`
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
    try {
      const req = indexedDB.open('dicklum_offline_maps', 1);
      req.onsuccess = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains('tiles')) {
          db.close();
          return resolve(null);
        }
        try {
          const tx = db.transaction('tiles', 'readonly');
          const store = tx.objectStore('tiles');
          const getReq = store.get(idbKey);
          getReq.onsuccess = () => {
            const rec = getReq.result;
            db.close();
            resolve(rec && rec.blob ? rec.blob : null);
          };
          getReq.onerror = () => {
            db.close();
            resolve(null);
          };
        } catch (_) {
          db.close();
          resolve(null);
        }
      };
      req.onerror = () => resolve(null);
    } catch (_) {
      resolve(null);
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
          .filter((key) => key !== CACHE_NAME && key !== TILE_CACHE_NAME && key !== 'dicklum-tiles-cache-v1')
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
          if (canonicalMatch) return canonicalMatch;
        }

        // 1B. Check exact request URL in tile cache
        const directMatch = await tileCache.match(e.request, { ignoreSearch: isBundledTilePath });
        if (directMatch) return directMatch;

        // 1C. Check legacy v1 tile cache if present
        const legacyCache = await caches.open('dicklum-tiles-cache-v1');
        const legacyMatch = await legacyCache.match(e.request);
        if (legacyMatch) return legacyMatch;

        // 1D. Check IndexedDB (`dicklum_offline_maps`) for user-downloaded offline map packs
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

        // 1E. Try live network fetch if online
        try {
          const networkResponse = await fetch(e.request);
          if (networkResponse && (networkResponse.ok || networkResponse.type === 'opaque')) {
            if (tileDesc && networkResponse.ok) {
              tileCache.put(tileDesc.canonicalUrl, networkResponse.clone());
            }
            tileCache.put(e.request, networkResponse.clone());
            return networkResponse;
          }
        } catch (_) {
          // Network offline or unreachable — proceed to bundled Diclum tile fallback
        }

        // 1F. Bundled Barangay Diclum tile fallback (zoom 14–17 for google_hybrid, 14–16 for streets)
        if (tileDesc && (tileDesc.layer === 'google_hybrid' || tileDesc.layer === 'streets')) {
          const bundledRelUrl = `./assets/dicklum-tiles/${tileDesc.layer}/${tileDesc.z}/${tileDesc.x}/${tileDesc.y}.${tileDesc.ext}`;
          const cachedBundled = await caches.match(bundledRelUrl, { ignoreSearch: true }) ||
                                await tileCache.match(bundledRelUrl, { ignoreSearch: true });
          if (cachedBundled) return cachedBundled;

          try {
            const bundledResp = await fetch(bundledRelUrl);
            if (bundledResp && bundledResp.ok) {
              tileCache.put(tileDesc.canonicalUrl, bundledResp.clone());
              return bundledResp;
            }
          } catch (_) {}
        }

        return new Response('', { status: 408, statusText: 'Offline Tile Unavailable' });
      })()
    );
    return;
  }

  // 2. Same-Origin App Shell Assets (HTML, CSS, JS, Vendor Libraries, Icons, Manifest)
  // Strategy: CACHE-FIRST + BACKGROUND REVALIDATE (Stale-While-Revalidate)
  // Guarantees 0ms instant boot when phone restarts 100% offline, while still updating from GitHub in the background!
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

    e.respondWith(
      (async () => {
        const cache = await caches.open(CACHE_NAME);

        // Look up in current cache (ignoring ?v=20 query strings so cached files always hit)
        let cachedResponse = await cache.match(e.request, { ignoreSearch: true });
        if (!cachedResponse && isNavigation) {
          cachedResponse = await cache.match('./index.html', { ignoreSearch: true }) ||
                           await cache.match('./', { ignoreSearch: true }) ||
                           await caches.match('./index.html', { ignoreSearch: true });
        }
        if (!cachedResponse) {
          cachedResponse = await caches.match(e.request, { ignoreSearch: true });
        }

        // Background network update (non-blocking when cachedResponse exists)
        const networkUpdatePromise = fetch(e.request, { cache: 'no-cache' })
          .then((networkResp) => {
            if (networkResp && networkResp.status === 200) {
              cache.put(e.request, networkResp.clone());
              if (isNavigation) {
                cache.put('./index.html', networkResp.clone());
              }
            }
            return networkResp;
          })
          .catch(() => null);

        // Return cached response immediately (0ms offline boot!)
        if (cachedResponse) {
          e.waitUntil(networkUpdatePromise);
          return cachedResponse;
        }

        // If not in cache yet (very first visit ever), await network
        const netResp = await networkUpdatePromise;
        if (netResp) return netResp;

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
