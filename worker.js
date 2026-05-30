/**
 * OC Scanner Intel HQ - Cloudflare Worker Proxy
 * Deploy at: https://workers.cloudflare.com (free tier)
 * Handles CORS for flight data APIs
 */

const ALLOWED_ORIGINS = [
  'https://intelhq.pages.dev',        // your Cloudflare Pages URL
  'https://ocscanner.github.io',      // keep old GitHub Pages URL too
  'http://localhost',                  // for local testing
];
];

const API_TARGETS = {
  '/flights': (lat, lon, dist) =>
    `https://api.airplanes.live/v2/point/${lat}/${lon}/${dist}`,
  '/adsb': (lat, lon, dist) =>
    `https://api.adsb.lol/v2/lat/${lat}/lon/${lon}/dist/${dist}`,
};

export default {
  async fetch(request) {
    const origin = request.headers.get('Origin') || '';
    const url    = new URL(request.url);
    const path   = url.pathname;

    // CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0],
          'Access-Control-Allow-Methods': 'GET',
          'Access-Control-Max-Age': '86400',
        }
      });
    }

    // Only allow GET
    if (request.method !== 'GET') {
      return new Response('Method not allowed', { status: 405 });
    }

    // Parse params
    const lat  = url.searchParams.get('lat')  || '33.832721';
    const lon  = url.searchParams.get('lon')  || '-118.022520';
    const dist = url.searchParams.get('dist') || '25';

    // Find matching API
    const apiFn = API_TARGETS[path];
    if (!apiFn) {
      return new Response('Not found', { status: 404 });
    }

    // Proxy request
    const targetUrl = apiFn(lat, lon, dist);
    try {
      const resp = await fetch(targetUrl, {
        headers: {
          'User-Agent': 'OCScannerIntelHQ/1.0',
          'Accept':     'application/json',
        }
      });

      const data = await resp.text();
      const corsOrigin = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];

      return new Response(data, {
        status: resp.status,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': corsOrigin,
          'Cache-Control': 'no-cache, max-age=10',
        }
      });
    } catch (e) {
      return new Response(JSON.stringify({ error: e.message }), {
        status: 502,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        }
      });
    }
  }
};
