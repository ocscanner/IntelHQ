// Builds the House district map shapes: elections/data/districts/XX.json, one small file per state.
// Run (needs internet access to the Census Bureau): cd elections/tools && npm install && node build-districts.mjs
// GitHub runs this for you: Actions → "Build district maps" → Run workflow.
//
// Source: Census TIGERweb, "120th Congressional Districts" layer — the districts for the Nov 2026 election.
// Don't switch to the "119th" files: those are the 2024 lines, before Texas, California, Missouri,
// North Carolina, Ohio, Utah, Florida, Tennessee, Louisiana and Alabama redrew for 2026.
// (Virginia's 2026 map was blocked in court, so its 2024 lines stand; the Census layer reflects that.)
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { geoAlbersUsa, geoPath, geoArea } from 'd3-geo';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, '..', 'data', 'districts');
mkdirSync(outDir, { recursive: true });
const LAYER = 'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/Legislative/MapServer/0/query';

const FIPS = {'01':'AL','02':'AK','04':'AZ','05':'AR','06':'CA','08':'CO','09':'CT','10':'DE','12':'FL','13':'GA','15':'HI','16':'ID','17':'IL','18':'IN','19':'IA','20':'KS','21':'KY','22':'LA','23':'ME','24':'MD','25':'MA','26':'MI','27':'MN','28':'MS','29':'MO','30':'MT','31':'NE','32':'NV','33':'NH','34':'NJ','35':'NM','36':'NY','37':'NC','38':'ND','39':'OH','40':'OK','41':'OR','42':'PA','44':'RI','45':'SC','46':'SD','47':'TN','48':'TX','49':'UT','50':'VT','51':'VA','53':'WA','54':'WV','55':'WI','56':'WY'};
const SEATS = {AL:7,AK:1,AZ:9,AR:4,CA:52,CO:8,CT:5,DE:1,FL:28,GA:14,HI:2,ID:2,IL:17,IN:9,IA:4,KS:4,KY:6,LA:6,ME:2,MD:8,MA:9,
  MI:13,MN:8,MS:4,MO:8,MT:2,NE:3,NV:4,NH:2,NJ:12,NM:3,NY:26,NC:14,ND:1,OH:15,OK:5,OR:6,PA:17,RI:2,SC:7,SD:1,TN:9,TX:38,UT:4,
  VT:1,VA:11,WA:10,WV:2,WI:8,WY:1};

// Same projection as the US map and the county files, so the board can zoom straight in.
const proj = geoAlbersUsa().scale(1280).translate([480, 300]);
const path = geoPath(proj);
// A path that skips points closer than `tol` map units to the last one kept (invisible even fully zoomed)
function lightPath(tol) {
  return geoPath({
    stream(out) {
      let last = null;
      return proj.stream({
        point(x, y) { if (last && Math.hypot(x - last[0], y - last[1]) < tol) return; last = [x, y]; out.point(x, y); },
        lineStart() { last = null; out.lineStart(); },
        lineEnd() { out.lineEnd(); },
        polygonStart() { out.polygonStart(); },
        polygonEnd() { out.polygonEnd(); },
        sphere() { out.sphere?.(); },
      });
    },
  });
}

// GeoJSON from the Census winds outer rings counterclockwise; d3 reads that as "everything except this
// district". Flip any polygon that comes out larger than a hemisphere.
function rewind(f) {
  const g = f.geometry;
  const polys = g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : [];
  for (const rings of polys) {
    if (geoArea({ type: 'Polygon', coordinates: rings }) > 2 * Math.PI) rings.forEach(r => r.reverse());
  }
}

async function fetchState(fp) {
  const params = new URLSearchParams({
    where: `STATE='${fp}'`, outFields: 'STATE,CD120,BASENAME', returnGeometry: 'true',
    outSR: '4326', maxAllowableOffset: '0.003', geometryPrecision: '5', f: 'geojson',
  });
  for (let tries = 1; ; tries++) {
    try {
      const r = await fetch(`${LAYER}?${params}`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = await r.json();
      if (!Array.isArray(j.features)) throw new Error(j.error?.message || 'no features');
      return j.features;
    } catch (e) {
      if (tries >= 4) throw e;
      await new Promise(res => setTimeout(res, 3000 * tries));
    }
  }
}

const SMALL_STATES = new Set(['RI', 'DE', 'CT', 'NJ', 'MD', 'MA', 'NH', 'VT', 'HI']);
const problems = [];
let total = 0, bytes = 0;
for (const [fp, st] of Object.entries(FIPS)) {
  let feats;
  try { feats = await fetchState(fp); }
  catch (e) { problems.push(`${st}: download failed (${e.message}); kept the existing file`); continue; }
  const districts = {};
  let bounds = [[Infinity, Infinity], [-Infinity, -Infinity]];
  for (const f of feats) {
    const cd = String(f.properties.CD120 ?? f.properties.BASENAME ?? '').trim();
    if (!/^\d+$/.test(cd) || cd === '98' || cd === '99') continue;     // 98/99 = non-voting / water
    const n = parseInt(cd, 10);
    const id = n === 0 ? `${st}-AL` : `${st}-${String(n).padStart(2, '0')}`;
    rewind(f);
    if (!path(f)) continue;
    const [[x0, y0], [x1, y1]] = path.bounds(f);
    bounds = [[Math.min(bounds[0][0], x0), Math.min(bounds[0][1], y0)], [Math.max(bounds[1][0], x1), Math.max(bounds[1][1], y1)]];
    const size = Math.max(x1 - x0, y1 - y0);
    const re = size < 6 ? /(\d+\.\d{3})\d+/g : size < 15 ? /(\d+\.\d{2})\d+/g : /(\d+\.\d)\d+/g;
    const stSize = SMALL_STATES.has(st) ? 0.03 : 0.15;          // map units; the US map is 960 wide
    const d = lightPath(Math.min(stSize, size / 50))(f) || path(f);
    const [cx, cy] = path.centroid(f);
    districts[id] = { n: n || 'AL', d: d.replace(re, '$1'), c: [Math.round(cx * 10) / 10, Math.round(cy * 10) / 10], s: Math.round(size * 10) / 10 };
  }
  const count = Object.keys(districts).length;
  if (count !== SEATS[st]) { problems.push(`${st}: expected ${SEATS[st]} districts, got ${count}; kept the existing file`); continue; }
  const r = v => Math.round(v * 10) / 10;
  const json = JSON.stringify({ st, source: 'Census TIGERweb, 120th Congressional Districts (2026 election)', bbox: [r(bounds[0][0]), r(bounds[0][1]), r(bounds[1][0]), r(bounds[1][1])], districts });
  writeFileSync(join(outDir, `${st}.json`), json);
  total += count; bytes += json.length;
}
console.log(`districts ${total} of 435, ${(bytes / 1024).toFixed(0)} KB`);
if (problems.length) { console.error(problems.join('\n')); if (!existsSync(join(outDir, 'TX.json'))) process.exit(1); }
