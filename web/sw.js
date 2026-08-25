/**
 * Offline support. The app shell is precached; dictionary shards are cached
 * as they are used, so the words a reader actually looks up stay available
 * offline without ever downloading the full 85 MB index.
 */

const VERSION = 'v1';
const SHELL = `shell-${VERSION}`;
const DICT = `dict-${VERSION}`;

const SHELL_FILES = [
  './',
  'index.html',
  'about.html',
  'style.css',
  'app.js',
  'search-core.js',
  'tags.json',
  'irregular.json',
  'icon.svg',
  'manifest.webmanifest',
  'dict/manifest.json',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(SHELL).then((c) => c.addAll(SHELL_FILES)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== SHELL && k !== DICT).map((k) => caches.delete(k)))
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const { request } = e;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== location.origin) return;

  // Shards are immutable for a given build: serve from cache, fetch once.
  if (url.pathname.includes('/dict/') && url.pathname.endsWith('.json')) {
    e.respondWith(
      caches.open(DICT).then(async (cache) => {
        const hit = await cache.match(request);
        if (hit) return hit;
        const res = await fetch(request);
        if (res.ok) cache.put(request, res.clone());
        return res;
      })
    );
    return;
  }

  // Shell: serve cache first, refresh in the background.
  e.respondWith(
    caches.match(request).then((hit) => {
      const network = fetch(request)
        .then((res) => {
          if (res.ok) caches.open(SHELL).then((c) => c.put(request, res.clone()));
          return res;
        })
        .catch(() => hit);
      return hit ?? network;
    })
  );
});
