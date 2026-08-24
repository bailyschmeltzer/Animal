// Simple offline-first service worker for PWA installability
const CACHE_NAME = 'animal-count-v1';
const APP_SHELL = [
  './',
  './index.html',
  './manifest.webmanifest'
];

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL))
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

// Cache-first; fall back to network; fallback to index.html for navigations
self.addEventListener('fetch', (event) => {
  const req = event.request;
  event.respondWith((async () => {
    const cached = await caches.match(req, { ignoreVary: true, ignoreSearch: true });
    if (cached) return cached;
    try {
      const fresh = await fetch(req);
      if (req.method === 'GET' && fresh && (fresh.status === 200 || fresh.type === 'opaqueredirect' || fresh.type === 'basic')) {
        const cache = await caches.open(CACHE_NAME);
        cache.put(req, fresh.clone()).catch(()=>{});
      }
      return fresh;
    } catch {
      if (req.mode === 'navigate') {
        const fallback = await caches.match('./index.html');
        if (fallback) return fallback;
      }
      return new Response('Offline', { status: 503, statusText: 'Offline' });
    }
  })());
});