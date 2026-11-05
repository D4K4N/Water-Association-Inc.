const CACHE_NAME = 'dicklum-water-v9';
const TILE_CACHE_NAME = 'dicklum-tiles-cache-v1';

const ASSETS_TO_CACHE = [
  './',
  './index.html',
  './css/styles.css',
  './css/print-thermal.css',
  './css/print-a4.css',
  './vendor/leaflet/leaflet.css',
  './vendor/leaflet/leaflet.js',
  './vendor/html2pdf/html2pdf.bundle.min.js',
  './js/offlineTileEngine.js',
  './js/app.js',
  './js/db.js',
  './js/sampleData.js',
  './js/mapEngine.js',
  './js/reading.js',
  './js/billing.js',
  './js/thermalPrinter.js',
  './js/a4Statement.js',
  './js/reports.js',
  './js/icons.js',
  './js/backup.js',
  './assets/logo.png',
  './assets/logo.svg',
  './assets/dicklum-tiles/manifest.json',
  './manifest.webmanifest'
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS_TO_CACHE);
    }).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.filter((key) => key !== CACHE_NAME && key !== TILE_CACHE_NAME).map((key) => caches.delete(key))
      );
    }).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;

  let url;
  try {
    url = new URL(e.request.url);
  } catch (err) {
    return;
  }

  // Never intercept /api/ sync endpoints
  if (url.pathname.startsWith('/api/')) return;

  // 1. Intercept and cache Map Tiles (Google Satellite, OpenStreetMap, and bundled tiles)
  const isMapTile = url.hostname.includes('google.com') ||
                    url.hostname.includes('openstreetmap.org') ||
                    url.pathname.includes('/dicklum-tiles/');

  if (isMapTile) {
    e.respondWith(
      caches.open(TILE_CACHE_NAME).then(async (tileCache) => {
        // Cache-first for map tiles: Instant 0ms return if already cached
        const cached = await tileCache.match(e.request);
        if (cached) {
          return cached;
        }

        // If not in cache, fetch from network and store in tileCache for 100% offline use
        try {
          const networkResponse = await fetch(e.request);
          if (networkResponse) {
            tileCache.put(e.request, networkResponse.clone());
          }
          return networkResponse;
        } catch (fetchErr) {
          // If offline and not in cache, return 408 status so Leaflet can handle fallback
          return cached || new Response('', { status: 408, statusText: 'Offline Tile Unavailable' });
        }
      })
    );
    return;
  }

  // 2. Local app assets (HTML, CSS, JS, Vendor files)
  if (url.origin === self.location.origin) {
    e.respondWith(
      fetch(e.request)
        .then((response) => {
          if (response && response.status === 200) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(e.request, copy));
          }
          return response;
        })
        .catch(() => {
          return caches.match(e.request, { ignoreSearch: true }).then((cached) => {
            if (cached) return cached;
            if (e.request.destination === 'document') {
              return caches.match('./index.html', { ignoreSearch: true });
            }
          });
        })
    );
  }
});
