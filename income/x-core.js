// OC Scanner IntelHQ — X analytics math (pairs X account analytics with X payouts from the Income tab).
// Works in the browser (window.XCore) and in Node (require) for the tests in income/test/.
//
// How X pays (help.x.com/en/using-x/original-content-rewards, checked Nov 21, 2026): payouts every two
// weeks, based on "qualified impressions": unique views from Premium users on the Home Timeline, original
// posts only. X's analytics export has no "qualified" number, but its Verified filter is the closest:
// across Christian's 21 Revenue Sharing payouts (Nov 2025 – Sep 2026) verified impressions tracked pay best
// (correlation 0.86 vs 0.82 for all impressions). So the rate here is dollars per 1,000 VERIFIED impressions,
// learned from his own history. It is an estimate, not X's formula.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.XCore = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const METRICS = ['impressions', 'likes', 'engagements', 'bookmarks', 'shares', 'newFollows', 'unfollows', 'replies', 'reposts', 'profileVisits', 'posts', 'videoViews', 'mediaViews'];
  const HEADER_MAP = {
    impressions: /^impressions$/i, likes: /^likes$/i, engagements: /^engagements$/i, bookmarks: /^bookmarks$/i,
    shares: /^shares$/i, newFollows: /^new follows?$/i, unfollows: /^unfollows?$/i, replies: /^replies$/i,
    reposts: /^reposts$|^retweets$/i, profileVisits: /^profile visits$/i, posts: /^create post$|^posts? created$|^posts$/i,
    videoViews: /^video views$/i, mediaViews: /^media views$/i,
  };
  const PAYOUT_DAYS = 14;
  const ELIGIBILITY = { days: 90, verifiedImpressions: 500000 };
  const MON = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
  const pad = (n) => String(n).padStart(2, '0');

  // "Sat, Nov 21, 2026", "Nov 21, 2026", "2026-11-21", "11/21/2026" → "2026-11-21"
  function parseXDate(s) {
    s = String(s || '').trim().replace(/^[A-Za-z]{3,9},\s*/, '');
    let m;
    if ((m = s.match(/^(\d{4})-(\d{2})-(\d{2})/))) return `${m[1]}-${m[2]}-${m[3]}`;
    if ((m = s.match(/^([A-Za-z]{3})[a-z]*\.?\s+(\d{1,2}),?\s+(\d{4})$/))) {
      const mo = MON[m[1].toLowerCase()];
      return mo ? `${m[3]}-${pad(mo)}-${pad(+m[2])}` : null;
    }
    if ((m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/))) return `${m[3]}-${pad(+m[1])}-${pad(+m[2])}`;
    return null;
  }
  const toInt = (v) => {
    const s = String(v === undefined || v === null ? '' : v).replace(/[,\s]/g, '');
    if (s === '') return null;
    const n = Number(s);
    return Number.isFinite(n) ? Math.round(n) : null;
  };

  function addDays(iso, n) {
    const [y, m, d] = iso.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
  }
  function daysBetween(a, b) { // inclusive
    const t = (iso) => { const [y, m, d] = iso.split('-').map(Number); return Date.UTC(y, m - 1, d); };
    return Math.round((t(b) - t(a)) / 86400000) + 1;
  }

  // rows = parsed CSV (array of arrays). Returns { kind, days: [{date, impressions, …}], skipped }.
  // kind: 'verified' when the file name says so, or when Video/Media views are blank on every row
  // (X leaves them empty in the Verified export); otherwise 'all'.
  function parseOverview(rows, fileName) {
    if (!rows || rows.length < 2) throw new Error('No rows in that file.');
    const head = rows[0].map((h) => String(h).trim());
    const di = head.findIndex((h) => /^date$/i.test(h));
    if (di < 0) throw new Error('This doesn’t look like an X Overview export (no Date column).');
    const col = {};
    for (const k of METRICS) col[k] = head.findIndex((h) => HEADER_MAP[k].test(h));
    if (col.impressions < 0) throw new Error('This doesn’t look like an X Overview export (no Impressions column).');
    const days = [];
    let skipped = 0, mediaBlank = 0;
    for (let i = 1; i < rows.length; i++) {
      const r = rows[i];
      const date = parseXDate(r[di]);
      if (!date) { skipped++; continue; }
      const d = { date };
      for (const k of METRICS) d[k] = col[k] >= 0 ? toInt(r[col[k]]) : null;
      if (d.videoViews === null && d.mediaViews === null) mediaBlank++;
      days.push(d);
    }
    const byName = /verified/i.test(fileName || '');
    const kind = byName || (days.length && mediaBlank === days.length && col.videoViews >= 0) ? 'verified' : 'all';
    days.sort((a, b) => a.date.localeCompare(b.date));
    return { kind, days, skipped, from: days.length ? days[0].date : null, to: days.length ? days[days.length - 1].date : null };
  }

  // store.days = { 'YYYY-MM-DD': { all: {...}, verified: {...} } }. Newer import wins for a day.
  function mergeDays(store, parsed) {
    const out = Object.assign({}, store);
    let added = 0, updated = 0;
    for (const d of parsed.days) {
      const cur = out[d.date] ? Object.assign({}, out[d.date]) : {};
      if (cur[parsed.kind]) updated++; else added++;
      const rec = {};
      for (const k of METRICS) rec[k] = d[k];
      cur[parsed.kind] = rec;
      out[d.date] = cur;
    }
    return { days: out, added, updated };
  }

  function sumRange(days, from, to, kind, metric) { // inclusive dates
    let total = 0, have = 0;
    for (let d = from; d <= to; d = addDays(d, 1)) {
      const x = days[d] && days[d][kind];
      if (x && x[metric] !== null && x[metric] !== undefined) { total += x[metric]; have++; }
    }
    return { total, have };
  }

  // The earning window for an X payout entry from the Income tab.
  // Entries with a payout period (Revenue Sharing) use it. Original Content Rewards lists only the pay date:
  // payday is a Friday and the window is the 14 days ending the Tuesday before it (Christian, Nov 21, 2026),
  // i.e. ending `endBefore` = 3 days before payday.
  function windowFor(entry, endBefore) {
    if (entry.periodStart && entry.periodEnd) return { from: entry.periodStart, to: entry.periodEnd, derived: false };
    const to = addDays(entry.date, -endBefore);
    return { from: addDays(to, -(PAYOUT_DAYS - 1)), to, derived: true };
  }

  function isXPayout(e) { return e && e.kind === 'revenue' && e.source === 'x_ads'; }

  // One row per X payout, newest first: window, verified and all impressions, $ per 1,000 verified.
  function payoutRows(entries, days, endBefore) {
    const rows = entries.filter(isXPayout).map((e) => {
      const w = windowFor(e, endBefore);
      const len = daysBetween(w.from, w.to);
      const vi = sumRange(days, w.from, w.to, 'verified', 'impressions');
      const ai = sumRange(days, w.from, w.to, 'all', 'impressions');
      const ve = sumRange(days, w.from, w.to, 'verified', 'engagements');
      const posts = sumRange(days, w.from, w.to, 'all', 'posts');
      const follows = sumRange(days, w.from, w.to, 'all', 'newFollows');
      const complete = vi.have === len;
      return {
        id: e.id, paidOn: e.date, net: e.net, program: e.note && /revenue shar/i.test(e.note) ? 'Revenue Sharing' : e.periodStart ? 'Revenue Sharing' : 'Original Content Rewards',
        from: w.from, to: w.to, derived: w.derived, days: len,
        verifiedImpressions: vi.have ? vi.total : null, allImpressions: ai.have ? ai.total : null,
        verifiedEngagements: ve.have ? ve.total : null, posts: posts.have ? posts.total : null, newFollows: follows.have ? follows.total : null,
        complete,
        perK: vi.have && vi.total > 0 && complete ? (e.net / 100) / vi.total * 1000 : null,
        verifiedShare: vi.have && ai.have && ai.total > 0 ? vi.total / ai.total : null,
      };
    });
    rows.sort((a, b) => b.to.localeCompare(a.to));
    return rows;
  }

  const median = (xs) => {
    const s = xs.slice().sort((a, b) => a - b);
    if (!s.length) return null;
    const m = Math.floor(s.length / 2);
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  };

  // Dollars per 1,000 verified impressions: the median of the last `n` complete payouts (median, so one
  // unusual payout doesn't swing it), plus the low/high of those payouts for a range.
  function rate(rows, n) {
    const use = rows.filter((r) => r.perK !== null).slice(0, n || 6);
    if (!use.length) return null;
    const ks = use.map((r) => r.perK);
    return { perK: median(ks), low: Math.min(...ks), high: Math.max(...ks), basedOn: use.length };
  }

  // The window being earned now: the one right after the newest payout's window, in 14-day steps up to
  // today. Its payday is the Friday 3 days after it ends. Pace = verified impressions so far, projected over the full 14 days.
  function currentPeriod(rows, days, today, r, goalCents) {
    if (!rows.length) return null;
    let from = addDays(rows[0].to, 1);
    while (addDays(from, PAYOUT_DAYS - 1) < today) from = addDays(from, PAYOUT_DAYS);
    const to = addDays(from, PAYOUT_DAYS - 1);
    // Last day with real numbers: X's export includes today as a partial day with zeros, which would drag
    // the pace down, so trailing days with 0 verified impressions don't count yet.
    const lastData = Object.keys(days).filter((d) => days[d].verified && days[d].verified.impressions > 0 && d >= from && d <= to).sort().pop() || null;
    const sofar = lastData ? sumRange(days, from, lastData, 'verified', 'impressions') : { total: 0, have: 0 };
    const elapsed = lastData ? daysBetween(from, lastData) : 0;
    const remaining = PAYOUT_DAYS - elapsed;
    const projected = elapsed ? Math.round(sofar.total / elapsed * PAYOUT_DAYS) : null;
    const out = { from, to, payday: addDays(to, 3), elapsed, remaining, lastData, verifiedSoFar: sofar.total, projected };
    if (r && r.perK) {
      out.projectedCents = projected === null ? null : Math.round(projected / 1000 * r.perK * 100);
      if (goalCents) {
        out.goalImpressions = Math.round(goalCents / 100 / r.perK * 1000);
        out.neededPerDay = remaining > 0 ? Math.max(0, Math.round((out.goalImpressions - sofar.total) / remaining)) : null;
        out.goalPerDay = Math.round(out.goalImpressions / PAYOUT_DAYS);
        out.onTrack = projected !== null ? projected >= out.goalImpressions : null;
      }
    }
    return out;
  }

  // Eligibility: X wants 500,000 verified Home Timeline impressions in 90 days (replies excluded).
  // The export's verified count includes replies and other surfaces, so this overstates it a little.
  function eligibility(days, today) {
    const keys = Object.keys(days).filter((d) => days[d].verified).sort();
    if (!keys.length) return null;
    const to = keys[keys.length - 1] < today ? keys[keys.length - 1] : today;
    const from = addDays(to, -(ELIGIBILITY.days - 1));
    const s = sumRange(days, from, to, 'verified', 'impressions');
    return { from, to, verifiedImpressions: s.total, daysWithData: s.have, required: ELIGIBILITY.verifiedImpressions, ratio: s.total / ELIGIBILITY.verifiedImpressions };
  }

  // What drives verified impressions: median per day by number of posts that day, and by weekday.
  function drivers(days, from, to) {
    const buckets = [['0', 0, 0], ['1–3', 1, 3], ['4–6', 4, 6], ['7–10', 7, 10], ['11+', 11, Infinity]];
    const by = buckets.map(() => []);
    const wd = [[], [], [], [], [], [], []];
    for (const d of Object.keys(days).sort()) {
      if ((from && d < from) || (to && d > to)) continue;
      const v = days[d].verified, a = days[d].all;
      if (!v || v.impressions === null || !a || a.posts === null) continue;
      const i = buckets.findIndex(([, lo, hi]) => a.posts >= lo && a.posts <= hi);
      by[i].push(v.impressions);
      const [y, m, dd] = d.split('-').map(Number);
      wd[new Date(Date.UTC(y, m - 1, dd)).getUTCDay()].push(v.impressions);
    }
    return {
      byPosts: buckets.map(([label], i) => ({ label, days: by[i].length, median: median(by[i]) })),
      byWeekday: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((label, i) => ({ label, days: wd[i].length, median: median(wd[i]) })),
    };
  }

  function dailySeries(days, from, to) {
    const out = [];
    for (let d = from; d <= to; d = addDays(d, 1)) {
      const x = days[d] || {};
      out.push({ date: d, verified: x.verified ? x.verified.impressions : null, all: x.all ? x.all.impressions : null, posts: x.all ? x.all.posts : null });
    }
    return out;
  }

  return { METRICS, PAYOUT_DAYS, ELIGIBILITY, parseXDate, parseOverview, mergeDays, sumRange, windowFor, isXPayout, payoutRows, rate, currentPeriod, eligibility, drivers, dailySeries, addDays, daysBetween, median };
});
