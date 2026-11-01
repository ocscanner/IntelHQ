// Feeds added after the Oct 24 survey of the remaining small states. Layouts are copied from each office's live or
// archived pages; the vote numbers are made up.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runIngest, memoryStore } from '../src/ingest.js';
import { raceIdFor } from '../src/feeds/util.js';

const universe = JSON.parse(readFileSync(new URL('../../data/races-2026.json', import.meta.url)));
const IDS = new Set(universe.races.map(r => r.id));
function fakeFetch(routes, log = []) {
  return async (url, init = {}) => {
    log.push(url);
    let r = routes[url];
    if (typeof r === 'function') r = r(init);
    if (r === undefined) return new Response('not found', { status: 404 });
    if (typeof r === 'object' && !(r instanceof Uint8Array) && r.status == null) r = JSON.stringify(r);
    if (typeof r === 'string') return new Response(r, { status: 200 });
    return new Response(r.body ?? '', { status: r.status ?? 200 });
  };
}
const run = (states, routes, extra = {}) => runIngest({
  env: { STATE_FEEDS: states, SUBREQUEST_BUDGET: 200, ...extra.env }, universe,
  store: extra.store || memoryStore(), fetchImpl: fakeFetch(routes, extra.log), now: Date.parse('2026-11-04T03:00:00Z'), force: true,
});
const res = (out, id) => out.results.find(r => r.raceId === id)?.payload;
const tally = p => p.candidates.map(c => [c.name, c.party, c.votes]);

test('Rhode Island ballot wording "Senator in Congress" is the U.S. Senate race, not a House seat', () => {
  assert.equal(raceIdFor('Senator in Congress', 'RI', IDS), 'RI-SEN');
  assert.equal(raceIdFor('Representative in Congress District 2', 'RI', IDS), 'RI-02');
});

test('Arkansas: Tally ENR JSON — names from the contest list, votes and counties from the results files', async () => {
  const A = 'https://enr-results-api.totalresults.com';
  const eid = '11b07106-031e-4d7c-911a-d01fb473d6dd';
  const loc = (fips, rep, tot, a, b) => ({ locationId: fips, precinctsReporting: rep, totalPrecincts: tot, choices: [{ choiceID: 'c1', totalVotes: a }, { choiceID: 'c2', totalVotes: b }] });
  const routes = {
    [`${A}/Election/GetElectionList?cid=arkansas`]: [
      { electionID: eid, electionName: '2026 General Election - Judical Runoff', electionDate: '2026-11-03T00:00:00', isDefault: true },
      { electionID: 'x', electionName: '2026 Primary Runoff', electionDate: '2026-03-31T00:00:00' },
    ],
    [`${A}/Contest/GetContestSearchList?cid=arkansas&electionID=${eid}`]: { response: { contests: {
      k4: { contestId: 'k4', contestName: 'U.S. Congress District 04', choices: { c1: { id: 'c1', name: 'DEM James "Rus" Russell, III' }, c2: { id: 'c2', name: 'REP Bruce Westerman' } } },
      sd1: { contestId: 'sd1', contestName: 'State Senate District 01', choices: { s1: { id: 's1', name: 'DEM Tomeka Butler' } } },
      gov: { contestId: 'gov', contestName: 'Governor', choices: { g1: { id: 'g1', name: 'DEM Fred Love' }, g2: { id: 'g2', name: 'REP Sarah Huckabee Sanders' } } },
    } } },
    [`${A}/Contest/GetContestResults?cId=arkansas&electionID=${eid}&contestType=Federal`]: { response: { contests: {
      k4: { contestID: 'k4', precinctsReporting: 410, totalPrecincts: 820, choices: [{ choiceID: 'c1', totalVotes: 40000 }, { choiceID: 'c2', totalVotes: 90000 }],
        locations: { '05003': loc('05003', 15, 30, 1000, 3000), '05011': loc('05011', 0, 12, 0, 0) } },
    } } },
    [`${A}/Contest/GetContestResults?cId=arkansas&electionID=${eid}&contestType=Statewide`]: { response: { contests: {
      gov: { contestID: 'gov', precinctsReporting: 1384, totalPrecincts: 2768, choices: [{ choiceID: 'g1', totalVotes: 200000 }, { choiceID: 'g2', totalVotes: 350000 }],
        locations: { '05119': { locationId: '05119', precinctsReporting: 50, totalPrecincts: 100, choices: [{ choiceID: 'g1', totalVotes: 60000 }, { choiceID: 'g2', totalVotes: 40000 }] } } },
    } } },
  };
  const out = await run('AR', routes);
  const ar4 = res(out, 'AR-04');
  assert.deepEqual(tally(ar4), [['Bruce Westerman', 'R', 90000], ['James Russell', 'D', 40000]]);
  assert.equal(ar4.pctIn, 50);
  assert.deepEqual(tally(res(out, 'AR-GOV')), [['Sarah Huckabee Sanders', 'R', 350000], ['Fredrick Love', 'D', 200000]]);
  // County breakdown only with county feeds on
  const withCounties = await runIngest({ env: { STATE_FEEDS: 'AR', SUBREQUEST_BUDGET: 200, COUNTY_FEEDS: 'on' }, universe, store: memoryStore(), fetchImpl: fakeFetch(routes), now: Date.parse('2026-11-04T03:00:00Z'), force: true });
  assert.equal(withCounties.counties.length, 1, 'statewide race only (governor) gets county results');
  const pulaski = withCounties.counties[0].payload;
  assert.equal(withCounties.counties[0].raceId, 'AR-GOV');
  assert.ok(pulaski.counties['05119'], 'county keyed by FIPS');
});

test('Connecticut: static JSON; cross-endorsed party lines added together under the major party', async () => {
  const D = 'https://ctemspublic.tgstg.net/ng-app/data';
  const base = `${D}/election/108/48700`;
  const out = await run('CT', {
    [`${D}/Elections.json`]: [{ ID: '113', Name: '09/01/2026 -- September 1st Democratic Primary' }, { ID: '108', Name: '11/03/2026 -- November 2026 State Election' }],
    [`${D}/election/108/Version.json`]: { Version: 48700 },
    [`${base}/Lookupdata.json`]: {
      officeList: [{ 19663: { ID: '19663', NM: 'Governor and Lieutenant Governor', D: '0' } }, { 19666: { ID: '19666', NM: 'Representative in Congress 1', D: '1' } }, { 19700: { ID: '19700', NM: 'State Senator 1', D: '1' } }],
      partyIds: { 1: { CD: 'D', NM: 'Democratic Party' }, 6: { CD: 'R', NM: 'Republican Party' }, 12: { CD: 'WF', NM: 'Working Families Party' }, 7: { CD: 'G', NM: 'Green Party' } },
      candidateIds: {
        44186: { NM: 'Ned Lamont and Susan Bysiewicz', P: '1' }, 44187: { NM: 'Ryan Fazio and Someone Else', P: '6' }, 44190: { NM: 'Ned Lamont and Susan Bysiewicz', P: '12' },
        44188: { NM: 'Luke Bronin', P: '12' }, 44189: { NM: 'Luke Bronin', P: '1' }, 44191: { NM: 'Amy Chai', P: '6' }, 44192: { NM: 'Mary L. Sanders', P: '7' },
      },
    },
    [`${base}/stateVotes_Electiondata.json`]: {
      19663: [{ 44186: { V: '300000' } }, { 44187: { V: '250000' } }, { 44190: { V: '20000' } }],
      19666: [{ 44188: { V: '6000' } }, { 44189: { V: '90000' } }, { 44191: { V: '50000' } }, { 44192: { V: '3000' } }],
      19700: [{ 44199: { V: '10' } }],
    },
    [`${base}/officePrecincts_Electiondata.json`]: { 19663: '390 of 780 (50%)', 19666: '67 of 134 (50%)' },
  });
  assert.deepEqual(tally(res(out, 'CT-GOV')), [['Ned Lamont', 'D', 320000], ['Ryan Fazio', 'R', 250000]]);
  const ct1 = res(out, 'CT-01');
  assert.deepEqual(tally(ct1), [['Luke Bronin', 'D', 96000], ['Amy Chai', 'R', 50000], ['Mary Sanders', 'G', 3000]]);
  assert.equal(ct1.pctIn, 50);
});

test('Delaware: only the statewide tables count (county tables repeat the same offices)', async () => {
  const table = (cap, rows) => `<table class="lighthouse-table mb-2"><caption>${cap}</caption><thead><tr><th>Candidate Name</th><th>Party</th><th>Machine Votes</th><th>Absentee Votes</th><th>Early Voting Votes</th><th>Total Votes</th><th>Percentage</th></tr></thead><tbody>${rows.map(r => `<tr>${r.map((c, i) => `<td data-label="x${i}">${c}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
  const html = `<p>Results reporting status</p><p>265 of 530 election districts reporting</p><h2 id="enr-active-group">Statewide</h2>
    <div id="enr-tables"><div id="st" data-exists="true">${table('U.S. Senator', [['CHRIS COONS', 'Democratic Party', '1', '2', '3', '150,000', '60'], ['MICHAEL KATZ', 'Republican Party', '1', '2', '3', '100,000', '40']])}
    ${table('Representative in Congress', [['SARAH MCBRIDE', 'Democratic Party', '1', '2', '3', '140,000', '58'], ['JOSEPH ARMINIO', 'Republican Party', '1', '2', '3', '101,000', '42']])}</div>
    <div id="dist" data-exists="true">${table('U.S. Senator<br>Representative District 01<br>Democratic Party', [['CHRIS COONS', 'Democratic Party', '1', '2', '3', '7,000', '60']])}</div>
    <div id="nc" data-exists="true">${table('U.S. Senator', [['CHRIS COONS', 'Democratic Party', '1', '2', '3', '90,000', '60']])}</div></div>`;
  const out = await run('DE', { 'https://elections.delaware.gov/results/enr/GE2026.html': html + 'x'.repeat(500000) });
  const sen = res(out, 'DE-SEN');
  assert.deepEqual(tally(sen), [['Chris Coons', 'D', 150000], ['Michael Katz', 'R', 100000]]);
  assert.equal(sen.pctIn, 50);
  assert.deepEqual(tally(res(out, 'DE-AL')), [['Sarah McBride', 'D', 140000], ['Joseph Arminio', 'R', 101000]]);
  assert.equal((await run('DE', {})).units[0].status, 'not posted');
});

test('Hawaii: summary file in both layouts (2026 tab-separated, 2024 comma-separated with "(D)" names)', async () => {
  const head = '#FormatVersion 1\n#Contest ID\tContest Title\tContest Seq Nbr\tContest Type\tContest Party\tMail Blank Votes\tIn-Person Blank Votes\tMail Over Votes\tIn-Person Over Votes\tMail Invalid Votes\tIn-Person Invalid Votes\tRegistered Voters\tTotal Precincts\tCounted Precincts\tCandidate ID\tCandidate Name\tCandidate Seq Nbr\tCandidate Party\tMail Votes\tIn-Person Votes\tTotal Votes';
  const tsv = [head,
    '338\t"U.S. Representative, Dist I"\t1\tOF\t\t811\t17\t0\t0\t0\t0\t846543\t223\t111\t1\t"(D) CASE, Ed"\t1\t\t95000\t5000\t100000',
    '338\t"U.S. Representative, Dist I"\t1\tOF\t\t811\t17\t0\t0\t0\t0\t846543\t223\t111\t2\t"(R) LAM, Adriel"\t2\t\t40000\t2000\t42000',
    '543\tGovernor\t8\tOF\t\t1\t1\t0\t0\t0\t0\t846543\t494\t247\t1\t"(D) GREEN, Josh"\t1\t\t200000\t9000\t209000',
  ].join('\n');
  const out = await run('HI', { 'https://elections.hawaii.gov/wp-content/results/2026%20General/summary.txt': tsv });
  const hi1 = res(out, 'HI-01');
  assert.deepEqual(tally(hi1), [['Ed Case', 'D', 100000], ['Adriel Lam', 'R', 42000]]);
  assert.equal(hi1.pctIn, 49.8);
  assert.deepEqual(tally(res(out, 'HI-GOV')), [['Josh Green', 'D', 209000]]);
  const csv = '"70","U.S. Representative, Dist II","4","OF",,"18195","2071","364","18","0","0","860868","273","273","2","(D) TOKUDA, Jill N.","3",,"158616","7635","166251",\n"70","U.S. Representative, Dist II","4","OF",,"18195","2071","364","18","0","0","860868","273","273","3","(R) AWA, Brenton","1",,"63097","12374","75471",';
  const out2 = await run('HI', { 'https://files.hawaii.gov/elections/files/results/2026/General/summary.txt': csv });
  assert.deepEqual(tally(res(out2, 'HI-02')), [['Jill Tokuda', 'D', 166251], ['Brenton Awa', 'R', 75471]]);
});

test('Kansas: static pages; "D-Name" party prefix; ignored while the site still shows the primary', async () => {
  const race = (title, prec, cands, total) => `<div class='container-md'><div class='row race-heading'><div class='col-11'><h3>${title}</h3></div></div>
    <div class='row race-subheading'><div class='col-6'><p>Precincts Reporting: ${prec}</p></div><div class='col-2'><p>Votes</p></div><div class='col-1'><p>%</p></div></div>
    <div class='race-candidate-list'>${cands.map(([n, v, p]) => `<div class='row'><div class='col-6'><p>${n}</p></div><div class='col-2'><p>${v}</p></div><div class='col-1'><p>${p}</p></div><div class='col-3'><table><tr><td>&nbsp;</td></tr></table></div></div>`).join('')}
    <div class='row'><div class='col-6'><p>Total Votes</p></div><div class='col-2'><p>${total}</p></div></div></div>
    <p>Candidate</p><p>No Results</p><p>D-Someone Legend</p><p>1</p><p>2%</p>`;
  const page = (updated, body) => `<html><body><p>Last Update: ${updated}</p>${body}</body></html>`;
  const national = page('11/04/2026 1:15 AM',
    race('United States Senate', '2075 of 4150', [['D-Adam Hamilton', '300,000', '42%'], ['R-Roger Marshall', '410,000', '58%']], '710,000')
    + race('United States House of Representatives 3', '300 of 600', [['D-Sharice Davids', '120,000', '54%'], ['R-Eric Jenkins', '100,000', '45%'], ['L-Steven Hohe', '3,000', '1%']], '223,000'));
  const statewide = page('11/04/2026 1:15 AM', race('Governor / Lt. Governor', '2075 of 4150', [['D-Cindy Holscher', '330,000', '47%'], ['R-Ty Masterson', '372,000', '53%']], '702,000'));
  const out = await run('KS', { 'https://ent.sos.ks.gov/national.html': national, 'https://ent.sos.ks.gov/statewide.html': statewide });
  const sen = res(out, 'KS-SEN');
  assert.deepEqual(tally(sen), [['Roger Marshall', 'R', 410000], ['Adam Hamilton', 'D', 300000]]);
  assert.equal(sen.pctIn, 50);
  assert.deepEqual(tally(res(out, 'KS-03')), [['Sharice Davids', 'D', 120000], ['Eric Jenkins', 'R', 100000], ['Steven Hohe', 'L', 3000]]);
  assert.deepEqual(tally(res(out, 'KS-GOV')), [['Ty Masterson', 'R', 372000], ['Cindy Holscher', 'D', 330000]]);
  // August primary still up: page updated before Nov 3, titles end in "(R)"
  const primary = page('08/07/2026 5:29 PM', race('United States Senate (R)', '4150 of 4150', [['Roger Marshall', '267,972', '80%']], '335,468'));
  const before = await run('KS', { 'https://ent.sos.ks.gov/national.html': primary, 'https://ent.sos.ks.gov/statewide.html': primary });
  assert.equal(before.units[0].status, 'not posted');
});

test('Kentucky: one Election Night Reporting page; the ticker and duplicate tables are skipped', async () => {
  const tbl = (title, rows) => `<div class="results-tbl results-tbl-partisan"><div class="results-tbl-bar"><div class=results-tbl-title>${title}</div></div>
    <div class="results-tbl-content"><div class="results-tbl-row results-tbl-header"><div class="results-tbl-col1 results-tbl-header-name">CANDIDATE NAME</div></div>
    <div class="results-tbl-body">${rows.map(([n, p, a, t]) => `<div class=results-tbl-body-row><div class='results-tbl-row results-tbl-row-data'><div class="results-tbl-col1 results-tbl-row-candidate-name">${n}</div><div class="results-tbl-col2 results-tbl-row-candidate-party">${p}</div><div class="results-tbl-col3 results-tbl-row-candidate-absentee">${a}</div><div class="results-tbl-col4 results-tbl-row-candidate-total">${t}</div><div class="results-tbl-col5 results-tbl-row-candidate-percent">50%</div></div></div>`).join('')}</div>
    <div class="results-tbl-row results-tbl-footer"><div class="results-tbl-col3 results-tbl-footer-label">Contest Total</div><div class="results-tbl-col4 results-tbl-footer-total">999</div></div></div></div>`;
  const html = `<div>ALL RESULTS ARE UNOFFICIAL</div><div>November 3, 2026</div><div>2026 General Election</div>
    <div class="tickerItem"><div class="tickerTitle">UNITED STATES SENATOR</div><div class="tickerRow"><div class="tickerCandidate">Andy BARR</div><div class="tickerTotal">1</div></div></div>
    <div>STATEWIDE INFORMATION</div><div>Precincts</div><div>Participating: 3,189</div><div>Reporting: 1,595</div>
    ${tbl('UNITED STATES SENATOR', [['Andy BARR', 'REP', '60,000', '700,000'], ['Charles BOOKER', 'DEM', '50,000', '500,000']])}
    ${tbl('UNITED STATES SENATOR', [['Andy BARR', 'REP', '60,000', '700,000']])}
    ${tbl('UNITED STATES REPRESENTATIVE in CONGRESS 3rd Congressional District', [['Morgan McGARVEY', 'DEM', '9,000', '120,000'], ['Maria RODRIQUEZ', 'REP', '5,000', '70,000']])}`;
  const out = await run('KY', { 'https://vrsws.sos.ky.gov/liveresults/': html });
  const sen = res(out, 'KY-SEN');
  assert.deepEqual(tally(sen), [['Andy Barr', 'R', 700000], ['Charles Booker', 'D', 500000]]);
  assert.equal(sen.pctIn, 50);
  const ky3 = res(out, 'KY-03');
  assert.deepEqual(tally(ky3), [['Morgan McGarvey', 'D', 120000], ['Maria Rodriquez', 'R', 70000]]);
  assert.equal(ky3.pctIn, null);
  // Between elections: "under maintenance", or the primary
  const maint = await run('KY', { 'https://vrsws.sos.ky.gov/liveresults/': '<h1>Notice: Under Maintenance</h1>' });
  assert.equal(maint.units[0].status, 'not posted');
});

test('North Dakota: statewide page blocks; waits for the 2026 general', async () => {
  const cand = (n, p, v, win = '') => `<div class="section group${win}"><div class="col display-results-box-d"><h2>${n} </h2></div><div class="display-results-row"><div class="display-results-box-e"><div class="${p}">${p}</div></div><h2 class="display-results-box-g">${v}</h2><h2 class="display-results-box-f">50%</h2></div></div><hr>`;
  const page = header => `<div>${header}</div><div class="display-results-box-wrapper"><div class="display-results-box-a"><h1>Representative in Congress </h1><h2>Vote For 1</h2></div>
    <div class="display-results-box-b"><div class="precinct-fully">Precincts Fully: 193 / 385</div><div class="precinct-partial">Partially: 20 / 385</div></div></div>
    <div class="contest-content"><div class="col candidate-box"><div class="candidate-rows">${cand('Julie Fedorchak', 'Republican', '150,000', ' winner')}${cand('Trygve Hammer', 'Democratic-NPL', '70,000')}
    <div class="section group"><div class="col display-results-box-d"><h2><div class="show-writein">write-in </div></h2></div><div class="display-results-row"><h2 class="display-results-box-g">900</h2></div></div></div></div></div>`;
  const url = 'https://results.sos.nd.gov/ResultsSW.aspx?text=All&type=SW&map=CTY';
  const out = await run('ND', { [url]: page('UNOFFICIAL 2026 GENERAL ELECTION RESULTS') });
  const nd = res(out, 'ND-AL');
  assert.deepEqual(tally(nd), [['Julie Fedorchak', 'R', 150000], ['Trygve Hammer', 'D', 70000]]);
  assert.equal(nd.pctIn, 50.1);
  const old = await run('ND', { [url]: page('OFFICIAL 2024 GENERAL ELECTION RESULTS') });
  assert.equal(old.units[0].status, 'not posted');
});

test('Vermont: election JSON points at the current federal and statewide files; votes summed over towns', async () => {
  const S = 'https://static.electionresults.vermont.gov/';
  const guid = '68d61e96-1d28-4210-8c1d-8e90512ae105';
  const town = (tn, rows) => ({ tn, distReported: '1/1', rc: rows.map(([cn, pn, vc]) => ({ cn, pn, vc, isWriteIn: false })), wc: [{ cn: 'OTHER WRITE-IN', vc: 9 }] });
  const out = await run('VT', {
    [`${S}elections/elections.json`]: [
      { electionGuid: 'tm', electionName: 'TOWN MEETING  2026', electionDate: '2026-11-03T00:00:00', isGeneralElection: false, town: 'DANBY' },
      { electionGuid: guid, electionName: '2026 GENERAL ELECTION', electionDate: '2026-11-03T00:00:00', isGeneralElection: true, isStateWideElection: true, town: null },
    ],
    [`${S}elections/${guid}.json`]: { federal: { isEnable: true, path: `elections\\${guid}-f-20261104010000.json` }, stateWide: { isEnable: true, path: `elections\\${guid}-s-20261104010000.json` }, townsReporting: '124/247' },
    [`${S}elections/${guid}-f-20261104010000.json`]: { d: [{ pid: 0, o: [{ on: 'REPRESENTATIVE TO CONGRESS', cs: [town('ADDISON', [['BECCA BALINT', 'DEMOCRATIC', 400], ['GERALD MALLOY', 'REPUBLICAN', 200]]), town('ALBANY', [['BECCA BALINT', 'DEMOCRATIC', 100], ['GERALD MALLOY', 'REPUBLICAN', 150]])] }] }] },
    [`${S}elections/${guid}-s-20261104010000.json`]: { d: [{ pid: 0, o: [{ on: 'GOVERNOR', cs: [town('ADDISON', [['PHIL SCOTT', 'REPUBLICAN', 500], ['AMANDA JANOO', 'DEMOCRATIC', 100]])] }, { on: 'LIEUTENANT GOVERNOR', cs: [town('ADDISON', [['X Y', 'REPUBLICAN', 5]])] }] }] },
  });
  const vt = res(out, 'VT-AL');
  assert.deepEqual(tally(vt), [['Becca Balint', 'D', 500], ['Gerald Malloy', 'R', 350]]);
  assert.equal(vt.pctIn, 50.2);
  assert.equal(vt.pctLabel, 'towns');
  assert.deepEqual(tally(res(out, 'VT-GOV')), [['Phil Scott', 'R', 500], ['Amanda Janoo', 'D', 100]]);
});

test('Texas: the SOS results page (Nov 3 layout, Oct 31); Senate, House district, governor; write-ins skipped', async () => {
  const race = (title, pct, rows) => `<div class="election">${title} </div><div class="polling">Polling Locations Reporting: ${pct}%</div><div><table class="election"><tr class="header"><th class="party">Party</th><th class="candidate">Candidate</th><th class="ballot">Ballots Cast</th></tr>${rows.map(([p, n, v]) => `<tr><td class="party">${p}</td><td class="candidate">${n}</td>${v == null ? '<td class="ballot" />' : `<td class="ballot">${v}</td>`}</tr>`).join('')}</table></div>`;
  const html = `<h1>Election Results - Tuesday, November 3, 2026</h1><button><div>2026 NOVEMBER GENERAL ELECTION<span> (Updated 11/03/2026 09:10 PM)</span></div></button>
    ${race('U. S. SENATOR', 41.5, [['REPUBLICAN', 'KEN PAXTON', '2,100,000'], ['DEMOCRATIC', 'JAMES TALARICO', '1,900,000'], ['LIBERTARIAN', 'TED BROWN', '50,000'], ['WRITE-IN', 'AVERY AYERS', '12']])}
    ${race('U. S. REPRESENTATIVE DISTRICT 28', 50, [['REPUBLICAN', 'SOMEONE R', '80,000'], ['DEMOCRATIC', 'HENRY CUELLAR', '90,000']])}
    ${race('GOVERNOR', 41.5, [['REPUBLICAN', 'GREG ABBOTT', '2,200,000'], ['DEMOCRATIC', 'GINA HINOJOSA', '1,800,000']])}
    ${race('RAILROAD COMMISSIONER', 41.5, [['REPUBLICAN', 'X', '1']])}`;
  const out = await run('TX', { 'https://electionresults.sos.state.tx.us/results.html': html });
  const sen = res(out, 'TX-SEN');
  assert.deepEqual(tally(sen).map(([, p, v]) => [p, v]), [['R', 2100000], ['D', 1900000], ['L', 50000]]);
  assert.equal(sen.pctIn, 41.5);
  assert.equal(sen.pctLabel, 'polling locations');
  assert.deepEqual(tally(res(out, 'TX-28')).map(([, p, v]) => [p, v]), [['D', 90000], ['R', 80000]]);
  assert.deepEqual(tally(res(out, 'TX-GOV')).map(([, p, v]) => [p, v]), [['R', 2200000], ['D', 1800000]]);
  const before = await run('TX', { 'https://electionresults.sos.state.tx.us/results.html': '<h1>Election Results</h1><div>2026 MARCH PRIMARY</div>' });
  assert.equal(before.units[0].status, 'not posted');
});
