import { test } from 'node:test';
import assert from 'node:assert/strict';
import { laContests, laPayload, laLocalAdapter, describe, LA_LOCAL } from '../src/feeds/la-local.js';
import { buildLocal } from '../src/local.js';
import { parseDDHQ, parseAP, matchCall } from '../src/queue/parse.js';
import { targets } from '../src/queue/build.js';

// Laid out like results.lavote.gov's JSON (titles from the June 2 primary, checked Oct 28); November numbers made up
const electionData = { Data: { ID: 4400, ContestGroups: [
  { Name: 'Governor', Contests: [{ ID: 10184, Title: 'GOVERNOR', Type: 'Candidate', Candidates: [{ ID: 1, Name: 'SOMEONE' }] }] },
  { Name: 'U.S. Representative', Contests: [{ ID: 10190, Title: 'UNITED STATES REPRESENTATIVE, 23rd District', Type: 'Candidate', Candidates: [{ ID: 9, Name: 'X' }] }] },
  { Name: 'Sheriff', Contests: [{ ID: 10300, Title: 'SHERIFF', Type: 'Candidate', Candidates: [{ ID: 31, Name: 'ROBERT G. LUNA' }, { ID: 32, Name: 'ALEX VILLANUEVA' }] }] },
  { Name: 'County Measures', Contests: [{ ID: 10305, Title: 'COUNTY MEASURE ER', Type: 'Measure', Candidates: [{ ID: 41, Name: 'YES' }, { ID: 42, Name: 'NO' }] }] },
  { Name: 'Cities', Contests: [
    { ID: 10281, Title: 'CITY OF AVALON GENERAL MUNICIPAL ELECTION Member of the City Council', Type: 'Candidate', VoteFor: 'Vote for no more than two', Candidates: [{ ID: 2, Name: 'ANNI MARSHALL' }, { ID: 3, Name: 'CINDE CASSIDY' }, { ID: 4, Name: 'DANIEL FELTS' }] },
    { ID: 10450, Title: 'LOS ANGELES CITY GENERAL MUNICIPAL ELECTION Mayor', Type: 'Candidate', Candidates: [{ ID: 25001, Name: 'KAREN RUTH BASS' }, { ID: 25002, Name: 'NITHYA RAMAN' }] },
    { ID: 10451, Title: 'LOS ANGELES CITY GENERAL MUNICIPAL ELECTION Member of the City Council, 3rd District', Type: 'Candidate', Candidates: [{ ID: 25011, Name: 'TIMOTHY K. GASPAR' }, { ID: 25012, Name: 'BARRI WORTH GIRVAN' }] },
  ] },
  { Name: 'Schools', Contests: [{ ID: 10500, Title: 'LONG BEACH UNIFIED SCHOOL DISTRICT Governing Board Member, District 1', Type: 'Candidate', Candidates: [{ ID: 51, Name: 'A B' }] }] },
] } };
const counters = { Data: [
  { ReferenceID: 25001, ReferenceType: 'CAND', Value: 410000.0 }, { ReferenceID: 25002, ReferenceType: 'CAND', Value: 455000.0 },
  { ReferenceID: 31, ReferenceType: 'CAND', Value: 900000.0 }, { ReferenceID: 32, ReferenceType: 'CAND', Value: 600000.0 },
  { ReferenceID: 41, ReferenceType: 'CAND', Value: 700.0 }, { ReferenceID: 42, ReferenceType: 'CAND', Value: 300.0 },
  { ReferenceID: 2, ReferenceType: 'CAND', Value: 900.0 }, { ReferenceID: 3, ReferenceType: 'CAND', Value: 800.0 }, { ReferenceID: 4, ReferenceType: 'CAND', Value: 100.0 },
  { ReferenceID: 10450, ReferenceType: 'CBLT', Value: 880000.0 },
] };

test('LA County: the 12 runoffs from the June primary are listed ahead of time', () => {
  assert.equal(LA_LOCAL.contests.length, 12);
  assert.deepEqual(LA_LOCAL.contests.find(c => c.id === 'MAYOR').candidates.map(c => c.name), ['Karen Bass', 'Nithya Raman']);
  assert.deepEqual(LA_LOCAL.contests.find(c => c.id === 'SHERIFF').candidates.map(c => c.name), ['Robert Luna', 'Alex Villanueva']);
});

test('LA County: every local contest from the county data; federal and statewide skipped; runoffs keep their ids', () => {
  const found = laContests(electionData);
  assert.deepEqual(found.map(f => [f.id, f.group, f.name, f.voteFor]), [
    ['SHERIFF', 'county', 'LA County Sheriff', 1],
    ['10305', 'measure', 'Measure ER (LA County)', 1],
    ['10281', 'city', 'Avalon City Council', 2],
    ['MAYOR', 'lacity', 'Los Angeles Mayor', 1],
    ['CD3', 'lacity', 'Los Angeles City Council, District 3', 1],
    ['10500', 'school', 'Long Beach Unified School District Governing Board Member, District 1', 1],
  ]);
  assert.deepEqual(found.find(f => f.id === 'SHERIFF').cands.map(c => c.name), ['Robert Luna', 'Alex Villanueva']);
  assert.deepEqual(found.find(f => f.id === '10281').cands.map(c => c.name), ['Anni Marshall', 'Cinde Cassidy', 'Daniel Felts']);
});

test('LA County: contest names from the June titles', () => {
  const d = (g, t, ty = 'Candidate') => describe(g, t, ty).name;
  assert.equal(d('Cities', 'CITY OF BEVERLY HILLS REGULAR MUNICIPAL ELECTION City Treasurer'), 'Beverly Hills City Treasurer');
  assert.equal(d('Cities', 'CITY OF BELL GARDENS SPECIAL MUNICIPAL ELECTION - MEASURE BG', 'Measure'), 'Measure BG (Bell Gardens)');
  assert.equal(d('Cities', 'CITY OF COMPTON PRIMARY NOMINATING ELECTION Member of the City Council, 2nd District'), 'Compton City Council, District 2');
  assert.equal(d('Board of Supervisors', 'SUPERVISOR 3RD DISTRICT'), 'LA County Supervisor, District 3');
  assert.equal(d('Judge Superior Court', 'JUDGE OF THE SUPERIOR COURT Office No. 131'), 'Superior Court Judge, Office No. 131');
  assert.equal(d('Member of the Assembly', 'MEMBER OF THE STATE ASSEMBLY, 34th District'), 'State Assembly, District 34');
  assert.equal(describe('Cities', 'LOS ANGELES CITY GENERAL MUNICIPAL ELECTION Controller').group, 'lacity');
});

test('LA County tab: listed runoffs plus the county’s other contests, with results and calls', () => {
  const p = laPayload(laContests(electionData), counters);
  assert.equal(p.area, 'LA');
  const calls = new Map([['LA-MAYOR', { candidate: 'Nithya Raman', source: 'Decision Desk HQ', called_at: 1 }]]);
  const tab = buildLocal(LA_LOCAL, p, calls, Date.now(), 'LA-');
  const byId = new Map(tab.contests.map(c => [c.id, c]));
  assert.equal(tab.contests.length, 12 + 3);                                   // 12 listed (3 with results) + 3 more from the county
  const mayor = byId.get('LA-MAYOR');
  assert.deepEqual(mayor.candidates.map(c => [c.name, c.votes, c.winner, c.incumbent]), [['Nithya Raman', 455000, true, false], ['Karen Bass', 410000, false, true]]);
  assert.equal(byId.get('LA-SHERIFF').margin, 20);
  const avalon = byId.get('LA-10281');
  assert.deepEqual([avalon.group, avalon.place, avalon.office, avalon.voteFor, avalon.ahead], ['city', 'Avalon', 'City Council', 2, ['Anni Marshall', 'Cinde Cassidy']]);
  assert.equal(byId.get('LA-10305').measure, true);
  assert.equal(byId.get('LA-JUDGE64').status, 'waiting');                     // listed, not in this sample's data
});

test('LA County feed: waits for the Nov 3 election, reads contests once, then only the counters', async () => {
  const meta = {}, got = [];
  const api = 'https://results.lavote.gov/ElectionResults';
  const files = { [`${api}/GetMenuElections?year=2026`]: { Data: [{ ID: 4338, Date: '2026-06-02T00:00:00-07:00' }] } };
  const c = { meta, now: Date.parse('2026-11-04T05:00:00Z'), json: async url => { got.push(url); return files[url]; } };
  const run = () => laLocalAdapter.units[0].run(c);
  assert.deepEqual(await run(), { notPosted: true });
  files[`${api}/GetMenuElections?year=2026`].Data.push({ ID: 4400, Date: '2026-11-03T00:00:00-08:00' });
  files[`${api}/GetElectionData?electionID=4400`] = electionData;
  files[`${api}/GetCounterData?electionID=4400`] = counters;
  const out = await run();
  assert.equal(out.local.area, 'LA');
  assert.equal(out.count, 6);
  got.length = 0;
  await run();
  assert.deepEqual(got, [`${api}/GetCounterData?electionID=4400`]);
});

test('Call queue: DDHQ/AP calls of LA runoffs match; only the listed runoffs are queue targets', () => {
  const ddhq = parseDDHQ('Decision Desk HQ projects Nithya Raman wins the Los Angeles Mayoral runoff\n\n#DecisionMade: 11:40 PM EST');
  assert.deepEqual(matchCall(ddhq, [], []), { raceId: 'LA-MAYOR', candidate: 'Nithya Raman', party: null, winners: ['Nithya Raman'] });
  assert.equal(matchCall(parseAP('LOS ANGELES (AP) — Karen Bass wins reelection as Los Angeles mayor. #APRaceCall at 11:55 p.m. EST.'), [], []).candidate, 'Karen Bass');
  assert.equal(matchCall(parseDDHQ('Decision Desk HQ projects Alex Villanueva wins the Los Angeles County Sheriff runoff'), [], []).raceId, 'LA-SHERIFF');
  assert.equal(matchCall(parseDDHQ('Decision Desk HQ projects Marissa Roy wins the Los Angeles City Attorney race'), [], []).raceId, 'LA-CITYATTY');
  assert.equal(parseDDHQ('Decision Desk HQ projects Nithya Raman advances to the runoff for Los Angeles mayor'), null);
  assert.equal(parseDDHQ('Decision Desk HQ projects Ashley Hinson wins the IA US Senate Republican Primary'), null);
  const t = targets({ races: [] }, null, null, { contests: [{ id: 'LA-MAYOR', name: 'Los Angeles Mayor', candidates: [], pctIn: null, voteFor: 1 }] });
  assert.equal(t.get('LA-MAYOR').tab, 'la');
});
