import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { deflateRawSync } from 'node:zlib';
import { runIngest, memoryStore } from '../src/ingest.js';
import { countyKey, countyFips, mnCountyFips } from '../src/feeds/county-names.js';
import { parseEVBreakdown, parseClarityDetail, parseCASOSCounties } from '../src/feeds/states.js';
import { parseOCSummary, localPayload, isMeasure } from '../src/feeds/oc-local.js';
import { buildLocal, measureParts } from '../src/local.js';
import { simulateCounties, simulateLocal } from '../src/sources/simulate-extra.js';

const universe = JSON.parse(readFileSync(new URL('../../data/races-2026.json', import.meta.url)));
const OC = JSON.parse(readFileSync(new URL('../../data/oc-local-2026.json', import.meta.url)));
const IDS = new Set(universe.races.map(r => r.id));

/* Samples below are made up, laid out like each office's published format (checked against the real files Oct 21). */

function fakeFetch(routes, log = []) {
  return async (url) => {
    log.push(url);
    const r = routes[url];
    if (r === undefined) return new Response('not found', { status: 404 });
    return new Response(r, { status: 200 });
  };
}
function zip(name, text) {
  const data = deflateRawSync(Buffer.from(text));
  const nameB = Buffer.from(name);
  const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(8, 8); local.writeUInt32LE(data.length, 18); local.writeUInt16LE(nameB.length, 26);
  const central = Buffer.alloc(46); central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(8, 10); central.writeUInt32LE(data.length, 20); central.writeUInt16LE(nameB.length, 28); central.writeUInt32LE(0, 42);
  const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(1, 8); end.writeUInt16LE(1, 10); end.writeUInt32LE(46 + nameB.length, 12); end.writeUInt32LE(30 + nameB.length + data.length, 16);
  return new Uint8Array(Buffer.concat([local, nameB, data, central, nameB, end]));
}
const run = (states, routes, env = {}) => runIngest({
  env: { STATE_FEEDS: states, SUBREQUEST_BUDGET: 200, COUNTY_FEEDS: 'on', ...env }, universe,
  store: memoryStore(), fetchImpl: fakeFetch(routes), now: Date.parse('2026-11-04T03:00:00Z'), force: true,
});
const cty = (out, id) => out.counties.find(r => r.raceId === id)?.payload;

test('county names: every spelling lands on the census county', () => {
  assert.equal(countyFips('GA', 'Appling County'), '13001');
  assert.equal(countyFips('GA', 'DeKalb'), countyFips('GA', 'DE KALB'));
  assert.equal(countyFips('FL', 'ST. LUCIE'), '12111');
  assert.equal(countyFips('FL', 'Saint Lucie'), '12111');
  assert.equal(countyFips('CA', 'contra costa'), '06013');
  assert.equal(countyFips('VA', 'Richmond City'), '51760');
  assert.equal(countyFips('VA', 'Richmond County'), '51159');
  assert.equal(countyFips('VA', 'James City County'), '51095');
  assert.equal(countyFips('VA', 'City of Fairfax'), '51600');
  assert.equal(countyFips('IA', "O'Brien"), '19141');
  assert.equal(countyFips('NC', 'NEW HANOVER'), '37129');
  assert.equal(countyFips('GA', 'Nowhere'), null);
  assert.equal(mnCountyFips('01'), '27001');
  assert.equal(mnCountyFips('87'), '27173');
  assert.equal(countyKey('St. Louis'), 'stlouis');
});

test('county files cover every state with every county', () => {
  const ga = JSON.parse(readFileSync(new URL('../../data/counties/GA.json', import.meta.url)));
  assert.equal(Object.keys(ga.counties).length, 159);
  assert.equal(ga.bbox.length, 4);
  assert.ok(ga.bbox[0] > 600 && ga.bbox[2] < 800, 'Georgia sits in the southeast of the 960×600 US map');
  for (const st of ['AK', 'HI', 'CA', 'TX', 'VA', 'RI']) assert.ok(Object.keys(JSON.parse(readFileSync(new URL(`../../data/counties/${st}.json`, import.meta.url))).counties).length > 1, st);
});

test('Enhanced Voting: results by county for statewide races', async () => {
  const api = 'https://results.sos.ga.gov/results/public/api';
  const opt = (n, p, v) => ({ name: [{ languageId: 'en', text: n }], party: { abbreviation: p }, voteCount: v });
  const routes = {
    [`${api}/jurisdictions/Georgia`]: JSON.stringify({ elections: [{ name: [{ text: 'November General Election' }], electionDate: '2026-11-03', publicElectionId: 'Gen110326' }] }),
    [`${api}/elections/Georgia/Gen110326/ballot-items?limit=500&offset=0`]: JSON.stringify({ totalRecordCount: 2, data: [
      { id: 'sen-1', name: [{ text: 'US Senate' }], reportingStatus: { reportingUnits: 10, totalUnits: 100 }, summaryResults: { ballotOptions: [opt('Jon Ossoff', 'DEM', 600), opt('Mike Collins', 'REP', 500)] } },
      { id: 'h13', name: [{ text: 'US House District 13' }], reportingStatus: {}, summaryResults: { ballotOptions: [opt('A B', 'DEM', 9)] } },
    ] }),
    [`${api}/elections/Georgia/Gen110326/data/ballot-item/sen-1`]: JSON.stringify({
      jurisdiction: {}, election: {},
      ballotItemWithBreakdownResults: { id: 'sen-1', breakdownResults: [
        { locality: { name: [{ text: 'Appling County' }], mapFeatureId: 'Appling', percentReporting: 50 }, ballotOptions: [opt('Jon Ossoff', 'DEM', 100), opt('Mike Collins', 'REP', 300)] },
        { locality: { name: [{ text: 'DeKalb County' }], mapFeatureId: 'DeKalb', percentReporting: null }, ballotOptions: [opt('Jon Ossoff', 'DEM', 500), opt('Mike Collins', 'REP', 200)] },
      ] },
    }),
  };
  const out = await run('GA', routes);
  assert.equal(out.units[0].status, 'ok', out.units[0].error);
  const c = cty(out, 'GA-SEN');
  assert.deepEqual(c.cands.map(x => [x.name, x.party]), [['Jon Ossoff', 'D'], ['Mike Collins', 'R']]);
  assert.deepEqual(c.counties['13001'], { v: [100, 300], pct: 50 });
  assert.deepEqual(c.counties['13089'].v, [500, 200]);
  assert.equal(out.counties.length, 1, 'House races get no county map');

  const off = await run('GA', routes, { COUNTY_FEEDS: 'off' });
  assert.equal(off.counties.length, 0, 'county downloads only when switched on');
  assert.equal(parseEVBreakdown({}, 'GA', 'GA-SEN').length, 0);
});

test('Clarity: county votes come from detail.xml, summed across vote types', async () => {
  const base = 'https://electionresults.iowa.gov/IA';
  const csv = 'contest name,choice name,party name,total votes,num Precinct total,num Precinct rptg\n"United States Senator","Zach Wahls","DEM",300,1658,800\n"United States Senator","Ashley Hinson","REP",500,1658,800';
  const xml = `<?xml version="1.0"?><ElectionResult><Contest key="1000" text="United States Senator" voteFor="1">
    <ParticipatingCounties><County name="Black Hawk" precinctsParticipating="10" precinctsReported="5" precinctsReportingPercent="50.00" /><County name="O'Brien" precinctsReportingPercent="100.00" /></ParticipatingCounties>
    <Choice key="1" text="Zach Wahls" party="DEM" totalVotes="300"><VoteType name="Election Day" votes="200"><County name="Black Hawk" votes="150" /><County name="O'Brien" votes="50" /></VoteType>
      <VoteType name="Absentee" votes="100"><County name="Black Hawk" votes="90" /><County name="O'Brien" votes="10" /></VoteType></Choice>
    <Choice key="2" text="Ashley Hinson" party="REP" totalVotes="500"><VoteType name="Election Day" votes="500"><County name="Black Hawk" votes="200" /><County name="O'Brien" votes="300" /></VoteType></Choice>
  </Contest><Contest key="2" text="State Representative District 1"><Choice text="X" party="DEM"><VoteType name="Election Day"><County name="Lyon" votes="5" /></VoteType></Choice></Contest></ElectionResult>`;
  const routes = {
    [`${base}/elections.json`]: JSON.stringify([{ EID: '130000', ElectionName: '2026 General Election', Date: '11/3/2026 12:00:00 AM' }]),
    [`${base}/130000/current_ver.txt`]: '400000',
    [`${base}/130000/400000/reports/summary.zip`]: zip('summary.csv', csv),
    [`${base}/130000/400000/reports/detailxml.zip`]: zip('detail.xml', xml),
  };
  const out = await run('IA', routes);
  assert.equal(out.units[0].status, 'ok', out.units[0].error);
  const c = cty(out, 'IA-SEN');
  assert.deepEqual(c.cands.map(x => x.name), ['Ashley Hinson', 'Zach Wahls']);
  assert.deepEqual(c.counties['19013'], { v: [200, 240], pct: 50 });
  assert.deepEqual(c.counties['19141'], { v: [300, 60], pct: 100 });
  assert.equal(parseClarityDetail(xml, 'IA', IDS).length, 4);
});

test('California: the maps file gives the statewide total and every county', async () => {
  const json = {
    statewide: { raceTitle: 'Governor - Statewide Results', Reporting: '40.0% (9,000 of 23,863) precincts reporting', candidates: [{ Name: 'Xavier Becerra', Party: 'Dem', Votes: '612,734' }, { Name: 'Steve Hilton', Party: 'Rep', Votes: '563,938' }] },
    orange: { raceTitle: 'Governor - Orange County Results', Reporting: '55.5% (1,000 of 1,800) precincts reporting', candidates: [{ Name: 'Xavier Becerra', Party: 'Dem', Votes: '100,000' }, { Name: 'Steve Hilton', Party: 'Rep', Votes: '150,000' }] },
    'contra-costa': { raceTitle: 'Governor - Contra Costa County Results', Reporting: '10% (1 of 10) precincts reporting', candidates: [{ Name: 'Xavier Becerra', Party: 'Dem', Votes: '9' }, { Name: 'Steve Hilton', Party: 'Rep', Votes: '1' }] },
  };
  const out = await runIngest({
    env: { STATE_FEEDS: 'CA', SUBREQUEST_BUDGET: 200, COUNTY_FEEDS: 'on' }, universe, store: memoryStore(), force: true, now: Date.parse('2026-11-04T03:00:00Z'),
    fetchImpl: fakeFetch({ 'https://api.sos.ca.gov/returns/maps/governor': JSON.stringify(json) }),
  });
  const gov = out.results.find(r => r.raceId === 'CA-GOV').payload;
  assert.equal(gov.candidates[0].votes, 612734);
  assert.equal(gov.pctIn, 40);
  const c = cty(out, 'CA-GOV');
  const at = name => c.cands.findIndex(x => x.name === name);
  assert.equal(c.counties['06059'].v[at('Steve Hilton')], 150000);
  assert.equal(c.counties['06059'].v[at('Xavier Becerra')], 100000);
  assert.equal(c.counties['06059'].pct, 55.5);
  assert.equal(c.counties['06013'].v[at('Xavier Becerra')], 9);
  assert.equal(parseCASOSCounties(json, 'CA-GOV').length, 4);
});

test('North Carolina, Florida and Minnesota: county rows', async () => {
  const nc = await run('NC', {
    'https://er.ncsbe.gov/enr/20261103/data/results_0.txt': JSON.stringify([
      { cnm: 'US SENATE (VOTE FOR 1)', lid: '1400', bnm: 'Roy Cooper', pty: 'DEM', vct: '700', prt: '10', ptl: '100' },
      { cnm: 'US SENATE (VOTE FOR 1)', lid: '1400', bnm: 'Michael Whatley', pty: 'REP', vct: '650', prt: '10', ptl: '100' },
    ]),
    'https://er.ncsbe.gov/enr/20261103/data/precinct_0.txt': JSON.stringify([
      { lid: '1400', aid: '1', anm: 'ALAMANCE', bnm: 'Roy Cooper', vct: '300', prt: '5', ptl: '39' },
      { lid: '1400', aid: '1', anm: 'ALAMANCE', bnm: 'Michael Whatley', vct: '400', prt: '5', ptl: '39' },
      { lid: '1400', aid: '65', anm: 'NEW HANOVER', bnm: 'Roy Cooper', vct: '400', prt: '1', ptl: '4' },
    ]),
  });
  assert.equal(nc.units[0].status, 'ok', nc.units[0].error);
  const ncs = cty(nc, 'NC-SEN');
  assert.deepEqual(ncs.counties['37001'].v, [300, 400]);
  assert.equal(ncs.counties['37129'].pct, 25);

  const head = 'ElectionDate\tPartyCode\tPartyName\tRaceCode\tRaceName\tCountyCode\tCountyName\tJuris1num\tJuris2num\tPrecincts\tPrecinctsReporting\tCanNameLast\tCanNameFirst\tCanNameMiddle\tCanVotes';
  const fl = await run('FL', { 'https://flelectionfiles.floridados.gov/enightfilespublic/20261103_ElecResultsFL.txt': [head,
    '11/03/2026\tREP\tRepublican Party\tGOV\tGovernor and Lieutenant Governor\tSTL\tSt. Lucie\t\t\t10\t5\tDonalds\tByron\t\t500',
    '11/03/2026\tDEM\tDemocratic Party\tGOV\tGovernor and Lieutenant Governor\tSTL\tSt. Lucie\t\t\t10\t5\tJolly\tDavid\t\t400',
    '11/03/2026\tDEM\tDemocratic Party\tREP\tRepresentative in Congress\tBRO\tBroward\t25\t\t100\t50\tMoskowitz\tJared\t\t10',
  ].join('\n') });
  assert.deepEqual(cty(fl, 'FL-GOV').counties['12111'], { v: [500, 400], pct: 50 });
  assert.equal(fl.counties.length, 1);

  const b = 'https://electionresultsfiles.sos.mn.gov/20261103';
  const mn = await run('MN', {
    [`${b}/ussenate.txt`]: 'MN;;;0102;U.S. Senator;;1001;Peggy Flanagan;;;DFL;10;100;400;40.00;1000',
    [`${b}/allracesbycounty.txt`]: ['MN;01;;0102;U.S. Senator;;1001;Peggy Flanagan;;;DFL;3;51;40;40.00;100', 'MN;01;;0102;U.S. Senator;;0302;Michele Tafoya;;;R;3;51;60;60.00;100',
      'MN;87;;0331;Governor & Lt Governor;;0302;Lisa Demuth;;;R;1;10;7;70.00;10', 'MN;01;;0104;U.S. Representative District 8;8;0401;X;;;DFL;1;1;1;1;1'].join('\r\n'),
  });
  assert.deepEqual(cty(mn, 'MN-SEN').counties['27001'].v.slice().sort(), [40, 60]);
  assert.equal(cty(mn, 'MN-GOV').counties['27173'].pct, 10);
});

/* ── Orange County ── */
const OC_XML = (n, rows) => `<?xml version="1.0" encoding="utf-8" standalone="yes"?>\r\n<NewDataSet>\r\n  <TotalBallotsCast>120000</TotalBallotsCast>\r\n  <VoterTurnout>6.29%</VoterTurnout>\r\n  <RegisteredVoters>1907719</RegisteredVoters>\r\n  <GeneratedDate>2026-11-03T20:05:00.000-08:00</GeneratedDate>\r\n${rows.map(([id, race, vf, name, party, votes, prec, rep]) => `  <Table>\r\n    <ElectionID>${n}</ElectionID>\r\n    <RaceID>${id}</RaceID>\r\n    <RaceName>${race}</RaceName>\r\n    <VoteFor>${vf}</VoteFor>\r\n    <ContestantName>${name}</ContestantName>\r\n    <Party>${party}</Party>\r\n    <PartyName />\r\n    <TotalVotes>${votes}</TotalVotes>\r\n    <NumberOfPrec>${prec}</NumberOfPrec>\r\n    <PrecReported>${rep}</PrecReported>\r\n    <ContestantWithdrawn>N</ContestantWithdrawn>\r\n    <ContestantWinner>N</ContestantWinner>\r\n  </Table>`).join('\r\n')}\r\n</NewDataSet>`;
const ocRows = [
  ['1020', 'Governor', 1, 'STEVE HILTON (REP)', 'REP', 9000, 2400, 600],
  ['5031', 'City of Costa Mesa, Mayor', 1, 'MIKE BULEY', '', 4000, 60, 30],
  ['5031', 'City of Costa Mesa, Mayor', 1, 'LOREN GAMEROS', '', 5000, 60, 30],
  ['5092', 'City of Huntington Beach, Member, City Council', 4, 'ANDREW GRUEL', '', 9000, 100, 25],
  ['5092', 'City of Huntington Beach, Member, City Council', 4, 'PAT BURNS', '', 8000, 100, 25],
  ['5401', 'K - City of Costa Mesa, Transient Occupancy Tax &amp; Services', 1, 'Yes', '', 6000, 60, 30],
  ['5401', 'K - City of Costa Mesa, Transient Occupancy Tax &amp; Services', 1, 'No', '', 3000, 60, 30],
  ...OC.contests.slice(0, 10).map(c => [c.id, c.name, c.voteFor, c.candidates[0].name.toUpperCase(), '', 10, 10, 1]),
];

test('Orange County: summary XML → local contests; statewide contests skipped; measures kept', () => {
  const p = parseOCSummary(OC_XML(24, ocRows));
  assert.equal(p.ballotsCast, 120000);
  const pay = localPayload(p, Date.parse('2026-11-04T04:00:00Z'));
  assert.ok(!pay.contests.some(c => c.id === '1020'), 'governor is on the national board');
  const mayor = pay.contests.find(c => c.id === '5031');
  assert.deepEqual(mayor.candidates.map(c => [c.name, c.votes]), [['Mike Buley', 4000], ['Loren Gameros', 5000]]);
  assert.equal(mayor.pctIn, 50);
  const k = pay.contests.find(c => c.id === '5401');
  assert.equal(k.measure, true);
  assert.equal(k.rawName, 'K - City of Costa Mesa, Transient Occupancy Tax & Services');
  assert.ok(isMeasure('AA - City of Orange, Fireworks Ordinance'));
  assert.deepEqual(measureParts('AA - City of Orange, Fireworks Ordinance'), { letter: 'AA', place: 'City of Orange', title: 'Fireworks Ordinance' });
});

test('Orange County: finds November\'s file by number and remembers it', async () => {
  const base = 'https://www.livevoterturnout.com/ENR/orangecaenr';
  const routes = {
    [`${base}/24/summary_24.xml`]: OC_XML(24, [['9999', 'Special Election Measure', 1, 'Yes', '', 1, 1, 1]]),   // a special election took 24
    [`${base}/25/summary_25.xml`]: OC_XML(25, ocRows),
  };
  const log = [];
  const store = memoryStore();
  const go = () => runIngest({ env: { STATE_FEEDS: 'OC', SUBREQUEST_BUDGET: 50 }, universe, store, fetchImpl: fakeFetch(routes, log), now: Date.parse('2026-11-04T04:00:00Z'), force: true });
  const out = await go();
  assert.equal(out.units[0].status, 'ok', out.units[0].error);
  assert.equal(out.units[0].meta.eid, 25);
  assert.ok((await store.loadLocal('OC')).contests.length >= 10);
  log.length = 0;
  await go();
  assert.deepEqual(log, [`${base}/25/summary_25.xml`]);
  const none = await runIngest({ env: { STATE_FEEDS: 'OC', SUBREQUEST_BUDGET: 50 }, universe, store: memoryStore(), fetchImpl: fakeFetch({}), now: Date.now(), force: true });
  assert.equal(none.units[0].status, 'not posted');
});

test('Orange County tab: list before results, results and desk calls after', () => {
  const before = buildLocal(OC, null);
  assert.equal(before.contests.length, OC.contests.length);
  assert.ok(before.contests.every(c => c.status === 'waiting'));
  const res = localPayload(parseOCSummary(OC_XML(24, ocRows)));
  const calls = new Map([['OC-5092', { race_id: 'OC-5092', candidate: 'Andrew Gruel | Pat Burns', source: 'OC Scanner desk', called_at: 1 }]]);
  const after = buildLocal(OC, res, calls);
  const hb = after.contests.find(c => c.id === 'OC-5092');
  assert.equal(hb.status, 'called');
  assert.deepEqual(hb.candidates.filter(c => c.winner).map(c => c.name), ['Andrew Gruel', 'Pat Burns']);
  const mayor = after.contests.find(c => c.id === 'OC-5031');
  assert.deepEqual(mayor.ahead, ['Loren Gameros']);
  assert.equal(mayor.margin, 11.1);
  const k = after.contests.find(c => c.id === 'OC-5401');
  assert.equal(k.group, 'measure');
  assert.equal(k.place, 'Costa Mesa');
  assert.match(k.name, /^Measure K \(City of Costa Mesa\)/);
});

test('rehearsal: county and local practice numbers', () => {
  const ga = universe.races.find(r => r.id === 'GA-SEN');
  const c = simulateCounties({ ...ga, candidates: [{ name: 'A', party: 'D', votes: 600 }, { name: 'B', party: 'R', votes: 400 }], pctIn: 60 }, Date.now());
  assert.equal(Object.keys(c.counties).length, 159);
  assert.equal(c.cands.length, 2);
  const late = simulateLocal(OC, 80 * 60000, 90);
  assert.ok(late.contests.length > OC.contests.length);
  assert.ok(late.contests.every(x => x.candidates.every(y => y.votes >= 0)));
  assert.equal(simulateLocal(OC, 1 * 60000, 90).contests.length, 0, 'nothing before polls close in the cycle');
});

test('Pennsylvania: the "by office" feed gives statewide totals, House races and counties', async () => {
  const row = (county, name, party, total) => `<tr><td>${county}</td><td>${name}</td><td>${party}</td><td style="text-align:right;">1</td><td style="text-align:right;">1</td><td style="text-align:right;">0</td><td style="text-align:right;">${total}</td><td style="text-align:right;">50.00</td></tr>`;
  const item = (title, rows) => `<item>\r\n      <title>${title}</title>\r\n      <description><![CDATA[<table><tr style="background-color:#b0c4de;"><td><b>County</b></td><td><b>Candidate Name</b></td><td><b>Party</b></td><td><b>Election Day Votes</b></td><td><b>Mail Votes</b></td><td><b>Provisional Votes</b></td><td><b>Total Votes</b></td><td><b>% of Vote</b></td></tr>${rows.join('')}</table>]]></description>\r\n    </item>`;
  const xml = `<rss version="2.0">\r\n  <channel>\r\n    <title>Results organized by office and vote totals for the 2026 General Election  2,212 Out of 9,066 Districts (24.40%)  - IN PERSON BALLOT REPORTING ONLY (Unofficial)</title>\r\n    ${[
    item('Governor', [row('ADAMS', 'JOSH SHAPIRO', 'DEM', '120'), row('ALLEGHENY', 'JOSH SHAPIRO', 'DEM', '2,656'), row('ADAMS', 'STACY GARRITY', 'REP', '300'), row('ALLEGHENY', 'STACY GARRITY', 'REP', '1,000')]),
    item('Representative in Congress (8th Congressional District)', [row('LUZERNE', 'PAIGE COGNETTI', 'DEM', '959'), row('LUZERNE', 'ROB BRESNAHAN JR', 'REP', '1,440')]),
    item('Senator in the General Assembly (2nd Senatorial District)', [row('PHILADELPHIA', 'SOMEONE', 'DEM', '5')]),
  ].join('\r\n')}\r\n  </channel>\r\n</rss>`;
  const out = await run('PA', { 'https://www.electionreturns.pa.gov/electionFeed.aspx?ID=83': xml });
  assert.equal(out.units[0].status, 'ok', out.units[0].error);
  const gov = out.results.find(r => r.raceId === 'PA-GOV').payload;
  assert.deepEqual(gov.candidates.map(c => [c.name, c.votes]), [['Josh Shapiro', 2776], ['Stacy Garrity', 1300]]);
  assert.equal(gov.pctIn, 24.4);
  assert.equal(out.results.find(r => r.raceId === 'PA-08').payload.candidates[0].name, 'Rob Bresnahan');
  assert.equal(out.results.length, 2, 'state legislature skipped');
  const c = cty(out, 'PA-GOV');
  assert.equal(c.counties['42001'].v[c.cands.findIndex(x => x.name === 'Stacy Garrity')], 300);
  assert.equal(out.counties.length, 1, 'counties only for statewide races');
  const page = await run('PA', { 'https://www.electionreturns.pa.gov/electionFeed.aspx?ID=83': '<html><body>Request unsuccessful. Incapsula incident</body></html>' });
  assert.equal(page.units[0].status, 'error');
});

test('Ohio: governor, Senate special and House districts from the contest API', async () => {
  const api = n => `https://liveresults.ohiosos.gov/Api/v1/Contest/GetContestDetailsObject?contestName=${encodeURIComponent(n)}&resultsLevel=&countyId=`;
  const cand = (n, p, v) => ({ primaryCandidate: n, candidateParty: p, vCount: v, isWriteIn: false });
  const out = await run('OH', {
    [api('Governor and Lieutenant Governor')]: JSON.stringify({ contestList: [{ name: 'Governor and Lieutenant Governor', reportedPrecincts: 50, totalPrecincts: 100, candidatesRunning: [cand('Vivek Ramaswamy', 'R', 600), cand('Amy Acton', 'D', 500)] }] }),
    [api('U.S. Senator')]: JSON.stringify({ contestList: [{ name: 'U.S. Senator', reportedPrecincts: 50, totalPrecincts: 100, candidatesRunning: [cand('Sherrod Brown', 'D', 550), cand('Jon Husted', 'R', 540), { primaryCandidate: 'Write-in', isWriteIn: true, vCount: 3 }] }] }),
    [api('Representative to Congress')]: JSON.stringify({ contestList: [{ name: 'Representative to Congress - District 09', reportedPrecincts: 10, totalPrecincts: 40, candidatesRunning: [cand('Marcy Kaptur', 'D', 90), cand('Derek Merrin', 'R', 95)] }] }),
  });
  assert.equal(out.units[0].status, 'ok', out.units[0].error);
  const ids = out.results.map(r => r.raceId).sort();
  assert.ok(ids.includes('OH-GOV') && ids.includes('OH-09') && ids.some(i => i.startsWith('OH-SEN')), ids.join());
  assert.equal(out.results.find(r => r.raceId === 'OH-09').payload.pctIn, 25);
});
