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
      { ...item('US House District 13', [['Everton Blair Jr.', 'DEM', 90]], 10, 20),
        summaryResults: { ballotOptions: [{ name: [{ text: 'Everton Blair Jr.' }], party: { abbreviation: 'DEM' }, voteCount: 90 }, { name: [{ text: 'Write-in' }], voteCount: 4, isWriteIn: true, isQualifiedWriteIn: false }] } },
    ] }),
  };
  const out = await run('GA', routes);
  assert.equal(out.units[0].status, 'ok');
  assert.equal(res(out, 'GA-SEN').candidates[0].name, 'Jon Ossoff');
  assert.equal(res(out, 'GA-SEN').pctIn, 25.2);
  assert.equal(res(out, 'GA-GOV').candidates[0].votes, 650);
  assert.equal(res(out, 'GA-13').pctIn, 50);
  assert.equal(res(out, 'GA-13').candidates.length, 1, 'unqualified write-ins are left out');
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

test('Washington: 2024-style file where district rows are labeled "Congressional"', async () => {
  const out = await run('WA', { 'https://results.vote.wa.gov/results/20261103/export/20261103_Congressional.csv': [
    '"Race","Candidate","Party","Votes","PercentageOfTotalVotes","JurisdictionName"',
    '"Congressional District 1 - U.S. Representative","Suzan DelBene","(Prefers Democratic Party)",227213,63,"Congressional"',
    '"Congressional District 1 - U.S. Representative","Jeb Brewer","(Prefers Republican Party)",132538,36.75,"Congressional"',
    '"Congressional District 1 - U.S. Representative","WRITE-IN"," ",907,0.25,"Congressional"',
  ].join('\n') });
  assert.deepEqual(res(out, 'WA-01').candidates.map(c => [c.name, c.party]), [['Suzan DelBene', 'D'], ['Jeb Brewer', 'R']]);
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

test('New Mexico: same CSV as Nebraska, House district in AreaNum, governor ticket', async () => {
  const head = 'RaceID,RaceName,PartyCode,AreaNum,CandidateID,CandidateName,VoteFor,CandidateVotes,CandidatePercentage,PrecinctsReporting,CandidateAbsenteeVotes,CandidateElectionDayVotes,CandidateEarlyVotes';
  // Laid out exactly like New Mexico's Nov 3, 2026 file (checked Oct 24); vote numbers made up
  const out = await run('NM', {
    'https://electionresults.sos.nm.gov/resultsCSV.aspx?text=All&type=FED&map=CTY': [head,
      '11185,"United States Senator","REP","",19608,"LARRY E MARKER",1,410,0,1102/2204,,,,',
      '11185,"United States Senator","DEM","",19607,"BEN R LUJAN",1,590,0,1102/2204,,,,',
      '11186,"United States Representative","REP","DISTRICT 1",19609,"NDIDIAMAKA EKWUA CHARLENE OKPAREKE",1,300,0,389/778,,,,',
      '11186,"United States Representative","DEM","DISTRICT 1",19610,"MELANIE ANN STANSBURY",1,500,0,389/778,,,,',
      '11188,"United States Representative","DEM","DISTRICT 3",19614,"TERESA LEGER FERNANDEZ",1,100,0,0/763,,,,'].join('\r\n'),
    'https://electionresults.sos.nm.gov/resultsCSV.aspx?text=All&type=SW&map=CTY': [head,
      '11530,"Governor and Lieutenant Governor","REP","",20141,"GREGGORY D HULL AND DAVID M GALLEGOS",1,45,0,1102/2204,,,,',
      '11530,"Governor and Lieutenant Governor","DEM","",20140,"DEB HAALAND AND STEPHANIE GARCIA RICHARD",1,55,0,1102/2204,,,,',
      '11531,"Secretary of State","DEM","",20150,"SOMEONE ELSE",1,9,0,1102/2204,,,,'].join('\r\n'),
  });
  assert.deepEqual(res(out, 'NM-SEN').candidates.map(c => [c.party, c.votes]), [['D', 590], ['R', 410]]);
  assert.equal(res(out, 'NM-SEN').pctIn, 50);
  assert.deepEqual(res(out, 'NM-01').candidates.map(c => c.votes), [500, 300]);
  assert.equal(res(out, 'NM-01').candidates[0].name, 'Melanie Stansbury');
  assert.equal(res(out, 'NM-03').candidates[0].votes, 100);
  assert.equal(res(out, 'NM-GOV').candidates[0].name, 'Deb Haaland');
});

test('Oregon/Montana: a redirect to the home page counts as "not posted", not as results', async () => {
  const html = '<!DOCTYPE html><html><head><title>Oregon Secretary of State</title></head><body>Welcome</body></html>';
  const out = await run('OR', {
    'https://results.oregonvotes.gov/resultsCSV.aspx?text=All&type=FED&map=CTY': html,
    'https://results.oregonvotes.gov/resultsCSV.aspx?text=All&type=SW&map=CTY': html,
  });
  assert.equal(out.units[0].status, 'not posted');
  assert.equal(out.results.length, 0);
});

test('Louisiana: races file + votes file, joined by candidate ID', async () => {
  // Laid out like voterportal.sos.la.gov's Nov 3, 2026 files (checked Oct 24); votes made up
  const races = { Races: { Race: [
    { ID: '67997', SpecificTitle: 'U. S. Senator', Choice: [{ ID: '124654', Desc: '"Jamie" Davis (DEM)' }, { ID: '124655', Desc: 'Julia Letlow (REP)' }] },
    { ID: '70195', SpecificTitle: 'U. S. Representative -- 1st Congressional District', Choice: [
      { ID: '124838', Desc: 'Randall Arrington (REP)' }, { ID: '128364', Desc: 'E. "Liddy" Glass (NOPTY)' },
      { ID: '124814', Desc: 'Lauren Jewett (DEM)' }, { ID: '128488', Desc: 'Steve Scalise (REP)' }] },
    { ID: '1', SpecificTitle: 'Justice of the Peace', Choice: [{ ID: '9', Desc: 'Someone (DEM)' }] },
  ] } };
  const votes = { Races: { Race: [
    { ID: '67997', PrecinctsReporting: '1861', PrecinctsExpected: '3722', Choice: [{ ID: '124654', VoteTotal: '300000' }, { ID: '124655', VoteTotal: '500000' }] },
    { ID: '70195', PrecinctsReporting: '522', PrecinctsExpected: '522', Choice: [{ ID: '124838', VoteTotal: '1000' }, { ID: '128364', VoteTotal: '500' }, { ID: '124814', VoteTotal: '40000' }, { ID: '128488', VoteTotal: '160000' }] },
  ] } };
  const base = 'https://voterportal.sos.la.gov/ElectionResults/ElectionResults/Data?blob=20261103';
  const out = await run('LA', { [`${base}/RacesCandidates_Multiparish.htm`]: JSON.stringify(races), [`${base}/Votes_Multiparish.htm`]: JSON.stringify(votes) });
  assert.deepEqual(res(out, 'LA-SEN').candidates.map(c => [c.name, c.party, c.votes]), [['Julia Letlow', 'R', 500000], ['Jamie Davis', 'D', 300000]]);
  assert.equal(res(out, 'LA-SEN').pctIn, 50);
  const la1 = res(out, 'LA-01');
  assert.equal(la1.candidates[0].name, 'Steve Scalise');
  assert.equal(la1.candidates.length, 4);
  assert.equal(la1.pctIn, 100);
});

test('Alaska: precinct CSV summed per candidate; the primary\'s file is ignored; paid plan only', async () => {
  const head = 'Precinct_name,Reporting_flag,Pct_Id,Pct_seq_nbr,Reg_voters,Aggregation_ID,Contest_Id,Contest_seq_nbr,Contest_title,Contest_party_name,Selectable_Options,Candidate_State_ID,candidate_id,candidate_name,Candidate_Type,cand_seq_nbr,Party_Code,total_ballots,total_votes';
  const row = (pct, contest, name, party, votes, type = 'C') => `"${pct}",0,"${pct}",1,100,"",6,5,"${contest}","",1,"",1,"${name}",${type},1,"${party}",100,${votes}`;
  const general = [head,
    row('01-600 Ketchikan No. 1', 'U.S. Senator', 'Sullivan, Dan', 'REP', 300), row('01-600 Ketchikan No. 1', 'U.S. Senator', 'Peltola, Mary', 'DEM', 200),
    row('District 1 - Absentee', 'U.S. Senator', 'Sullivan, Dan', 'REP', 50), row('District 1 - Absentee', 'U.S. Senator', 'Peltola, Mary', 'DEM', 80),
    row('01-600 Ketchikan No. 1', 'U.S. Senator', 'Write-in 1', 'NP', 4, 'W'),
    row('01-600 Ketchikan No. 1', 'Governor / Lieutenant Governor', 'Kreiss-Tomkins, Jonathan/Someone, Pat', 'DEM', 210),
    row('01-600 Ketchikan No. 1', 'U.S. Representative', 'Begich III, Nick', 'REP', 260),
    row('01-600 Ketchikan No. 1', 'House District 1', 'Local, Candidate', 'REP', 99),
  ].join('\n');
  const url = 'https://www.elections.alaska.gov/enr26/results/GA_ENR_Precinct_State_of_Alaska.csv';
  assert.equal((await run('AK', { [url]: general })).units.length, 0, 'off on the free plan');
  const out = await run('AK', { [url]: general }, { env: { COUNTY_FEEDS: 'on' } });
  assert.deepEqual(res(out, 'AK-SEN').candidates.map(c => [c.name, c.votes]), [['Dan Sullivan', 350], ['Mary Peltola', 280]]);
  assert.equal(res(out, 'AK-SEN').pctIn, null);
  assert.equal(res(out, 'AK-GOV').candidates[0].name, 'Jonathan Kreiss-Tomkins');
  assert.equal(res(out, 'AK-AL').candidates[0].votes, 260);
  const primary = [head, ...['A, A', 'B, B', 'C, C', 'D, D', 'E, E', 'F, F', 'G, G'].map(n => row('01-600 Ketchikan No. 1', 'U.S. Senator', n, 'REP', 1))].join('\n');
  const p = await run('AK', { [url]: primary }, { env: { COUNTY_FEEDS: 'on' } });
  assert.equal(p.units[0].status, 'not posted');
});

test('Maryland: finds November\'s folder, reads the governor and Congress pages', async () => {
  const table = rows => `<div class="tableWrapper"> <table class="table-banded"> <thead> <tr> <th scope="col">Name</th> <th scope="col">Party</th> <th scope="col">Early Voting</th><th scope="col">Election Day</th><th scope="col">Mail-In Ballot</th><th scope="col">Provisional</th> <th scope="col">Total</th> <th scope="col">Percentage</th> </tr></thead><tbody>${
    rows.map(([n, p, v]) => `<tr> <td> <div>${n}</div> </td> <td>${p}</td> <td class="VotesCol"> 1</td><td class="VotesCol"> 2</td><td class="VotesCol"> 3</td><td class="VotesCol"> 4</td> <td> ${v}</td> <td> 50.00%</td> </tr>`).join('')}</tbody></table></div>`;
  // Laid out like the June 2026 primary pages (checked Oct 24); November folder and numbers made up
  const site = 'https://elections.maryland.gov/elections/2026/';
  const out = await run('MD', {
    [`${site}index.html`]: '<a href="general_results/index.html">Unofficial General Election Results</a>',
    [`${site}general_results/`]: '<a href="gen_results_2026_1.html">Governor / Lt. Governor</a><a href="gen_results_2026_4.html">Representative in Congress</a><a href="gen_results_2026_4_1.html">1</a>',
    [`${site}general_results/gen_results_2026_1.html`]: `<h2>Governor / Lt. Governor</h2> <h4>Vote for 1</h4> (1,000 of 2,000 election day precincts reported) ${table([['Wes Moore and Aruna Miller<img alt="Winner Selected" src="/img/check.gif">', 'Democratic', '1,200,000'], ['Dan Cox and Someone Else', 'Republican', '800,000']])}`,
    [`${site}general_results/gen_results_2026_4.html`]: `<h2>Representative in Congress</h2> <h3>District 1</h3> <h4>Vote for 1</h4> (100 of 309 election day precincts reported) ${table([['Andy Harris', 'Republican', '150,000'], ['Dan Schwartz', 'Democratic', '90,000']])} <h3>District 6</h3> <h4>Vote for 1</h4> (50 of 200 election day precincts reported) ${table([['April McClain Delaney', 'Democratic', '120,000'], ['Robin Ficker', 'Republican', '118,000']])}`,
  });
  assert.deepEqual(res(out, 'MD-GOV').candidates.map(c => [c.name, c.party, c.votes]), [['Wes Moore', 'D', 1200000], ['Dan Cox', 'R', 800000]]);
  assert.equal(res(out, 'MD-GOV').pctIn, 50);
  assert.deepEqual(res(out, 'MD-01').candidates.map(c => [c.party, c.votes]), [['R', 150000], ['D', 90000]]);
  assert.equal(res(out, 'MD-06').candidates[0].name, 'April McClain Delaney');
  assert.equal(res(out, 'MD-06').pctIn, 25);
  assert.equal((await run('MD', { [`${site}index.html`]: '<a href="primary_results/index.html">Official Primary Results</a>' })).units[0].status, 'not posted');
});

test('South Carolina (Clarity on enr-scvotes.org): finds the general election from scvotes.gov when the list is empty', async () => {
  const base = 'https://www.enr-scvotes.org/SC';
  const csv = [
    'contest name,choice name,party name,total votes,percent of votes,registered voters,ballots cast,num Precinct total,num Precinct rptg,over votes,under votes',
    '"US House of Representatives District 1","Nancy Mace","REP",1000,55,0,0,200,100,0,0',
    '"US House of Representatives District 1","Somebody Else","DEM",800,45,0,0,200,100,0,0',
  ].join('\n');
  const routes = {
    [`${base}/elections.json`]: '[]',
    'https://scvotes.gov/elections-statistics/election-results/': [
      '<a href="https://www.enr-scvotes.org/SC/127179/">U.S. Senate Special Republican Runoff</a>',
      '<a href="https://www.enr-scvotes.org/SC/127500/">2026 Statewide General Election</a>',
    ].join(''),
    [`${base}/127500/current_ver.txt`]: '380001',
    [`${base}/127500/380001/reports/summary.zip`]: zip('summary.csv', csv),
  };
  const out = await run('SC', routes);
  assert.equal(res(out, 'SC-01').pctIn, 50);
  assert.equal(res(out, 'SC-01').candidates[0].votes, 1000);
  assert.equal((await run('SC', { [`${base}/elections.json`]: '[]', 'https://scvotes.gov/elections-statistics/election-results/': '<a href="https://www.enr-scvotes.org/SC/127179/">U.S. Senate Special Republican Runoff</a>' })).units[0].status, 'not posted');
});

test('Indiana: office-category JSON, House district from "(n)", write-ins skipped', async () => {
  // Laid out like Indiana's Nov 3, 2026 files (checked live Oct 24); votes made up
  const base = 'https://enr.indianavoters.in.gov/site/data';
  const elections = { Root: { WriteTime: '2026-11-04T01:00:00', JurisdictionsReporting: { TOTAL_ALLPRECINCTS: '5067', PRECINCTSREPORTING: '2533' },
    List: [{ Heading: 'Federal', Items: { Item: [{ OFFICECATEGORYID: '1005', OFFICE_CATEGORY_NAME: 'US Representative' }] } }] } };
  const offcat = { Root: { StatewideSummary: { Race: [
    { OFFICEID: '4919', SubSortOrder: 'United States Representative, (1) District', OFFICE_TITLE: 'United States Representative, First District',
      Candidates: { Candidate: [
        { NAME_ON_BALLOT: 'Frank J. Mrvan', PARTY: 'D', TOTAL: 52000 },
        { NAME_ON_BALLOT: 'Barb Regnitz', PARTY: 'R', TOTAL: 48000 },
        { NAME_ON_BALLOT: 'Alexander R (Alex) Degman (W/I)', PARTY: 'I', TOTAL: 12 }] } },
    { OFFICEID: '4923', SubSortOrder: 'United States Representative, (5) District', OFFICE_TITLE: 'United States Representative, Fifth District',
      Candidates: { Candidate: [{ NAME_ON_BALLOT: 'Victoria Spartz', PARTY: 'R', TOTAL: 70000 }, { NAME_ON_BALLOT: 'J. D. Ford', PARTY: 'D', TOTAL: 65000 }] } },
  ] } } };
  const out = await run('IN', { [`${base}/statewideElectionsC_A.json`]: JSON.stringify(elections), [`${base}/OffCatC_1005_A.json`]: JSON.stringify(offcat) });
  assert.deepEqual(res(out, 'IN-01').candidates.map(c => [c.name, c.party, c.votes]), [['Frank Mrvan', 'D', 52000], ['Barb Regnitz', 'R', 48000]]);
  assert.equal(res(out, 'IN-01').pctIn, 50);
  assert.equal(res(out, 'IN-05').candidates[0].name, 'Victoria Spartz');
});

test('Tennessee: office pages found from the home page; race data embedded in the HTML', async () => {
  const base = 'https://www.tnelectionresults.com';
  const chart = (race, title, cands, rep) => `<div class="chart-container" data-race="${race}" id="chart-${race}" data-candidates="${
    JSON.stringify(cands).replace(/"/g, '&quot;')}"> <div class="bar-head"> <h3 class="chart-title">${title}</h3> </div>
    <div class="px-lg-4 px-md-2 county-reporting-header-text"> ${rep} of 95 Counties Completed </div> </div>`;
  // Laid out like the Nov 2024 pages (archived); 2026 titles and numbers made up
  const out = await run('TN', {
    [`${base}/home`]: '<a href="/categories/us-senate/offices">US Senate</a><a href="/categories/us-house/offices">US House</a><a href="/categories/governor/offices">Governor</a><a href="/categories/general-assembly/offices">General Assembly</a>',
    [`${base}/categories/us-senate/offices`]: chart('United_States_Senate', 'United States Senate', [{ name: 'Bill Hagerty', party: 'Republican', votes: 900000 }, { name: 'Marquita Bradshaw', party: 'Democratic', votes: 500000 }], 50),
    [`${base}/categories/governor/offices`]: chart('Governor', 'Governor', [{ name: 'Marsha Blackburn', party: 'Republican', votes: 880000 }, { name: 'Jerri Green', party: 'Democratic', votes: 520000 }], 50),
    [`${base}/categories/us-house/offices`]: chart('United_States_House_of_Representatives_District_5', 'United States House of Representatives District 5',
      [{ name: 'Charlie Hatcher', party: 'Republican', votes: 100000 }, { name: 'Chaz Molder', party: 'Democratic', votes: 95000 }, { name: "Micheál O'Leary", party: 'Independent', votes: 2000 }], 7)
      + chart('United_States_House_of_Representatives_District_9', 'United States House of Representatives District 9', [{ name: 'Justin Pearson', party: 'Democratic', votes: 120000 }, { name: 'Brent Taylor', party: 'Republican', votes: 40000 }], 1),
  });
  assert.deepEqual(res(out, 'TN-SEN').candidates.map(c => [c.party, c.votes]), [['R', 900000], ['D', 500000]]);
  assert.equal(res(out, 'TN-GOV').candidates[0].name, 'Marsha Blackburn');
  assert.equal(res(out, 'TN-05').candidates.length, 3);
  assert.equal(res(out, 'TN-09').candidates[0].name, 'Justin Pearson');
  assert.equal(res(out, 'TN-SEN').pctLabel, 'counties');
  assert.equal((await run('TN', { [`${base}/home`]: '<p>Official election results for past elections can be found here</p>' })).units[0].status, 'not posted');
});

test('Missouri: reads the form, posts it back for the November general, parses the results table', async () => {
  // Form and table laid out like enr.sos.mo.gov (checked Oct 24 against the Aug 4, 2026 primary); November numbers made up
  const form = (opts) => `<form method="post" action="./" id="ctl01"><input type="hidden" name="__EVENTTARGET" value="" />
    <input type="hidden" name="__VIEWSTATE" value="abc&#43;123" /><input type="hidden" name="__VIEWSTATEGENERATOR" value="CA0B0334" />
    <input name="q" type="text" /><input type="button" value="Search" />
    <select name="ctl00$MainContent$cboElectionNames">${opts}</select>
    <input type="submit" name="ctl00$MainContent$btnElectionType" value="Submit" /><input type="hidden" name="__ncforminfo" value="xyz" /></form>`;
  const row = cells => `<tr> ${cells.map(c => `<td>${c}</td>`).join('')} </tr>`;
  const table = `<table>${[
    row(['<strong>U.S. REPRESENTATIVE - DISTRICT 2</strong>', '&nbsp;', '&nbsp;', '<strong>322 of 644 Precincts Reported</strong>']),
    row(['Ann Wagner', 'Republican', '120,000', '55.000%']),
    row(['Fred Wellman', 'Democratic', '98,000', '45.000%']),
    row(['&nbsp;', '<i><b>Total Votes:</b></i>', '<i><b>218,000</b></i>', '&nbsp;']),
    row(['<strong>STATE AUDITOR</strong>', '&nbsp;', '&nbsp;', '<strong>1 of 3000 Precincts Reported</strong>']),
    row(['Someone Else', 'Republican', '5', '100%']),
  ].join('')}</table>`;
  let posted = null;
  const url = 'https://enr.sos.mo.gov/';
  const out = await run('MO', { [url]: init => init.method === 'POST'
    ? (posted = new URLSearchParams(init.body), table)
    : form('<option value="750006905">State of Missouri - Primary Election, August 04, 2026</option><option selected="selected" value="750007001">State of Missouri - General Election, November 03, 2026</option>') });
  assert.equal(posted.get('ctl00$MainContent$cboElectionNames'), '750007001');
  assert.equal(posted.get('__VIEWSTATE'), 'abc+123');
  assert.equal(posted.get('ctl00$MainContent$btnElectionType'), 'Submit');
  assert.equal(posted.has('q'), false);
  const mo2 = res(out, 'MO-02');
  assert.ok(mo2, 'MO-02 parsed');
  assert.deepEqual(mo2.candidates.map(c => [c.party, c.votes]), [['R', 120000], ['D', 98000]]);
  assert.equal(mo2.pctIn, 50);
  // Before November's election is on the site: nothing is posted
  const before = await run('MO', { [url]: form('<option value="750006905">State of Missouri - Primary Election, August 04, 2026</option>') });
  assert.equal(before.units[0].status, 'not posted');
});
