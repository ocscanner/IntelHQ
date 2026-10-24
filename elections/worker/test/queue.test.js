import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseDDHQ, parseAP, matchCall, samePerson } from '../src/queue/parse.js';
import { suggest } from '../src/queue/model.js';
import { buildQueue, targets, rehearsalPosts } from '../src/queue/build.js';
import { readDDHQ, postsToRows } from '../src/queue/watch.js';

const universe = JSON.parse(readFileSync(new URL('../../data/races-2026.json', import.meta.url)));
const PROPS = JSON.parse(readFileSync(new URL('../../data/ca-props-2026.json', import.meta.url)));
const RACES = universe.races.map(r => ({ id: r.id, state: r.state, chamber: r.chamber, district: r.district ?? 0, special: !!r.special, candidates: r.candidates }));
const PROP_IDS = PROPS.contests.map(c => ({ id: `CA-P${c.id}` }));
const race = id => universe.races.find(r => r.id === id);
const nameOf = (id, party) => race(id).candidates.find(c => c.party === party).name;

test('names: same person despite middle names, nicknames, suffixes', () => {
  assert.ok(samePerson('Robert S. "Bob" Smith Jr.', 'Bob Smith') === false, 'first names differ');
  assert.ok(samePerson('Robert S. "Bob" Smith Jr.', 'Robert Smith'));
  assert.ok(samePerson('Mary Sattler Peltola', 'Mary Peltola'));
  assert.ok(samePerson('Jenny Rae Le Roux', 'Jenny Le Roux'));
  assert.ok(!samePerson('Dan Sullivan', 'Mary Peltola'));
});

test('DDHQ: primary-night posts are skipped; November calls match our races', () => {
  assert.equal(parseDDHQ('Decision Desk HQ projects Ashley Hinson wins the IA US Senate Republican Primary\n\n#DecisionMade: 9:07 PM EDT'), null);
  assert.equal(parseDDHQ('DDHQ Race Update (est. 24% in): Iowa US Senate'), null);
  assert.equal(parseDDHQ('DDHQ FORECAST UPDATE Ohio: Tossup -> Leans Democratic'), null);

  const r = nameOf('IA-SEN', 'R');
  const m = matchCall(parseDDHQ(`Decision Desk HQ projects ${r} wins the IA US Senate\n\n#DecisionMade: 9:07 PM EST`), RACES, PROP_IDS);
  assert.deepEqual([m.raceId, m.candidate, m.party], ['IA-SEN', r, 'R']);

  const d = nameOf('CA-47', 'D');
  assert.equal(matchCall(parseDDHQ(`Decision Desk HQ projects ${d} wins the CA US House 47 General Election`), RACES, PROP_IDS).raceId, 'CA-47');

  const s = race('OH-SEN-S').candidates[0];
  assert.equal(matchCall(parseDDHQ(`Decision Desk HQ projects ${s.name} wins the OH US Senate Special`), RACES, PROP_IDS).raceId, 'OH-SEN-S');

  const g = race('OH-GOV').candidates[0].name;
  assert.equal(matchCall(parseDDHQ(`Decision Desk HQ projects ${g} wins the OH Governor`), RACES, PROP_IDS).raceId, 'OH-GOV');

  const p = matchCall(parseDDHQ('Decision Desk HQ projects California Proposition 39 fails\n#DecisionMade'), RACES, PROP_IDS);
  assert.deepEqual([p.raceId, p.winners], ['CA-P39', ['No']]);
  const p2 = matchCall(parseDDHQ('Decision Desk HQ projects Yes on CA Prop 3 passes'), RACES, PROP_IDS);
  assert.deepEqual([p2.raceId, p2.winners], ['CA-P3', ['Yes']]);
});

test('AP: race-call posts match; primaries, runoffs and other states\' measures are skipped', () => {
  assert.equal(parseAP('WASHINGTON (AP) — Nithya Raman advances to runoff election for Los Angeles mayor. #APRaceCall at 7:55 EDT.'), null);
  const r = nameOf('IA-SEN', 'R');
  const m = matchCall(parseAP(`WASHINGTON (AP) — Republican ${r} wins election to U.S. Senate in Iowa. #APRaceCall at 9:07 p.m. EST.`), RACES, PROP_IDS);
  assert.equal(m.raceId, 'IA-SEN');
  const d = nameOf('CA-47', 'D');
  assert.equal(matchCall(parseAP(`WASHINGTON (AP) — Democrat ${d} wins election to U.S. House in California's 47th Congressional District. #APRaceCall at 1:12 a.m. EST.`), RACES, PROP_IDS).raceId, 'CA-47');
  const wv = race('WV-SEN').candidates.find(c => c.party === 'R').name;
  assert.equal(matchCall(parseAP(`WASHINGTON (AP) — ${wv} wins election to U.S. Senate in West Virginia. #APRaceCall`), RACES, PROP_IDS).raceId, 'WV-SEN');
  const p = matchCall(parseAP('SACRAMENTO, Calif. (AP) — California voters approve Proposition 1, a housing bond. #APRaceCall at 11:40 p.m. EST.'), RACES, PROP_IDS);
  assert.deepEqual(p.winners, ['Yes']);
  assert.match(matchCall(parseAP('DENVER (AP) — Colorado voters reject Proposition 140. #APRaceCall'), RACES, PROP_IDS).unmatched, /outside California/);
});

test('calls we can\'t place are kept as "couldn\'t match", not guessed', () => {
  assert.ok(matchCall(parseDDHQ('Decision Desk HQ projects Pat Example wins the ZZ Mayor'), RACES, PROP_IDS).unmatched);
  // Right race, a name we don't have: kept on that race and flagged
  const m = matchCall(parseDDHQ('Decision Desk HQ projects Zed Nobody wins the OH Governor'), RACES, PROP_IDS);
  assert.equal(m.raceId, 'OH-GOV');
  assert.ok(m.nameNotOnList);
});

test('Bluesky feed → queue rows (only new posts, only calls)', async () => {
  const name = nameOf('IA-SEN', 'R');
  const feed = { feed: [
    { post: { uri: 'at://did:plc:x/app.bsky.feed.post/aaa', author: { handle: 'decisiondeskhq.bsky.social' }, record: { $type: 'app.bsky.feed.post', createdAt: '2026-11-04T02:07:00Z', text: `Decision Desk HQ projects ${name} wins the IA US Senate\n\n#DecisionMade: 9:07 PM EST` } } },
    { post: { uri: 'at://did:plc:x/app.bsky.feed.post/bbb', author: { handle: 'decisiondeskhq.bsky.social' }, record: { $type: 'app.bsky.feed.post', createdAt: '2026-11-04T02:05:00Z', text: 'DDHQ Race Update (est. 40% in): Iowa US Senate' } } },
    { post: { uri: 'at://did:plc:y/app.bsky.feed.post/ccc', author: { handle: 'someone.else' }, record: { $type: 'app.bsky.feed.post', createdAt: '2026-11-04T02:06:00Z', text: 'Decision Desk HQ projects X wins the IA Governor' } } },
  ] };
  const posts = await readDDHQ(async url => { assert.match(url, /getAuthorFeed\?actor=decisiondeskhq\.bsky\.social/); return new Response(JSON.stringify(feed)); });
  assert.equal(posts.length, 2, 'only DDHQ\'s own posts');
  const rows = postsToRows(posts, 'DDHQ', { races: RACES, props: PROP_IDS, since: 0 });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].raceId, 'IA-SEN');
  assert.equal(rows[0].url, 'https://bsky.app/profile/decisiondeskhq.bsky.social/post/aaa');
  assert.equal(postsToRows(posts, 'DDHQ', { races: RACES, props: PROP_IDS, since: Date.parse('2026-11-04T02:10:00Z') }).length, 0, 'older than the last check');
});

test('model: unopposed, blowouts and the remaining-vote test; cautious in slow-count states', () => {
  const c = (votes, extra = {}) => ({ id: 'X', state: 'OH', kind: 'race', cands: votes.map((v, i) => ({ name: `Cand ${i}`, party: i ? 'R' : 'D', votes: v })), ...extra });
  assert.equal(suggest(c([5000], { pctIn: 10 })).reason, 'Unopposed');
  assert.equal(suggest(c([60000, 20000], { pctIn: 30 })).confidence, 'high');               // 50-pt blowout
  assert.equal(suggest(c([55000, 45000], { pctIn: 90 })).confidence, 'high');               // 10 pts, ~11k left, trailer needs ~95%
  assert.equal(suggest(c([52000, 48000], { pctIn: 90 })), null);                             // 4 pts: too close
  assert.equal(suggest(c([53500, 46500], { pctIn: 45 })), null);                             // 7 pts, lots left
  assert.equal(suggest(c([55000, 45000], { pctIn: 90, called: true })), null);
  // California: 100% of precincts isn't the whole count, so only the margin counts
  assert.equal(suggest(c([53000, 47000], { state: 'CA', pctIn: 100 })), null);
  assert.equal(suggest(c([57000, 43000], { state: 'CA', pctIn: 70 })).confidence, 'medium');
  assert.equal(suggest(c([61000, 39000], { state: 'CA', pctIn: 50 })).confidence, 'high');
  // Georgia needs a majority (else runoff)
  assert.equal(suggest({ ...c([49000, 30000, 21000], { state: 'GA', pctIn: 95 }) }), null);
  // Proposition: Yes/No, judged like California
  const p = suggest({ id: 'CA-P1', kind: 'prop', cands: [{ name: 'Yes', votes: 3_900_000 }, { name: 'No', votes: 2_000_000 }], pctIn: 60 });
  assert.deepEqual([p.confidence, p.winners], ['high', ['Yes']]);
  // Vote for 2: the gap between 2nd and 3rd decides
  const v2 = suggest({ id: 'OC-1', kind: 'local', voteFor: 2, cands: [{ name: 'A', votes: 9000 }, { name: 'B', votes: 8000 }, { name: 'C', votes: 3000 }], pctIn: 70 });
  assert.deepEqual(v2.winners, ['A', 'B']);
});

test('queue: DDHQ calls, conflicts, model suggestions and auto-resolved items', () => {
  const ia = race('IA-SEN'), oh = race('OH-GOV');
  const R = n => ia.candidates.find(c => c.party === n).name;
  const board = { races: [
    { ...ia, preCandidates: ia.candidates, candidates: [{ name: R('R'), party: 'R', votes: 600000 }, { name: R('D'), party: 'D', votes: 400000 }], pctIn: 70, call: null },
    { ...oh, preCandidates: oh.candidates, candidates: [], pctIn: null, call: { candidate: oh.candidates[0].name, party: oh.candidates[0].party } },
    { ...race('CA-47'), preCandidates: race('CA-47').candidates, candidates: [], pctIn: null, call: { candidate: race('CA-47').candidates[0].name, party: race('CA-47').candidates[0].party } },
  ] };
  const rows = [
    { key: 'DDHQ|1', source: 'DDHQ', race_id: 'IA-SEN', candidate: R('R'), party: 'R', status: 'new', posted_at: 1000, text: 't' },
    { key: 'DDHQ|2', source: 'DDHQ', race_id: 'OH-GOV', candidate: oh.candidates[0].name, party: oh.candidates[0].party, status: 'new', posted_at: 2000 },
    { key: 'AP|3', source: 'AP', race_id: 'CA-47', candidate: race('CA-47').candidates[1].name, party: race('CA-47').candidates[1].party, status: 'new', posted_at: 3000 },
    { key: 'DDHQ|4', source: 'DDHQ', race_id: null, candidate: 'Pat', status: 'new', posted_at: 4000, note: 'couldn’t tell which race' },
    { key: 'DDHQ|5', source: 'DDHQ', race_id: 'IA-SEN', candidate: R('R'), status: 'dismissed', posted_at: 500 },
  ];
  const q = buildQueue({ rows, targets: targets(board, null, null), now: 10000 });
  assert.deepEqual(q.items.map(i => [i.type, i.key]), [['conflict', 'AP|3'], ['call', 'DDHQ|1'], ['unmatched', 'DDHQ|4']]);
  assert.deepEqual(q.autoResolved, ['DDHQ|2'], 'same call already on the board');
  assert.equal(q.items.find(i => i.type === 'conflict').current, race('CA-47').candidates[0].name);
  // IA has a DDHQ call pending, so the model stays quiet there

  const q2 = buildQueue({ rows: [], targets: targets(board, null, null), now: 10000 });
  const model = q2.items.find(i => i.raceId === 'IA-SEN');
  assert.equal(model.type, 'model');
  assert.equal(model.confidence, 'high');
  assert.equal(model.candidate, R('R'));
  assert.ok(q2.newKeys.some(k => k.key === model.key));
  // Dismissed stays dismissed
  const q3 = buildQueue({ rows: [{ key: model.key, source: 'MODEL', status: 'dismissed' }], targets: targets(board, null, null), now: 10000 });
  assert.equal(q3.items.find(i => i.raceId === 'IA-SEN'), undefined);
});

test('rehearsal: practice DDHQ calls go through the real parser', () => {
  const ia = race('IA-SEN');
  const board = { races: [{ ...ia, candidates: [{ name: ia.candidates[1].name, party: ia.candidates[1].party, votes: 600 }, { name: ia.candidates[0].name, votes: 400 }], total: 1000, pctIn: 70, margin: 20, call: null }] };
  const posts = rehearsalPosts(board, null, 1e6, () => 0.1);
  const rows = postsToRows(posts, 'DDHQ', { races: RACES, props: PROP_IDS, since: 0 });
  assert.equal(rows.find(r => r.raceId === 'IA-SEN')?.candidate, ia.candidates[1].name);
  assert.ok(rows.some(r => !r.raceId), 'one practice post that can\'t be matched');
});

test('queue: a computed item already stored appears once', () => {
  const ia = race('IA-SEN');
  const board = { races: [{ ...ia, preCandidates: ia.candidates, candidates: [], pctIn: null, call: null }] };
  const row = { key: 'DDHQ|sim-IA-SEN', source: 'DDHQ', raceId: 'IA-SEN', candidate: ia.candidates[0].name, party: ia.candidates[0].party, text: 't' };
  const stored = { key: row.key, source: 'DDHQ', race_id: 'IA-SEN', candidate: row.candidate, party: row.party, status: 'new', created_at: 5 };
  const q = buildQueue({ rows: [stored], targets: targets(board, null, null), extra: [row], now: 10 });
  assert.equal(q.items.filter(i => i.key === row.key).length, 1);
  assert.equal(q.newKeys.length, 0);
});
