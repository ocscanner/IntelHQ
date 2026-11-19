// Run: node --test income/test/   (no packages needed)
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../income-core.js');

const rev = (o) => C.normalizeEntry(Object.assign({ kind: 'revenue', source: 'kofi' }, o));

test('parseAmount handles the formats statements use', () => {
  assert.equal(C.parseAmount('$1,234.56'), 123456);
  assert.equal(C.parseAmount('+ $10.00'), 1000);
  assert.equal(C.parseAmount('- $5.00'), -500);
  assert.equal(C.parseAmount('(5.25)'), -525);
  assert.equal(C.parseAmount('USD 7.5'), 750);
  assert.equal(C.parseAmount('12-'), -1200);
  assert.equal(C.parseAmount(''), null);
  assert.equal(C.parseAmount('n/a'), null);
  assert.equal(C.parseAmount('0.1'), 10);
  assert.equal(C.parseAmount('0.29'), 29); // no float drift
});

test('parseDate: ISO, US, month names; time-zone stamps become the Pacific day', () => {
  assert.equal(C.parseDate('2026-11-03'), '2026-11-03');
  assert.equal(C.parseDate('2026-11-03T12:30:00'), '2026-11-03');
  assert.equal(C.parseDate('2026-11-04T03:00:00Z'), '2026-11-03'); // 7 pm PT on Nov 3
  assert.equal(C.parseDate('11/03/2026'), '2026-11-03');
  assert.equal(C.parseDate('1/5/26 4:00 PM'), '2026-01-05');
  assert.equal(C.parseDate('Nov 3, 2026'), '2026-11-03');
  assert.equal(C.parseDate('September 9, 2026'), '2026-09-09');
  assert.equal(C.parseDate('3 Nov 2026'), '2026-11-03');
  assert.equal(C.parseDate('2026-02-30'), null);
  assert.equal(C.parseDate('soon'), null);
});

test('only revenue counts; expenses, taxes and transfers are listed separately', () => {
  const entries = [
    rev({ date: '2026-11-02', net: 1000, fee: 50 }),
    rev({ date: '2026-11-05', source: 'x_ads', net: 25000 }),
    C.normalizeEntry({ date: '2026-11-06', source: 'venmo', kind: 'transfer', net: 30000 }),
    C.normalizeEntry({ date: '2026-11-07', source: 'other', kind: 'expense', net: -1200 }),
    C.normalizeEntry({ date: '2026-11-08', source: 'other', kind: 'tax', net: 5000 }),
    rev({ date: '2026-11-09', net: -500 }), // a refund lowers revenue
    rev({ date: '2026-10-31', net: 99999 }), // outside the range
  ];
  const s = C.summarize(entries, { from: '2026-11-01', to: '2026-11-30' });
  assert.equal(s.revenue.net, 1000 + 25000 - 500);
  assert.equal(s.revenue.count, 3);
  assert.equal(s.revenue.fee, 50);
  assert.deepEqual(s.excluded, { expense: 1200, tax: 5000, transfer: 30000 });
  assert.equal(s.bySource.kofi.net, 500);
  assert.equal(s.bySource.x_ads.net, 25000);
  assert.equal(s.bySource.venmo, undefined);
});

test('gross/net fill each other in from the fee', () => {
  assert.equal(rev({ date: '2026-11-01', net: 970, fee: 30 }).gross, 1000);
  assert.equal(rev({ date: '2026-11-01', gross: 1000, fee: -30 }).net, 970);
  assert.equal(C.normalizeEntry({ date: '2026-11-01', kind: 'expense', net: -800 }).net, 800);
});

test('validateEntry refuses account-number-looking text and bad periods', () => {
  const ok = rev({ date: '2026-11-01', net: 100, destination: 'Chase checking' });
  assert.deepEqual(C.validateEntry(ok), []);
  assert.ok(C.validateEntry(rev({ date: '2026-11-01', net: 100, destination: '4111 1111 1111 1111' })).length);
  assert.ok(C.validateEntry(rev({ date: '2026-11-01', net: 100, note: 'acct 123456789' })).length);
  assert.ok(C.validateEntry(rev({ date: '2026-11-01', net: 100, periodStart: '2026-10-15' })).length);
  assert.ok(C.validateEntry(rev({ date: '2026-11-01', net: 100, periodStart: '2026-10-20', periodEnd: '2026-10-10' })).length);
  assert.ok(C.validateEntry(rev({ date: '2026-02-30', net: 100 })).length);
  assert.ok(C.validateEntry(rev({ date: '2026-11-01', net: null })).length);
});

test('counterparty (sponsor) is only kept for sponsorships', () => {
  assert.equal(rev({ date: '2026-11-01', net: 1, counterparty: 'Jane Doe' }).counterparty, '');
  assert.equal(rev({ date: '2026-11-01', net: 1, source: 'sponsorship', counterparty: 'Acme' }).counterparty, 'Acme');
});

test('ranges and "vs previous"', () => {
  const t = '2026-11-18';
  assert.deepEqual(C.rangeFor('this-month', t), { from: '2026-11-01', to: '2026-11-18' });
  assert.deepEqual(C.rangeFor('last-month', t), { from: '2026-10-01', to: '2026-10-31' });
  assert.deepEqual(C.rangeFor('ytd', t), { from: '2026-01-01', to: '2026-11-18' });
  assert.deepEqual(C.rangeFor('12m', t), { from: '2025-12-01', to: '2026-11-18' });
  assert.deepEqual(C.previousRange({ from: '2026-11-01', to: '2026-11-18' }), { from: '2026-10-01', to: '2026-10-18' });
  assert.deepEqual(C.previousRange({ from: '2026-03-01', to: '2026-03-31' }), { from: '2026-02-01', to: '2026-02-28' });
  assert.deepEqual(C.previousRange({ from: '2026-01-01', to: '2026-11-18' }), { from: '2025-01-01', to: '2025-11-18' });
  assert.deepEqual(C.previousRange({ from: '2026-11-05', to: '2026-11-14' }), { from: '2026-10-26', to: '2026-11-04' });
  assert.equal(C.pctChange(150, 100), 0.5);
  assert.equal(C.pctChange(150, 0), null);
});

test('monthly trend', () => {
  const rows = C.monthly([
    rev({ date: '2026-09-10', net: 100 }),
    rev({ date: '2026-11-01', net: 200, source: 'x_ads' }),
    rev({ date: '2026-11-20', net: 50 }),
    C.normalizeEntry({ date: '2026-11-20', kind: 'transfer', net: 9999 }),
  ], '2026-11', 3);
  assert.deepEqual(rows.map((r) => r.month), ['2026-09', '2026-10', '2026-11']);
  assert.deepEqual(rows.map((r) => r.net), [100, 0, 250]);
  assert.equal(rows[2].bySource.x_ads, 200);
});

test('payout periods: grouped, per-day, change vs previous', () => {
  const p = C.payoutPeriods([
    rev({ date: '2026-10-20', source: 'x_ads', net: 14000, periodStart: '2026-10-01', periodEnd: '2026-10-14' }),
    rev({ date: '2026-11-03', source: 'x_ads', net: 21000, periodStart: '2026-10-15', periodEnd: '2026-10-28' }),
    rev({ date: '2026-11-03', source: 'kofi', net: 500, periodStart: '2026-10-15', periodEnd: '2026-10-28' }),
  ]);
  assert.equal(p.length, 2);
  assert.equal(p[0].periodStart, '2026-10-15');
  assert.equal(p[0].days, 14);
  assert.equal(p[0].perDay, 1500);
  assert.equal(p[0].change, 7000);
  assert.equal(p[0].changePct, 0.5);
  assert.equal(p[1].change, null);
});

test('parseCSV: quotes, commas in amounts, CRLF, BOM, semicolons', () => {
  const rows = C.parseCSV('﻿Date,Amount,Note\r\n2026-11-01,"$1,000.00","said ""hi"", ok"\r\n\r\n');
  assert.deepEqual(rows, [['Date', 'Amount', 'Note'], ['2026-11-01', '$1,000.00', 'said "hi", ok']]);
  assert.deepEqual(C.parseCSV('a;b\n1;2'), [['a', 'b'], ['1', '2']]);
  assert.deepEqual(C.parseCSV('a\tb\n1\t2'), [['a', 'b'], ['1', '2']]);
  assert.deepEqual(C.parseCSV('a,b\n"line\nbreak",2'), [['a', 'b'], ['line\nbreak', '2']]);
});

// A statement laid out like Venmo's (title lines first, signed amounts, transfers to bank).
const VENMO_LIKE = [
  'Account Statement - (@oc_scanner) ,,,,,,,,,',
  'Account Activity,,,,,,,,,',
  ',ID,Datetime,Type,Status,Note,From,To,Amount (total),Amount (fee),Funding Source,Destination',
  ',,,,,,,,,,,',
  ',4001,2026-11-01T18:00:00,Payment,Complete,keep it up,Jane Donor,OC Scanner,+ $20.00,,,Venmo balance',
  ',4002,2026-11-02T18:00:00,Payment,Complete,coffee,OC Scanner,Some Shop,- $6.50,,Venmo balance,',
  ',4003,2026-11-03T18:00:00,Standard Transfer,Issued,,,,- $13.50,,,Bank',
  ',4004,2026-11-04T18:00:00,Standard Transfer,Complete,,,,- $13.50,,,Bank',
  ',4005,2026-11-05T18:00:00,Payment,Pending,,John Donor,OC Scanner,+ $5.00,,,',
  ',,,,,,,,,,,',
].join('\n');

test('Venmo-style statement: header found, columns guessed, rows classified, names never read', () => {
  const rows = C.parseCSV(VENMO_LIKE);
  const h = C.findHeaderRow(rows);
  assert.equal(rows[h][1], 'ID');
  const m = C.guessMapping(rows[h]);
  assert.equal(rows[h][m.date], 'Datetime');
  assert.equal(rows[h][m.gross], 'Amount (total)');
  assert.equal(rows[h][m.fee], 'Amount (fee)');
  assert.equal(rows[h][m.ref], 'ID');
  assert.equal(rows[h][m.type], 'Type');
  assert.equal(rows[h][m.status], 'Status');
  const p = C.rowsToEntries(rows, h, m, { source: 'venmo', destination: 'Venmo balance' });
  const kept = p.filter((x) => x.include).map((x) => x.entry);
  assert.deepEqual(kept.map((e) => [e.ref, e.kind, e.net]), [['4001', 'revenue', 2000], ['4002', 'expense', 650], ['4004', 'transfer', 1350]]);
  const skipped = p.filter((x) => !x.include).map((x) => x.reason);
  assert.ok(skipped.some((r) => /Issued/.test(r)));
  assert.ok(skipped.some((r) => /Pending/.test(r)));
  const json = JSON.stringify(kept);
  assert.ok(!json.includes('Jane') && !json.includes('keep it up') && !json.includes('coffee'));
  assert.equal(C.summarize(kept, { from: '2026-11-01', to: '2026-11-30' }).revenue.net, 2000);
});

test('duplicates: same file twice saves nothing new; rows without IDs count repeats', () => {
  const rows = C.parseCSV(VENMO_LIKE);
  const h = C.findHeaderRow(rows);
  const m = C.guessMapping(rows[h]);
  const first = C.rowsToEntries(rows, h, m, { source: 'venmo' }).filter((x) => x.include).map((x) => x.entry);
  const again = C.markDuplicates(C.rowsToEntries(rows, h, m, { source: 'venmo' }), first);
  assert.equal(again.filter((x) => x.include).length, 0);
  assert.ok(again.some((x) => x.duplicate));

  // Two genuine $5 tips on the same day with no transaction ID stay two entries.
  const noId = C.parseCSV('Date,Amount\n2026-11-01,5\n2026-11-01,5\n');
  const a = C.rowsToEntries(noId, 0, C.guessMapping(noId[0]), { source: 'kofi' });
  assert.equal(a.filter((x) => x.include).length, 2);
  assert.notEqual(a[0].entry.fingerprint, a[1].entry.fingerprint);
  assert.equal(C.markDuplicates(C.rowsToEntries(noId, 0, C.guessMapping(noId[0]), { source: 'kofi' }), a.map((x) => x.entry)).filter((x) => x.include).length, 0);
});

test('net/gross/fee columns and payout periods come through from a payout CSV', () => {
  const rows = C.parseCSV('Payout ID,Paid on,Period start,Period end,Gross,Fee,Net\nP1,2026-11-03,2026-10-15,2026-10-28,"$210.00",$6.30,$203.70\n');
  const m = C.guessMapping(rows[0]);
  const [p] = C.rowsToEntries(rows, 0, m, { source: 'x_ads' });
  assert.ok(p.include, p.reason);
  assert.deepEqual([p.entry.date, p.entry.periodStart, p.entry.periodEnd, p.entry.gross, p.entry.fee, p.entry.net, p.entry.ref],
    ['2026-11-03', '2026-10-15', '2026-10-28', 21000, 630, 20370, 'P1']);
});

test('classify', () => {
  assert.equal(C.classify(500, 'Payment', 'Complete').kind, 'revenue');
  assert.equal(C.classify(-500, 'Payment', '').kind, 'expense');
  assert.equal(C.classify(-500, 'Instant Transfer', '').kind, 'transfer');
  assert.equal(C.classify(-500, 'Refund', '').kind, 'revenue');
  assert.equal(C.classify(500, 'Tax withholding', '').kind, 'tax');
  assert.ok(C.classify(500, 'Payment', 'Failed').skip);
});

test('CSV export guards against spreadsheet formulas and reads back in exactly', () => {
  const entries = [
    C.normalizeEntry({ id: 'a1', date: '2026-11-01', source: 'sponsorship', kind: 'revenue', gross: 50000, net: 50000, counterparty: '=HYPERLINK("x")', note: 'line, with "quotes"', destination: 'Chase checking' }),
    C.normalizeEntry({ id: 'a2', date: '2026-11-02', source: 'other', kind: 'expense', net: 1999, note: '-minus first' }),
  ];
  const csv = C.toCSV(entries);
  assert.ok(csv.includes(`"'=HYPERLINK(""x"")"`));
  assert.ok(csv.includes(`'-minus first`));
  assert.ok(csv.includes(',500.00,0.00,500.00,'));
  const rows = C.parseCSV(csv);
  assert.ok(C.isOwnExport(rows[0]));
  const back = C.fromOwnCSV(rows);
  assert.ok(back.every((x) => x.include));
  for (const k of ['date', 'source', 'kind', 'gross', 'fee', 'net', 'counterparty', 'note', 'destination', 'id']) {
    assert.deepEqual(back.map((x) => x.entry[k]), entries.map((e) => e[k]), k);
  }
});
