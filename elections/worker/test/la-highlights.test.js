import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findLAContests, laPayload, laLocalAdapter } from '../src/feeds/la-local.js';
import { OC_LOCAL } from '../src/feeds/oc-local.js';
import { buildLocal } from '../src/local.js';
import { parseDDHQ, parseAP, matchCall } from '../src/queue/parse.js';
import { nextHighlights, highlightCards, DEFAULT_HIGHLIGHTS } from '../src/highlights.js';
import { memoryD1 } from './helpers/d1.js';
import { loadHighlights, saveHighlights } from '../src/highlights.js';

// Laid out like results.lavote.gov's JSON (June 2 primary, checked Oct 28); November's numbers made up
const electionData = { Data: { ID: 4400, ContestGroups: [
  { Name: 'Governor', Contests: [{ ID: 10184, Title: 'GOVERNOR', Candidates: [{ ID: 1, Name: 'SOMEONE' }] }] },
  { Name: 'Cities', Contests: [
    { ID: 10281, Title: 'CITY OF AVALON GENERAL MUNICIPAL ELECTION Mayor', Candidates: [{ ID: 2, Name: 'ANNI MARSHALL' }] },
    { ID: 10321, Title: 'LONG BEACH CITY GENERAL MUNICIPAL ELECTION Mayor', Candidates: [{ ID: 3, Name: 'X Y' }] },
    { ID: 10450, Title: 'LOS ANGELES CITY GENERAL MUNICIPAL ELECTION Mayor', Candidates: [{ ID: 25001, Name: 'KAREN RUTH BASS' }, { ID: 25002, Name: 'NITHYA RAMAN' }] },
  ] },
] } };
const counters = { Data: [
  { ReferenceID: 25001, ReferenceType: 'CAND', Value: 410000.0 },
  { ReferenceID: 25002, ReferenceType: 'CAND', Value: 455000.0 },
  { ReferenceID: 10450, ReferenceType: 'CBLT', Value: 880000.0 },
  { ReferenceID: 2, ReferenceType: 'CAND', Value: 900.0 },
] };

test('LA County: finds the LA mayor contest, names matched to ours, votes from the counters', () => {
  const found = findLAContests(electionData);
  assert.deepEqual(found, [{ id: 'LAMAYOR', countyId: 10450, title: 'LOS ANGELES CITY GENERAL MUNICIPAL ELECTION Mayor', cands: [{ id: 25001, name: 'Karen Bass' }, { id: 25002, name: 'Nithya Raman' }] }]);
  const p = laPayload(found, counters);
  assert.equal(p.area, 'LAC');
  assert.deepEqual(p.contests[0].candidates.map(c => [c.name, c.votes]), [['Karen Bass', 410000], ['Nithya Raman', 455000]]);
  assert.equal(p.contests[0].pctIn, null);
});

test('LA County feed: waits for the Nov 3 election, reads contests once, then only the counters', async () => {
  const meta = {}, got = [];
  const api = 'https://results.lavote.gov/ElectionResults';
  const files = {
    [`${api}/GetMenuElections?year=2026`]: { Data: [{ ID: 4338, Date: '2026-06-02T00:00:00-07:00' }] },
  };
  const c = { meta, now: Date.parse('2026-11-04T05:00:00Z'), json: async url => { got.push(url); return files[url]; } };
  const run = () => laLocalAdapter.units[0].run(c);
  assert.deepEqual(await run(), { notPosted: true });                                  // only the June primary listed
  files[`${api}/GetMenuElections?year=2026`].Data.push({ ID: 4400, Date: '2026-11-03T00:00:00-08:00' });
  files[`${api}/GetElectionData?electionID=4400`] = electionData;
  files[`${api}/GetCounterData?electionID=4400`] = counters;
  const out = await run();
  assert.equal(out.local.contests[0].id, 'LAMAYOR');
  got.length = 0;
  await run();
  assert.deepEqual(got, [`${api}/GetCounterData?electionID=4400`]);                     // one download per run after that
});

test('LA mayor sits on the local tab (Los Angeles group) and takes results and calls like OC races', () => {
  assert.ok(OC_LOCAL.groups.some(g => g.key === 'la'));
  const p = laPayload(findLAContests(electionData), counters);
  const calls = new Map([['OC-LAMAYOR', { candidate: 'Nithya Raman', source: 'Decision Desk HQ', called_at: 1 }]]);
  const out = buildLocal(OC_LOCAL, { contests: p.contests }, calls);
  const la = out.contests.find(c => c.id === 'OC-LAMAYOR');
  assert.equal(la.group, 'la');
  assert.equal(la.name, 'Los Angeles Mayor');
  assert.deepEqual(la.candidates.map(c => [c.name, c.votes, c.winner, c.incumbent]), [['Nithya Raman', 455000, true, false], ['Karen Bass', 410000, false, true]]);
  assert.equal(la.margin, 5.2);
});

test('DDHQ and AP calls of the LA mayor runoff match the race; primary-night posts still don’t', () => {
  const ddhq = parseDDHQ('Decision Desk HQ projects Nithya Raman wins the Los Angeles Mayoral runoff\n\n#DecisionMade: 11:40 PM EST');
  assert.deepEqual(matchCall(ddhq, [], []), { raceId: 'OC-LAMAYOR', candidate: 'Nithya Raman', party: null, winners: ['Nithya Raman'] });
  const ap = parseAP('LOS ANGELES (AP) — Karen Bass wins reelection as Los Angeles mayor. #APRaceCall at 11:55 p.m. EST.');
  assert.equal(matchCall(ap, [], []).candidate, 'Karen Bass');
  assert.equal(parseDDHQ('Decision Desk HQ projects Nithya Raman advances to the runoff for Los Angeles mayor'), null);
  assert.equal(parseDDHQ('Decision Desk HQ projects Ashley Hinson wins the IA US Senate Republican Primary'), null);
  assert.equal(parseAP('WASHINGTON (AP) — Nithya Raman advances to runoff election for Los Angeles mayor. #APRaceCall at 7:55 EDT.'), null);
});

/* ── Highlights ── */
const known = id => ['GA-SEN', 'AZ-06', 'OC-LAMAYOR', 'CA-P1', 'OC-5031'].includes(id);
test('highlights: add, remove, reorder, limits, unknown ids', () => {
  assert.deepEqual(nextHighlights(['OC-LAMAYOR'], { action: 'add', raceId: 'ga-sen' }, known), { ids: ['OC-LAMAYOR', 'GA-SEN'] });
  assert.deepEqual(nextHighlights(['OC-LAMAYOR', 'GA-SEN'], { action: 'add', raceId: 'GA-SEN' }, known), { ids: ['OC-LAMAYOR', 'GA-SEN'] });
  assert.deepEqual(nextHighlights(['OC-LAMAYOR', 'GA-SEN'], { action: 'remove', raceId: 'OC-LAMAYOR' }, known), { ids: ['GA-SEN'] });
  assert.deepEqual(nextHighlights(['GA-SEN'], { ids: ['AZ-06', 'GA-SEN'] }, known), { ids: ['AZ-06', 'GA-SEN'] });
  assert.match(nextHighlights([], { action: 'add', raceId: 'ZZ-99' }, known).error, /Unknown race/);
  assert.match(nextHighlights(Array(8).fill(0).map((_, i) => `X${i}`), { action: 'add', raceId: 'AZ-06' }, known).error, /Up to 8/);
});

test('highlights: stored once; the list starts with the LA mayor until changed (even to empty)', async () => {
  const db = memoryD1();
  assert.deepEqual(await loadHighlights(db), DEFAULT_HIGHLIGHTS);
  assert.deepEqual(DEFAULT_HIGHLIGHTS, ['OC-LAMAYOR']);
  await saveHighlights(db, []);
  assert.deepEqual(await loadHighlights(db), []);
});

test('highlight cards: national races and local contests, before results, counting and called', () => {
  const board = { races: [
    { id: 'GA-SEN', chamber: 'senate', name: 'Georgia Senate', total: 0, candidates: [], preCandidates: [{ name: 'Jon Ossoff', party: 'D' }, { name: 'Mike Collins', party: 'R' }], pctIn: null, call: null },
    { id: 'AZ-06', chamber: 'house', name: 'Arizona 6th', total: 1000, candidates: [{ name: 'A B', party: 'R', pct: 51.24 }, { name: 'C D', party: 'D', pct: 48.76 }], preCandidates: [], pctIn: 62, pctLabel: 'precincts', call: { candidate: 'A B', party: 'R', source: 'AP' }, flip: false },
  ] };
  const p = laPayload(findLAContests(electionData), counters);
  const OC = buildLocal(OC_LOCAL, { contests: p.contests }, new Map());
  const cards = highlightCards(['OC-LAMAYOR', 'GA-SEN', 'AZ-06', 'NOPE'], board, { OC });
  assert.deepEqual(cards.map(c => [c.id, c.tab, c.name]), [['OC-LAMAYOR', 'local', 'Los Angeles Mayor'], ['GA-SEN', 'senate', 'Georgia Senate'], ['AZ-06', 'house', 'Arizona 6th']]);
  assert.deepEqual(cards[0].cands, [{ name: 'Nithya Raman', party: null, pct: 52.6 }, { name: 'Karen Bass', party: null, pct: 47.4 }]);
  assert.equal(cards[0].counting, true);
  assert.deepEqual(cards[1].cands.map(c => c.pct), [null, null]);
  assert.equal(cards[1].counting, false);
  assert.deepEqual(cards[2].call, { who: 'A B', party: 'R', source: 'AP' });
  assert.equal(cards[2].cands[0].pct, 51.2);
});
