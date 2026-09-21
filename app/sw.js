// Service worker: caches the static app shell for offline use only.
// IMPORTANT: /api/* requests are NEVER cached — they can contain private
// data (a member's own prayer requests, auth state, admin data). Caching
// those would let that private data linger in the browser's cache storage
// and be readable by anything with access to it. All API calls always go
// straight to the network.
const CACHE = 'cop-final-v2';
const CORE = ['./', './index.html', './styles.css', './app.js', './manifest.webmanifest', './assets/rccg-logo.jpg', './assets/icon-192.png', './assets/icon-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(CORE)));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  // Never intercept or cache API calls — always hit the network directly.
  if (url.pathname.startsWith('/api/')) return;

  if (e.request.method !== 'GET') return;

  e.respondWith(
    caches.match(e.request).then(cached =>
      cached || fetch(e.request).then(r => {
        const copy = r.clone();
        caches.open(CACHE).then(c => c.put(e.request, copy));
        return r;
      }).catch(() => caches.match('./index.html'))
    )
  );
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(clients.openWindow('./'));
});
