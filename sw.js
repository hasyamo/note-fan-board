const CACHE_NAME = 'fan-board-v2';
const STATIC_ASSETS = [
  '/note-fan-board/',
  '/note-fan-board/index.html',
  '/note-fan-board/app.css',
  '/note-fan-board/app.js',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE_NAME).then(c => c.addAll(STATIC_ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  // CSV data: network first, no cache
  if (url.pathname.includes('/data/')) {
    e.respondWith(fetch(e.request).catch(() => caches.match(e.request)));
    return;
  }
  // Static assets: cache first
  e.respondWith(
    caches.match(e.request).then(r => r || fetch(e.request))
  );
});
