/**
 * OC Scanner Intel HQ — Flight Data Proxy Worker
 * Paste this into your Cloudflare Worker editor and deploy.
 */

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: corsHeaders()
      });
    }

    // Only serve /flights path
    if (url.pathname !== '/flights') {
      return new Response(JSON.stringify({ error: 'Use /flights?lat=XX&lon=XX&dist=XX' }), {
        status: 404,
        headers: { ...corsHeaders(), 'Content-Type': 'application/json' }
      });
    }

    const lat  = url.searchParams.get('lat')  || '33.832721';
    const lon  = url.searchParams.get('lon')  || '-118.022520';
    const dist = url.searchParams.get('dist') || '25';

    // Try APIs in order — return first successful response
    const apis = [
      `https://api.adsb.lol/v2/lat/${lat}/lon/${lon}/dist/${dist}`,
      `https://api.airplanes.live/v2/point/${lat}/${lon}/${dist}`,
      `https://opensky-network.org/api/states/all?lamin=${lat-0.4}&lomin=${lon-0.4}&lamax=${+lat+0.4}&lomax=${+lon+0.4}`,
    ];

    for (const apiUrl of apis) {
      try {
        const resp = await fetch(apiUrl, {
          headers: {
            'User-Agent':  'Mozilla/5.0 OCScannerIntelHQ/1.0',
            'Accept':      'application/json',
            'Cache-Control': 'no-cache',
          },
          cf: { cacheTtl: 10 }
        });

        if (!resp.ok) continue;

        const text = await resp.text();

        // Validate it's actual flight data
        if (!text || text.length < 10) continue;
        if (text.includes('rate limit') || text.includes('Rate limit')) continue;
        if (!text.includes('{')) continue;

        return new Response(text, {
          status: 200,
          headers: {
            ...corsHeaders(),
            'Content-Type': 'application/json',
            'X-Source': new URL(apiUrl).hostname,
          }
        });

      } catch (e) {
        continue;
      }
    }

    // All failed — return empty aircraft array so radar doesn't crash
    return new Response(JSON.stringify({ ac: [], msg: 'All APIs unavailable', time: Date.now() }), {
      status: 200,
      headers: { ...corsHeaders(), 'Content-Type': 'application/json' }
    });
  }
};

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin':  '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age':       '86400',
  };
}
