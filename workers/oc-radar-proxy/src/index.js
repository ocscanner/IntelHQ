/**
 * OC Scanner Intel HQ — Proxy Worker v9
 * /flights — ADS-B flight data
 * /tle?group=NAME — CelesTrak TLE proxy
 * /tfr — FAA TFR list (scrapes tfr.faa.gov HTML)
 * /mil — military aircraft (ADS-B mil endpoints)
 * /airports?codes=LAX,SNA — FAA NAS status
 * /launches — cached upcoming launches (Launch Library 2)
 * /ai-digest — Claude-powered news digest (POST headlines[])
 * /rss?url=ENCODED — generic RSS/feed proxy (no rate limit)
 */

const TLE_URLS = {
  stations: 'https://celestrak.org/NORAD/elements/gp.php?GROUP=stations&FORMAT=TLE',
  starlink: 'https://celestrak.org/NORAD/elements/gp.php?GROUP=starlink&FORMAT=TLE',
  weather: 'https://celestrak.org/NORAD/elements/gp.php?GROUP=weather&FORMAT=TLE',
  gps: 'https://celestrak.org/NORAD/elements/gp.php?GROUP=gps-ops&FORMAT=TLE',
  visual: 'https://celestrak.org/NORAD/elements/gp.php?GROUP=visual&FORMAT=TLE',
};

// TLE cache — CelesTrak rate-limits, so we keep the last good copy per group.
// TLEs stay accurate for hours, so serving a cached copy is fine (and often
// necessary when CelesTrak returns 502/429 under repeated requests).
const TLE_CACHE = {}; // { group: { text, t } }
const TLE_TTL_MS = 6 * 60 * 60 * 1000; // 6h fresh (TLEs stay accurate for days)

// Launches cache — Launch Library 2 rate-limits anonymous requests (~15/hr per
// IP). Every visitor's page-load hitting it through this Worker shares one IP,
// which trips that limit and returns HTTP 429. So we fetch it once and serve a
// cached copy to everyone; upstream is hit at most ~1-2x/hour regardless of
// traffic. A stale copy is served if a later refresh gets throttled.
const LAUNCH_URL = 'https://ll.thespacedevs.com/2.2.0/launch/upcoming/?mode=list&limit=40&hide_recent_previous=true';
let LAUNCH_CACHE = { data: null, t: 0 };
const LAUNCH_TTL_MS = 45 * 60 * 1000; // 45 min fresh

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function jsonResp(data, status = 200, extra = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json', ...extra },
  });
}

// ── AI digest server-side cache ──
// Persists across requests on the same Worker isolate.
// Generation is driven by Cron Triggers (see scheduled() below) at fixed times,
// so cost is fully decoupled from visitor traffic. TTL is a safety fallback only.
const DIGEST_TTL_MS = 9 * 60 * 60 * 1000; // 9h fallback (cron fires ~3x/day)
let DIGEST_CACHE = { text: null, timestamp: 0 };

// Feeds the cron job pulls headlines from when generating the scheduled digest.
const DIGEST_FEEDS = [
  'https://moxie.foxnews.com/google-publisher/politics.xml',
  'https://www.breitbart.com/feed/',
  'https://feeds.npr.org/1014/rss.xml',
  'https://thehill.com/feed',
  'https://www.aljazeera.com/xml/rss/all.xml',
  'https://rss.upi.com/news/tn_int.rss',
  'https://www.militarytimes.com/arc/outboundfeeds/rss/?outputType=xml',
  'https://www.ocregister.com/feed/',
  'https://justthenews.com/feeds/all-stories',
];

// Pull a batch of headlines from the feeds (server-side, no CORS limits).
async function collectHeadlines() {
  const titles = [];
  const seen = new Set();
  await Promise.allSettled(DIGEST_FEEDS.map(async u => {
    try {
      const resp = await fetch(u, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; OCScannerIntelHQ/1.0)' },
        signal: AbortSignal.timeout(8000),
      });
      if (!resp.ok) return;
      const xml = await resp.text();
      // Crude but dependency-free title extraction
      const matches = xml.match(/<title[^>]*>([\s\S]*?)<\/title>/gi) || [];
      matches.slice(1, 7).forEach(m => { // skip first <title> (channel name)
        let t = m.replace(/<[^>]+>/g, '')
          .replace(/<!\[CDATA\[|\]\]>/g, '')
          .replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"')
          .trim();
        const key = t.slice(0, 50);
        if (t && t.length > 12 && !seen.has(key)) { seen.add(key); titles.push(t); }
      });
    } catch (e) {}
  }));
  return titles.slice(0, 30);
}

// Generate a digest from headlines via Claude and store it in the cache.
async function generateDigest(headlines, env) {
  if (!env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY not configured');
  const headlineText = headlines.slice(0, 30).join('\n');

  const aiResp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    signal: AbortSignal.timeout(20000),
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 1000,
      system: `You are an intelligence analyst for OC Scanner, a public safety and local news operation focused on Orange County and Southern California.
You receive a list of current news headlines and write a concise situational awareness digest.
Write 4-6 sentences in a direct, factual, professional tone — like a briefing for a command center.
Focus on the most significant developing stories. Group related items. Flag anything with SoCal/OC relevance.
Do not use bullet points. Do not use headers. Plain prose only.
End with a brief note on OC-specific relevance, or state none was detected.`,
      messages: [
        {
          role: 'user',
          content: `Current headlines as of ${new Date().toUTCString()}:\n\n${headlineText}\n\nProvide the intelligence digest.`,
        },
      ],
    }),
  });

  if (!aiResp.ok) {
    const errText = await aiResp.text();
    throw new Error(`Claude API error ${aiResp.status}: ${errText.slice(0, 200)}`);
  }

  const aiData = await aiResp.json();
  const digest = aiData.content?.[0]?.text || 'Digest unavailable.';
  DIGEST_CACHE = { text: digest, timestamp: Date.now() };
  return digest;
}

// Parse TFR XML from FAA
function parseTFRXml(xml) {
  const tfrs = [];
  // Match <NOTAM> or <TFR> blocks
  const blockRe = /<(?:NOTAM|notam|TFR|tfr)[^>]*>([\s\S]*?)<\/(?:NOTAM|notam|TFR|tfr)>/gi;
  const getText = (xml, tag) => {
    const m = xml.match(new RegExp('<' + tag + '[^>]*>([\\s\\S]*?)<\\/' + tag + '>', 'i'));
    return m ? m[1].replace(/<[^>]+>/g, '').trim() : '';
  };

  let block;
  while ((block = blockRe.exec(xml)) !== null) {
    const b = block[1];
    const notam = getText(b, 'notamNumber') || getText(b, 'NOTAM_Number') || getText(b, 'notam') || '';
    const type = getText(b, 'type') || getText(b, 'TYPE') || getText(b, 'tfrType') || '';
    const state = getText(b, 'state') || getText(b, 'STATE') || '';
    const desc = getText(b, 'description') || getText(b, 'DESCRIPTION') || getText(b, 'text') || getText(b, 'TEXT') || '';
    const fac = getText(b, 'facility') || getText(b, 'FACILITY') || getText(b, 'artcc') || '';
    const date = getText(b, 'creationDate') || getText(b, 'date') || getText(b, 'DATE') || '';
    if (notam || type || desc) {
      tfrs.push({ notam, type, state, description: desc.slice(0, 120), facility: fac, date });
    }
  }
  return tfrs;
}

// Parse TFR HTML table from tfr.faa.gov/tfr2/tfr.html
function parseTFRHtml(html) {
  const tfrs = [];
  // Match table rows - each TFR row has: date, notam, facility, state, type, description, links
  const rowRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  const stripTags = s => s.replace(/<[^>]+>/g, '').replace(/&amp;/g,'&').replace(/&nbsp;/g,' ').trim();

  let rowMatch;
  while ((rowMatch = rowRegex.exec(html)) !== null) {
    const rowHtml = rowMatch[1];
    const cells = [];
    let cellMatch;
    const cellRe = /<td[^>]*>([\s\S]*?)<\/td>/gi;
    while ((cellMatch = cellRe.exec(rowHtml)) !== null) {
      cells.push(stripTags(cellMatch[1]));
    }
    // TFR rows have 6+ cells: date, notam, facility, state, type, description
    if (cells.length >= 5 && cells[0].match(/\d{2}\/\d{2}\/\d{4}/)) {
      // Extract detail link
      const linkMatch = rowHtml.match(/href="([^"]*detail[^"]*)"/) || rowHtml.match(/href="([^"]*save_pages[^"]*)"/);
      const detailUrl = linkMatch ? 'https://tfr.faa.gov' + linkMatch[1] : null;
      tfrs.push({
        date: cells[0] || '',
        notam: cells[1] || '',
        facility: cells[2] || '',
        state: cells[3] || '',
        type: cells[4] || '',
        description: cells[5] || '',
        links: detailUrl ? { details: detailUrl } : null,
      });
    }
  }
  return tfrs;
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS });
    }

    // ── /flights ──
    if (url.pathname === '/flights') {
      const lat = parseFloat(url.searchParams.get('lat') || '33.832721');
      const lon = parseFloat(url.searchParams.get('lon') || '-118.02252');
      const dist = parseInt(url.searchParams.get('dist') || '25');

      const apis = [
        `https://api.adsb.lol/v2/lat/${lat}/lon/${lon}/dist/${dist}`,
        `https://api.airplanes.live/v2/point/${lat}/${lon}/${dist}`,
        `https://api.adsb.one/v2/point/${lat}/${lon}/${dist}`,
      ];

      let emptyFallback = null; // remember a valid-but-empty response as last resort
      for (const api of apis) {
        try {
          const resp = await fetch(api, {
            headers: { 'User-Agent': 'OCScannerIntelHQ/1.0', 'Accept': 'application/json' },
            signal: AbortSignal.timeout(5000),
          });
          if (!resp.ok) continue;
          const text = await resp.text();
          if (!text.includes('"ac"') && !text.includes('"states"')) continue;
          if (text.toLowerCase().includes('rate limit')) continue;

          // Count aircraft — if a source returns an empty list, don't stop here.
          // Another source may have coverage for this area. Keep the empty one
          // as a fallback and try the rest before giving up.
          let acCount = 0;
          try {
            const j = JSON.parse(text);
            acCount = Array.isArray(j.ac) ? j.ac.length
              : Array.isArray(j.states) ? j.states.length : 0;
          } catch(e) { /* if it won't parse, treat as usable text below */ }

          if (acCount === 0) {
            if (!emptyFallback) emptyFallback = text; // stash first valid-empty
            continue; // try next source
          }

          return new Response(text, {
            status: 200,
            headers: { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': 'no-cache', 'X-Source': new URL(api).hostname },
          });
        } catch(e) { continue; }
      }
      // Every source was empty (or failed). Return the empty payload if we got
      // one — that's an honest "no aircraft" — otherwise a clear error.
      if (emptyFallback) {
        return new Response(emptyFallback, {
          status: 200,
          headers: { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': 'no-cache', 'X-Source': 'all-empty' },
        });
      }
      return jsonResp({ ac: [], msg: 'All APIs unavailable' });
    }

    // ── /tle?group=NAME ──
    if (url.pathname === '/tle') {
      const group = url.searchParams.get('group') || 'stations';
      const tleUrl = TLE_URLS[group];
      if (!tleUrl) return jsonResp({ error: `Unknown group. Use: ${Object.keys(TLE_URLS).join(', ')}` }, 400);

      // Serve fresh cache if we have a recent copy (TLEs stay valid for hours)
      const cached = TLE_CACHE[group];
      const cacheAge = cached ? Date.now() - cached.t : Infinity;
      if (cached && cacheAge < TLE_TTL_MS) {
        return new Response(cached.text, {
          status: 200,
          headers: { ...CORS, 'Content-Type': 'text/plain', 'Cache-Control': 'public, max-age=300', 'X-TLE-Cache': 'fresh' },
        });
      }

      // CelesTrak blocks non-browser agents, so send full browser-like headers.
      const BROWSER_HEADERS = {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
        'Accept': 'text/plain,text/html,application/xhtml+xml,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Referer': 'https://celestrak.org/',
      };
      const sources = [ tleUrl, tleUrl.replace('celestrak.org', 'celestrak.com') ];
      for (const src of sources) {
        try {
          const resp = await fetch(src, { headers: BROWSER_HEADERS, signal: AbortSignal.timeout(10000) });
          if (!resp.ok) continue;
          const text = await resp.text();
          if (!text || (!text.includes('1 ') && !text.includes('2 '))) continue;
          TLE_CACHE[group] = { text, t: Date.now() };
          return new Response(text, {
            status: 200,
            headers: { ...CORS, 'Content-Type': 'text/plain', 'Cache-Control': 'public, max-age=300', 'X-TLE-Cache': 'miss' },
          });
        } catch(e) { /* try next source */ }
      }

      // Fallback: free public TLE API (JSON) -> convert to TLE text.
      // Keeps the tracker alive when CelesTrak blocks the Worker.
      try {
        const q = 'https://tle.ivanstanojevic.me/api/tle/?page-size=80';
        const r2 = await fetch(q, { headers: { 'Accept':'application/json' }, signal: AbortSignal.timeout(8000) });
        if (r2.ok) {
          const j = await r2.json();
          const members = j.member || [];
          if (members.length) {
            const text = members.map(m => m.name + String.fromCharCode(10) + m.line1 + String.fromCharCode(10) + m.line2).join(String.fromCharCode(10));
            TLE_CACHE[group] = { text, t: Date.now() };
            return new Response(text, {
              status: 200,
              headers: { ...CORS, 'Content-Type': 'text/plain', 'Cache-Control': 'public, max-age=300', 'X-TLE-Cache': 'fallback-api' },
            });
          }
        }
      } catch(e) { /* fall through to stale cache */ }

      // All live sources failed — serve stale cache if we have any (still accurate for a while)
      if (cached) {
        return new Response(cached.text, {
          status: 200,
          headers: { ...CORS, 'Content-Type': 'text/plain', 'Cache-Control': 'no-cache', 'X-TLE-Cache': 'stale' },
        });
      }
      return jsonResp({ error: 'CelesTrak unavailable and no cached TLE' }, 502);
    }

    // ── /tfr ──
    if (url.pathname === '/tfr') {
      // Use the FAA TFR XML feed - reliable structured data
      const tfrSources = [
        'https://tfr.faa.gov/tfr3/download/tfr_data.xml',
        'https://tfr.faa.gov/tfr3/export/tfr_data.xml',
        'https://tfr.faa.gov/tfr2/tfr.xml',
      ];

      for (const src of tfrSources) {
        try {
          const resp = await fetch(src, {
            headers: {
              'User-Agent': 'Mozilla/5.0 (compatible; OCScannerIntelHQ/1.0)',
              'Accept': 'application/xml, text/xml, */*',
            },
            signal: AbortSignal.timeout(10000),
          });
          if (!resp.ok) continue;
          const xml = await resp.text();
          if (!xml.includes('<') || xml.length < 100) continue;

          // Parse XML into JSON
          const tfrs = parseTFRXml(xml);
          if (tfrs.length > 0) {
            return jsonResp({ TFRs: tfrs, count: tfrs.length, source: src, updated: new Date().toISOString() }, 200, {
              'Cache-Control': 'public, max-age=60',
            });
          }
        } catch(e) { continue; }
      }

      // All XML sources failed - return helpful links
      return jsonResp({
        TFRs: [],
        count: 0,
        error: 'FAA XML feeds unavailable',
        links: {
          list: 'https://tfr.faa.gov/tfr3/?page=tfr',
          map: 'https://tfr.faa.gov/tfr3/?page=map',
        },
        updated: new Date().toISOString()
      }, 200);
    }

    // ── /mil — all military aircraft globally (dedicated ADS-B mil endpoints) ──
    if (url.pathname === '/mil') {
      const apis = [
        'https://api.adsb.lol/v2/mil',
        'https://api.airplanes.live/v2/mil',
      ];
      for (const api of apis) {
        try {
          const resp = await fetch(api, {
            headers: { 'User-Agent': 'OCScannerIntelHQ/1.0', 'Accept': 'application/json' },
            signal: AbortSignal.timeout(8000),
          });
          if (!resp.ok) continue;
          const text = await resp.text();
          if (!text.includes('"ac"')) continue;
          return new Response(text, {
            status: 200,
            headers: { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=15', 'X-Source': new URL(api).hostname },
          });
        } catch(e) { continue; }
      }
      return jsonResp({ ac: [], msg: 'Military feeds unavailable' });
    }

    // ── /airports?codes=LAX,SNA — FAA NAS status (FAA blocks browser CORS) ──
    if (url.pathname === '/airports') {
      const codes = (url.searchParams.get('codes') || 'LAX,SNA,LGB,ONT,SAN')
        .split(',').map(c => c.trim().toUpperCase()).filter(Boolean).slice(0, 10);
      const out = {};
      await Promise.allSettled(codes.map(async code => {
        try {
          const resp = await fetch(`https://nasstatus.faa.gov/api/airport-status/${code}`, {
            headers: { 'User-Agent': 'Mozilla/5.0 (compatible; OCScannerIntelHQ/1.0)', 'Accept': 'application/json' },
            signal: AbortSignal.timeout(6000),
          });
          if (!resp.ok) { out[code] = { error: `HTTP ${resp.status}` }; return; }
          const d = await resp.json();
          const delays = d.status?.delay?.delays || d.delays || [];
          out[code] = { delays: delays.length, ok: true };
        } catch (e) { out[code] = { error: e.message }; }
      }));
      return jsonResp(out, 200, { 'Cache-Control': 'public, max-age=120' });
    }

    // ── /launches — cached upcoming launches (Launch Library 2) ──
    // Returns { results: [...] } (the LL2 list). The site filters to
    // California / Texas / Florida on the client. Cached 45 min to stay well
    // under LL2's ~15/hr anonymous rate limit; stale copy served on throttle.
    if (url.pathname === '/launches') {
      const age = Date.now() - LAUNCH_CACHE.t;
      if (LAUNCH_CACHE.data && age < LAUNCH_TTL_MS) {
        return jsonResp({ results: LAUNCH_CACHE.data, cached: true, ageMinutes: Math.round(age / 60000) },
          200, { 'Cache-Control': 'public, max-age=300' });
      }

      try {
        const headers = {
          'User-Agent': 'Mozilla/5.0 (compatible; OCScannerIntelHQ/1.0)',
          'Accept': 'application/json',
        };
        // OPTIONAL: a free Space Devs API key raises the rate limit further.
        // Get one at https://thespacedevs.com , then set it as a Worker secret:
        // npx wrangler secret put SPACEDEVS_KEY
        if (env.SPACEDEVS_KEY) headers['Authorization'] = 'Token ' + env.SPACEDEVS_KEY;

        const resp = await fetch(LAUNCH_URL, { headers, signal: AbortSignal.timeout(9000) });

        if (!resp.ok) {
          // Upstream throttled/failed — serve the last good copy if we have one.
          if (LAUNCH_CACHE.data) {
            return jsonResp({ results: LAUNCH_CACHE.data, cached: true, stale: true },
              200, { 'Cache-Control': 'no-cache' });
          }
          return jsonResp({ error: `Launch Library HTTP ${resp.status}`, results: [] }, 200);
        }

        const data = await resp.json();
        const results = Array.isArray(data.results) ? data.results : [];
        LAUNCH_CACHE = { data: results, t: Date.now() };
        return jsonResp({ results }, 200, { 'Cache-Control': 'public, max-age=300' });
      } catch (e) {
        if (LAUNCH_CACHE.data) {
          return jsonResp({ results: LAUNCH_CACHE.data, cached: true, stale: true },
            200, { 'Cache-Control': 'no-cache' });
        }
        return jsonResp({ error: e.message, results: [] }, 200);
      }
    }

    // ── /rss?url=ENCODED — generic RSS/feed proxy ──
    if (url.pathname === '/rss') {
      const feedUrl = url.searchParams.get('url');
      if (!feedUrl) {
        return jsonResp({ error: 'Missing url param', contents: '' }, 400);
      }
      try {
        const resp = await fetch(feedUrl, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (compatible; OCScannerIntelHQ/1.0; +https://ocscanner.github.io)',
            'Accept': 'application/rss+xml, application/xml, text/xml, application/atom+xml, */*',
          },
          signal: AbortSignal.timeout(9000),
        });
        if (!resp.ok) {
          return jsonResp({ error: `Feed returned HTTP ${resp.status}`, contents: '' }, 200);
        }
        const text = await resp.text();
        // allorigins-compatible shape so the front-end can read .contents
        return jsonResp({ contents: text, status: { http_code: resp.status } }, 200, {
          'Cache-Control': 'public, max-age=120',
        });
      } catch (e) {
        return jsonResp({ error: e.message, contents: '' }, 200);
      }
    }

    // ── /ai-digest ── (POST { headlines: string[] })
    if (url.pathname === '/ai-digest') {
      if (request.method !== 'POST') {
        return jsonResp({ error: 'Use POST with JSON body { headlines: [...] }' }, 405);
      }

      try {
        const body = await request.json();
        const headlines = Array.isArray(body.headlines) ? body.headlines : [];
        const force = body.force === true;

        if (!env.ANTHROPIC_API_KEY) {
          return jsonResp({ error: 'ANTHROPIC_API_KEY not configured on Worker' }, 500);
        }

        const age = Date.now() - DIGEST_CACHE.timestamp;

        // ── Normal request: serve the cached digest (generated by cron). ──
        // Browsers never trigger paid generation on a normal load — only the
        // cron schedule or a manual force-refresh does.
        if (!force && DIGEST_CACHE.text) {
          return jsonResp({
            digest: DIGEST_CACHE.text,
            timestamp: new Date(DIGEST_CACHE.timestamp).toISOString(),
            cached: true,
            ageMinutes: Math.round(age / 60000),
          }, 200, { 'Cache-Control': 'no-cache' });
        }

        // ── Manual force-refresh: rate-limited to once per 10 min ──
        if (force && DIGEST_CACHE.text && age < 10 * 60 * 1000) {
          return jsonResp({
            digest: DIGEST_CACHE.text,
            timestamp: new Date(DIGEST_CACHE.timestamp).toISOString(),
            cached: true,
            rateLimited: true,
            ageMinutes: Math.round(age / 60000),
          }, 200, { 'Cache-Control': 'no-cache' });
        }

        // ── Generate: only reached on force-refresh, or when cache is empty ──
        // (e.g. before the first cron run after a deploy). Use provided
        // headlines if present, otherwise collect them server-side.
        const useHeadlines = headlines.length >= 3 ? headlines : await collectHeadlines();
        if (useHeadlines.length < 3) {
          return jsonResp({ error: 'Not enough headlines to generate digest' }, 400);
        }

        try {
          const digest = await generateDigest(useHeadlines, env);
          return jsonResp({ digest, timestamp: new Date().toISOString(), cached: false }, 200, {
            'Cache-Control': 'no-cache',
          });
        } catch (genErr) {
          // If generation fails but we have a cached copy, serve it rather than erroring
          if (DIGEST_CACHE.text) {
            return jsonResp({
              digest: DIGEST_CACHE.text,
              timestamp: new Date(DIGEST_CACHE.timestamp).toISOString(),
              cached: true,
              note: 'served stale cache (generation failed)',
            }, 200, { 'Cache-Control': 'no-cache' });
          }
          return jsonResp({ error: genErr.message }, 502);
        }

      } catch (err) {
        return jsonResp({ error: err.message }, 500);
      }
    }

    // ── default ──
    return jsonResp({
      status: 'OC Scanner Proxy v9',
      endpoints: {
        flights: '/flights?lat=XX&lon=XX&dist=XX',
        tle: '/tle?group=stations|starlink|weather|gps|visual',
        tfr: '/tfr',
        mil: '/mil',
        airports: '/airports?codes=LAX,SNA',
        launches: '/launches (cached upcoming launches; site filters to CA/TX/FL)',
        rss: '/rss?url=ENCODED_FEED_URL',
        'ai-digest': 'POST /ai-digest { "headlines": [...] } (served from cache; generated by cron 3x/day)',
      },
      digestSchedule: '08:00, 14:00, 21:00 America/Los_Angeles',
      digestAge: DIGEST_CACHE.timestamp
        ? Math.round((Date.now() - DIGEST_CACHE.timestamp) / 60000) + ' min'
        : 'none yet',
      launchCache: LAUNCH_CACHE.t
        ? Math.round((Date.now() - LAUNCH_CACHE.t) / 60000) + ' min'
        : 'none yet',
    });
  },

  // ── Cron Triggers ──
  // Generates the digest at fixed times so cost is independent of traffic.
  // Configured in wrangler / dashboard for: 8am, 2pm, 9pm PT.
  // (Cron runs in UTC; the dashboard cron expressions handle the conversion.)
  async scheduled(event, env, ctx) {
    ctx.waitUntil((async () => {
      try {
        const headlines = await collectHeadlines();
        if (headlines.length >= 3) {
          await generateDigest(headlines, env);
          console.log(`[cron] Digest regenerated from ${headlines.length} headlines at ${new Date().toISOString()}`);
        } else {
          console.log('[cron] Skipped — not enough headlines collected');
        }
      } catch (e) {
        console.log('[cron] Digest generation failed:', e.message);
      }
    })());
  },
};
