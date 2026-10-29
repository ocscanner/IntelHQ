// Los Angeles races on the board's local tab (shown with Orange County's), counted by the LA County
// Registrar-Recorder. results.lavote.gov is built on a public JSON API:
//   GetMenuElections?year=2026        elections (the Nov 3 one appears when the county sets it up)
//   GetElectionData?electionID=<id>   contests and candidates, with their IDs (~120 KB; read once)
//   GetCounterData?electionID=<id>    every counter: candidate votes ("CAND"), contest ballots, etc. (~140 KB)
// Checked Oct 28 against the June 2 primary: LA mayor (contest 10250) Bass 292,593, Raman 247,781, Pratt 217,977.
// LA's results site sits behind Imperva bot protection; if it ever refuses the Worker, the feed shows "failing"
// and the desk can type the counts in.
import LA from '../../../data/la-local-2026.json' with { type: 'json' };

const API = 'https://results.lavote.gov/ElectionResults';
const fold = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z ]/g, ' ').replace(/\s+/g, ' ').trim();
const lastName = s => fold(s).split(' ').filter(w => !/^(jr|sr|ii|iii|iv)$/.test(w)).pop() || '';
const titleCase = s => String(s).toLowerCase().replace(/(^|[\s\-'"(])(\p{L})/gu, (m, a, b) => a + b.toUpperCase());

/** Our contests found in the county's election data: [{ id, countyId, title, cands: [{ id, name }] }] */
export function findLAContests(electionData) {
  const all = (electionData?.Data?.ContestGroups || []).flatMap(g => g.Contests || []);
  const out = [];
  for (const base of LA.contests) {
    const re = new RegExp(base.laTitle, 'i');
    const c = all.find(x => re.test(String(x.Title || '').trim()));
    if (!c) continue;
    out.push({
      id: base.id, countyId: c.ID, title: c.Title,
      // Ballot names ("KAREN RUTH BASS") become the board's names ("Karen Bass") by last name
      cands: (c.Candidates || []).map(x => ({ id: x.ID, name: base.candidates.find(b => lastName(b.name) === lastName(x.Name))?.name || titleCase(x.Name) })),
    });
  }
  return out;
}

/** Board payload (same shape as Orange County's) from the saved contests and the county's counters. */
export function laPayload(found, counters, now = Date.now()) {
  const votes = new Map((counters?.Data || []).filter(x => x.ReferenceType === 'CAND').map(x => [x.ReferenceID, x.Value]));
  return {
    area: 'LAC', source: LA.source, updated: new Date(now).toISOString(),
    contests: found.map(f => ({
      id: f.id, voteFor: 1, pctIn: null,                          // the county posts no precinct count per contest
      candidates: f.cands.map(c => ({ name: c.name, party: null, votes: Math.round(votes.get(c.id) || 0) })),
    })),
  };
}

export const laLocalAdapter = {
  st: 'LAC', label: 'Los Angeles County Registrar-Recorder', confidence: 'unverified', format: 'Results site JSON', local: true,
  units: [{
    id: 'LAC', requests: 3,
    async run(c) {
      let eid = c.meta.eid;
      if (!eid) {
        const menu = await c.json(`${API}/GetMenuElections?year=2026`, { allow404: true });
        const el = (menu?.Data || []).find(e => String(e.Date || '').startsWith('2026-11-03'));
        if (!el) return { notPosted: true };
        eid = c.meta.eid = el.ID;
      }
      if (!c.meta.found?.length) {
        c.meta.found = findLAContests(await c.json(`${API}/GetElectionData?electionID=${eid}`));
        if (!c.meta.found.length) return { notPosted: true };
      }
      const payload = laPayload(c.meta.found, await c.json(`${API}/GetCounterData?electionID=${eid}`), c.now);
      return { local: payload, count: payload.contests.length };
    },
  }],
};
export const LA_LOCAL = LA;
