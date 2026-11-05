const CACHE_NAME = 'dicklum-water-v8';
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
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      );
    }).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;

  try {
    const url = new URL(e.request.url);
    // Never intercept cross-origin tile servers, CDNs, or /api/ endpoints
    if (url.origin !== self.location.origin || url.pathname.startsWith('/api/')) {
      return;
    }
  } catch (err) {
    return;
  }

  // Network-first strategy with offline cache fallback so code updates always apply immediately
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
});
