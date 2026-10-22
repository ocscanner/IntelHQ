// Builds elections/data/oc-local-2026.json from data/src/oc-local.txt (the OC Registrar's candidate list).
// Run: node elections/tools/build-local.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const dataDir = join(here, '..', 'data');

const SMALL = new Set(['and', 'of', 'the', 'de', 'der', 'van', 'la', 'del']);
/** "ROBERT S. \"BOB\" MCKINNELL" → 'Robert S. "Bob" McKinnell' */
export function titleCase(s, { place = false } = {}) {
  return String(s).toLowerCase().split(/(\s+)/).map((w, i) => {
    if (/^\s+$/.test(w)) return w;
    const bare = w.replace(/[^\p{L}]/gu, '');
    if (/^(ii|iii|iv|usd|oc)$/.test(bare)) return w.toUpperCase();
    if (bare.length === 2 && bare !== 'st' && (!/[aeiouy]/.test(bare) || /^"\p{L}{2}"$/u.test(w))) return w.toUpperCase();   // JJ, TJ, "AJ"
    if (place && i > 0 && SMALL.has(bare)) return w;
    return w.replace(/(^|[\s\-'"(])(\p{L})/gu, (m, a, b) => a + b.toUpperCase())
      .replace(/\bMc(\p{L})/gu, (m, c) => 'Mc' + c.toUpperCase());
  }).join('');
}
/** Prefer the incumbent's own spelling ("Joe DoVinh") when the names match. */
function candName(raw, incumbent) {
  const t = titleCase(raw.replace(/\s+/g, ' ').trim());
  if (incumbent && incumbent.toLowerCase().replace(/[^a-z]/g, '') === t.toLowerCase().replace(/[^a-z]/g, '')) return incumbent;
  return t;
}
const PARTY = { D: 'D', R: 'R', G: 'G', L: 'L', PF: 'O', AI: 'O' };

const groups = [
  { key: 'county', label: 'County' },
  { key: 'city', label: 'Cities' },
  { key: 'school', label: 'Schools & colleges' },
  { key: 'district', label: 'Water & special districts' },
  { key: 'measure', label: 'Measures' },
  { key: 'legislature', label: 'State Legislature', note: 'Orange County votes only. Most of these districts reach into neighboring counties, so the full-district count can differ.' },
];

const contests = [];
for (const line of readFileSync(join(dataDir, 'src', 'oc-local.txt'), 'utf8').split('\n')) {
  if (!line.trim() || line.startsWith('#')) continue;
  const [id, head, short, vf, incRaw, cands] = line.split('|');
  const inc = /^(no incumbent|vacant|)$/i.test(incRaw.trim()) ? null : incRaw.trim();
  const n = +id;
  let group, place, office;
  const shortTerm = /short term/i.test(short) ? ', short term' : '';
  if (n < 2000) {
    group = 'legislature'; place = 'State Legislature';
    office = short.replace('State Senator, ', 'State Senate, ').replace(/(\d+)(st|nd|rd|th) District/, 'District $1');
  } else if (/^Nonpartisan COUNTY OF ORANGE/.test(head)) {
    group = 'county'; place = 'Orange County';
    office = short.replace(/(\d+)(st|nd|rd|th) District/, 'District $1');
  } else if (/^Nonpartisan CITY OF /.test(head)) {
    group = 'city';
    place = titleCase(head.match(/^Nonpartisan CITY OF (.+?) (Mayor|Member|City |Treasurer|Clerk)/)[1], { place: true });
    office = short.replace(/^City of [^,]+,\s*/, '').replace(/^Member,\s*/, '').replace(/, Short Term$/i, '')
      .replace(/^City Council,? District (\d+)$/, 'City Council, District $1').replace(/^City Council$/, 'City Council (at large)') + shortTerm;
  } else if (/^Nonpartisan SCHOOL /.test(head)) {
    group = 'school';
    place = titleCase(head.replace(/^Nonpartisan SCHOOL /, '').replace(/ Governing Board Member$/, '').replace(/ Superintendent.*$/, ''), { place: true });
    const area = short.match(/Trust(?:ee)? Area ([0-9A-Z]+)/i);
    office = (area ? `Trustee Area ${area[1]}` : 'Board (at large)') + shortTerm;
  } else {
    group = 'district';
    place = titleCase(head.replace(/^Nonpartisan /, '').replace(/ (Director|Trustee)$/, '').replace(/ DIST\.$/, ' DISTRICT').replace(/^MUNICIPAL WATER DISTRICT$/, 'MUNICIPAL WATER DISTRICT OF ORANGE COUNTY'), { place: true });
    const div = short.match(/Div(?:ision|\.)\s*(\d+)/i);
    const role = /Trustee$/.test(head) ? 'Trustee' : 'Director';
    office = `${role}${div ? `, Division ${div[1]}` : ''}${/full term/i.test(short) ? ', full term' : ''}${shortTerm}`;
  }
  contests.push({
    id, group, place, office,
    name: group === 'legislature' ? office : `${place}: ${office}`,
    voteFor: +vf || 1,
    incumbent: inc,
    candidates: cands.split(';').filter(Boolean).map(c => {
      const [nm, p] = c.split('~');
      return { name: candName(nm, inc), party: p ? (PARTY[p] || 'O') : null };
    }),
  });
}

const out = {
  area: 'OC', name: 'Orange County', election: '2026-11-03',
  source: 'Orange County Registrar of Voters',
  resultsBase: 'https://www.livevoterturnout.com/ENR/orangecaenr',
  groups, contests,
};
writeFileSync(join(dataDir, 'oc-local-2026.json'), JSON.stringify(out));
const byGroup = Object.fromEntries(groups.map(g => [g.key, contests.filter(c => c.group === g.key).length]));
console.log('OC local contests', contests.length, byGroup, 'cities', new Set(contests.filter(c => c.group === 'city').map(c => c.place)).size);
