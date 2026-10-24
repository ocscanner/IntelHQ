// OC Scanner · Intel HQ — Service Worker
// Bump CACHE_VERSION any time you deploy updates to force a cache refresh
const CACHE_VERSION = 'inthq-v9-desk-alerts';

const STATIC_ASSETS = [
  '/IntelHQ/',
  '/IntelHQ/index.html',
  '/IntelHQ/hq.html',
  '/IntelHQ/hq.css',
  '/IntelHQ/hq.js',
  '/IntelHQ/newsroom.css',
  '/IntelHQ/newsroom.js',
  '/IntelHQ/manifest.json',
  '/IntelHQ/assets/oc-scanner-logo.png',
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

  if (liveDataHosts.some(h => url.hostname.includes(h))) {
    // Network-only for live feeds — let them fail gracefully if offline
    event.respondWith(fetch(event.request).catch(() => new Response('')));
    return;
  }

  // For same-origin requests: try network first, fall back to cache
  if (url.origin === self.location.origin) {
    event.respondWith(
      fetch(event.request)
        .then(response => {
          // Cache a fresh copy on success
          if (response && response.status === 200) {
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
    icon: '/IntelHQ/assets/oc-scanner-logo.png',
    badge: '/IntelHQ/assets/oc-scanner-logo.png',
    data: { url: m.url || '/IntelHQ/hq.html#elections' },
  }));
});

// Tapping an alert opens (or brings forward) IntelHQ on that race
self.addEventListener('notificationclick', event => {
  event.notification.close();
  const url = new URL(event.notification.data?.url || '/IntelHQ/hq.html#elections', self.location.origin).href;
  event.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const hq = wins.find(w => w.url.includes('/IntelHQ/hq.html')) || wins.find(w => w.url.includes('/IntelHQ/'));
    if (hq) {
      try { await hq.focus(); } catch {}
      try { return await hq.navigate(url); } catch {}
    }
    return self.clients.openWindow(url);
  })());
});
