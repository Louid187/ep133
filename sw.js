/* network-first service worker so the app works offline after the first visit */
const CACHE = 'kosim-v1';
const FILES = ['./', 'index.html', 'css/style.css', 'js/util.js', 'js/sounds.js', 'js/store.js', 'js/engine.js',
  'js/sequencer.js', 'js/display.js', 'js/ui.js', 'js/app.js', 'manifest.webmanifest', 'icons/icon.svg', 'icons/icon-180.png'];
self.addEventListener('install', (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)).then(() => self.skipWaiting())); });
self.addEventListener('activate', (e) => { e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  e.respondWith(fetch(e.request).then((r) => { const cp = r.clone(); caches.open(CACHE).then((c) => c.put(e.request, cp)); return r; })
    .catch(() => caches.match(e.request).then((r) => r || caches.match('index.html'))));
});
