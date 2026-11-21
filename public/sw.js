// Align service worker.
// Caches the app shell only (built JS, CSS, fonts, icons). Pages and data are
// never cached, so the app always shows the live plan. When offline, page
// loads fall back to a small offline screen.

const VERSION = new URL(self.location.href).searchParams.get('v') || 'dev';
const SHELL_CACHE = `align-shell-${VERSION}`;
const OFFLINE_URL = '/offline.html';

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((cache) => cache.addAll([OFFLINE_URL, '/icons/icon-192.png', '/manifest.webmanifest']))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('align-') && k !== SHELL_CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

function isShellAsset(url) {
  return (
    url.origin === self.location.origin &&
    (url.pathname.startsWith('/_next/static/') || url.pathname.startsWith('/icons/'))
  );
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);

  // Page loads: always the network. Offline screen only if the network fails.
  if (request.mode === 'navigate') {
    event.respondWith(fetch(request).catch(() => caches.match(OFFLINE_URL)));
    return;
  }

  // Built assets are content hashed, so cache first is safe.
  if (isShellAsset(url)) {
    event.respondWith(
      caches.match(request).then(
        (hit) =>
          hit ||
          fetch(request).then((res) => {
            if (res.ok) {
              const copy = res.clone();
              caches.open(SHELL_CACHE).then((cache) => cache.put(request, copy));
            }
            return res;
          }),
      ),
    );
  }
  // Everything else (API, Supabase, server actions) goes straight to the network.
});

self.addEventListener('message', (event) => {
  if (event.data === 'skip-waiting') self.skipWaiting();
});
