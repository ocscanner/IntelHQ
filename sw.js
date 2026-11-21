// OC Scanner · Intel HQ — Service Worker
// Bump CACHE_VERSION any time you deploy updates to force a cache refresh
const CACHE_VERSION = 'inthq-v11-hq';

// Paths are relative to this file, so the same code works at hq.ocscanner.media/
// and at the old ocscanner.github.io/IntelHQ/ address.
const STATIC_ASSETS = [
  './',
  './index.html',
  './hq.html',
  './hq.css',
  './hq.js',
  './newsroom.css',
  './newsroom.js',
  './manifest.json',
  './assets/oc-scanner-logo.png',
];

// ── Install: cache all static assets ──────────────────────────────────────────
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then(cache => cache.addAll(STATIC_ASSETS))
  );
  self.skipWaiting();
});

// ── Activate: delete old caches ───────────────────────────────────────────────
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(key => key !== CACHE_VERSION)
          .map(key => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

// ── Fetch: network-first for live data, cache fallback for everything else ────
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // Always go network-first for these live-data domains
  const liveDataHosts = [
    'openweathermap.org',
    'earthquake.usgs.gov',
    'api.adsb.lol',
    'opensky-network.org',
    'oc-radar-proxy.ocscannernews.workers.dev',
    'oc-election-wire.ocscannernews.workers.dev',
    'alerts.weather.gov',
    'api.weather.gov',
    'services3.arcgis.com',
    'mesonet.agron.iastate.edu',
    'inciweb.nwcg.gov',
    'firms.modaps.eosdis.nasa.gov',
  ];

  // Live data goes straight to the network, untouched. This used to answer a
  // failed request with an empty "200 OK", which hid real failures: a blocked
  // adsb.lol call looked like success and a worker outage looked like "no data".
  if (liveDataHosts.some(h => url.hostname.includes(h))) return;

  // The page's sign-in check (hq.css?signin=…) must reach the network untouched and is never cached
  if (url.origin === self.location.origin && url.searchParams.has('signin')) return;

  // For same-origin requests: try network first, fall back to cache
  if (url.origin === self.location.origin) {
    event.respondWith(
      fetch(event.request)
        .then(response => {
          // Behind Cloudflare Access, an expired sign-in answers with a redirect to the
          // login page. Hand that straight to the browser and never cache it, so the
          // sign-in page can't be saved as if it were IntelHQ.
          // Cache a fresh copy only for a real, same-site 200.
          if (response && response.status === 200 && response.type === 'basic' && !response.redirected) {
            const clone = response.clone();
            caches.open(CACHE_VERSION).then(cache => cache.put(event.request, clone));
          }
          return response;
        })
        .catch(() => caches.match(event.request))
    );
    return;
  }

  // Everything else: try cache first (CDN scripts, fonts, etc.)
  event.respondWith(
    caches.match(event.request).then(cached => cached || fetch(event.request))
  );
});

// ── Election desk alerts (Web Push from the oc-election-wire Worker) ─────────
// Turned on from the Elections tab's call queue ("Phone alerts"). Each message: {title, body, url, tag}.
self.addEventListener('push', event => {
  let m = {};
  try { m = event.data ? event.data.json() : {}; } catch { m = { body: event.data ? event.data.text() : '' }; }
  event.waitUntil(self.registration.showNotification(m.title || 'OC Scanner desk', {
    body: m.body || '',
    tag: m.tag || undefined,
    renotify: !!m.tag,
    icon: 'assets/oc-scanner-logo.png',
    badge: 'assets/oc-scanner-logo.png',
    data: { url: m.url || new URL('hq.html#elections', self.registration.scope).href },
  }));
});

// Tapping an alert opens (or brings forward) IntelHQ on that race
self.addEventListener('notificationclick', event => {
  event.notification.close();
  const url = new URL(event.notification.data?.url || 'hq.html#elections', self.registration.scope).href;
  event.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const scope = self.registration.scope;
    const hq = wins.find(w => w.url.startsWith(scope) && w.url.includes('hq.html')) || wins.find(w => w.url.startsWith(scope));
    if (hq) {
      try { await hq.focus(); } catch {}
      try { return await hq.navigate(url); } catch {}
    }
    return self.clients.openWindow(url);
  })());
});
