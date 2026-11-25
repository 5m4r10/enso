// App shell, cache-first, one cache per version: modules of different versions never mix and the app
// opens without network. VERSION is stamped by the deploy workflow. Only same-origin GETs listed
// here are served; API and Google requests always go to the network. A test checks SHELL is complete.
const VERSION = 'dev';
const CACHE = `enso-${VERSION}`;
const SHELL = [
  './',
  'config.js',
  'domain.js',
  'fonts/fonts.css',
  'fonts/texgyreheros-bold.woff2',
  'fonts/texgyreheros-regular.woff2',
  'icons/icon-180.png',
  'icons/icon-192.png',
  'icons/icon-32.png',
  'icons/icon-512.png',
  'js/api.js',
  'js/app.js',
  'js/auth.js',
  'js/biometric.js',
  'js/crypto.js',
  'js/db.js',
  'js/enso.js',
  'js/format.js',
  'js/links.js',
  'js/mock.js',
  'js/overlay.js',
  'js/store.js',
  'js/sync.js',
  'js/vault.js',
  'js/views/capture.js',
  'js/views/forms.js',
  'js/views/project.js',
  'js/views/review.js',
  'js/views/shell.js',
  'js/views/vault.js',
  'manifest.webmanifest',
  'styles.css'
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL.map((u) => new Request(u, { cache: 'reload' })))));
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k.startsWith('enso-') && k !== CACHE) await caches.delete(k);
    await self.clients.claim();
  })());
});

// The page asks for this only when the owner presses "Actualizar".
self.addEventListener('message', (e) => { if (e.data === 'activate') self.skipWaiting(); });

self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin || !req.url.startsWith(self.registration.scope)) return;
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const hit = await cache.match(req.mode === 'navigate' ? './' : req, { ignoreSearch: true });
    return hit || fetch(req);
  })());
});
