// Builds the county map shapes and the county-name lookup the Worker uses.
// Run: cd elections/tools && npm install && node build-counties.mjs
// Outputs:
//   elections/data/counties/XX.json        one file per state: {viewBox, counties:{fips:{n,d}}}
//   elections/worker/src/county-fips.json  {XX: {nameKey: fips}} for matching state files' county names
import { mkdirSync, writeFileSync } from 'node:fs';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { geoAlbersUsa, geoConicEqualArea, geoPath } from 'd3-geo';
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

const W = 600, H = 420;
const names = {};
let total = 0, bytes = 0;
for (const sf of states) {
  const st = FIPS[sf.id];
  if (!st) continue;
  // Alaska crosses the date line; give it its own conic projection. Everything else fits fine in Albers USA.
  const proj = st === 'AK'
    ? geoConicEqualArea().rotate([154, 0]).center([0, 62]).parallels([55, 65]).fitSize([W, H], sf)
    : st === 'HI'
      ? geoConicEqualArea().rotate([157, 0]).center([0, 20.5]).parallels([19, 22]).fitSize([W, H], sf)
      : geoAlbersUsa().fitSize([W, H], sf);
  const path = geoPath(proj);
  const out = {};
  names[st] = {};
  for (const f of counties.filter(c => c.id.slice(0, 2) === sf.id)) {
    const d = path(f);
    if (!d) continue;
    out[f.id] = { n: f.properties.name + (isIndepCity(f.id) ? ' (city)' : ''), d: d.replace(/(\d+\.\d)\d+/g, '$1') };
    names[st][countyKey(f.properties.name, isIndepCity(f.id))] = f.id;
    total++;
  }
  const [[x0, y0], [x1, y1]] = path.bounds(sf);
  const pad = 6;
  const json = JSON.stringify({ st, viewBox: `${Math.floor(x0 - pad)} ${Math.floor(y0 - pad)} ${Math.ceil(x1 - x0 + pad * 2)} ${Math.ceil(y1 - y0 + pad * 2)}`, counties: out });
  writeFileSync(join(outDir, `${st}.json`), json);
  bytes += json.length;
}
writeFileSync(join(here, '..', 'worker', 'src', 'county-fips.json'), JSON.stringify(names));
console.log(`counties ${total} in ${Object.keys(names).length} states, ${(bytes / 1024).toFixed(0)} KB of shapes`);
