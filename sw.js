const CACHE = 'fe-learning-os-v2-20260801-nav-map-notes-v10';
const ASSET_PATHS = [
  './',
  './index.html',
  './assets/styles.css',
  './assets/app.js',
  './assets/terms-data.js',
  './assets/syllabus-terms.js',
  './assets/subject-a-data.js',
  './assets/knowledge-map-data.js',
  './assets/knowledge-map.js',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png'
];
const ASSETS = ASSET_PATHS.map(path => new URL(path, self.registration.scope).href);
const FALLBACK_URL = new URL('./index.html', self.registration.scope).href;

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(ASSETS)));
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key))))
  );
  self.clients.claim();
});

self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;

  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;

  if (event.request.mode === 'navigate') {
    event.respondWith(fetch(event.request).catch(() => caches.match(FALLBACK_URL)));
    return;
  }

  event.respondWith(
    caches.open(CACHE).then(cache => cache.match(event.request).then(cached => {
      const fetched = fetch(event.request).then(response => {
        if (response && response.status === 200) cache.put(event.request, response.clone());
        return response;
      }).catch(() => cached || Response.error());
      return cached || fetched;
    }))
  );
});
