// The board's LA County tab, counted by the LA County Registrar-Recorder. results.lavote.gov is built on a
// public JSON API:
//   GetMenuElections?year=2026        elections (the Nov 3 one appears when the county sets it up)
//   GetElectionData?electionID=<id>   every contest and candidate, with their IDs (read once)
//   GetCounterData?electionID=<id>    every counter: candidate votes ("CAND"), contest ballots, etc. (each run)
// Checked Oct 28 against the June 2 primary: LA mayor Bass 292,593, Raman 247,781, Pratt 217,977.
//
// The tab lists every local contest on the county's ballot: county offices and measures, the City of LA, other
// cities, schools, special districts, Superior Court, and the State Legislature (LA County votes only).
// Federal and statewide contests are skipped (the national board and the CA Props tab have them).
// The 12 November runoffs in data/la-local-2026.json are listed before the county posts anything; once it
// does, they keep their ids (LA-MAYOR…) and every other contest is "LA-<county contest number>".
// LA's results site sits behind Imperva bot protection; if it ever refuses the Worker, the feed shows "failing"
// and the desk can type the counts in.
import LA from '../../../data/la-local-2026.json' with { type: 'json' };

const API = 'https://results.lavote.gov/ElectionResults';
const fold = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z ]/g, ' ').replace(/\s+/g, ' ').trim();
const lastName = s => fold(s).split(' ').filter(w => !/^(jr|sr|ii|iii|iv)$/.test(w)).pop() || '';
export const titleCase = s => String(s).toLowerCase().replace(/(^|[\s\-'"(/])(\p{L})/gu, (m, a, b) => a + b.toUpperCase())
  .replace(/\bMc(\p{L})/gu, (m, c) => 'Mc' + c.toUpperCase()).replace(/\b(Ii|Iii|Iv)\b/g, m => m.toUpperCase())
  .replace(/\b(Of|The|And|For|To|A|An|In|On|At)\b/g, (m, w, i) => i === 0 ? m : m.toLowerCase())
  .replace(/\b(Usd|Ccd|Cfd|Unified|Lausd)\b/g, m => /^(Usd|Ccd|Cfd|Lausd)$/.test(m) ? m.toUpperCase() : m);

// County contest groups we skip: on the national board or the CA Props tab already
const SKIP_GROUP = /^(governor|lieutenant governor|secretary of state|controller|treasurer|attorney general|insurance commissioner|board of equalization|superintendent|u\.?s\.? (senator|representative)|united states|president|state measures?|propositions?)/i;
const NUM = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7 };
const voteFor = v => { const s = String(v || '').toLowerCase(); const n = s.match(/\d+/)?.[0]; return n ? +n : Object.entries(NUM).find(([w]) => new RegExp(`\\b${w}\\b`).test(s))?.[1] || 1; };

/** Group, place and office for one county contest (pure; tested with the June titles). */
export function describe(groupName, title, type) {
  const g = String(groupName || ''), t = String(title || '').replace(/\s+/g, ' ').trim();
  const measure = /^measure$/i.test(type) || /\bMEASURE [A-Z]{1,3}\b/.test(t);
  const mLetter = t.match(/\bMEASURE ([A-Z]{1,3})\b/)?.[1];
  // "CITY OF BELL GENERAL MUNICIPAL ELECTION - MEASURE BB", "LOS ANGELES CITY GENERAL MUNICIPAL ELECTION Mayor"
  const city = t.match(/^(?:CITY OF )?(.+?)(?: CITY)? (?:GENERAL|PRIMARY|SPECIAL|REGULAR|CONSOLIDATED|MUNICIPAL)\b[A-Z ]*? ELECTION(?:\s*-\s*|\s+)(.+)$/i);
  let group, place, office;
  if (/^cities/i.test(g) && city) {
    place = titleCase(city[1]);
    office = measure ? `Measure ${mLetter}` : city[2].replace(/^Member of the /i, '');
    group = measure ? 'measure' : /^LOS ANGELES$/i.test(city[1]) ? 'lacity' : 'city';
  } else if (/^schools/i.test(g) || /\b(SCHOOL|COLLEGE)\b.*\bDISTRICT\b/i.test(t)) {
    const m = t.match(/^(.+?\b(?:SCHOOL|COLLEGE)\b[^-]*?\bDISTRICT)(?:\s+(?:SPECIAL|GENERAL) ELECTION)?(?:\s*-\s*|\s+)(.+)$/i);
    place = titleCase(m ? m[1] : t);
    office = measure ? `Measure ${mLetter}` : m ? m[2] : t;
    group = measure ? 'measure' : 'school';
  } else if (/judge/i.test(g) || /^JUDGE OF THE SUPERIOR COURT/i.test(t)) {
    group = 'judicial'; place = 'Superior Court';
    office = `Judge, Office No. ${t.match(/Office No\.? (\d+)/i)?.[1] || '?'}`;
  } else if (/state senat|assembly/i.test(g) || /^(STATE SENATOR|MEMBER OF THE STATE ASSEMBLY)/i.test(t)) {
    group = 'legislature'; place = 'State Legislature';
    office = titleCase(t).replace(/^Member of the State Assembly/i, 'State Assembly').replace(/^State Senator/i, 'State Senate')
      .replace(/, (\d+)(st|nd|rd|th) District$/i, ', District $1');
  } else if (/supervisor|sheriff|assessor|county/i.test(g) || /^(SUPERVISOR|SHERIFF|ASSESSOR|COUNTY MEASURE)/i.test(t)) {
    group = measure ? 'measure' : 'county'; place = 'LA County';
    office = measure ? `Measure ${mLetter}` : titleCase(t).replace(/^Supervisor (\d+)(st|nd|rd|th) District$/i, 'Supervisor, District $1');
  } else {
    const m = t.match(/^(.+?)(?:\s+(?:SPECIAL|GENERAL) ELECTION)?(?:\s*-\s*)(MEASURE [A-Z]{1,3})$/i) || t.match(/^(.+?\bDISTRICT)\s+(.+)$/i);
    place = titleCase(m ? m[1] : t);
    office = measure ? `Measure ${mLetter}` : m ? m[2] : '';
    group = measure ? 'measure' : 'district';
  }
  office = titleCase(office).replace(/^Measure ([a-z]{1,3})$/i, (x, l) => `Measure ${l.toUpperCase()}`)
    .replace(/,? (\d+)(st|nd|rd|th) District$/i, ', District $1');
  const name = group === 'judicial' ? `Superior Court ${office}` : group === 'legislature' ? office : measure ? `${office} (${place})` : office ? `${place} ${office}` : place;
  return { group, place, office, name, measure };
}

/** Our contests from the county's election data (pure): [{ id, countyId, group, place, office, name, measure, voteFor, cands: [{ id, name }] }] */
export function laContests(electionData) {
  const out = [];
  const taken = new Set();
  for (const g of electionData?.Data?.ContestGroups || []) {
    if (SKIP_GROUP.test(g.Name || '')) continue;
    for (const c of g.Contests || []) {
      const title = String(c.Title || '').trim();
      if (/^(UNITED STATES|GOVERNOR|LIEUTENANT GOVERNOR|STATE MEASURE|PROPOSITION)/i.test(title)) continue;
      const base = LA.contests.find(b => !taken.has(b.id) && new RegExp(b.laTitle, 'i').test(title));
      if (base) taken.add(base.id);
      const d = base ? { group: base.group, place: base.place, office: base.office, name: base.name, measure: false } : describe(g.Name, title, c.Type);
      out.push({
        id: base ? base.id : String(c.ID), countyId: c.ID, ...d, voteFor: voteFor(c.VoteFor),
        // Ballot names ("KAREN RUTH BASS") become ours ("Karen Bass") by last name for the preloaded runoffs
        cands: (c.Candidates || []).map(x => ({
          id: x.ID,
          name: base?.candidates.find(b => lastName(b.name) === lastName(x.Name))?.name || titleCase(x.Name),
        })),
      });
    }
  }
  return out;
}

/** Board payload (same shape as Orange County's) from the saved contests and the county's counters. */
export function laPayload(found, counters, now = Date.now()) {
  const votes = new Map((counters?.Data || []).filter(x => x.ReferenceType === 'CAND').map(x => [x.ReferenceID, x.Value]));
  const listed = new Set(LA.contests.map(c => c.id));
  return {
    area: 'LA', source: LA.source, updated: new Date(now).toISOString(),
    contests: found.map(f => ({
      id: f.id, voteFor: f.voteFor, pctIn: null,                    // the county posts no precinct count per contest
      ...(listed.has(f.id) ? {} : { group: f.group, place: f.place, office: f.office, name: f.name, measure: f.measure || undefined }),
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
        c.meta.found = laContests(await c.json(`${API}/GetElectionData?electionID=${eid}`));
        if (!c.meta.found.length) return { notPosted: true };
      }
      const payload = laPayload(c.meta.found, await c.json(`${API}/GetCounterData?electionID=${eid}`), c.now);
      return { local: payload, count: payload.contests.length };
    },
  }],
};
export const LA_LOCAL = LA;
