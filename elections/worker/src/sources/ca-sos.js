// California Secretary of State election-night JSON (api.sos.ca.gov, free, no key).
// A response is a race object (or an array of them) with raceTitle, Reporting, ReportingTime and
// candidates[Name, Party, Votes, Percent, incumbent]. Downloading is done by the scheduler (feeds/states.js).
import { normParty, toNum } from '../parties.js';

export function parseCASOS(json) {
  const arr = Array.isArray(json) ? json : [json];
  // Prefer the statewide/districtwide row over county breakdowns
  const race = arr.find(r => /(Statewide|Districtwide) Results/i.test(r?.raceTitle || '')) || arr[0];
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
