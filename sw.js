const CACHE = 'mare-ia-v3';
const ASSETS = ['./manifest.webmanifest', './icon-192.png', './icon-512.png', './apple-touch-icon.png'];
self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  // Third-party requests (Google Maps tiles/session tokens, fonts, etc.) must
  // always hit the network: Maps tile/session URLs carry short-lived tokens, so
  // replaying a cached response instead of a live request breaks the map
  // silently — the Map object still works, it just never receives real tiles.
  if (new URL(e.request.url).origin !== self.location.origin) {
    e.respondWith(fetch(e.request));
    return;
  }
  const isHtml = e.request.mode === 'navigate' || e.request.destination === 'document';
  if (isHtml) {
    // Network-first for the app shell so deploys reach returning visitors immediately;
    // cache is only a fallback for offline use.
    e.respondWith(
      fetch(e.request).then(res => {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(e.request, copy)).catch(() => {});
        return res;
      }).catch(() => caches.match(e.request))
    );
    return;
  }
  e.respondWith(
    caches.match(e.request).then(hit => hit || fetch(e.request).then(res => {
      // Only cache successful responses — a broken/one-off request (e.g. a bad
      // URL from a template bug) must not be replayed forever.
      if (res.ok) {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(e.request, copy)).catch(() => {});
      }
      return res;
    }))
  );
});
