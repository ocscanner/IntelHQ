// Run: node --test income/test/*.test.js   (synthetic data only; never commit real analytics exports)
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../income-core.js');
const X = require('../x-core.js');

const HEAD = 'Date,Impressions,Likes,Engagements,Bookmarks,Shares,New follows,Unfollows,Replies,Reposts,Profile visits,Create Post,Video views,Media views';
// Build an export for `n` days ending `end`, newest first like X's file.
function exportCsv(end, n, verified, f) {
  const lines = [HEAD];
  for (let i = 0; i < n; i++) {
    const d = X.addDays(end, -i);
    const [y, m, dd] = d.split('-').map(Number);
    const dt = new Date(Date.UTC(y, m - 1, dd));
    const label = dt.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
    const imp = f(d, i);
    const posts = 5;
    lines.push(`"${label}",${imp},10,20,1,1,3,1,2,2,5,${posts},${verified ? '' : 7},${verified ? '' : 9}`);
  }
  return lines.join('\n');
}

test('parseXDate handles X’s "Sat, Nov 21, 2026" and other forms', () => {
  assert.equal(X.parseXDate('Sat, Nov 21, 2026'), '2026-11-21');
  assert.equal(X.parseXDate('Nov 1, 2026'), '2026-11-01');
  assert.equal(X.parseXDate('2026-11-21'), '2026-11-21');
  assert.equal(X.parseXDate('11/21/2026'), '2026-11-21');
  assert.equal(X.parseXDate('Total'), null);
});

test('parseOverview reads columns and detects the Verified export', () => {
  const all = X.parseOverview(C.parseCSV(exportCsv('2026-11-21', 3, false, () => 1000)), 'account_overview_analytics.csv');
  assert.equal(all.kind, 'all');
  assert.equal(all.days.length, 3);
  assert.equal(all.from, '2026-11-19');
  assert.equal(all.days[2].impressions, 1000);
  assert.equal(all.days[2].posts, 5);
  assert.equal(all.days[2].newFollows, 3);
  // Verified: blank video/media columns, even when the file is renamed
  const ver = X.parseOverview(C.parseCSV(exportCsv('2026-11-21', 3, true, () => 100)), 'export.csv');
  assert.equal(ver.kind, 'verified');
  assert.equal(X.parseOverview(C.parseCSV(exportCsv('2026-11-21', 3, false, () => 1)), 'overview (Verified).csv').kind, 'verified');
  assert.throws(() => X.parseOverview(C.parseCSV('Name,Amount\nA,1'), 'x.csv'), /Date column/);
});

test('mergeDays keeps all and verified side by side; a newer import replaces a day', () => {
  let store = {};
  store = X.mergeDays(store, X.parseOverview(C.parseCSV(exportCsv('2026-11-21', 2, false, () => 1000)), 'a.csv')).days;
  const r = X.mergeDays(store, X.parseOverview(C.parseCSV(exportCsv('2026-11-21', 2, true, () => 100)), 'a (Verified).csv'));
  store = r.days;
  assert.equal(r.added, 2);
  assert.equal(store['2026-11-21'].all.impressions, 1000);
  assert.equal(store['2026-11-21'].verified.impressions, 100);
  const again = X.mergeDays(store, X.parseOverview(C.parseCSV(exportCsv('2026-11-21', 1, true, () => 250)), 'Verified.csv'));
  assert.equal(again.updated, 1);
  assert.equal(again.days['2026-11-21'].verified.impressions, 250);
});

test('payout windows: Revenue Sharing uses its period; Original Content Rewards is derived from the pay date', () => {
  const rs = C.normalizeEntry({ date: '2026-09-12', source: 'x_ads', kind: 'revenue', net: 63540, periodStart: '2026-08-29', periodEnd: '2026-09-11' });
  assert.deepEqual(X.windowFor(rs, 8), { from: '2026-08-29', to: '2026-09-11', derived: false });
  const ocr = C.normalizeEntry({ date: '2026-11-20', source: 'x_ads', kind: 'revenue', net: 53732 });
  // 14 days ending 8 days before Nov 20: Oct 29 .. Nov 11 (same window as the analysis)
  assert.deepEqual(X.windowFor(ocr, 8), { from: '2026-10-29', to: '2026-11-11', derived: true });
});

function fixture() {
  // 120 days ending Nov 21; verified = 50,000/day, all = 400,000/day
  let days = {};
  days = X.mergeDays(days, X.parseOverview(C.parseCSV(exportCsv('2026-11-21', 120, false, () => 400000)), 'all.csv')).days;
  days = X.mergeDays(days, X.parseOverview(C.parseCSV(exportCsv('2026-11-21', 120, true, () => 50000)), 'Verified.csv')).days;
  const entries = [
    // $420 for 14 days × 50k = 700k verified → $0.60 / 1k
    C.normalizeEntry({ id: 'a', date: '2026-11-20', source: 'x_ads', kind: 'revenue', net: 42000, note: 'Original Content Rewards' }),
    // $350 → $0.50 / 1k
    C.normalizeEntry({ id: 'b', date: '2026-11-06', source: 'x_ads', kind: 'revenue', net: 35000, note: 'Original Content Rewards' }),
    // $700 → $1.00 / 1k
    C.normalizeEntry({ id: 'c', date: '2026-09-12', source: 'x_ads', kind: 'revenue', net: 70000, periodStart: '2026-08-29', periodEnd: '2026-09-11', note: 'Revenue Sharing' }),
    // other income is ignored
    C.normalizeEntry({ id: 'd', date: '2026-11-10', source: 'kofi', kind: 'revenue', net: 5000 }),
    // payout outside the data window: kept, but no rate
    C.normalizeEntry({ id: 'e', date: '2026-01-17', source: 'x_ads', kind: 'revenue', net: 10000, periodStart: '2026-01-03', periodEnd: '2026-01-16', note: 'Revenue Sharing' }),
  ];
  return { days, entries };
}

test('payoutRows and rate', () => {
  const { days, entries } = fixture();
  const rows = X.payoutRows(entries, days, 8);
  assert.equal(rows.length, 4);
  assert.equal(rows[0].id, 'a');
  assert.equal(rows[0].verifiedImpressions, 700000);
  assert.equal(rows[0].allImpressions, 5600000);
  assert.equal(rows[0].posts, 70);
  assert.ok(Math.abs(rows[0].perK - 0.6) < 1e-9);
  assert.equal(rows[0].verifiedShare, 0.125);
  assert.equal(rows[0].program, 'Original Content Rewards');
  assert.equal(rows.find((r) => r.id === 'c').program, 'Revenue Sharing');
  assert.equal(rows.find((r) => r.id === 'e').perK, null);
  const r = X.rate(rows, 6);
  assert.equal(r.basedOn, 3);
  assert.ok(Math.abs(r.perK - 0.6) < 1e-9); // median of 0.5, 0.6, 1.0
  assert.equal(r.low, 0.5);
  assert.equal(r.high, 1);
});

test('currentPeriod pace and goal', () => {
  const { days, entries } = fixture();
  const rows = X.payoutRows(entries, days, 8);
  const r = X.rate(rows, 6);
  // Newest window ends Nov 11 → current window Nov 12..Nov 25; data through Nov 21 = 10 days
  const cp = X.currentPeriod(rows, days, '2026-11-21', r, 50000);
  assert.equal(cp.from, '2026-11-12');
  assert.equal(cp.to, '2026-11-25');
  assert.equal(cp.elapsed, 10);
  assert.equal(cp.verifiedSoFar, 500000);
  assert.equal(cp.projected, 700000);
  assert.equal(cp.projectedCents, 42000);
  // $500 at $0.60/1k = 833,333 impressions; 333,333 left over 4 days
  assert.equal(cp.goalImpressions, 833333);
  assert.equal(cp.neededPerDay, 83333);
  assert.equal(cp.onTrack, false);
  // Today's partial day (0 verified so far) doesn't count toward the pace
  const d2 = X.mergeDays(days, X.parseOverview(C.parseCSV(exportCsv('2026-11-21', 1, true, () => 0)), 'Verified.csv')).days;
  const cp2 = X.currentPeriod(rows, d2, '2026-11-21', r, 50000);
  assert.equal(cp2.elapsed, 9);
  assert.equal(cp2.verifiedSoFar, 450000);
  assert.equal(cp2.projected, 700000);
  // Far past the newest window: steps forward in 14-day blocks
  assert.equal(X.currentPeriod(rows, days, '2026-12-01', r, 0).from, '2026-11-26');
});

test('eligibility and drivers', () => {
  const { days } = fixture();
  const e = X.eligibility(days, '2026-11-21');
  assert.equal(e.daysWithData, 90);
  assert.equal(e.verifiedImpressions, 4500000);
  assert.equal(e.ratio, 9);
  const d = X.drivers(days);
  assert.equal(d.byPosts.find((b) => b.label === '4–6').days, 120);
  assert.equal(d.byPosts.find((b) => b.label === '4–6').median, 50000);
  assert.equal(d.byWeekday.length, 7);
});
