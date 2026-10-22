// Builds the county map shapes and the county-name lookup the Worker uses.
// Run: cd elections/tools && npm install && node build-counties.mjs
// Outputs:
//   elections/data/counties/XX.json        one file per state: {bbox, counties:{fips:{n,d}}}, in the US map's coordinates
//   elections/worker/src/county-fips.json  {XX: {nameKey: fips}} for matching state files' county names
import { mkdirSync, writeFileSync } from 'node:fs';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { geoAlbersUsa, geoPath } from 'd3-geo';
import { feature } from 'topojson-client';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, '..', 'data', 'counties');
mkdirSync(outDir, { recursive: true });

const FIPS = {'01':'AL','02':'AK','04':'AZ','05':'AR','06':'CA','08':'CO','09':'CT','10':'DE','11':'DC','12':'FL','13':'GA','15':'HI','16':'ID','17':'IL','18':'IN','19':'IA','20':'KS','21':'KY','22':'LA','23':'ME','24':'MD','25':'MA','26':'MI','27':'MN','28':'MS','29':'MO','30':'MT','31':'NE','32':'NV','33':'NH','34':'NJ','35':'NM','36':'NY','37':'NC','38':'ND','39':'OH','40':'OK','41':'OR','42':'PA','44':'RI','45':'SC','46':'SD','47':'TN','48':'TX','49':'UT','50':'VT','51':'VA','53':'WA','54':'WV','55':'WI','56':'WY'};

// Same key rules as worker/src/feeds/county-names.js (kept in sync by the test there).
function countyKey(name, indepCity) {
  let s = String(name || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim().replace(/-/g, ' ').replace(/\s+/g, ' ');
  s = s.replace(/^(saint|ste?\.?) /, 'st ').replace(/[^a-z]/g, '');
  return indepCity ? `${s}~city` : s;
}
// Independent cities carry FIPS codes 510 and up (Virginia), plus Baltimore, St. Louis and Carson City.
const isIndepCity = (id) => (id.startsWith('51') && +id.slice(2) >= 510) || id === '24510' || id === '29510' || id === '32510';

const topo = JSON.parse(readFileSync(join(here, 'node_modules/us-atlas/counties-10m.json'), 'utf8'));
const counties = feature(topo, topo.objects.counties).features;
const states = feature(topo, topo.objects.states).features;

// Counties use the national map's own projection (same as us-states.json), so the board can zoom the
// US map straight into a state. Small states keep an extra decimal so they stay crisp when zoomed.
const proj = geoAlbersUsa().scale(1280).translate([480, 300]);
const path = geoPath(proj);
const names = {};
let total = 0, bytes = 0;
for (const sf of states) {
  const st = FIPS[sf.id];
  if (!st) continue;
  const [[x0, y0], [x1, y1]] = path.bounds(sf);
  const size = Math.max(x1 - x0, y1 - y0);
  const re = size < 60 ? /(\d+\.\d{3})\d+/g : size < 160 ? /(\d+\.\d{2})\d+/g : /(\d+\.\d)\d+/g;
  const out = {};
  names[st] = {};
  for (const f of counties.filter(c => c.id.slice(0, 2) === sf.id)) {
    const d = path(f);
    if (!d) continue;
    out[f.id] = { n: f.properties.name + (isIndepCity(f.id) ? ' (city)' : ''), d: d.replace(re, '$1') };
    names[st][countyKey(f.properties.name, isIndepCity(f.id))] = f.id;
    total++;
  }
  const r = v => Math.round(v * 10) / 10;
  const json = JSON.stringify({ st, bbox: [r(x0), r(y0), r(x1), r(y1)], counties: out });
  writeFileSync(join(outDir, `${st}.json`), json);
  bytes += json.length;
}
writeFileSync(join(here, '..', 'worker', 'src', 'county-fips.json'), JSON.stringify(names));
console.log(`counties ${total} in ${Object.keys(names).length} states, ${(bytes / 1024).toFixed(0)} KB of shapes`);
