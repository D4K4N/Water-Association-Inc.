const CACHE_NAME = 'dicklum-water-v1';
const ASSETS_TO_CACHE = [
  './',
  './index.html',
  './css/styles.css',
  './css/print-thermal.css',
  './css/print-a4.css',
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
  e.respondWith(
    caches.match(e.request).then((cached) => {
      return cached || fetch(e.request).catch(() => {
        if (e.request.destination === 'document') {
          return caches.match('./index.html');
        }
      });
    })
  );
});
