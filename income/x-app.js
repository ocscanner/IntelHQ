// OC Scanner IntelHQ — X analytics view on the Income page. Math in x-core.js.
// X analytics days are kept in this browser (localStorage KEY), like the rest of Income, and go into the
// Income backup file. X payouts come from the Income entries (source "X ad revenue share").
(function () {
  'use strict';
  const C = window.IncomeCore, X = window.XCore;
  const KEY = 'ocs-xanalytics-v1';
  const INCOME_KEY = 'ocs-income-v1';
  const $ = (s, el) => (el || document).querySelector(s);
  const $$ = (s, el) => Array.from((el || document).querySelectorAll(s));
  const esc = (s) => String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const fd = (iso, year) => { if (!iso) return ''; const [y, m, d] = iso.split('-').map(Number); return `${MON[m - 1]} ${d}${year ? ', ' + y : ''}`; };
  const n0 = (v) => (v === null || v === undefined ? '–' : Math.round(v).toLocaleString('en-US'));
  const short = (v) => (v === null || v === undefined ? '–' : v >= 1e6 ? (v / 1e6).toFixed(v >= 1e7 ? 1 : 2) + 'M' : v >= 1e3 ? Math.round(v / 1e3) + 'K' : String(v));
  const money = (cents, o) => C.formatMoney(cents, o);
  const perK = (v) => (v === null || v === undefined ? '–' : '$' + v.toFixed(2));

  const empty = () => ({ version: 1, days: {}, imports: [], settings: { goalCents: 50000, lag: 8, rateN: 6 } });
  function load() {
    try { const d = JSON.parse(localStorage.getItem(KEY)); return d ? Object.assign(empty(), d, { settings: Object.assign(empty().settings, d.settings || {}) }) : empty(); }
    catch (e) { return empty(); }
  }
  let data = load();
  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(data)); return true; }
    catch (e) { msg('Couldn’t save on this device: ' + e.message + '.'); return false; }
  }
  function msg(text) { const el = $('#xa-msg'); if (!text) { el.hidden = true; return; } el.textContent = text; el.hidden = false; }
  function incomeEntries() {
    try { const d = JSON.parse(localStorage.getItem(INCOME_KEY)); return d && Array.isArray(d.entries) ? d.entries.map(C.normalizeEntry) : []; } catch (e) { return []; }
  }

  // ── Render ──────────────────────────────────────────────────────────────
  function render() {
    const body = $('#xa-body');
    if (!body) return;
    const dayKeys = Object.keys(data.days).sort();
    const hasAll = dayKeys.some((d) => data.days[d].all), hasVer = dayKeys.some((d) => data.days[d].verified);
    const entries = incomeEntries();
    const s = data.settings;
    const rows = X.payoutRows(entries, data.days, s.lag);
    const r = X.rate(rows, s.rateN);
    const today = C.todayPacific();
    const cp = X.currentPeriod(rows, data.days, today, r, s.goalCents);
    const el = X.eligibility(data.days, today);

    if (!dayKeys.length) {
      body.innerHTML = `<div class="card"><h2>Get started</h2>
        <ol style="margin:0;padding-left:20px;line-height:1.7">
          <li>On a computer, open <strong>x.com/i/account_analytics</strong> and pick the longest date range.</li>
          <li>Overview → <strong>Export</strong>. Then turn on the <strong>Verified</strong> filter and export again.</li>
          <li>Press <strong>Import X analytics</strong> and pick both files.</li>
          <li>Make sure your X payouts are in Income (source “X ad revenue share”). ${rows.length ? `<span class="xa-ok">${rows.length} found.</span>` : '<span class="xa-bad">None yet.</span>'}</li>
        </ol></div>`;
      return;
    }

    const warn = [];
    if (!hasVer) warn.push('No Verified export yet: rates and targets need it.');
    if (!hasAll) warn.push('No all-viewers export yet: the verified share and posts per day need it.');
    if (!rows.length) warn.push('No X payouts in Income yet: add them (source “X ad revenue share”) so the rate can be learned.');
    const lastDay = dayKeys[dayKeys.length - 1];
    const staleDays = X.daysBetween(lastDay, today) - 1;
    if (staleDays > 3) warn.push(`Analytics end ${fd(lastDay, true)}. Import a fresh export for this period's pace.`);

    // Cards
    const cards = [];
    cards.push(`<div class="kpi"><div class="lbl">Your rate</div><div class="val num">${r ? perK(r.perK) : '–'}</div>
      <div class="sub">${r ? `per 1,000 verified views · last ${r.basedOn} payouts ranged ${perK(r.low)}–${perK(r.high)}` : 'needs payouts and the Verified export'}</div></div>`);
    if (cp) {
      cards.push(`<div class="kpi"><div class="lbl">This period · ${esc(fd(cp.from))}–${esc(fd(cp.to))}</div><div class="val num">${cp.projectedCents !== null && cp.projectedCents !== undefined ? '~' + money(cp.projectedCents, { whole: true }) : '–'}</div>
        <div class="sub">${short(cp.verifiedSoFar)} verified views in ${cp.elapsed} of 14 days · on pace for ${short(cp.projected)}</div></div>`);
      cards.push(`<div class="kpi"><div class="lbl">Goal per payout</div><div class="val num">${money(s.goalCents, { whole: true })}</div>
        <div class="sub">${cp.goalImpressions ? `needs ${short(cp.goalImpressions)} verified views (${short(cp.goalPerDay)}/day). ${cp.remaining > 0 ? `<span class="${cp.onTrack ? 'xa-ok' : 'xa-bad'}">${cp.onTrack ? 'On track' : `Need ${short(cp.neededPerDay)}/day for the last ${cp.remaining} days`}</span>` : ''}` : 'set below'}</div></div>`);
    }
    if (el) {
      cards.push(`<div class="kpi"><div class="lbl">Eligibility · 90 days</div><div class="val num">${short(el.verifiedImpressions)}</div>
        <div class="sub"><span class="${el.ratio >= 1 ? 'xa-ok' : 'xa-bad'}">${el.ratio >= 1 ? '✓' : '!'} ${el.ratio.toFixed(1)}× the 500K X requires</span> (counts replies too)</div></div>`);
    }

    // Chart: daily verified views for the current window and the two before it, with the goal pace line.
    let chart = '';
    if (hasVer) {
      const to = cp ? cp.to : lastDay;
      const from = X.addDays(to, -41);
      const series = X.dailySeries(data.days, from, to);
      const W = Math.max(320, Math.min(1200, ($('#xa-body').clientWidth || 900) - 40)), H = W < 500 ? 190 : 230, top = 16, bottom = 26;
      const goal = cp && cp.goalPerDay ? cp.goalPerDay : 0;
      const max = Math.max(1, goal * 1.15, ...series.map((x) => x.verified || 0));
      const gap = W < 500 ? 1 : 3;
      const bw = (W - gap * (series.length - 1)) / series.length;
      const y = (v) => H - bottom - Math.round((v / max) * (H - top - bottom));
      const bars = series.map((x, i) => {
        const xpos = i * (bw + gap);
        const cur = cp && x.date >= cp.from;
        const lab = (i % (W < 500 ? 14 : 7) === 0) ? `<text x="${i === 0 ? 0 : (xpos + bw / 2).toFixed(1)}" y="${H - 8}" text-anchor="${i === 0 ? 'start' : 'middle'}">${esc(fd(x.date))}</text>` : '';
        return `<g><title>${esc(fd(x.date, true))}: ${x.verified === null ? 'no data' : n0(x.verified) + ' verified views'}${x.posts !== null ? ` · ${x.posts} posts` : ''}</title>
          ${x.verified ? `<rect class="v${cur ? ' cur' : ''}" x="${xpos.toFixed(1)}" y="${y(x.verified)}" width="${bw.toFixed(1)}" height="${H - bottom - y(x.verified)}" rx="2"></rect>` : ''}${lab}</g>`;
      }).join('');
      const goalLine = goal ? `<line class="goal" x1="0" x2="${W}" y1="${y(goal)}" y2="${y(goal)}"></line><text x="${W - 4}" y="${y(goal) - 5}" text-anchor="end">goal ${short(goal)}/day</text>` : '';
      chart = `<div class="card xa-chart" style="margin-top:12px"><h2>Verified views per day <span class="muted" style="font-size:.85rem;text-transform:none;letter-spacing:0">· last 6 weeks, this period in green</span></h2>
        <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Verified views per day, last 6 weeks">${bars}${goalLine}</svg></div>`;
    }

    // Payout table
    const table = rows.length ? `<div class="card" style="margin-top:12px"><h2>Payouts vs. verified views</h2>
      <p class="muted" style="margin:0 0 8px;font-size:.9rem">Revenue Sharing payouts use the period X listed. Original Content Rewards lists only the pay date, so its window is estimated (*) as the 14 days ending ${s.lag} days before payday, the gap that best matched your history.</p>
      <div class="scroll"><table class="tbl xa-tbl"><thead><tr><th>Paid</th><th>Window</th><th class="r">Payout</th><th class="r">Verified views</th><th class="r hide-sm">Verified %</th><th class="r">Per 1K</th><th class="r hide-sm">Posts</th><th class="r hide-sm">New follows</th></tr></thead><tbody>${
        rows.map((x) => `<tr><td class="num">${esc(fd(x.paidOn, true))}<br><span class="xa-flag">${x.program === 'Revenue Sharing' ? 'Revenue Sharing' : 'Content Rewards'}</span></td>
          <td class="num">${esc(fd(x.from))}–${esc(fd(x.to))}${x.derived ? ' *' : ''}</td>
          <td class="r num">${money(x.net)}</td><td class="r num">${x.complete ? n0(x.verifiedImpressions) : '<span class="muted">no data</span>'}</td>
          <td class="r num hide-sm">${x.verifiedShare !== null ? (x.verifiedShare * 100).toFixed(1) + '%' : '–'}</td>
          <td class="r num"><strong>${perK(x.perK)}</strong></td><td class="r num hide-sm">${n0(x.posts)}</td><td class="r num hide-sm">${n0(x.newFollows)}</td></tr>`).join('')
      }</tbody></table></div></div>` : '';

    // Drivers
    const dr = X.drivers(data.days, X.addDays(lastDay, -179), lastDay);
    const drivers = hasVer && hasAll ? `<div class="grid2" style="margin-top:12px">
      <div class="card"><h2>Posts per day</h2><p class="muted" style="margin:0 0 6px;font-size:.9rem">Typical verified views on days with this many posts (last 6 months).</p>
        <table class="tbl"><thead><tr><th>Posts that day</th><th class="r">Days</th><th class="r">Typical verified views</th></tr></thead><tbody>${
          dr.byPosts.filter((b) => b.days).map((b) => `<tr><td>${esc(b.label)}</td><td class="r num">${b.days}</td><td class="r num">${n0(b.median)}${r && b.median ? ` <span class="muted">≈ ${money(Math.round(b.median / 1000 * r.perK * 100))}</span>` : ''}</td></tr>`).join('')
        }</tbody></table></div>
      <div class="card"><h2>Day of the week</h2><p class="muted" style="margin:0 0 6px;font-size:.9rem">Typical verified views by weekday (last 6 months).</p>
        <table class="tbl"><thead><tr><th>Day</th><th class="r">Typical verified views</th></tr></thead><tbody>${
          dr.byWeekday.map((b) => `<tr><td>${esc(b.label)}</td><td class="r num">${n0(b.median)}</td></tr>`).join('')
        }</tbody></table></div></div>` : '';

    // Settings + imports
    const settings = `<div class="grid2" style="margin-top:12px">
      <div class="card"><h2>Settings</h2><div class="xa-settings">
        <label>Goal per payout ($)<input id="xa-goal" inputmode="decimal" value="${(s.goalCents / 100).toFixed(0)}"></label>
        <label>Rate from last … payouts<input id="xa-n" type="number" min="1" max="30" value="${s.rateN}"></label>
        <label>Payday lag (days)<input id="xa-lag" type="number" min="0" max="20" value="${s.lag}"><span class="hint">Content Rewards only</span></label>
      </div></div>
      <div class="card"><h2>Imported analytics</h2>
        <p style="margin:0 0 6px">${dayKeys.length} days, ${esc(fd(dayKeys[0], true))} – ${esc(fd(lastDay, true))}. All viewers: ${hasAll ? '<span class="xa-ok">✓</span>' : '<span class="xa-bad">missing</span>'} · Verified: ${hasVer ? '<span class="xa-ok">✓</span>' : '<span class="xa-bad">missing</span>'}</p>
        ${data.imports.slice(-4).reverse().map((i) => `<div class="muted" style="font-size:.88rem">${esc(new Date(i.at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }))}: ${esc(i.file)} (${esc(i.kind)}, ${i.days} days)</div>`).join('')}
        <div class="actions" style="margin-top:10px"><button type="button" class="small danger" id="xa-clear">Delete X analytics</button></div>
      </div></div>`;

    body.innerHTML = (warn.length ? `<p class="note warn">${warn.map(esc).join(' ')}</p>` : '') +
      `<div class="kpis">${cards.join('')}</div>` + chart + table + drivers + settings;

    const num = (id) => $(id, body);
    num('#xa-goal').addEventListener('change', (e) => { const c = C.parseAmount(e.target.value); if (c !== null && c >= 0) { data.settings.goalCents = c; save(); render(); } });
    num('#xa-n').addEventListener('change', (e) => { const v = parseInt(e.target.value, 10); if (v >= 1 && v <= 30) { data.settings.rateN = v; save(); render(); } });
    num('#xa-lag').addEventListener('change', (e) => { const v = parseInt(e.target.value, 10); if (v >= 0 && v <= 20) { data.settings.lag = v; save(); render(); } });
    num('#xa-clear').addEventListener('click', (e) => {
      const b = e.currentTarget;
      if (b.dataset.armed !== '1') { b.dataset.armed = '1'; b.textContent = 'Tap again to delete'; setTimeout(() => { b.dataset.armed = ''; b.textContent = 'Delete X analytics'; }, 4000); return; }
      data = Object.assign(empty(), { settings: data.settings }); save(); render();
    });
  }

  // ── Import ──────────────────────────────────────────────────────────────
  let pending = [];
  $('#xa-import').addEventListener('click', () => $('#xa-file').click());
  $('#xa-file').addEventListener('change', async (ev) => {
    const files = Array.from(ev.target.files || []);
    ev.target.value = '';
    if (!files.length) return;
    pending = [];
    for (const f of files.slice(0, 6)) {
      try {
        if (f.size > 5 * 1024 * 1024) throw new Error('over 5 MB');
        const parsed = X.parseOverview(C.parseCSV(await f.text()), f.name);
        pending.push({ file: f.name.slice(0, 120), parsed });
      } catch (e) { pending.push({ file: f.name.slice(0, 120), error: e.message }); }
    }
    $('#xa-files').innerHTML = `<table class="tbl"><thead><tr><th>File</th><th>Dates</th><th>Kind</th></tr></thead><tbody>${
      pending.map((p, i) => p.error ? `<tr><td>${esc(p.file)}</td><td colspan="2" class="xa-bad">${esc(p.error)}</td></tr>` :
        `<tr><td>${esc(p.file)}</td><td class="num">${esc(fd(p.parsed.from, true))} – ${esc(fd(p.parsed.to, true))}<br><span class="muted">${p.parsed.days.length} days</span></td>
         <td><select data-kind="${i}" aria-label="Kind of export for ${esc(p.file)}"><option value="all"${p.parsed.kind === 'all' ? ' selected' : ''}>All viewers</option><option value="verified"${p.parsed.kind === 'verified' ? ' selected' : ''}>Verified only</option></select></td></tr>`).join('')
    }</tbody></table>`;
    $$('#xa-files [data-kind]').forEach((sel) => sel.addEventListener('change', () => { pending[+sel.dataset.kind].parsed.kind = sel.value; }));
    $('#xa-save').disabled = !pending.some((p) => p.parsed);
    $('#dlg-xa').showModal();
  });
  $('#xa-save').addEventListener('click', () => {
    let added = 0, updated = 0;
    for (const p of pending) {
      if (!p.parsed) continue;
      const res = X.mergeDays(data.days, p.parsed);
      data.days = res.days; added += res.added; updated += res.updated;
      data.imports.push({ at: new Date().toISOString(), file: p.file, kind: p.parsed.kind, days: p.parsed.days.length, from: p.parsed.from, to: p.parsed.to });
    }
    data.imports = data.imports.slice(-50);
    if (save()) msg('');
    $('#dlg-xa').close();
    render();
  });

  // ── Backup hooks used by app.js ─────────────────────────────────────────
  window.XApp = {
    exportData() { return data; },
    importData(d) {
      if (!d || typeof d.days !== 'object') return;
      for (const [day, v] of Object.entries(d.days)) data.days[day] = Object.assign({}, data.days[day] || {}, v);
      data.imports = (data.imports || []).concat(d.imports || []).slice(-50);
      if (d.settings) data.settings = Object.assign(data.settings, d.settings);
      save(); render();
    },
  };

  window.addEventListener('ocs-income-changed', render);
  window.addEventListener('storage', (e) => { if (e.key === KEY) { data = load(); render(); } if (e.key === INCOME_KEY) render(); });
  // Draw when the tab is opened (chart needs its width) and on resize.
  document.addEventListener('click', (e) => { if (e.target.closest('[data-view="x"]')) setTimeout(render, 0); });
  let rt = null;
  window.addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(() => { if (!$('#view-x').hidden) render(); }, 150); });
  render();
})();
