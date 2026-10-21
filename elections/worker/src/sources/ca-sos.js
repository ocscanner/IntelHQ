// California Secretary of State election-night feed (free, no key).
// Endpoints: /returns/governor, /returns/us-rep/district/{n}. Responses are a race object
// (or an array of them) with raceTitle, Reporting, ReportingTime and candidates[Name, Party, Votes, Percent, incumbent].
import { normParty, toNum } from '../parties.js';

const BASE = 'https://api.sos.ca.gov/returns';

export async function fetchCASOS(env) {
  if (env.CA_SOS === 'off') return { name: 'CA SOS', enabled: false, races: new Map() };
  const districts = (env.CA_SOS_DISTRICTS || '13,21,22,40,41,45,46,47,48,49').split(',').map(s => +s.trim()).filter(Boolean);
  const jobs = [['CA-GOV', `${BASE}/governor`], ...districts.map(n => [`CA-${String(n).padStart(2, '0')}`, `${BASE}/us-rep/district/${n}`])];
  const races = new Map();
  const errors = [];
  await Promise.all(jobs.map(async ([id, url]) => {
    try {
      const r = await fetch(url, { headers: { Accept: 'application/json' }, cf: { cacheTtl: 30 } });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const parsed = parseCASOS(await r.json());
      if (parsed) races.set(id, parsed);
    } catch (e) { errors.push(`${id}: ${e.message}`); }
  }));
  if (!races.size && errors.length) throw new Error(errors.slice(0, 3).join('; '));
  return { name: 'CA SOS', enabled: true, races, errors };
}

export function parseCASOS(json) {
  const arr = Array.isArray(json) ? json : [json];
  // Prefer the statewide/districtwide row over county breakdowns
  const race = arr.find(r => /(Statewide|Districtwide) Results/i.test(r.raceTitle || '')) || arr[0];
  if (!race || !Array.isArray(race.candidates)) return null;
  const m = String(race.Reporting || '').match(/([\d.]+)%/);
  return {
    source: 'CA SOS',
    candidates: race.candidates.map(c => ({
      name: c.Name, party: normParty(c.Party), votes: toNum(c.Votes) ?? 0, incumbent: !!c.incumbent, winner: false,
    })),
    pctIn: m ? +m[1] : null,
    pctLabel: 'precincts',
    updated: race.ReportingTime || null,
  };
}
