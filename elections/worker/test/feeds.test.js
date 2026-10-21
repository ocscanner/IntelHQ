import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { deflateRawSync } from 'node:zlib';
import { raceIdFor, cleanName, parseCSV, unzipEntry } from '../src/feeds/util.js';
import { runIngest, memoryStore } from '../src/ingest.js';
import { buildBoard } from '../src/board.js';

const universe = JSON.parse(readFileSync(new URL('../../data/races-2026.json', import.meta.url)));
const IDS = new Set(universe.races.map(r => r.id));
const race = id => universe.races.find(r => r.id === id);

/* Samples below are made up, laid out like each office's published format. */

// Fake network: URL → body | {status, body, headers}
function fakeFetch(routes, log = []) {
  return async (url, init = {}) => {
    log.push(url);
    let r = routes[url];
    if (typeof r === 'function') r = r(init);
    if (r === undefined) return new Response('not found', { status: 404 });
    if (typeof r === 'string' || r instanceof Uint8Array) return new Response(r, { status: 200 });
    const status = r.status ?? 200;
    return new Response([204, 304].includes(status) ? null : (r.body ?? ''), { status, headers: r.headers });
  };
}
function zip(name, text) {
  const data = deflateRawSync(Buffer.from(text));
  const nameB = Buffer.from(name);
  const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(8, 8); local.writeUInt32LE(data.length, 18); local.writeUInt16LE(nameB.length, 26);
  const central = Buffer.alloc(46); central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(8, 10); central.writeUInt32LE(data.length, 20); central.writeUInt16LE(nameB.length, 28); central.writeUInt32LE(0, 42);
  const cdOffset = 30 + nameB.length + data.length;
  const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(1, 8); end.writeUInt16LE(1, 10); end.writeUInt32LE(46 + nameB.length, 12); end.writeUInt32LE(cdOffset, 16);
  return new Uint8Array(Buffer.concat([local, nameB, data, central, nameB, end]));
}
const run = (states, routes, extra = {}) => runIngest({
  env: { STATE_FEEDS: states, SUBREQUEST_BUDGET: 200, ...extra.env }, universe,
  store: extra.store || memoryStore(), fetchImpl: fakeFetch(routes, extra.log), now: extra.now ?? Date.parse('2026-11-04T03:00:00Z'), force: extra.force ?? true,
});
const res = (out, id) => out.results.find(r => r.raceId === id)?.payload;

test('contest names map to the right race', () => {
  const cases = [
    ['US SENATE (VOTE FOR 1)', 'NC', 'NC-SEN'],
    ['United States Senator', 'FL', 'FL-SEN-S'],
    ['U.S. Senator - Unexpired Term', 'OH', 'OH-SEN-S'],
    ['Governor & Lt Governor', 'MN', 'MN-GOV'],
    ['For Governor and Lt. Governor', 'IA', 'IA-GOV'],
    ['Lieutenant Governor', 'GA', null],
    ['US HOUSE OF REPRESENTATIVES DISTRICT 01 (VOTE FOR 1)', 'NC', 'NC-01'],
    ['Representative to the 120th United States Congress - District 8', 'CO', 'CO-08'],
    ['Congressional District 3', 'WA', 'WA-03'],
    ['U.S. REPRESENTATIVE DISTRICT 15', 'TX', 'TX-15'],
    ['United States Representative', 'SD', 'SD-AL'],
    ['NC STATE SENATE DISTRICT 01 (VOTE FOR 1)', 'NC', null],
    ['State Representative District 45', 'TX', null],
    ['United States Senator - Rep.', 'GA', null],
    ['US Senate', 'WA', null],                       // no Washington Senate race this year
  ];
  for (const [name, st, want] of cases) assert.equal(raceIdFor(name, st, IDS), want, `${st}: ${name}`);
  assert.equal(raceIdFor('For Representative in Congress - 2  Year Term', 'NE', IDS, { district: 'District 01' }), 'NE-01');
});

test('candidate names are tidied and matched to the race list', () => {
  assert.equal(cleanName('KEN PAXTON', race('TX-SEN')), 'Ken Paxton');
  assert.equal(cleanName('PAXTON, KEN', race('TX-SEN')), 'Ken Paxton');
  assert.equal(cleanName('Amy Klobuchar and Someone Else', race('MN-GOV'), { ticket: true }), 'Amy Klobuchar');
  assert.equal(cleanName("JOHN O'NEIL", race('TX-01')), "John O'Neil");
  assert.equal(cleanName('MARY MCDONALD', race('TX-01')), 'Mary McDonald');
});

test('CSV parser handles quotes, commas and Excel-style ="1/10"', () => {
  const rows = parseCSV('a,b,c\n"x, y","he said ""hi""",="1/10"\r\n');
  assert.deepEqual(rows[1], ['x, y', 'he said "hi"', '=1/10']);
});

test('zip reader inflates a Clarity summary', async () => {
  assert.equal(await unzipEntry(zip('summary.csv', 'hello,world'), /summary\.csv$/), 'hello,world');
});

test('North Carolina: statewide JSON, precincts, and 304 on the next run', async () => {
  const url = 'https://er.ncsbe.gov/enr/20261103/data/results_0.txt';
  const body = JSON.stringify([
    { cnm: 'US HOUSE OF REPRESENTATIVES DISTRICT 01 (VOTE FOR 1)', bnm: 'Don Davis', pty: 'DEM', vct: '120', prt: '50', ptl: '200' },
    { cnm: 'US HOUSE OF REPRESENTATIVES DISTRICT 01 (VOTE FOR 1)', bnm: 'Laurie Buckhout', pty: 'REP', vct: '100', prt: '50', ptl: '200' },
    { cnm: 'US HOUSE OF REPRESENTATIVES DISTRICT 01 (VOTE FOR 1)', bnm: 'Write-In (Miscellaneous)', pty: '', vct: '3', prt: '50', ptl: '200' },
    { cnm: 'NC STATE SENATE DISTRICT 01 (VOTE FOR 1)', bnm: 'Someone', pty: 'DEM', vct: '5', prt: '1', ptl: '1' },
  ]);
  const store = memoryStore();
  const out = await run('NC', { [url]: ({ headers }) => headers['If-None-Match'] === '"v1"' ? { status: 304 } : { body, headers: { etag: '"v1"' } } }, { store });
  const nc1 = res(out, 'NC-01');
  assert.equal(out.results.length, 1);
  assert.deepEqual(nc1.candidates.map(c => [c.name, c.party, c.votes]), [['Don Davis', 'D', 120], ['Laurie Buckhout', 'R', 100]]);
  assert.equal(nc1.pctIn, 25);
  assert.equal(nc1.source, 'NC State Board of Elections');
  const again = await run('NC', { [url]: ({ headers }) => headers['If-None-Match'] === '"v1"' ? { status: 304 } : { body } }, { store });
  assert.equal(again.units[0].status, 'unchanged');
  assert.equal(again.results.length, 0);
});

test('Georgia (Enhanced Voting): finds the Nov 3 election and reads every page', async () => {
  const api = 'https://results.sos.ga.gov/results/public/api';
  const item = (name, opts, rep = 40, tot = 159) => ({
    name: [{ languageId: 'en', text: name }], reportingStatus: { reportingUnits: rep, totalUnits: tot },
    summaryResults: { ballotOptions: opts.map(([n, p, v]) => ({ name: [{ languageId: 'en', text: n }], party: { abbreviation: p }, voteCount: v })) },
  });
  const routes = {
    [`${api}/jurisdictions/Georgia`]: JSON.stringify({ elections: [
      { name: [{ text: 'General Primary' }], electionDate: '2026-05-19', publicElectionId: 'GeneralPrimary51926' },
      { name: [{ text: 'November General Election' }], electionDate: '2026-11-03T00:00:00', publicElectionId: 'Gen110326' },
    ] }),
    [`${api}/elections/Georgia/Gen110326/ballot-items?limit=500&offset=0`]: JSON.stringify({ totalRecordCount: 3, data: [
      item('US Senate', [['Jon Ossoff', 'DEM', 600], ['Mike Collins', 'REP', 500]]),
      item('Governor', [['Keisha Lance Bottoms', 'DEM', 450], ['Rick Jackson', 'REP', 650]]),
    ] }),
    [`${api}/elections/Georgia/Gen110326/ballot-items?limit=500&offset=2`]: JSON.stringify({ totalRecordCount: 3, data: [
      item('US House District 13', [['Everton Blair Jr.', 'DEM', 90]], 10, 20),
    ] }),
  };
  const out = await run('GA', routes);
  assert.equal(out.units[0].status, 'ok');
  assert.equal(res(out, 'GA-SEN').candidates[0].name, 'Jon Ossoff');
  assert.equal(res(out, 'GA-SEN').pctIn, 25.2);
  assert.equal(res(out, 'GA-GOV').candidates[0].votes, 650);
  assert.equal(res(out, 'GA-13').pctIn, 50);
});

test('Enhanced Voting: not posted yet when the election list has no Nov 3 general', async () => {
  const out = await run('UT', { 'https://electionresults.utah.gov/results/public/api/jurisdictions/Utah': JSON.stringify({ elections: [] }) });
  assert.equal(out.units[0].status, 'not posted');
});

test('Colorado (Clarity): downloads the zip, then skips it while the version is unchanged', async () => {
  const base = 'https://results.enr.clarityelections.com/CO';
  const csv = [
    'contest name,choice name,party name,total votes,percent of votes,registered voters,ballots cast,num Area total,num Area rptg,over votes,under votes',
    '"Representative to the 120th United States Congress - District 8","Manny Rutinel","DEM",1000,51.00,0,0,64,32,0,0',
    '"Representative to the 120th United States Congress - District 8","Gabe Evans","REP",960,49.00,0,0,64,32,0,0',
    '"Governor/Lieutenant Governor","Phil Weiser / Someone","DEM",5000,60,0,0,64,32,0,0',
  ].join('\n');
  const log = [];
  const routes = {
    [`${base}/elections.json`]: JSON.stringify([{ EID: '120000', ElectionName: '2026 General Election', Date: '11/3/2026' }]),
    [`${base}/120000/current_ver.txt`]: '345678',
    [`${base}/120000/345678/reports/summary.zip`]: zip('summary.csv', csv),
  };
  const store = memoryStore();
  const out = await run('CO', routes, { store, log });
  assert.equal(res(out, 'CO-08').pctIn, 50);
  assert.equal(res(out, 'CO-08').candidates[1].name, 'Gabe Evans');
  assert.equal(res(out, 'CO-GOV').candidates[0].name, 'Phil Weiser');
  assert.equal(res(out, 'CO-GOV').pctLabel, 'reporting areas');
  const again = await run('CO', routes, { store, log });
  assert.equal(again.units[0].status, 'unchanged');
  assert.equal(log.filter(u => u.endsWith('summary.zip')).length, 1);
  assert.equal(log.filter(u => u.endsWith('elections.json')).length, 1, 'election id is remembered');
});

test('Texas: version files, Federal.json, missing StateWide.json is fine', async () => {
  const base = 'https://results.texas-election.com/static/data';
  const routes = {
    [`${base}/Version.json`]: JSON.stringify({ ___versionNo: 77 }),
    [`${base}/ElectionConstants_77.json`]: JSON.stringify({ electionInfo: { 2026: { G: { 51000: { N: '2026 November 3rd General Election' } } } } }),
    [`${base}/election/51000/Version.json`]: JSON.stringify({ ___versionNo: 12 }),
    [`${base}/election/51000/12/Federal.json`]: JSON.stringify({ Races: [
      { N: 'U.S. SENATOR', Candidates: [{ N: 'JAMES TALARICO', P: 'DEM', V: 1000 }, { N: 'KEN PAXTON', P: 'REP', V: 1100 }] },
      { N: 'U.S. REPRESENTATIVE DISTRICT 15', PR: 100, TP: 400, Candidates: [{ N: 'BOBBY PULIDO', P: 'DEM', V: 50 }, { N: 'MONICA DE LA CRUZ', P: 'REP', V: 49 }] },
    ] }),
  };
  const out = await run('TX', routes);
  assert.equal(out.units[0].status, 'ok', out.units[0].error);
  assert.deepEqual(res(out, 'TX-SEN').candidates.map(c => c.name), ['Ken Paxton', 'James Talarico']);
  assert.equal(res(out, 'TX-15').pctIn, 25);
  assert.equal(res(out, 'TX-15').candidates[1].name, 'Monica De La Cruz');
});

test('Florida: adds counties together, counts each county\'s precincts once', async () => {
  const head = 'ElectionDate\tPartyCode\tPartyName\tRaceCode\tRaceName\tCountyCode\tCountyName\tJuris1num\tJuris2num\tPrecincts\tPrecinctsReporting\tCanNameLast\tCanNameFirst\tCanNameMiddle\tCanVotes';
  const tsv = [head,
    '11/03/2026\tDEM\tDemocratic Party\tUSS\tUnited States Senator\tALA\tAlachua\t\t\t10\t4\tNixon\tAngie\t\t500',
    '11/03/2026\tREP\tRepublican Party\tUSS\tUnited States Senator\tALA\tAlachua\t\t\t10\t4\tMoody\tAshley\t\t400',
    '11/03/2026\tDEM\tDemocratic Party\tUSS\tUnited States Senator\tBAY\tBay\t\t\t30\t16\tNixon\tAngie\t\t100',
    '11/03/2026\tREP\tRepublican Party\tUSS\tUnited States Senator\tBAY\tBay\t\t\t30\t16\tMoody\tAshley\t\t700',
    '11/03/2026\tDEM\tDemocratic Party\tREP\tRepresentative in Congress\tBRO\tBroward\t25\t\t100\t50\tMoskowitz\tJared\t\t10',
  ].join('\n');
  const out = await run('FL', { 'https://flelectionfiles.floridados.gov/enightfilespublic/20261103_ElecResultsFL.txt': tsv });
  const sen = res(out, 'FL-SEN-S');
  assert.deepEqual(sen.candidates.map(c => [c.name, c.votes]), [['Ashley Moody', 1100], ['Angie Nixon', 600]]);
  assert.equal(sen.pctIn, 50);
  assert.equal(res(out, 'FL-25').candidates[0].name, 'Jared Moskowitz');
});

test('Minnesota: statewide rows only; a missing file is skipped', async () => {
  const b = 'https://electionresultsfiles.sos.mn.gov/20261103';
  const out = await run('MN', {
    [`${b}/ussenate.txt`]: ['MN;;;0102;U.S. Senator;;1001;Peggy Flanagan;;;DFL;10;100;400;40.00;1000', 'MN;;;0102;U.S. Senator;;0302;Michele Tafoya;;;R;10;100;600;60.00;1000', 'MN;01;;0102;U.S. Senator;;1001;Peggy Flanagan;;;DFL;1;2;9;50.00;18'].join('\n'),
    [`${b}/ushouse.txt`]: 'MN;;;0104;U.S. Representative District 2;2;0401;Matt Little;;;DFL;4;20;8;40.00;20',
  });
  assert.equal(res(out, 'MN-SEN').candidates[0].votes, 600);
  assert.equal(res(out, 'MN-SEN').pctIn, 10);
  assert.equal(res(out, 'MN-02').candidates[0].name, 'Matt Little');
  assert.equal(res(out, 'MN-02').candidates[0].party, 'D');
});

test('Nebraska: statewide and district CSVs, county rows ignored', async () => {
  const head = 'RaceID,RaceName,PartyCode,AreaType,AreaNum,OfficeSeqNo,BallotOrder,CandidateID,CandidateName,CurrentDateTime,VoteFor,CandidateVotes,CandidatePercentage,PrecinctsReporting';
  const out = await run('NE', {
    'https://electionresults.nebraska.gov/resultsCSV.aspx?text=All&type=SW&map=CTY': [head,
      '1,"United States Senator","REP","SW","",110,,1,"Pete Ricketts",11/3/2026 9:33:43 PM,1,400,40,="300/1200"',
      '1,"United States Senator","IND","SW","",110,,2,"Dan Osborn",11/3/2026 9:33:43 PM,1,600,60,="300/1200"',
      '1,"United States Senator","IND","CTY","Adams",110,,2,"Dan Osborn",11/3/2026 9:33:43 PM,1,99,99,="1/1"'].join('\n'),
    'https://electionresults.nebraska.gov/resultsCSV.aspx?text=All&type=CG&map=DIST': [head,
      '2,"For Representative in Congress - 2  Year Term","DEM","CG","District 02",120,,3,"Denise Powell",11/3/2026 9:33:43 PM,1,70,70,="20/80"'].join('\n'),
  });
  assert.deepEqual(res(out, 'NE-SEN').candidates.map(c => [c.name, c.party, c.votes]), [['Dan Osborn', 'I', 600], ['Pete Ricketts', 'R', 400]]);
  assert.equal(res(out, 'NE-SEN').pctIn, 25);
  assert.equal(res(out, 'NE-02').pctIn, 25);
});

test('Washington: congressional CSV with long party names', async () => {
  const out = await run('WA', { 'https://results.vote.wa.gov/results/20261103/export/20261103_Congressional.csv': [
    'Race,Candidate,Party,Votes,PercentageOfTotalVotes,JurisdictionName',
    'Congressional District 3,Marie Gluesenkamp Perez,Prefers Democratic Party,510,51,Congressional District 3',
    'Congressional District 3,John Braun,Prefers Republican Party,490,49,Congressional District 3',
    'Congressional District 3,Marie Gluesenkamp Perez,Prefers Democratic Party,200,50,Clark',
  ].join('\n') });
  assert.deepEqual(res(out, 'WA-03').candidates.map(c => [c.party, c.votes]), [['D', 510], ['R', 490]]);
});

test('scheduler: stays inside the download budget, oldest jobs first, and fills the board', async () => {
  const store = memoryStore();
  const caRoute = n => JSON.stringify({ raceTitle: `U.S. House of Representatives District ${n} - Districtwide Results`, Reporting: '10% (1 of 10) precincts reporting',
    candidates: [{ Name: 'A Dem', Party: 'Dem', Votes: '10' }, { Name: 'B Rep', Party: 'Rep', Votes: '20' }] });
  const routes = Object.fromEntries(Array.from({ length: 52 }, (_, i) => [`https://api.sos.ca.gov/returns/us-rep/district/${i + 1}`, caRoute(i + 1)]));
  const t0 = Date.parse('2026-11-04T04:00:00Z');
  const first = await runIngest({ env: { STATE_FEEDS: 'CA', SUBREQUEST_BUDGET: 20 }, universe, store, fetchImpl: fakeFetch(routes), now: t0 });
  assert.equal(first.used, 20);
  const second = await runIngest({ env: { STATE_FEEDS: 'CA', SUBREQUEST_BUDGET: 20 }, universe, store, fetchImpl: fakeFetch(routes), now: t0 + 5 * 60000 });
  assert.equal(second.used, 20);
  assert.ok(second.units.every(u => !first.units.some(f => f.unit === u.unit)), 'second run picks jobs the first run skipped');
  const third = await runIngest({ env: { STATE_FEEDS: 'CA', SUBREQUEST_BUDGET: 20 }, universe, store, fetchImpl: fakeFetch(routes), now: t0 + 6 * 60000 });
  assert.equal(third.used, 13, 'only the 13 jobs never run are due; the rest ran under 9 minutes ago');
  assert.equal(store.units.get('CA:CA-GOV').status, 'error');        // governor file missing in this test

  const rows = await store.loadResults();
  const b = buildBoard(universe, [{ name: 'States', races: new Map(rows.map(r => [r.raceId, r.payload])) }], { calls: new Map(), results: new Map() });
  const ca45 = b.races.find(r => r.id === 'CA-45');
  assert.equal(ca45.status, 'counting');
  assert.equal(ca45.source, 'California Secretary of State');
  assert.equal(ca45.call, null, 'state numbers never make a call');
  assert.equal(b.summary.house.leading.R, 52);
});
