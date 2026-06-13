// OC Scanner · Intel HQ — Service Worker
// Bump CACHE_VERSION any time you deploy updates to force a cache refresh
const CACHE_VERSION = 'inthq-v1';

const STATIC_ASSETS = [
  '/IntelHQ/',
  '/IntelHQ/index.html',
  '/IntelHQ/hq.html',
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
    'alerts.weather.gov',
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
