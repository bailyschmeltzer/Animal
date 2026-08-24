// site/sw.js
// Bump CACHE_NAME to invalidate old caches on deploy
const CACHE_NAME = 'animal-count-v3';
const ASSETS = [
  '/', '/index.html', '/manifest.webmanifest'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// Strategy:
// - API: network-first
// - Assets: cache-first
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  const isAPI = url.pathname.endsWith('/wins') || url.pathname.endsWith('/health');

  if (isAPI) {
    event.respondWith(
      fetch(event.request).catch(() => caches.match(event.request))
    );
    return;
  }

  // HTML navigations: try network, fallback to cache, then index
  if (event.request.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const net = await fetch(event.request);
        return net;
      } catch {
        const cached = await caches.match('/index.html');
        return cached || new Response('Offline', { status: 503 });
      }
    })());
    return;
  }

  // Static: cache-first
  event.respondWith((async () => {
    const cached = await caches.match(event.request);
    if (cached) return cached;
    try {
      const net = await fetch(event.request);
      const cache = await caches.open(CACHE_NAME);
      cache.put(event.request, net.clone());
      return net;
    } catch {
      return new Response('Offline', { status: 503 });
    }
  })());
});