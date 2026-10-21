// Builds elections/data/races-2026.json and elections/data/us-states.json
// Run: node elections/tools/build-data.mjs
// Inputs: elections/data/src/{house,senate,governor}.txt  (Race|Candidates|Held by)
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { geoAlbersUsa, geoPath } from 'd3-geo';
import { feature } from 'topojson-client';

const here = dirname(fileURLToPath(import.meta.url));
const dataDir = join(here, '..', 'data');
const srcDir = join(dataDir, 'src');

export const STATES = {
  Alabama:'AL',Alaska:'AK',Arizona:'AZ',Arkansas:'AR',California:'CA',Colorado:'CO',Connecticut:'CT',Delaware:'DE',
  Florida:'FL',Georgia:'GA',Hawaii:'HI',Idaho:'ID',Illinois:'IL',Indiana:'IN',Iowa:'IA',Kansas:'KS',Kentucky:'KY',
  Louisiana:'LA',Maine:'ME',Maryland:'MD',Massachusetts:'MA',Michigan:'MI',Minnesota:'MN',Mississippi:'MS',Missouri:'MO',
  Montana:'MT',Nebraska:'NE',Nevada:'NV','New Hampshire':'NH','New Jersey':'NJ','New Mexico':'NM','New York':'NY','North Carolina':'NC',
  'North Dakota':'ND',Ohio:'OH',Oklahoma:'OK',Oregon:'OR',Pennsylvania:'PA','Rhode Island':'RI','South Carolina':'SC',
  'South Dakota':'SD',Tennessee:'TN',Texas:'TX',Utah:'UT',Vermont:'VT',Virginia:'VA',Washington:'WA','West Virginia':'WV',
  Wisconsin:'WI',Wyoming:'WY','District of Columbia':'DC'
};
// 2020 apportionment — used as a sanity check on the House list
const SEATS = {AL:7,AK:1,AZ:9,AR:4,CA:52,CO:8,CT:5,DE:1,FL:28,GA:14,HI:2,ID:2,IL:17,IN:9,IA:4,KS:4,KY:6,LA:6,ME:2,MD:8,MA:9,
  MI:13,MN:8,MS:4,MO:8,MT:2,NE:3,NV:4,NH:2,NJ:12,NM:3,NY:26,NC:14,ND:1,OH:15,OK:5,OR:6,PA:17,RI:2,SC:7,SD:1,TN:9,TX:38,UT:4,
  VT:1,VA:11,WA:10,WV:2,WI:8,WY:1};

const PARTY = { D:'D', R:'R', I:'I', L:'L', G:'G' };
const person = s => {
  const m = s.trim().match(/^(.*)\s+\(([A-Z])\)$/);
  return m ? { name: m[1].trim(), party: PARTY[m[2]] || m[2] } : null;
};
function parseHolder(s) {
  s = s.trim();
  if (!s || s === '–' || s === '-') return { name: null, party: null, open: true, vacant: true };
  const open = /,\s*open seat$/.test(s);
  const p = person(s.replace(/,\s*open seat$/, ''));
  return { name: p?.name ?? null, party: p?.party ?? null, open };
}
function parseCands(s) {
  if (!s.trim()) return [];
  return s.split(/\s+vs\.\s+|,\s+(?=[^,]+\([A-Z]\))/).map(person).filter(Boolean);
}
function lines(f) { return readFileSync(join(srcDir, f), 'utf8').trim().split('\n').map(l => l.split('|')); }

const races = [];
for (const [race, cands, held] of lines('house.txt')) {
  const m = race.match(/^(.+?) (\d+)(?:st|nd|rd|th) District$|^(.+?) At-Large District$/);
  const stateName = m[1] || m[3];
  const st = STATES[stateName];
  const district = m[2] ? +m[2] : 0;
  races.push({
    id: `${st}-${district ? String(district).padStart(2, '0') : 'AL'}`,
    chamber: 'house', state: st, stateName, district,
    name: district ? `${stateName} ${race.match(/\d+(st|nd|rd|th)/)[0]}` : `${stateName} At-Large`,
    holder: parseHolder(held), candidates: parseCands(cands),
  });
}
for (const [chamber, file, label] of [['senate', 'senate.txt', 'Senate'], ['governor', 'governor.txt', 'Governor']]) {
  for (const [race, cands, held] of lines(file)) {
    const special = /\(special\)/.test(race);
    const stateName = race.replace(/ (Senate|Governor).*$/, '');
    const st = STATES[stateName];
    races.push({
      id: `${st}-${chamber === 'senate' ? 'SEN' : 'GOV'}${special ? '-S' : ''}`,
      chamber, state: st, stateName, special,
      name: `${stateName} ${label}${special ? ' (special)' : ''}`,
      holder: parseHolder(held), candidates: parseCands(cands),
    });
  }
}

// ── Sanity checks ──
const errs = [];
const byState = {};
for (const r of races.filter(r => r.chamber === 'house')) byState[r.state] = (byState[r.state] || 0) + 1;
for (const [st, n] of Object.entries(SEATS)) if (byState[st] !== n) errs.push(`House ${st}: ${byState[st]} != ${n}`);
const ids = new Set();
for (const r of races) { if (!r.state) errs.push(`no state: ${r.name}`); if (ids.has(r.id)) errs.push(`dup ${r.id}`); ids.add(r.id); }
const count = (ch, p) => races.filter(r => r.chamber === ch && r.holder.party === p).length;
const totals = {
  house: races.filter(r => r.chamber === 'house').length,
  senate: races.filter(r => r.chamber === 'senate').length,
  governor: races.filter(r => r.chamber === 'governor').length,
};
console.log('races', totals);
console.log('House held  D', count('house', 'D'), 'R', count('house', 'R'), 'I', count('house', 'I'), 'vacant', races.filter(r => r.chamber === 'house' && r.holder.vacant).length);
console.log('Senate up held  D', count('senate', 'D'), 'R', count('senate', 'R'));
console.log('Gov up held  D', count('governor', 'D'), 'R', count('governor', 'R'));
console.log('races w/ candidates', races.filter(r => r.candidates.length).length);
if (errs.length) { console.error(errs.join('\n')); process.exit(1); }

// Seats NOT on the ballot this year. Senate figures match the Nov 2026 class (65 seats);
// governor figures are the 14 states without a 2026 race. Edit here if anything changes.
const notUp = {
  senate: { D: 32, R: 31, I: 2, note: 'Independents not up this year caucus with Democrats' },
  governor: { D: 6, R: 8, states: { DE: 'D', KY: 'D', NJ: 'D', NC: 'D', VA: 'D', WA: 'D', IN: 'R', LA: 'R', MS: 'R', MO: 'R', MT: 'R', ND: 'R', UT: 'R', WV: 'R' } },
};
const config = {
  election: '2026-11-03',
  majority: { house: 218, senate: 51, governor: 26 },
  // VP breaks Senate ties; a 50-50 split goes to the VP's party.
  senateTieBreak: 'R',
  totalSeats: { house: 435, senate: 100, governor: 50 },
  notUp,
};
writeFileSync(join(dataDir, 'races-2026.json'), JSON.stringify({ config, races }, null, 0));

// ── State shapes, pre-projected so the browser needs no map library ──
const FIPS = {'01':'AL','02':'AK','04':'AZ','05':'AR','06':'CA','08':'CO','09':'CT','10':'DE','11':'DC','12':'FL','13':'GA','15':'HI','16':'ID','17':'IL','18':'IN','19':'IA','20':'KS','21':'KY','22':'LA','23':'ME','24':'MD','25':'MA','26':'MI','27':'MN','28':'MS','29':'MO','30':'MT','31':'NE','32':'NV','33':'NH','34':'NJ','35':'NM','36':'NY','37':'NC','38':'ND','39':'OH','40':'OK','41':'OR','42':'PA','44':'RI','45':'SC','46':'SD','47':'TN','48':'TX','49':'UT','50':'VT','51':'VA','53':'WA','54':'WV','55':'WI','56':'WY'};
const topo = JSON.parse(readFileSync(join(here, 'node_modules/us-atlas/states-10m.json'), 'utf8'));
const geo = feature(topo, topo.objects.states);
const proj = geoAlbersUsa().scale(1280).translate([480, 300]);
const path = geoPath(proj);
const shapes = {};
for (const f of geo.features) {
  const st = FIPS[f.id];
  if (!st) continue;
  const d = path(f);
  if (!d) continue;
  const [x, y] = path.centroid(f);
  shapes[st] = { d: d.replace(/(\d+\.\d{1})\d+/g, '$1'), c: [Math.round(x), Math.round(y)] };
}
writeFileSync(join(dataDir, 'us-states.json'), JSON.stringify({ viewBox: '0 0 960 600', shapes }));
console.log('states', Object.keys(shapes).length);
