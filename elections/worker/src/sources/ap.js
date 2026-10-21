// AP Elections API adapter (licensed — needs AP_API_KEY).
// Field names follow the AP Elections API developer guide: races[] → reportingUnits[] → candidates[],
// with candidates[].winner = "X" (called), "R" (runoff), "N" (call reversed).
// Newer API versions add expected-vote fields (eevp); we use them when present.
import { normParty, toNum } from '../parties.js';

export async function fetchAP(env, ids) {
  if (!env.AP_API_KEY) return { name: 'AP', enabled: false, races: new Map() };
  const base = (env.AP_BASE || 'https://api.ap.org/v3').replace(/\/$/, '');
  const date = env.ELECTION_DATE || '2026-11-03';
  const url = `${base}/elections/${date}?officeID=S,H,G&level=state&format=json`
    + (env.AP_TEST === 'true' ? '&test=true' : '')
    + `&apiKey=${encodeURIComponent(env.AP_API_KEY)}`;
  const resp = await fetch(url, { headers: { Accept: 'application/json' }, cf: { cacheTtl: 0 } });
  if (!resp.ok) throw new Error(`AP HTTP ${resp.status}`);
  return { name: 'AP', enabled: true, races: parseAP(await resp.json(), ids) };
}

export function parseAP(json, ids) {
  const out = new Map();
  for (const race of json.races || []) {
    const ru = (race.reportingUnits || []).find(u => /state/i.test(u.level || '')) || (race.reportingUnits || [])[0];
    if (!ru) continue;
    const st = ru.statePostal || race.statePostal;
    const id = apRaceId(race, st, ids);
    if (!id) continue;
    const cands = (ru.candidates || []).map(c => ({
      name: [c.first, c.last].filter(Boolean).join(' ') + (c.suffix ? ` ${c.suffix}` : ''),
      party: normParty(c.party),
      votes: toNum(c.voteCount) ?? 0,
      incumbent: !!c.incumbent,
      winner: c.winner === 'X',
      runoff: c.winner === 'R',
    }));
    const eevp = toNum(ru.eevp ?? race.eevp);
    out.set(id, {
      source: 'AP',
      candidates: cands,
      pctIn: eevp ?? toNum(ru.precinctsReportingPct),
      pctLabel: eevp != null ? 'expected vote' : 'precincts',
      updated: ru.lastUpdated || json.timestamp || null,
      uncontested: !!race.uncontested,
    });
  }
  return out;
}

function apRaceId(race, st, ids) {
  const special = /special/i.test(`${race.raceType || ''} ${race.description || ''}`);
  switch (race.officeID) {
    case 'H': {
      const n = parseInt(race.seatNum, 10);
      const id = `${st}-${n > 0 ? String(n).padStart(2, '0') : 'AL'}`;
      return ids.has(id) ? id : null;
    }
    case 'S': return pick(ids, special ? [`${st}-SEN-S`, `${st}-SEN`] : [`${st}-SEN`, `${st}-SEN-S`]);
    case 'G': return pick(ids, [`${st}-GOV`]);
    default: return null;
  }
}
const pick = (ids, list) => list.find(i => ids.has(i)) || null;
