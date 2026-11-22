/* OC Scanner IntelHQ — branded weather images ("cards") for quick posts.
 *
 * Draws a 1600×900 PNG in the browser: OC Scanner header, the warning name in its NWS hazard
 * colour, a map (Esri dark basemap + latest NEXRAD mosaic from Iowa Environmental Mesonet + the
 * warning area), key facts, and a credit line. Nothing is uploaded or posted: the Briefing shows
 * the image with Share / Save / Copy caption buttons for a person to use.
 *
 * Kept separate from briefing.js so the P37 warning bot can reuse the layout and the pure helpers
 * (hazard colours, warning types, captions, map fitting), which also run under Node for tests.
 */
(function (root) {
  'use strict';

  const W = 1600, H = 900;
  const HEAD = 150, FOOT = 74;                    // header and footer bands; the map fills the rest
  const MAP_Y = HEAD, MAP_H = H - HEAD - FOOT;
  const BRAND = { navy: '#0c2d4f', navy2: '#081f38', red: '#e5322d', cream: '#f3e6d3', ink: '#0b1726' };

  // NWS standard hazard colours (weather.gov hazards map).
  const HAZARD_COLORS = {
    'Tornado Warning': '#FF0000', 'Extreme Wind Warning': '#FF8C00', 'Severe Thunderstorm Warning': '#FFA500',
    'Flash Flood Warning': '#8B0000', 'Flash Flood Watch': '#2E8B57', 'Flood Warning': '#00FF00',
    'Flood Advisory': '#00FF7F', 'Flood Watch': '#2E8B57', 'Red Flag Warning': '#FF1493',
    'Fire Weather Watch': '#FFDEAD', 'Fire Warning': '#A0522D', 'High Wind Warning': '#DAA520',
    'High Wind Watch': '#B8860B', 'Wind Advisory': '#D2B48C', 'Excessive Heat Warning': '#C71585',
    'Extreme Heat Warning': '#C71585', 'Excessive Heat Watch': '#800000', 'Extreme Heat Watch': '#800000',
    'Heat Advisory': '#FF7F50', 'Dense Fog Advisory': '#708090', 'Dense Smoke Advisory': '#F0E68C',
    'High Surf Warning': '#228B22', 'High Surf Advisory': '#BA55D3', 'Beach Hazards Statement': '#40E0D0',
    'Rip Current Statement': '#40E0D0', 'Coastal Flood Warning': '#228B22', 'Coastal Flood Advisory': '#7CFC00', 'Coastal Flood Watch': '#66CDAA', 'Coastal Flood Statement': '#6B8E23',
    'Tsunami Warning': '#FD6347', 'Tsunami Advisory': '#D2691E', 'Winter Storm Warning': '#FF69B4',
    'Winter Weather Advisory': '#7B68EE', 'Frost Advisory': '#6495ED', 'Freeze Warning': '#483D8B',
    'Air Quality Alert': '#808080', 'Special Weather Statement': '#FFE4B5', 'Lake Wind Advisory': '#D2B48C',
    'Blowing Dust Advisory': '#BDB76B', 'Small Craft Advisory': '#D8BFD8', 'Gale Warning': '#DDA0DD',
  };
  const FALLBACK_COLOR = '#00B4FF';
  function hazardColor(event) { return HAZARD_COLORS[event] || FALLBACK_COLOR; }

  // Which template a warning uses: decides the facts shown and whether radar matters.
  function warningType(event) {
    const e = String(event || '').toLowerCase();
    if (/red flag|fire weather|fire warning/.test(e)) return 'fire';
    if (/wind|dust/.test(e)) return 'wind';
    if (/heat/.test(e)) return 'heat';
    if (/surf|rip current|beach|coastal|tsunami|marine|small craft|gale/.test(e)) return 'coast';   // before "flood": Coastal Flood …
    if (/flood|thunderstorm|tornado|rain|winter|snow/.test(e)) return 'rain';
    if (/fog|smoke/.test(e)) return 'fog';
    return 'other';
  }

  // Readable text on a coloured band.
  function textOn(hex) {
    const n = parseInt(String(hex).replace('#', ''), 16);
    const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    return lum > 0.6 ? BRAND.ink : '#ffffff';
  }

  const TZ = 'America/Los_Angeles';
  const dayClock = (t) => new Date(t).toLocaleString('en-US', { weekday: 'short', hour: 'numeric', minute: '2-digit', timeZone: TZ });
  const clock = (t) => new Date(t).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: TZ });

  // "Orange County Coastal Areas; Orange County Inland Areas; …" → short list for captions.
  function shortAreas(areaDesc, max) {
    const parts = String(areaDesc || '').split(';').map((s) => s.trim()).filter(Boolean);
    const n = max || 3;
    if (parts.length <= n) return parts.join(', ');
    return parts.slice(0, n).join(', ') + ' and ' + (parts.length - n) + ' more';
  }
  function office(senderName) {
    const s = String(senderName || '').replace(/^NWS\s+/i, '').trim();
    return s ? 'NWS ' + s : 'National Weather Service';
  }

  // Caption for X (≤ 280 characters). Facts only from the NWS alert; nothing added or reworded.
  function alertCaption(p, tags) {
    const until = p.expires || p.ends;
    const head = `${p.event} for ${shortAreas(p.areaDesc, 3)}${until ? ' until ' + dayClock(until) : ''}.`;
    const src = `Source: ${office(p.senderName)}`;
    const tail = tags === undefined ? '#OCWeather' : tags;
    let text = [head, src, tail].filter(Boolean).join('\n');
    if (text.length > 280) text = [`${p.event} for ${shortAreas(p.areaDesc, 1)}${until ? ' until ' + dayClock(until) : ''}.`, src, tail].filter(Boolean).join('\n');
    return text.slice(0, 280);
  }
  function fireCaption(f) {
    const size = f.acres ? `${Math.round(f.acres).toLocaleString('en-US')} acres` : 'size not yet reported';
    const pct = f.pct !== null && f.pct !== undefined ? `${Math.round(f.pct)}% contained` : 'containment not yet reported';
    return `${f.name} fire${f.county ? ', ' + f.county + ' County' : ''}: ${size}, ${pct}.\nSource: NIFC incident data\n#OCFire`;
  }
  function stormCaption(s) {
    const label = s.status === 'crit' ? 'Critical' : s.status === 'warn' ? 'Elevated' : 'Normal';
    const peak = s.peak && s.peak.gust ? ` Peak gust ${Math.round(s.peak.gust)} mph at ${s.peak.name}.` : '';
    return `OC Storm Index: ${label}. ${s.crit} critical and ${s.warn} elevated of ${s.total} weather stations.${peak}\nSource: NWS/FAA stations via Iowa Environmental Mesonet\n#OCWeather`;
  }

  // ── Map maths (Web Mercator, 256 px tiles) ───────────────────────────────
  const lon2x = (lon, z) => ((lon + 180) / 360) * 256 * Math.pow(2, z);
  const lat2y = (lat, z) => {
    const r = (lat * Math.PI) / 180;
    return ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 256 * Math.pow(2, z);
  };
  // Largest whole zoom that fits bbox [w,s,e,n] in w×h pixels with padding.
  function fitView(bbox, w, h, opts) {
    const o = Object.assign({ minZ: 6, maxZ: 11, pad: 0.12 }, opts);
    const [west, south, east, north] = bbox;
    let z = o.maxZ;
    for (; z > o.minZ; z--) {
      const bw = lon2x(east, z) - lon2x(west, z), bh = lat2y(south, z) - lat2y(north, z);
      if (bw <= w * (1 - 2 * o.pad) && bh <= h * (1 - 2 * o.pad)) break;
    }
    const cx = (lon2x(west, z) + lon2x(east, z)) / 2, cy = (lat2y(north, z) + lat2y(south, z)) / 2;
    return { z, left: cx - w / 2, top: cy - h / 2, w, h };
  }
  function bboxOf(geoms) {
    let w = 180, s = 90, e = -180, n = -90, any = false;
    const walk = (c) => {
      if (typeof c[0] === 'number') { any = true; w = Math.min(w, c[0]); e = Math.max(e, c[0]); s = Math.min(s, c[1]); n = Math.max(n, c[1]); return; }
      c.forEach(walk);
    };
    geoms.filter(Boolean).forEach((g) => { if (g.coordinates) walk(g.coordinates); else if (g.geometries) g.geometries.forEach((x) => x && x.coordinates && walk(x.coordinates)); });
    return any ? [w, s, e, n] : null;
  }
  // Keep views sensible: at least ~OC-sized, never wider than SoCal.
  const OC_BBOX = [-118.13, 33.38, -117.41, 33.95];
  const SOCAL_BBOX = [-120.7, 32.5, -114.1, 35.8];
  function clampBbox(b) {
    if (!b) return OC_BBOX.slice();
    let [w, s, e, n] = b;
    w = Math.max(w, SOCAL_BBOX[0]); s = Math.max(s, SOCAL_BBOX[1]); e = Math.min(e, SOCAL_BBOX[2]); n = Math.min(n, SOCAL_BBOX[3]);
    if (e <= w || n <= s) return OC_BBOX.slice();
    const minW = 0.5, minH = 0.35;
    if (e - w < minW) { const c = (e + w) / 2; w = c - minW / 2; e = c + minW / 2; }
    if (n - s < minH) { const c = (n + s) / 2; s = c - minH / 2; n = c + minH / 2; }
    return [w, s, e, n];
  }

  const pure = { W, H, HAZARD_COLORS, hazardColor, warningType, textOn, shortAreas, office, alertCaption, fireCaption, stormCaption, fitView, bboxOf, clampBbox, lon2x, lat2y, OC_BBOX };

  // Node (tests) stops here.
  if (typeof document === 'undefined') { if (typeof module !== 'undefined') module.exports = pure; return; }

  // ── Browser drawing ──────────────────────────────────────────────────────
  const ESRI = 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/';
  const TILES = {
    base: (z, x, y) => `${ESRI}World_Dark_Gray_Base/MapServer/tile/${z}/${y}/${x}`,
    labels: (z, x, y) => `${ESRI}World_Dark_Gray_Reference/MapServer/tile/${z}/${y}/${x}`,
    radar: (z, x, y) => `https://mesonet.agron.iastate.edu/cache/tile.py/1.0.0/nexrad-n0q-900913/${z}/${x}/${y}.png`,
  };

  function loadImg(url, ms) {
    return new Promise((resolve) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      const t = setTimeout(() => { img.src = ''; resolve(null); }, ms || 10000);
      img.onload = () => { clearTimeout(t); resolve(img); };
      img.onerror = () => { clearTimeout(t); resolve(null); };
      img.src = url;
    });
  }
  async function getJSON(url, ms) {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), ms || 10000);
    try {
      const r = await fetch(url, { signal: ctl.signal, headers: { Accept: 'application/geo+json, application/json' } });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return await r.json();
    } finally { clearTimeout(t); }
  }

  // Draws one tile layer; returns how many tiles loaded (so missing radar can be reported).
  async function drawLayer(ctx, view, urlFn, alpha, cacheBust) {
    const n = Math.pow(2, view.z);
    const x0 = Math.floor(view.left / 256), x1 = Math.floor((view.left + view.w) / 256);
    const y0 = Math.max(0, Math.floor(view.top / 256)), y1 = Math.min(n - 1, Math.floor((view.top + view.h) / 256));
    const jobs = [];
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) {
      const tx = ((x % n) + n) % n;
      const url = urlFn(view.z, tx, y) + (cacheBust ? (urlFn(view.z, tx, y).includes('?') ? '&' : '?') + cacheBust : '');
      jobs.push(loadImg(url).then((img) => ({ img, x, y })));
    }
    const tiles = await Promise.all(jobs);
    ctx.save();
    ctx.globalAlpha = alpha === undefined ? 1 : alpha;
    let ok = 0;
    for (const t of tiles) if (t.img) { ok++; ctx.drawImage(t.img, Math.round(t.x * 256 - view.left), Math.round(MAP_Y + t.y * 256 - view.top), 256, 256); }
    ctx.restore();
    return { ok, total: tiles.length };
  }

  const px = (view, lon, lat) => [lon2x(lon, view.z) - view.left, MAP_Y + lat2y(lat, view.z) - view.top];

  function tracePolys(ctx, view, geom) {
    const ring = (r) => r.forEach(([lon, lat], i) => { const [x, y] = px(view, lon, lat); if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); });
    const poly = (p) => p.forEach((r) => { ring(r); ctx.closePath(); });
    if (!geom) return;
    if (geom.type === 'Polygon') poly(geom.coordinates);
    else if (geom.type === 'MultiPolygon') geom.coordinates.forEach(poly);
    else if (geom.type === 'GeometryCollection') geom.geometries.forEach((g) => tracePolys(ctx, view, g));
  }
  function drawShapes(ctx, view, geoms, color) {
    if (!geoms.length) return;
    ctx.save();
    ctx.beginPath();
    geoms.forEach((g) => tracePolys(ctx, view, g));
    ctx.fillStyle = color; ctx.globalAlpha = 0.26; ctx.fill('evenodd');
    ctx.globalAlpha = 1; ctx.lineJoin = 'round';
    ctx.strokeStyle = 'rgba(0,0,0,.55)'; ctx.lineWidth = 7; ctx.stroke();
    ctx.strokeStyle = color; ctx.lineWidth = 3.5; ctx.stroke();
    ctx.restore();
  }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }
  function fitText(ctx, text, maxW, size, weight, family) {
    let s = size;
    do { ctx.font = `${weight} ${s}px ${family}`; s -= 2; } while (ctx.measureText(text).width > maxW && s > 18);
    return ctx.font;
  }
  function wrap(ctx, text, maxW) {
    const words = String(text).split(/\s+/); const lines = []; let line = '';
    for (const w of words) { const t = line ? line + ' ' + w : w; if (ctx.measureText(t).width > maxW && line) { lines.push(line); line = w; } else line = t; }
    if (line) lines.push(line);
    return lines;
  }

  let logoImg = null;
  async function logo() {
    if (logoImg) return logoImg;
    logoImg = await loadImg('assets/oc-scanner-logo.png', 8000);
    return logoImg;
  }
  async function fontsReady() {
    try {
      await Promise.all(['700 64px Rajdhani', '600 30px "Barlow Condensed"', '700 30px "Barlow Condensed"', '400 22px "Share Tech Mono"'].map((f) => document.fonts.load(f)));
    } catch (e) { /* system fonts are fine */ }
  }
  const F = { head: 'Rajdhani, "Barlow Condensed", system-ui, sans-serif', body: '"Barlow Condensed", system-ui, sans-serif', mono: '"Share Tech Mono", ui-monospace, monospace' };

  async function radarTime() {
    try {
      const j = await getJSON('https://mesonet.agron.iastate.edu/data/gis/images/4326/USCOMP/n0q_0.json', 6000);
      return j && j.meta && j.meta.valid ? j.meta.valid : null;
    } catch (e) { return null; }
  }

  /* spec: { color, kicker, title, subtitle, bbox, shapes:[geojson], points:[{lon,lat,label,color,big}],
             facts:[[label,value]], chips:[{label,value,color}], radar:bool, credit, footRight } */
  async function render(spec) {
    await fontsReady();
    const canvas = document.createElement('canvas');
    canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext('2d');
    const color = spec.color || FALLBACK_COLOR;

    // Map
    ctx.fillStyle = '#1b1f24'; ctx.fillRect(0, MAP_Y, W, MAP_H);
    const view = fitView(clampBbox(spec.bbox), W, MAP_H, { maxZ: spec.maxZ || 11 });
    ctx.save(); ctx.beginPath(); ctx.rect(0, MAP_Y, W, MAP_H); ctx.clip();
    await drawLayer(ctx, view, TILES.base, 1);
    let radar = null, radarAt = null;
    if (spec.radar !== false) {
      const bust = 't=' + Math.floor(Date.now() / 300000);            // new radar every 5 min
      [radar, radarAt] = await Promise.all([drawLayer(ctx, view, TILES.radar, 0.85, bust), radarTime()]);
    }
    drawShapes(ctx, view, spec.shapes || [], color);
    await drawLayer(ctx, view, TILES.labels, 0.95);
    for (const p of spec.points || []) {
      const [x, y] = px(view, p.lon, p.lat);
      if (x < -20 || x > W + 20 || y < MAP_Y - 20 || y > MAP_Y + MAP_H + 20) continue;
      const r = p.big ? 16 : 9;
      ctx.beginPath(); ctx.arc(x, y, r + 4, 0, Math.PI * 2); ctx.fillStyle = 'rgba(0,0,0,.55)'; ctx.fill();
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fillStyle = p.color || color; ctx.fill();
      ctx.lineWidth = 2; ctx.strokeStyle = '#fff'; ctx.stroke();
      if (p.label) {
        ctx.font = `700 ${p.big ? 30 : 22}px ${F.body}`;
        const tw = ctx.measureText(p.label).width;
        const lx = Math.min(W - tw - 26, x + r + 10), ly = y - (p.big ? 22 : 16);
        ctx.fillStyle = 'rgba(8,16,26,.82)'; roundRect(ctx, lx - 8, ly, tw + 16, p.big ? 40 : 32, 6); ctx.fill();
        ctx.fillStyle = '#fff'; ctx.textBaseline = 'top'; ctx.fillText(p.label, lx, ly + (p.big ? 5 : 4));
      }
    }
    ctx.restore();

    // Facts panel (bottom-left of the map)
    const facts = (spec.facts || []).filter((f) => f && f[1]);
    const chips = spec.chips || [];
    if (facts.length || chips.length) {
      const pw = 560, lineH = 34;
      ctx.font = `600 26px ${F.body}`;
      const factLines = facts.map(([k, v]) => ({ k, lines: wrap(ctx, v, pw - 170).slice(0, 2) }));
      const ph = 28 + factLines.reduce((n, f) => n + f.lines.length * lineH + 6, 0) + (chips.length ? 20 + Math.ceil(chips.length / 2) * 66 : 0);
      const pxL = 28, pyT = MAP_Y + MAP_H - ph - 26;
      ctx.fillStyle = 'rgba(6,14,24,.86)'; roundRect(ctx, pxL, pyT, pw, ph, 14); ctx.fill();
      ctx.fillStyle = color; ctx.fillRect(pxL, pyT + 14, 6, ph - 28);
      let y = pyT + 20;
      ctx.textBaseline = 'top';
      for (const f of factLines) {
        ctx.font = `700 22px ${F.mono}`; ctx.fillStyle = '#9fb7c8'; ctx.fillText(String(f.k).toUpperCase(), pxL + 26, y + 5);
        ctx.font = `600 28px ${F.body}`; ctx.fillStyle = '#fff';
        f.lines.forEach((l, i) => ctx.fillText(l, pxL + 170, y + i * lineH));
        y += f.lines.length * lineH + 6;
      }
      if (chips.length) {
        y += 12;
        chips.slice(0, 6).forEach((c, i) => {
          const cx = pxL + 26 + (i % 2) * 262, cy = y + Math.floor(i / 2) * 66;
          ctx.fillStyle = 'rgba(255,255,255,.07)'; roundRect(ctx, cx, cy, 246, 56, 8); ctx.fill();
          ctx.fillStyle = c.color || color; ctx.fillRect(cx, cy, 5, 56);
          ctx.font = fitText(ctx, c.label, 222, 19, 600, F.body); ctx.fillStyle = '#b8cddb'; ctx.fillText(c.label, cx + 16, cy + 6);
          ctx.font = fitText(ctx, c.value, 222, 26, 700, F.body); ctx.fillStyle = '#fff'; ctx.fillText(c.value, cx + 16, cy + 26);
        });
      }
    }

    // Radar legend + time (bottom-right of the map)
    if (radar && radar.ok) {
      const lx = W - 360, ly = MAP_Y + MAP_H - 70;
      ctx.fillStyle = 'rgba(6,14,24,.86)'; roundRect(ctx, lx - 16, ly - 14, 348, 62, 10); ctx.fill();
      const stops = ['#04e9e7', '#019ff4', '#02fd02', '#01c501', '#fdf802', '#fd9500', '#fd0000', '#bc0000', '#f800fd'];
      stops.forEach((c, i) => { ctx.fillStyle = c; ctx.fillRect(lx + i * 26, ly + 22, 26, 12); });
      ctx.font = `600 18px ${F.body}`; ctx.fillStyle = '#cfe0ea'; ctx.textBaseline = 'top';
      ctx.fillText(`Radar${radarAt ? ' · ' + clock(radarAt) : ''}`, lx, ly - 4);
      ctx.fillText('light → heavy', lx + 236, ly + 18);
    }

    // Header band
    const g = ctx.createLinearGradient(0, 0, W, 0); g.addColorStop(0, BRAND.navy2); g.addColorStop(1, BRAND.navy);
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, HEAD);
    ctx.fillStyle = color; ctx.fillRect(0, HEAD - 12, W, 12);
    const lg = await logo();
    ctx.fillStyle = BRAND.cream; roundRect(ctx, 24, 18, 108, 108, 16); ctx.fill();
    if (lg) ctx.drawImage(lg, 235, 90, 555, 580, 34, 22, 88, 92);           // the shield from the logo
    ctx.textBaseline = 'alphabetic';
    ctx.font = `700 24px ${F.mono}`; ctx.fillStyle = BRAND.red;
    ctx.fillText('OC_SCANNER', 156, 50);
    ctx.fillStyle = '#9fb7c8'; ctx.font = `600 24px ${F.body}`;
    ctx.fillText(spec.kicker ? '  ·  ' + spec.kicker.toUpperCase() : '', 156 + ctx.measureText('OC_SCANNER').width + 20, 50);
    ctx.font = fitText(ctx, spec.title, W - 200, 66, 700, F.head);
    ctx.fillStyle = '#ffffff'; ctx.fillText(spec.title, 154, 112);
    // Colour tag with the warning name, top right
    if (spec.tag) {
      ctx.font = `700 26px ${F.body}`;
      const tw = ctx.measureText(spec.tag).width + 36;
      ctx.fillStyle = color; roundRect(ctx, W - tw - 28, 26, tw, 44, 8); ctx.fill();
      ctx.fillStyle = textOn(color); ctx.textBaseline = 'middle'; ctx.fillText(spec.tag, W - tw - 10, 49);
      ctx.textBaseline = 'alphabetic';
    }
    if (spec.subtitle) {
      ctx.font = fitText(ctx, spec.subtitle, 640, 26, 600, F.body);
      ctx.fillStyle = '#cfe0ea'; ctx.textAlign = 'right'; ctx.fillText(spec.subtitle, W - 28, 112); ctx.textAlign = 'left';
    }

    // Footer band
    ctx.fillStyle = BRAND.cream; ctx.fillRect(0, H - FOOT, W, FOOT);
    ctx.fillStyle = BRAND.red; ctx.fillRect(0, H - FOOT, W, 4);
    ctx.textBaseline = 'middle';
    ctx.font = `700 28px ${F.head}`; ctx.fillStyle = BRAND.navy; ctx.fillText('ocscanner.media', 28, H - FOOT / 2 + 2);
    ctx.font = `600 21px ${F.body}`; ctx.fillStyle = '#3c4d5e';
    const credit = spec.credit || 'Radar: NOAA/NWS via Iowa Environmental Mesonet · Map: Esri';
    ctx.textAlign = 'right';
    ctx.fillText(`${credit} · Made ${dayClock(Date.now())} PT`, W - 28, H - FOOT / 2 + 2);
    ctx.textAlign = 'left';

    const blob = await new Promise((res) => canvas.toBlob(res, 'image/png'));
    return { blob, radarOk: !radar || radar.ok > 0 };
  }

  // NWS alert geometry: the polygon when there is one, otherwise its forecast/fire zones.
  async function alertShapes(feature) {
    if (feature.geometry) return [feature.geometry];
    const zones = ((feature.properties && feature.properties.affectedZones) || []).slice(0, 14);
    const out = await Promise.all(zones.map((u) => getJSON(u, 9000).then((z) => z.geometry).catch(() => null)));
    return out.filter(Boolean);
  }

  function slug(s) { return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40); }
  function stamp() {
    const d = new Date(); const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
  }

  // ── Card kinds ───────────────────────────────────────────────────────────
  async function alertCard(feature, ctx) {
    const p = feature.properties || {};
    const type = warningType(p.event);
    const color = hazardColor(p.event);
    const shapes = await alertShapes(feature);
    const bbox = bboxOf(shapes) || OC_BBOX;
    const st = (ctx && ctx.stations || []).filter((s) => s.ok && s.status !== 'off');
    let chips = [];
    if (type === 'fire') chips = st.slice().sort((a, b) => (b.gust || 0) - (a.gust || 0)).slice(0, 4).map((s) => ({ label: s.name, value: `${s.gust ? 'Gust ' + Math.round(s.gust) : 'Wind ' + Math.round(s.wind || 0)} mph · ${s.rh !== null && s.rh !== undefined ? Math.round(s.rh) + '% RH' : 'RH —'}` }));
    else if (type === 'wind') chips = st.slice().sort((a, b) => (b.gust || 0) - (a.gust || 0)).slice(0, 4).map((s) => ({ label: s.name, value: s.gust ? `Gusts ${Math.round(s.gust)} mph` : `Wind ${Math.round(s.wind || 0)} mph` }));
    else if (type === 'heat') chips = st.slice().sort((a, b) => (b.temp || 0) - (a.temp || 0)).slice(0, 4).map((s) => ({ label: s.name, value: s.temp !== null && s.temp !== undefined ? `${Math.round(s.temp)}°F now` : '—' }));
    const until = p.expires || p.ends;
    const res = await render({
      color, tag: p.event, kicker: 'Weather alert', title: p.event,
      subtitle: until ? 'Until ' + dayClock(until) : (p.severity || ''),
      bbox, shapes, radar: type === 'rain' || type === 'other' || type === 'wind' || type === 'fire',
      facts: [['Areas', shortAreas(p.areaDesc, 4)], ['Until', until ? dayClock(until) : ''], ['Issued by', office(p.senderName)]],
      chips: chips.map((c) => Object.assign({ color }, c)),
    });
    return Object.assign(res, { caption: alertCaption(p), filename: `ocscanner-${slug(p.event)}-${stamp()}.png`, alt: `${p.event} for ${shortAreas(p.areaDesc, 6)}${until ? ' until ' + dayClock(until) : ''}. Map of the warning area.` });
  }

  async function fireCard(f) {
    const color = '#ff5a1f';
    const has = f.lon !== undefined && f.lat !== undefined && f.lon !== null;
    const bbox = has ? [f.lon - 0.35, f.lat - 0.25, f.lon + 0.35, f.lat + 0.25] : OC_BBOX;
    const res = await render({
      color, tag: 'Wildfire', kicker: 'Fire', title: `${f.name} Fire`,
      subtitle: f.county ? f.county + ' County' : '', bbox, radar: false, maxZ: 11,
      points: has ? [{ lon: f.lon, lat: f.lat, label: f.name, color, big: true }] : [],
      facts: [['Size', f.acres ? Math.round(f.acres).toLocaleString('en-US') + ' acres' : 'Not yet reported'],
        ['Contained', f.pct !== null && f.pct !== undefined ? Math.round(f.pct) + '%' : 'Not yet reported'],
        ['Reported', f.found ? dayClock(f.found) : '']],
      credit: 'Fire data: NIFC · Map: Esri',
    });
    return Object.assign(res, { caption: fireCaption(f), filename: `ocscanner-fire-${slug(f.name)}-${stamp()}.png`, alt: `Map of the ${f.name} fire${f.county ? ' in ' + f.county + ' County' : ''}.` });
  }

  async function stormCard(s, stations) {
    s = Object.assign({ total: (stations || []).length }, s);
    const label = s.status === 'crit' ? 'Critical' : s.status === 'warn' ? 'Elevated' : 'Normal';
    const color = s.status === 'crit' ? '#ff3b30' : s.status === 'warn' ? '#ffb700' : '#00c46a';
    const STC = { crit: '#ff3b30', warn: '#ffb700', ok: '#00c46a', off: '#6b7b88' };
    const pts = (stations || []).filter((x) => x.lon !== undefined && x.lat !== undefined && x.lon !== null).map((x) => ({
      lon: x.lon, lat: x.lat, color: STC[x.status] || STC.off,
      label: x.status === 'crit' || x.status === 'warn' ? `${x.gust ? 'gust ' + Math.round(x.gust) : 'wind ' + Math.round(x.wind || 0)} mph${x.rh !== null && x.rh !== undefined ? ' · ' + Math.round(x.rh) + '% RH' : ''}` : '',
    }));
    const res = await render({
      color, tag: label, kicker: 'Storm Index', title: `Orange County conditions: ${label}`,
      subtitle: `${s.crit} critical · ${s.warn} elevated of ${s.total} stations`,
      bbox: [-118.3, 33.15, -116.95, 34.12], radar: true, points: pts,
      facts: [['Peak gust', s.peak && s.peak.gust ? `${Math.round(s.peak.gust)} mph at ${s.peak.name}` : ''], ['Stations', `${s.crit} critical · ${s.warn} elevated · ${s.total - s.crit - s.warn} normal or no report`]],
      credit: 'Stations & radar: NOAA/NWS/FAA via Iowa Environmental Mesonet · Map: Esri',
    });
    return Object.assign(res, { caption: stormCaption(s), filename: `ocscanner-storm-index-${stamp()}.png`, alt: `Orange County Storm Index map: ${label}.` });
  }

  root.WxCard = Object.assign({ render, alertCard, fireCard, stormCard }, pure);
})(typeof window !== 'undefined' ? window : globalThis);
