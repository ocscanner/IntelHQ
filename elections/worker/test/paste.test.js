// Paste from page (elections/paste.js): reading vote counts out of a results page copied in a browser.
// Page markup/text copied from New York's results page (Oct 31) and in the style of Nevada's results app; votes made up.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
const P = createRequire(import.meta.url)('../../paste.js');
const universe = JSON.parse(readFileSync(new URL('../../data/races-2026.json', import.meta.url)));
const racesOf = st => universe.races.filter(r => r.state === st).map(r => ({ id: r.id, name: r.name, candidates: r.candidates }));
const votes = (out, id) => Object.fromEntries(out.find(r => r.id === id).candidates.map(c => [c.name, c.votes]));

const nyRace = (title, rep, tot, cands) => `<table class="datatable"><tr><td class="resultsHeaderWrap" colspan="8"><table class="resultsHeaderWrap"><tr><td class="resultsHeader"><span><input type="checkbox"></span><span>&nbsp;${title} > All Counties</span></td><td class="resultsHeaderRight"><span>Election Districts Reporting: ${rep} of ${tot}&nbsp;</span></td></tr></table></td></tr>
  <tr><th>Candidate</th><th>Party</th><th>Graph (by Party)</th><th>% (by Party)</th><th>Votes (by Party)</th><th>Graph (by Candidate)</th><th>% (by Candidate)</th><th>Votes (by Candidate)</th></tr>
  ${cands.map(([name, lines, total]) => `<tr><td class="resultsColumnData" rowspan="${lines.length}">${name}</td><td>${lines[0][0]}</td><td></td><td><span>41.20 %</span></td><td>${lines[0][1]}</td><td></td><td><span>48.10 %</span></td><td>${total}</td></tr>`
    + lines.slice(1).map(([p, v]) => `<tr><td>${p}</td><td></td><td><span>3.10 %</span></td><td>${v}</td><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td></tr>`).join('')).join('')}
  <tr><td class="resultsColumnData" rowspan="1">Blank</td><td></td><td></td><td></td><td>500</td><td></td><td></td><td>500</td></tr>
  <tr><td>Total Votes</td><td>201,709</td></tr></table>`;

test('New York page (copied HTML): House races with fusion lines, % in from "Election Districts Reporting"', () => {
  const html = `<title>NYS Board of Elections Unofficial Election Night Results</title><h1>New York State Unofficial Election Night Results</h1>
    <p>Welcome to the New York State Board of Elections Election Night Reporting Page. Polls close at 9 PM.</p>`
    + nyRace('3rd Congressional District', '260', '520', [['Thomas R. Suozzi', [['DEM', '120,000']], '120,000'], ['Michael J. LiPetri Jr', [['REP', '100,000'], ['CON', '9,000']], '109,000']])
    + nyRace('17th Congressional District', '340', '679', [['Cait Conley', [['DEM', '90,000'], ['WOR', '8,000']], '98,000'], ['Mike Lawler', [['REP', '95,000'], ['CON', '6,200']], '101,200']]);
  const text = P.htmlToText(html);
  assert.equal(P.detectState(text), 'NY');
  const out = P.read(text, racesOf('NY'));
  assert.deepEqual(votes(out, 'NY-17'), { 'Cait Conley': 98000, 'Mike Lawler': 101200 });
  assert.deepEqual(votes(out, 'NY-03'), { 'Tom Suozzi': 120000, 'Mike LiPetri': 109000 });   // "Thomas R." / "Michael J. … Jr"
  assert.equal(out.find(r => r.id === 'NY-17').pctIn, 50.1);
  assert.equal(out.find(r => r.id === 'NY-03').pctIn, 50);
  assert.ok(out.every(r => r.status === 'ok'));
  assert.equal(out.length, 2);                                      // nothing invented for races not on the page
});

test('New York governor, plain text copy (tabs between cells): ticket names, fusion lines skipped', () => {
  const text = `Governor and Lieutenant Governor > All Counties\tElection Districts Reporting: 6,634 of 13,268
Candidate\tParty\tGraph (by Party)\t% (by Party)\tVotes (by Party)\tGraph (by Candidate)\t% (by Candidate)\tVotes (by Candidate)
Kathy C. Hochul / Adrienne E. Adams\tDEM\t\t48.00 %\t1,500,000\t\t51.20 %\t1,600,000
WOR\t\t3.20 %\t100,000\t\t\t
Bruce A. Blakeman / Todd Hood\tREP\t\t41.60 %\t1,300,000\t\t46.70 %\t1,460,000
CON\t\t4.80 %\t150,000\t\t\t
Total Votes\t3,125,000`;
  const out = P.read(text, racesOf('NY'));
  assert.deepEqual(votes(out, 'NY-GOV'), { 'Kathy Hochul': 1600000, 'Bruce Blakeman': 1460000 });
  assert.equal(out.find(r => r.id === 'NY-GOV').pctIn, 50);
});

test('Nevada-style cards (name, party, %, votes on separate lines): "Last, First" names, two Fords kept apart', () => {
  const text = `Nevada Election Results
2026 General Election · Unofficial
Governor
Statewide · 10 of 17 counties reporting
Ford, Aaron D.
DEM
47.1%
600,000
Ford, Danielle
NPP
1.6%
20,000
Lombardo, Joseph
REP
47.9%
610,000
None of These Candidates
0.7%
9,000
Representative In Congress, District 3
Congressional District 3 · 1 of 1 counties reporting
Kamerath, Jon
IAP
2.0%
6,000
Lee, Susie
DEM
50.5%
150,000
O'Donnell, Marty
REP
47.5%
140,000`;
  assert.equal(P.detectState(text), 'NV');
  const out = P.read(text, racesOf('NV'));
  assert.deepEqual(votes(out, 'NV-GOV'), { 'Aaron Ford': 600000, 'Joe Lombardo': 610000 });
  assert.equal(out.find(r => r.id === 'NV-GOV').pctIn, 58.8);
  assert.deepEqual(votes(out, 'NV-03'), { 'Susie Lee': 150000, "Martin O'Donnell": 140000, 'Jon Kamerath': 6000 });
  assert.equal(out.find(r => r.id === 'NV-03').pctIn, 100);
});

test('Generic page: one line per candidate; partial when a major candidate is missing; counts, not percents', () => {
  const text = `Michigan Governor — unofficial results
Jocelyn Benson (D)   812,345   50.7%
Precincts reporting: 38%`;
  const out = P.read(text, racesOf('MI'));
  const gov = out.find(r => r.id === 'MI-GOV');
  assert.equal(gov.status, 'partial');
  assert.deepEqual(votes(out, 'MI-GOV'), { 'Jocelyn Benson': 812345 });
  assert.ok(gov.missing.length >= 1);
  assert.equal(P.detectState(text), 'MI');
});
