import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runIngest, memoryStore } from '../src/ingest.js';
import { parseCAProps, propsPayload } from '../src/feeds/ca-props.js';
import { buildLocal } from '../src/local.js';
import { simulateProps } from '../src/sources/simulate-extra.js';

const universe = JSON.parse(readFileSync(new URL('../../data/races-2026.json', import.meta.url)));
const PROPS = JSON.parse(readFileSync(new URL('../../data/ca-props-2026.json', import.meta.url)));

/* Laid out exactly like the Secretary of State's file (checked against api.sos.ca.gov's Sept 24 test data, Oct 23). */
const measure = (num, name, yes, no) => ({ Name: name, Number: num, yesVotes: String(yes), yesPercent: '', noVotes: String(no), noPercent: '' });
const statewide = {
  raceTitle: 'Ballot Measures - Statewide Results',
  Reporting: '32.1% (9,781 of 30,482) precincts reporting',
  ReportingTime: 'November 3, 2026, 9:15 p.m.',
  'ballot-measures': [
    measure('01', 'Authorizes Bonds For Housing Affordability Programs. Legislative Statute.', 3181568, 792773),
    measure('39', 'Prohibits Citizens From Voting Unless They Present Government-Issued Identification. Initiative Constitutional Amendment.', 1900000, 2100000),
    measure('99', 'Not on our list', 1, 1),
  ],
};
const orange = { ...statewide, raceTitle: 'Ballot Measures - Orange Results', Reporting: '25.0% (250 of 1,000) precincts reporting',
  'ballot-measures': [measure('01', 'x', 274386, 73447), measure('39', 'x', 210000, 150000)] };

test('the list has all 14 propositions on the Nov 3 ballot', () => {
  assert.deepEqual(PROPS.contests.map(c => c.id), ['1', '2', '3', '4', '5', '37', '38', '39', '40', '41', '42', '43', '44', '45']);
  for (const c of PROPS.contests) {
    assert.ok(c.title && c.type && c.office, `Prop ${c.id} has a title, type and short label`);
    assert.deepEqual(c.candidates.map(x => x.name), ['Yes', 'No']);
  }
});

test('Secretary of State file → Yes/No votes per proposition', () => {
  const p = parseCAProps(statewide);
  assert.equal(p.pctIn, 32.1);
  assert.deepEqual(p.props.get('1'), { yes: 3181568, no: 792773 });
  assert.deepEqual(p.props.get('39'), { yes: 1900000, no: 2100000 });
  assert.equal(parseCAProps({ raceTitle: 'nothing yet' }), null);

  const payload = propsPayload(p, parseCAProps(orange), 0);
  assert.equal(payload.area, 'CAP');
  assert.deepEqual(payload.contests.map(c => c.id), ['1', '39'], 'measures not on our list are skipped');
  assert.deepEqual(payload.oc.props['39'], { yes: 210000, no: 150000 });
  assert.equal(payload.oc.pctIn, 25);
});

test('scheduled download: two files, saved under area CAP', async () => {
  const log = [];
  const fetchImpl = async url => {
    log.push(url);
    const body = url.endsWith('/ballot-measures') ? statewide : url.endsWith('/county/orange') ? orange : null;
    return body ? new Response(JSON.stringify(body)) : new Response('nope', { status: 404 });
  };
  const store = memoryStore();
  const out = await runIngest({ env: { STATE_FEEDS: 'CAP', SUBREQUEST_BUDGET: 10 }, universe, store, fetchImpl, now: Date.parse('2026-11-04T05:00:00Z') });
  assert.deepEqual(log, ['https://api.sos.ca.gov/returns/ballot-measures', 'https://api.sos.ca.gov/returns/ballot-measures/county/orange']);
  assert.equal(out.units[0].status, 'ok');
  const saved = await store.loadLocal('CAP');
  assert.equal(saved.contests.length, 2);
  assert.equal(saved.oc.props['1'].yes, 274386);
});

test('if the Orange County file fails, the statewide numbers still save', async () => {
  const fetchImpl = async url => url.endsWith('/ballot-measures') ? new Response(JSON.stringify(statewide)) : new Response('down', { status: 500 });
  const store = memoryStore();
  await runIngest({ env: { STATE_FEEDS: 'CAP', SUBREQUEST_BUDGET: 10 }, universe, store, fetchImpl, now: 1e13 });
  const saved = await store.loadLocal('CAP');
  assert.equal(saved.contests.length, 2);
  assert.equal(saved.oc, null);
});

test('propositions tab: list before results, Yes/No and OC count after, desk call shows', () => {
  const before = buildLocal(PROPS, null, new Map(), 0, 'CA-P');
  assert.equal(before.contests.length, 14);
  const p1 = before.contests[0];
  assert.equal(p1.id, 'CA-P1');
  assert.equal(p1.status, 'waiting');
  assert.equal(p1.title, 'Authorizes Bonds for Housing Affordability Programs');
  assert.equal(p1.type, 'Legislative statute');
  assert.equal(p1.oc, undefined);

  const res = propsPayload(parseCAProps(statewide), parseCAProps(orange), 0);
  const calls = new Map([['CA-P39', { race_id: 'CA-P39', candidate: 'No', source: 'OC Scanner desk', called_at: 5 }]]);
  const after = buildLocal(PROPS, res, calls, 0, 'CA-P');
  const p39 = after.contests.find(c => c.id === 'CA-P39');
  assert.equal(p39.status, 'called');
  assert.deepEqual(p39.call.winners, ['No']);
  assert.deepEqual(p39.ahead, ['No']);
  assert.equal(p39.margin, 5);
  assert.equal(p39.oc.yesPct, 58.3);
  assert.equal(p39.pctIn, 32.1);
  assert.equal(after.ocReporting.pctIn, 25);
  assert.equal(after.contests.find(c => c.id === 'CA-P2').status, 'waiting');
});

test('rehearsal: propositions fill in with an Orange County count', () => {
  const late = simulateProps(PROPS, 60 * 60000, 90);
  assert.equal(late.contests.length, 14);
  for (const c of late.contests) {
    assert.ok(c.candidates[0].votes > 0 && c.candidates[1].votes > 0);
    const oc = late.oc.props[c.id];
    assert.ok(oc.yes > 0 && oc.no > 0 && oc.yes + oc.no < c.candidates[0].votes + c.candidates[1].votes);
  }
  assert.equal(simulateProps(PROPS, 0, 90).contests.length, 0, 'nothing before the count starts');
});
