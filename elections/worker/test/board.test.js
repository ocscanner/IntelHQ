import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildBoard } from '../src/board.js';
import { parseCASOS } from '../src/sources/ca-sos.js';
import { parseAP } from '../src/sources/ap.js';
import { simulate } from '../src/sources/simulate.js';

const universe = JSON.parse(readFileSync(new URL('../../data/races-2026.json', import.meta.url)));
const IDS = new Set(universe.races.map(r => r.id));
const emptyDesk = () => ({ calls: new Map(), results: new Map() });

// Shape copied from api.sos.ca.gov/returns/us-rep/district/45 (Sept 2026 test data)
const caSample = {
  raceTitle: 'U.S. House of Representatives District 45 - Districtwide Results',
  Reporting: '25% (259 of 1,036) precincts reporting',
  ReportingTime: 'September 24, 2026, 5:37 p.m.',
  candidates: [
    { Name: 'Derek Tran', Party: 'Dem', Votes: '27,476', Percent: '33.3', incumbent: false },
    { Name: 'Chuong V. Vo', Party: 'Rep', Votes: '54,955', Percent: '66.7', incumbent: false },
  ],
};

test('CA SOS parser reads strings with commas and percent reporting', () => {
  const r = parseCASOS(caSample);
  assert.equal(r.pctIn, 25);
  assert.equal(r.candidates[0].votes, 27476);
  assert.equal(r.candidates[1].party, 'R');
});

test('CA SOS parser prefers statewide row from county arrays', () => {
  const r = parseCASOS([{ ...caSample, raceTitle: 'Governor - Fresno County Results', Reporting: '100% (1 of 1)' }, { ...caSample, raceTitle: 'Governor - Statewide Results' }]);
  assert.equal(r.pctIn, 25);
});

test('AP parser maps House, at-large, special Senate and calls', () => {
  const ap = { races: [
    { officeID: 'H', seatNum: '45', reportingUnits: [{ level: 'state', statePostal: 'CA', precinctsReportingPct: 61.2, candidates: [
      { first: 'Derek', last: 'Tran', party: 'Dem', voteCount: 100, winner: 'X' }, { first: 'Chuong', last: 'Vo', party: 'GOP', voteCount: 90 }] }] },
    { officeID: 'H', seatNum: '0', reportingUnits: [{ level: 'state', statePostal: 'AK', candidates: [] }] },
    { officeID: 'S', raceType: 'Special General', reportingUnits: [{ level: 'state', statePostal: 'OH', eevp: 88, candidates: [{ first: 'A', last: 'B', party: 'GOP', voteCount: 5 }] }] },
    { officeID: 'S', reportingUnits: [{ level: 'state', statePostal: 'FL', candidates: [] }] },
    { officeID: 'P', reportingUnits: [{ level: 'state', statePostal: 'CA', candidates: [] }] },
  ] };
  const m = parseAP(ap, IDS);
  assert.ok(m.get('CA-45').candidates[0].winner);
  assert.equal(m.get('CA-45').pctIn, 61.2);
  assert.ok(m.has('AK-AL'));
  assert.equal(m.get('OH-SEN-S').pctIn, 88);
  assert.equal(m.get('OH-SEN-S').pctLabel, 'expected vote');
  assert.ok(m.has('FL-SEN-S'), 'FL has only a special Senate race; regular label must still map');
  assert.equal(m.size, 4);
});

test('board: feed call, flip detection and seat math', () => {
  const feed = { name: 'X', races: new Map([
    ['CA-45', { source: 'AP', candidates: [{ name: 'Chuong Vo', party: 'R', votes: 60, winner: true }, { name: 'Derek Tran', party: 'D', votes: 40 }], pctIn: 90 }],
    ['TX-SEN', { source: 'AP', candidates: [{ name: 'Ken Paxton', party: 'R', votes: 55 }, { name: 'James Talarico', party: 'D', votes: 45 }], pctIn: 40 }],
  ]) };
  const b = buildBoard(universe, [feed], emptyDesk());
  const ca = b.races.find(r => r.id === 'CA-45');
  assert.equal(ca.status, 'called');
  assert.equal(ca.flip, true);
  assert.equal(ca.candidates[0].pct, 60);
  assert.equal(ca.margin, 20);
  assert.equal(b.summary.house.called.R, 1);
  assert.equal(b.summary.house.flips.toR, 1);
  const tx = b.races.find(r => r.id === 'TX-SEN');
  assert.equal(tx.status, 'counting');
  assert.equal(tx.leader, 'R');
  assert.equal(b.summary.senate.seats.D, 32, 'Senate seats include 32 D not up');
  assert.equal(b.summary.senate.seats.R, 31);
  assert.equal(b.summary.senate.leading.R, 1);
  assert.equal(b.summary.house.waiting, 434);
});

test('board: desk call overrides feed; retraction hides a feed call', () => {
  const feed = { name: 'X', races: new Map([['GA-SEN', { source: 'AP', candidates: [{ name: 'Jon Ossoff', party: 'D', votes: 51, winner: true }, { name: 'Mike Collins', party: 'R', votes: 49 }] }]]) };
  const desk = emptyDesk();
  desk.calls.set('ME-SEN', { party: 'R', source: 'DDHQ', called_at: 1 });
  desk.calls.set('GA-SEN', { party: 'D', source: 'AP', called_at: 1, retracted_at: 2 });
  const b = buildBoard(universe, [feed], desk);
  const me = b.races.find(r => r.id === 'ME-SEN');
  assert.equal(me.call.source, 'DDHQ');
  assert.equal(me.call.candidate, 'Susan Collins', 'candidate filled from pre-race list');
  assert.equal(me.flip, false);
  assert.equal(b.races.find(r => r.id === 'GA-SEN').call, null);
});

test('board: manual desk numbers fill in when no feed covers a race', () => {
  const desk = emptyDesk();
  desk.results.set('NE-SEN', { candidates: [{ name: 'Dan Osborn', party: 'I', votes: 300 }, { name: 'Pete Ricketts', party: 'R', votes: 200 }], pctIn: 50 });
  const b = buildBoard(universe, [], desk);
  const ne = b.races.find(r => r.id === 'NE-SEN');
  assert.equal(ne.source, 'Desk');
  assert.equal(ne.leader, 'I');
  assert.equal(b.summary.senate.leading.I, 1);
});

test('simulation produces labeled, sane data over a full cycle', () => {
  for (const minute of [5, 30, 60, 89]) {
    const s = simulate(universe.races, minute * 60000, 90);
    for (const [id, d] of s.races) {
      assert.equal(d.source, 'SIM');
      assert.ok(d.pctIn >= 0 && d.pctIn <= 100, id);
      assert.ok(d.candidates.every(c => Number.isFinite(c.votes) && c.votes >= 0), id);
      assert.ok(d.candidates.filter(c => c.winner).length <= 1, id);
    }
  }
  const late = simulate(universe.races, 89 * 60000, 90);
  assert.ok(late.races.size > 480, 'nearly every race reporting late in the cycle');
  const b = buildBoard(universe, [late], emptyDesk());
  const h = b.summary.house;
  assert.equal(h.called.D + h.called.R + h.called.I + h.called.O + h.counting + h.waiting, 435);
});
