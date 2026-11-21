// OC Scanner IntelHQ — Income page (P08). The math lives in income-core.js.
// Everything is kept in this browser's localStorage under KEY; nothing is sent anywhere
// (the page's Content-Security-Policy blocks network requests: connect-src 'none').
(function () {
  'use strict';
  const C = window.IncomeCore;
  const KEY = 'ocs-income-v1';
  const RANGE_KEY = 'ocs-income-range';
  const MAX_FILE = 5 * 1024 * 1024;
  const HISTORY_CAP = 2000;
  const $ = (s, el) => (el || document).querySelector(s);
  const $$ = (s, el) => Array.from((el || document).querySelectorAll(s));

  // ── Storage ─────────────────────────────────────────────────────────────
  const empty = () => ({ version: 1, entries: [], batches: [], history: [], destinations: [], mappings: {} });
  let data = load();
  let persistAsked = false;

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return empty();
      const d = JSON.parse(raw);
      return Object.assign(empty(), d, { entries: (d.entries || []).map(C.normalizeEntry) });
    } catch (e) {
      showStorageError('Couldn’t read saved income on this device (' + e.message + '). Nothing has been changed.');
      return empty();
    }
  }
  function save() {
    try {
      localStorage.setItem(KEY, JSON.stringify(data));
      $('#storage-error').hidden = true;
      window.dispatchEvent(new Event('ocs-income-changed')); // X analytics view (x-app.js) re-reads payouts
      if (!persistAsked && navigator.storage && navigator.storage.persist) {
        persistAsked = true;
        navigator.storage.persist().catch(() => {});
      }
      return true;
    } catch (e) {
      showStorageError('Couldn’t save on this device: ' + e.message + '. Download a backup before closing this page.');
      return false;
    }
  }
  function showStorageError(msg) { const el = $('#storage-error'); el.textContent = msg; el.hidden = false; }

  function uid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return 'e' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
  }
  function nowIso() { return new Date().toISOString(); }
  function log(action, text, id) {
    data.history.unshift({ at: nowIso(), action, text, id: id || '' });
    if (data.history.length > HISTORY_CAP) data.history.length = HISTORY_CAP;
  }
  function rememberDestination(d) {
    if (d && !data.destinations.includes(d)) data.destinations.push(d);
  }

  // ── Formatting ──────────────────────────────────────────────────────────
  const esc = (s) => String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const money = (c, o) => C.formatMoney(c, o);
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  function fmtDate(iso, short) {
    if (!iso) return '';
    const [y, m, d] = iso.split('-').map(Number);
    return short ? `${MON[m - 1]} ${d}` : `${MON[m - 1]} ${d}, ${y}`;
  }
  function fmtRange(r) {
    if (r.from === '1900-01-01') return 'all time';
    if (r.from.slice(0, 4) === r.to.slice(0, 4)) return `${fmtDate(r.from, true)} – ${fmtDate(r.to)}`;
    return `${fmtDate(r.from)} – ${fmtDate(r.to)}`;
  }
  function change(now, before) {
    const p = C.pctChange(now, before);
    if (p === null) return before === 0 && now ? '<span class="muted">nothing before</span>' : '';
    const cls = p > 0 ? 'up' : p < 0 ? 'down' : '';
    return `<span class="${cls}">${p > 0 ? '▲' : p < 0 ? '▼' : ''} ${Math.abs(p * 100).toFixed(0)}%</span>`;
  }
  const kindBadge = (k) => `<span class="badge ${esc(k)}">${esc(k)}</span>`;
  const sourceShort = (id) => (C.SOURCES.find((s) => s.id === id) || { short: id }).short;

  // ── Range ───────────────────────────────────────────────────────────────
  let rangeState = (() => { try { return JSON.parse(localStorage.getItem(RANGE_KEY)) || { preset: 'this-month' }; } catch (e) { return { preset: 'this-month' }; } })();
  function currentRange() {
    if (rangeState.preset === 'custom' && rangeState.from && rangeState.to) {
      return rangeState.from <= rangeState.to ? { from: rangeState.from, to: rangeState.to } : { from: rangeState.to, to: rangeState.from };
    }
    return C.rangeFor(rangeState.preset || 'this-month', C.todayPacific());
  }
  function setRange(st) {
    rangeState = st;
    try { localStorage.setItem(RANGE_KEY, JSON.stringify(st)); } catch (e) {}
    render();
  }

  // ── Render ──────────────────────────────────────────────────────────────
  function render() {
    const r = currentRange();
    $$('.chip[data-range]').forEach((b) => b.setAttribute('aria-pressed', String(rangeState.preset === b.dataset.range)));
    $('#range-from').value = rangeState.preset === 'custom' ? rangeState.from || '' : '';
    $('#range-to').value = rangeState.preset === 'custom' ? rangeState.to || '' : '';
    renderOverview(r);
    renderPayouts();
    renderEntries(r);
    renderImports();
    renderHistory();
    backupStatus();
    $('#dest-list').innerHTML = data.destinations.map((d) => `<option value="${esc(d)}">`).join('');
  }

  function renderOverview(r) {
    const s = C.summarize(data.entries, r);
    const isAll = r.from === '1900-01-01';
    const prev = isAll ? null : C.summarize(data.entries, C.previousRange(r));
    const today = C.todayPacific();
    let days;
    if (isAll) {
      const rev = data.entries.filter((e) => e.kind === 'revenue').map((e) => e.date).sort();
      days = rev.length ? C.daysBetween(rev[0], today) : 0;
    } else {
      days = C.daysBetween(r.from, r.to < today ? r.to : today);
    }
    const perDay = days > 0 ? Math.round(s.revenue.net / days) : 0;
    const prevLabel = !prev ? '' : prev.revenue.net ? `vs ${fmtRange(prev.range)}: ${money(prev.revenue.net)}` : `nothing in ${fmtRange(prev.range)}`;
    $('#kpis').innerHTML = `
      <div class="kpi"><div class="lbl">Revenue · ${esc(fmtRange(r))}</div><div class="val num">${money(s.revenue.net)}</div>
        <div class="sub">${prev ? (prev.revenue.net ? change(s.revenue.net, prev.revenue.net) + ' ' : '') + '<span class="muted">' + esc(prevLabel) + '</span>' : 'after fees'}</div></div>
      <div class="kpi"><div class="lbl">Gross / fees</div><div class="val num">${money(s.revenue.gross)}</div>
        <div class="sub">${money(s.revenue.fee)} in fees${s.revenue.gross ? ` (${(s.revenue.fee / s.revenue.gross * 100).toFixed(1)}%)` : ''}</div></div>
      <div class="kpi"><div class="lbl">Payments</div><div class="val num">${s.revenue.count}</div>
        <div class="sub">${prev ? 'before: ' + prev.revenue.count : 'revenue entries'}</div></div>
      <div class="kpi"><div class="lbl">Per day</div><div class="val num">${money(perDay)}</div>
        <div class="sub">over ${days} day${days === 1 ? '' : 's'}</div></div>`;
    const ex = s.excluded;
    const parts = [['expenses', ex.expense], ['taxes', ex.tax], ['transfers', ex.transfer]].filter((p) => p[1]);
    $('#excluded-line').innerHTML = parts.length
      ? 'Not counted as income: ' + parts.map((p) => `${p[0]} <span class="num">${money(p[1])}</span>`).join(' · ')
      : 'Nothing excluded in these dates (expenses, taxes and transfers are never counted as income).';

    // Trend: last 12 months ending this month.
    const rows = C.monthly(data.entries, C.monthKey(today), 12);
    const W = Math.max(320, Math.min(1200, $('#trend').clientWidth || 720)), H = W < 500 ? 200 : 240, top = 22, bottom = 28, gap = W < 500 ? 4 : 8;
    const max = Math.max(1, ...rows.map((x) => x.net));
    const bw = (W - gap * (rows.length - 1)) / rows.length;
    const cur = C.monthKey(today);
    const bars = rows.map((x, i) => {
      const h = Math.max(0, Math.round((x.net / max) * (H - top - bottom)));
      const xpos = i * (bw + gap);
      const y = H - bottom - h;
      const [yy, mm] = x.month.split('-').map(Number);
      const narrow = bw < 34;
      const label = narrow ? MON[mm - 1].slice(0, 1) : MON[mm - 1] + (mm === 1 || i === 0 ? ` ’${String(yy).slice(2)}` : '');
      const tip = `${MON[mm - 1]} ${yy}: ${money(x.net)}`;
      return `<g><title>${esc(tip)}</title>
        <rect class="bar${x.month === cur ? ' cur' : ''}" x="${xpos.toFixed(1)}" y="${y}" width="${bw.toFixed(1)}" height="${h}" rx="3"></rect>
        ${x.net && !narrow ? `<text class="val" x="${(xpos + bw / 2).toFixed(1)}" y="${y - 6}" text-anchor="middle">${esc(money(x.net, { whole: true }))}</text>` : ''}
        <text x="${(xpos + bw / 2).toFixed(1)}" y="${H - 8}" text-anchor="middle">${esc(label)}</text></g>`;
    }).join('');
    $('#trend').innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Revenue by month, last 12 months">
      <line x1="0" x2="${W}" y1="${H - bottom}" y2="${H - bottom}" stroke="currentColor" stroke-opacity=".2"></line>${bars}</svg>`;
    $('#trend-table').innerHTML = `<table class="tbl"><thead><tr><th>Month</th>${C.SOURCES.map((x) => `<th class="r">${esc(x.short)}</th>`).join('')}<th class="r">Total</th></tr></thead><tbody>${
      rows.slice().reverse().map((x) => `<tr><td>${esc(MON[+x.month.slice(5) - 1] + ' ' + x.month.slice(0, 4))}</td>${
        C.SOURCES.map((src) => `<td class="r num">${x.bySource[src.id] ? money(x.bySource[src.id]) : '<span class="muted">–</span>'}</td>`).join('')
      }<td class="r num"><strong>${money(x.net)}</strong></td></tr>`).join('')}</tbody></table>`;

    // By source
    const src = Object.entries(s.bySource).sort((a, b) => b[1].net - a[1].net);
    $('#by-source').innerHTML = src.length ? `<table class="tbl"><thead><tr><th>Source</th><th class="r">Net</th><th class="r hide-sm">Gross</th><th class="r hide-sm">Fees</th><th class="r">#</th>${prev ? '<th class="r">vs before</th>' : ''}</tr></thead><tbody>${
      src.map(([id, v]) => {
        const share = s.revenue.net > 0 ? Math.max(0, v.net / s.revenue.net) : 0;
        const p = prev && prev.bySource[id] ? prev.bySource[id].net : 0;
        return `<tr><td>${esc(C.sourceLabel(id))}<span class="share" style="width:${(share * 100).toFixed(1)}%"></span></td>
          <td class="r num">${money(v.net)}</td><td class="r num hide-sm">${money(v.gross)}</td><td class="r num hide-sm">${money(v.fee)}</td>
          <td class="r num">${v.count}</td>${prev ? `<td class="r num">${change(v.net, p) || '<span class="muted">–</span>'}</td>` : ''}</tr>`;
      }).join('')}
      <tr><td><strong>Total</strong></td><td class="r num"><strong>${money(s.revenue.net)}</strong></td><td class="r num hide-sm">${money(s.revenue.gross)}</td><td class="r num hide-sm">${money(s.revenue.fee)}</td><td class="r num">${s.revenue.count}</td>${prev ? `<td class="r num">${change(s.revenue.net, prev.revenue.net)}</td>` : ''}</tr>
      </tbody></table>` : emptyState();

    const dst = Object.entries(s.byDestination).sort((a, b) => b[1].net - a[1].net);
    $('#by-dest').innerHTML = dst.length ? `<table class="tbl"><thead><tr><th>Paid to</th><th class="r">Net</th><th class="r">#</th></tr></thead><tbody>${
      dst.map(([d, v]) => `<tr><td>${d === '(not set)' ? '<span class="muted">Not set</span>' : esc(d)}</td><td class="r num">${money(v.net)}</td><td class="r num">${v.count}</td></tr>`).join('')
    }</tbody></table>` : emptyState();
  }

  function emptyState() {
    return data.entries.length
      ? '<div class="empty">No income in these dates.</div>'
      : '<div class="empty">No income yet. Use <strong>+ Add income</strong> or <strong>Import CSV</strong> to start.</div>';
  }

  function renderPayouts() {
    const list = C.payoutPeriods(data.entries);
    $('#payouts').innerHTML = list.length ? `<table class="tbl"><thead><tr><th>Period</th><th>Source</th><th class="hide-sm">Paid on</th><th class="r">Net</th><th class="r">Per day</th><th class="r">vs previous</th></tr></thead><tbody>${
      list.map((p) => `<tr><td>${esc(fmtDate(p.periodStart, true))} – ${esc(fmtDate(p.periodEnd))} <span class="muted">(${p.days} d)</span></td>
        <td>${esc(sourceShort(p.source))}</td><td class="hide-sm">${esc(fmtDate(p.paidOn))}</td>
        <td class="r num">${money(p.net)}</td><td class="r num">${money(p.perDay)}</td>
        <td class="r num">${p.change === null ? '<span class="muted">first</span>' : `<span class="${p.change > 0 ? 'up' : p.change < 0 ? 'down' : ''}">${money(p.change, { sign: true })}${p.changePct !== null ? ` (${(p.changePct * 100).toFixed(0)}%)` : ''}</span>`}</td></tr>`).join('')
    }</tbody></table>` : '<div class="empty">No payouts with a period yet. When you add an X payout, fill in "Payout period from / to".</div>';
  }

  const filters = { source: '', kind: '', q: '' };
  function renderEntries(r) {
    const q = filters.q.trim().toLowerCase();
    const list = data.entries
      .filter((e) => e.date >= r.from && e.date <= r.to)
      .filter((e) => !filters.source || e.source === filters.source)
      .filter((e) => !filters.kind || e.kind === filters.kind)
      .filter((e) => !q || [e.destination, e.counterparty, e.note, e.ref, C.sourceLabel(e.source)].join(' ').toLowerCase().includes(q))
      .sort((a, b) => b.date.localeCompare(a.date) || (b.createdAt || '').localeCompare(a.createdAt || ''));
    const revTotal = list.filter((e) => e.kind === 'revenue').reduce((t, e) => t + e.net, 0);
    $('#entries-count').textContent = `${list.length} entr${list.length === 1 ? 'y' : 'ies'} · ${fmtRange(r)} · revenue ${money(revTotal)}. Tap a row to edit.`;
    const shown = list.slice(0, 1000);
    $('#entries').innerHTML = list.length ? `<table class="tbl"><thead><tr><th>Date</th><th>Source</th><th>Kind</th><th class="r">Net</th><th class="hide-sm">Paid to</th><th class="hide-sm">Note</th></tr></thead><tbody>${
      shown.map((e) => `<tr class="click" data-id="${esc(e.id)}" tabindex="0"><td class="num">${esc(fmtDate(e.date, false))}</td>
        <td>${esc(sourceShort(e.source))}${e.counterparty ? `<br><span class="muted">${esc(e.counterparty)}</span>` : ''}</td>
        <td>${kindBadge(e.kind)}</td><td class="r num">${money(e.net)}</td>
        <td class="hide-sm">${esc(e.destination)}</td><td class="hide-sm">${esc(e.note.length > 60 ? e.note.slice(0, 60) + '…' : e.note)}</td></tr>`).join('')
    }</tbody></table>${list.length > shown.length ? `<p class="muted">Showing the newest 1,000. Narrow the dates to see older ones.</p>` : ''}` : emptyState();
  }

  function renderImports() {
    const list = data.batches.slice().sort((a, b) => b.at.localeCompare(a.at));
    $('#imports').innerHTML = list.length ? `<table class="tbl"><thead><tr><th>When</th><th>Source</th><th class="hide-sm">File</th><th class="r">Rows</th><th></th></tr></thead><tbody>${
      list.map((b) => {
        const left = data.entries.filter((e) => e.batch === b.id).length;
        return `<tr><td class="num">${esc(new Date(b.at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }))}</td>
          <td>${esc(b.source === 'backup' ? 'CSV export' : sourceShort(b.source))}</td><td class="hide-sm">${esc(b.file)}</td>
          <td class="r num">${left}${left !== b.count ? `<span class="muted"> of ${b.count}</span>` : ''}</td>
          <td class="r">${left ? `<button class="small danger" data-undo="${esc(b.id)}" type="button">Undo</button>` : '<span class="muted">undone</span>'}</td></tr>`;
      }).join('')}</tbody></table>` : '<div class="empty">No imports yet.</div>';
  }

  function renderHistory() {
    const list = data.history.slice(0, 150);
    $('#history').innerHTML = list.length ? `<table class="tbl"><tbody>${
      list.map((h) => `<tr><td class="num" style="white-space:nowrap">${esc(new Date(h.at).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }))}</td><td><span class="badge">${esc(h.action)}</span></td><td>${esc(h.text)}</td></tr>`).join('')
    }</tbody></table>` : '<div class="empty">Nothing yet.</div>';
  }

  // ── Views ───────────────────────────────────────────────────────────────
  function setView(v) {
    $$('.views [role=tab]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.view === v)));
    $$('section[role=tabpanel]').forEach((s) => { s.hidden = s.id !== 'view-' + v; });
  }
  $$('.views [role=tab]').forEach((b) => b.addEventListener('click', () => setView(b.dataset.view)));
  $$('[data-view-link]').forEach((a) => a.addEventListener('click', (e) => { e.preventDefault(); setView(a.dataset.viewLink); }));
  $$('.chip[data-range]').forEach((b) => b.addEventListener('click', () => setRange({ preset: b.dataset.range })));
  function customRange() {
    const from = $('#range-from').value, to = $('#range-to').value;
    if (from && to) setRange({ preset: 'custom', from, to });
  }
  $('#range-from').addEventListener('change', customRange);
  $('#range-to').addEventListener('change', customRange);

  // Filters
  $('#f-source').innerHTML += C.SOURCES.map((s) => `<option value="${s.id}">${esc(s.label)}</option>`).join('');
  $('#f-kind').innerHTML += C.KINDS.map((k) => `<option value="${k.id}">${esc(k.label)}</option>`).join('');
  $('#f-source').addEventListener('change', (e) => { filters.source = e.target.value; renderEntries(currentRange()); });
  $('#f-kind').addEventListener('change', (e) => { filters.kind = e.target.value; renderEntries(currentRange()); });
  $('#f-q').addEventListener('input', (e) => { filters.q = e.target.value; renderEntries(currentRange()); });

  // Dialog close buttons
  $$('dialog [data-close]').forEach((b) => b.addEventListener('click', () => b.closest('dialog').close()));

  // ── Add / edit ──────────────────────────────────────────────────────────
  const form = $('#entry-form');
  form.source.innerHTML = C.SOURCES.map((s) => `<option value="${s.id}">${esc(s.label)}</option>`).join('');
  form.kind.innerHTML = C.KINDS.map((k) => `<option value="${k.id}">${esc(k.label)}</option>`).join('');
  let editing = null;
  let deleteArmed = null;

  const centsToInput = (c) => (c === null || c === undefined ? '' : (c / 100).toFixed(2));
  function openEntry(entry) {
    editing = entry || null;
    $('#dlg-entry-title').textContent = entry ? 'Edit entry' : 'Add income';
    $('#entry-errors').hidden = true;
    const e = entry || { date: C.todayPacific(), source: 'x_ads', kind: 'revenue', gross: null, fee: 0, net: null, periodStart: '', periodEnd: '', destination: '', counterparty: '', ref: '', note: '' };
    form.date.value = e.date; form.source.value = e.source; form.kind.value = e.kind;
    form.gross.value = entry ? centsToInput(e.gross) : '';
    form.fee.value = entry && e.fee ? centsToInput(e.fee) : '';
    form.net.value = entry ? centsToInput(e.net) : '';
    form.periodStart.value = e.periodStart; form.periodEnd.value = e.periodEnd;
    form.destination.value = e.destination; form.counterparty.value = e.counterparty;
    form.ref.value = e.ref; form.note.value = e.note;
    $('#btn-delete').hidden = !entry;
    $('#btn-delete').textContent = 'Delete';
    deleteArmed = null;
    syncForm();
    $('#dlg-entry').showModal();
  }
  function syncForm() {
    $('#sponsor-wrap').hidden = form.source.value !== 'sponsorship';
    const g = C.parseAmount(form.gross.value), f = C.parseAmount(form.fee.value), n = C.parseAmount(form.net.value);
    const hint = $('#net-hint');
    if (n === null && g !== null) hint.textContent = 'Will be ' + money(g - Math.abs(f || 0)) + ' (gross − fees)';
    else if (n !== null && g !== null && Math.abs(g - Math.abs(f || 0) - n) > 1 && form.kind.value === 'revenue') hint.textContent = 'Doesn’t equal gross − fees; net is what’s counted';
    else hint.textContent = 'What actually arrived';
  }
  ['source', 'gross', 'fee', 'net', 'kind'].forEach((n) => form[n].addEventListener('input', syncForm));

  form.addEventListener('submit', (ev) => {
    ev.preventDefault();
    const errs = [];
    const amt = (name, label) => {
      const v = form[name].value.trim();
      if (!v) return null;
      const c = C.parseAmount(v);
      if (c === null) errs.push(`${label} isn’t a number.`);
      return c;
    };
    const gross = amt('gross', 'Gross'), fee = amt('fee', 'Fees'), net = amt('net', 'Net');
    if (gross === null && net === null && !errs.length) errs.push('Enter the gross or the net amount.');
    const e = C.normalizeEntry({
      id: editing ? editing.id : uid(),
      date: form.date.value, source: form.source.value, kind: form.kind.value,
      gross, fee: fee === null ? 0 : fee, net,
      periodStart: form.periodStart.value, periodEnd: form.periodEnd.value,
      destination: form.destination.value, counterparty: form.counterparty.value,
      ref: form.ref.value, note: form.note.value,
      batch: editing ? editing.batch : '',
      createdAt: editing ? editing.createdAt : nowIso(),
      updatedAt: nowIso(),
    });
    e.fingerprint = editing && editing.fingerprint ? editing.fingerprint : 'manual|' + e.id;
    if (!errs.length) errs.push(...C.validateEntry(e));
    if (errs.length) {
      const ul = $('#entry-errors');
      ul.innerHTML = errs.map((x) => `<li>${esc(x)}</li>`).join('');
      ul.hidden = false;
      ul.scrollIntoView({ block: 'nearest' });
      return;
    }
    const desc = `${C.sourceLabel(e.source)} ${money(e.net)} on ${fmtDate(e.date)} (${e.kind})`;
    if (editing) {
      const i = data.entries.findIndex((x) => x.id === editing.id);
      if (i >= 0) data.entries[i] = e;
      log('edit', desc, e.id);
    } else {
      data.entries.push(e);
      log('add', desc, e.id);
    }
    rememberDestination(e.destination);
    save();
    $('#dlg-entry').close();
    render();
  });

  $('#btn-delete').addEventListener('click', () => {
    if (!editing) return;
    if (deleteArmed !== editing.id) {
      deleteArmed = editing.id;
      $('#btn-delete').textContent = 'Tap again to delete';
      setTimeout(() => { if (deleteArmed) { deleteArmed = null; $('#btn-delete').textContent = 'Delete'; } }, 4000);
      return;
    }
    data.entries = data.entries.filter((x) => x.id !== editing.id);
    log('delete', `${C.sourceLabel(editing.source)} ${money(editing.net)} on ${fmtDate(editing.date)} (${editing.kind})`, editing.id);
    save();
    $('#dlg-entry').close();
    render();
  });

  $('#btn-add').addEventListener('click', () => openEntry(null));
  $('#entries').addEventListener('click', (ev) => {
    const tr = ev.target.closest('tr[data-id]');
    if (tr) openEntry(data.entries.find((x) => x.id === tr.dataset.id));
  });
  $('#entries').addEventListener('keydown', (ev) => {
    if (ev.key !== 'Enter') return;
    const tr = ev.target.closest('tr[data-id]');
    if (tr) openEntry(data.entries.find((x) => x.id === tr.dataset.id));
  });

  // ── Import ──────────────────────────────────────────────────────────────
  const imp = { rows: null, header: 0, mapping: null, proposed: null, file: '', own: false };
  const MAP_FIELDS = [
    ['date', 'Date received *'], ['net', 'Net amount'], ['gross', 'Gross / amount'], ['fee', 'Fee'],
    ['type', 'Type (payment, transfer…)'], ['status', 'Status'], ['ref', 'Transaction / payout ID'],
    ['periodStart', 'Payout period start'], ['periodEnd', 'Payout period end'], ['sponsor', 'Sponsor name'],
  ];
  $('#imp-source').innerHTML = C.SOURCES.map((s) => `<option value="${s.id}">${esc(s.label)}</option>`).join('');

  function impStep(n) {
    $('#imp-step1').hidden = n !== 1; $('#imp-step2').hidden = n !== 2; $('#imp-step3').hidden = n !== 3;
    $('#imp-back').hidden = n === 1 || (n === 3 && imp.own);
    const next = $('#imp-next');
    next.dataset.step = n;
    next.textContent = n === 3 ? 'Save' : 'Next';
    next.disabled = (n === 1 && !imp.rows) || (n === 3 && !(imp.proposed || []).some((x) => x.include));
  }
  $('#btn-import').addEventListener('click', () => {
    Object.assign(imp, { rows: null, header: 0, mapping: null, proposed: null, file: '', own: false });
    $('#imp-file').value = '';
    $('#imp-errors').hidden = true;
    impStep(1);
    $('#dlg-import').showModal();
  });
  function impError(msg) { const ul = $('#imp-errors'); ul.innerHTML = `<li>${esc(msg)}</li>`; ul.hidden = false; }

  $('#imp-file').addEventListener('change', async (ev) => {
    const f = ev.target.files[0];
    imp.rows = null; $('#imp-errors').hidden = true; impStep(1);
    if (!f) return;
    if (f.size > MAX_FILE) return impError('That file is over 5 MB. Export a shorter date range.');
    try {
      const rows = C.parseCSV(await f.text());
      if (rows.length < 2) return impError('No rows found in that file.');
      imp.rows = rows; imp.file = f.name.slice(0, 120);
      impStep(1);
    } catch (e) { impError('Couldn’t read that file: ' + e.message); }
  });

  function headerSig(h) { return h.map((x) => x.trim().toLowerCase()).join('|'); }
  function renderMapping() {
    const headers = imp.rows[imp.header] || [];
    const opts = (sel) => `<option value="-1">— none —</option>` + headers.map((h, i) => `<option value="${i}"${i === sel ? ' selected' : ''}>${esc(h || 'Column ' + (i + 1))}</option>`).join('');
    const src = $('#imp-source').value;
    $('#imp-map').innerHTML = `<label>Header is on row<input type="number" min="1" max="${Math.min(imp.rows.length, 25)}" value="${imp.header + 1}" id="imp-header"></label>` +
      MAP_FIELDS.filter(([k]) => k !== 'sponsor' || src === 'sponsorship')
        .map(([k, label]) => `<label>${esc(label)}<select data-map="${k}">${opts(imp.mapping[k])}</select></label>`).join('');
    const sample = imp.rows.slice(imp.header + 1, imp.header + 4);
    const cut = (s) => (s.length > 32 ? s.slice(0, 32) + '…' : s);
    $('#imp-sample').innerHTML = `<p class="muted" style="margin:6px 0">First rows of the file (shown here only, not saved):</p><table class="tbl"><thead><tr>${headers.map((h) => `<th>${esc(cut(h))}</th>`).join('')}</tr></thead><tbody>${
      sample.map((r) => `<tr>${headers.map((_, i) => `<td>${esc(cut(String(r[i] || '')))}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
    $('#imp-header').addEventListener('change', (e) => {
      const n = Math.max(1, Math.min(imp.rows.length, parseInt(e.target.value, 10) || 1));
      imp.header = n - 1;
      imp.mapping = C.guessMapping(imp.rows[imp.header]);
      renderMapping();
    });
    $$('#imp-map select[data-map]').forEach((s) => s.addEventListener('change', () => { imp.mapping[s.dataset.map] = parseInt(s.value, 10); }));
  }

  function buildPreview() {
    const src = $('#imp-source').value;
    const dest = $('#imp-dest').value.trim();
    if (imp.own) {
      imp.proposed = C.fromOwnCSV(imp.rows);
      const ids = new Set(data.entries.map((e) => e.id));
      for (const p of imp.proposed) {
        if (p.entry && p.entry.id && ids.has(p.entry.id)) { p.include = false; p.duplicate = true; p.reason = 'Already saved'; }
      }
    } else {
      imp.proposed = C.rowsToEntries(imp.rows, imp.header, imp.mapping, { source: src, destination: dest });
    }
    C.markDuplicates(imp.proposed, data.entries);
    renderPreview();
  }
  function renderPreview() {
    const p = imp.proposed;
    const inc = p.filter((x) => x.include);
    const dup = p.filter((x) => x.duplicate).length;
    const skip = p.length - inc.length - dup;
    const revenue = inc.filter((x) => x.entry.kind === 'revenue').reduce((t, x) => t + x.entry.net, 0);
    $('#imp-summary').innerHTML = `<strong>${inc.length}</strong> to save (revenue ${money(revenue)}) · ${dup} already saved · ${skip} skipped. Untick anything you don’t want, or change its kind.`;
    const shown = p.slice(0, 500);
    $('#imp-preview').innerHTML = `<table class="tbl"><thead><tr><th>Save</th><th class="hide-sm">Row</th><th>Date</th><th>Kind</th><th class="r">Net</th><th>Note</th></tr></thead><tbody>${
      shown.map((x, i) => `<tr><td><input type="checkbox" data-inc="${i}" ${x.include ? 'checked' : ''} ${x.entry && !x.duplicate && !x.reason ? '' : 'disabled'} aria-label="Save row ${x.line}"></td>
        <td class="hide-sm num">${x.line}</td><td class="num">${x.entry ? esc(fmtDate(x.entry.date, false)) : ''}</td>
        <td>${x.entry && !x.duplicate && !x.reason ? `<select data-kind="${i}">${C.KINDS.map((k) => `<option value="${k.id}"${k.id === x.entry.kind ? ' selected' : ''}>${esc(k.id)}</option>`).join('')}</select>` : x.entry ? kindBadge(x.entry.kind) : ''}</td>
        <td class="r num">${x.entry ? money(x.entry.net) : ''}</td><td class="muted">${esc(x.reason || '')}</td></tr>`).join('')
    }</tbody></table>${p.length > shown.length ? `<p class="muted">Showing the first 500 of ${p.length} rows; all ${inc.length} ticked rows will be saved.</p>` : ''}`;
    $$('#imp-preview [data-inc]').forEach((cb) => cb.addEventListener('change', () => { imp.proposed[+cb.dataset.inc].include = cb.checked; renderPreview(); }));
    $$('#imp-preview [data-kind]').forEach((s) => s.addEventListener('change', () => {
      const x = imp.proposed[+s.dataset.kind];
      x.entry = C.normalizeEntry(Object.assign({}, x.entry, { kind: s.value }));
      renderPreview();
    }));
    $('#imp-next').disabled = inc.length === 0;
  }

  $('#imp-next').addEventListener('click', () => {
    const step = +$('#imp-next').dataset.step;
    if (step === 1) {
      if (!imp.rows) return;
      imp.own = C.isOwnExport(imp.rows[0]);
      if (imp.own) { buildPreview(); impStep(3); return; }
      imp.header = C.findHeaderRow(imp.rows);
      const src = $('#imp-source').value;
      const saved = data.mappings[src + '|' + headerSig(imp.rows[imp.header])];
      imp.mapping = Object.assign(C.guessMapping(imp.rows[imp.header]), saved || {});
      renderMapping();
      impStep(2);
    } else if (step === 2) {
      if (imp.mapping.date < 0) return alertInline('Pick the date column.');
      if (imp.mapping.gross < 0 && imp.mapping.net < 0) return alertInline('Pick an amount column (net or gross).');
      data.mappings[$('#imp-source').value + '|' + headerSig(imp.rows[imp.header])] = Object.assign({}, imp.mapping);
      save();
      buildPreview();
      impStep(3);
    } else if (step === 3) {
      const inc = imp.proposed.filter((x) => x.include && x.entry);
      if (!inc.length) return;
      const batchId = uid();
      const at = nowIso();
      for (const x of inc) {
        const e = Object.assign({}, x.entry, { id: imp.own && x.entry.id ? x.entry.id : uid(), batch: batchId, createdAt: at, updatedAt: at });
        data.entries.push(e);
        rememberDestination(e.destination);
      }
      const src = imp.own ? 'backup' : $('#imp-source').value;
      data.batches.push({ id: batchId, at, source: src, file: imp.file, count: inc.length });
      log('import', `${inc.length} rows from ${imp.file} (${src === 'backup' ? 'CSV export' : C.sourceLabel(src)})`, batchId);
      save();
      $('#dlg-import').close();
      render();
    }
  });
  function alertInline(msg) {
    let p = $('#imp-map-err');
    if (!p) { p = document.createElement('p'); p.id = 'imp-map-err'; p.className = 'errors'; p.style.listStyle = 'none'; p.style.paddingLeft = '0'; $('#imp-step2').prepend(p); }
    p.textContent = msg;
  }
  $('#imp-back').addEventListener('click', () => {
    const step = +$('#imp-next').dataset.step;
    if (step === 3) { renderMapping(); impStep(2); } else impStep(1);
  });

  $('#imports').addEventListener('click', (ev) => {
    const b = ev.target.closest('[data-undo]');
    if (!b) return;
    if (b.dataset.armed !== '1') { b.dataset.armed = '1'; b.textContent = 'Tap again'; setTimeout(() => { b.dataset.armed = ''; b.textContent = 'Undo'; }, 4000); return; }
    const id = b.dataset.undo;
    const n = data.entries.filter((e) => e.batch === id).length;
    data.entries = data.entries.filter((e) => e.batch !== id);
    const batch = data.batches.find((x) => x.id === id);
    log('undo import', `${n} rows removed from ${batch ? batch.file : 'an import'}`, id);
    save();
    render();
  });

  // ── Export & backup ─────────────────────────────────────────────────────
  function download(name, text, type) {
    const url = URL.createObjectURL(new Blob([text], { type }));
    const a = document.createElement('a');
    a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }
  function exportCSV(range) {
    const list = data.entries.filter((e) => !range || (e.date >= range.from && e.date <= range.to)).sort((a, b) => a.date.localeCompare(b.date));
    const label = range ? (range.from === '1900-01-01' ? 'all' : `${range.from}_to_${range.to}`) : 'all';
    download(`ocscanner-income-${label}.csv`, C.toCSV(list), 'text/csv;charset=utf-8');
    log('export', `CSV with ${list.length} rows (${range ? fmtRange(range) : 'everything'})`);
    save(); renderHistory();
  }
  $('#btn-export').addEventListener('click', () => exportCSV(currentRange()));
  $('#btn-export-range').addEventListener('click', () => exportCSV(currentRange()));
  $('#btn-export-all').addEventListener('click', () => exportCSV(null));

  $('#btn-backup').addEventListener('click', () => {
    const payload = { app: 'ocs-income', version: 1, exportedAt: nowIso(), entries: data.entries, batches: data.batches, destinations: data.destinations, history: data.history,
      xAnalytics: window.XApp ? window.XApp.exportData() : undefined };
    download(`ocscanner-income-backup-${C.todayPacific()}.json`, JSON.stringify(payload, null, 1), 'application/json');
    data.lastBackup = nowIso();
    log('backup', `Backup file with ${data.entries.length} entries`);
    save(); render();
  });
  function backupStatus() {
    const el = $('#backup-status');
    el.textContent = data.lastBackup ? `Last backup: ${new Date(data.lastBackup).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })}.` : 'No backup made on this device yet.';
  }

  let pendingRestore = null;
  $('#btn-restore').addEventListener('click', () => $('#restore-file').click());
  $('#restore-file').addEventListener('change', async (ev) => {
    const f = ev.target.files[0];
    ev.target.value = '';
    if (!f) return;
    let d;
    try {
      if (f.size > MAX_FILE * 4) throw new Error('file is too large');
      d = JSON.parse(await f.text());
      if (!d || d.app !== 'ocs-income' || !Array.isArray(d.entries)) throw new Error('not an IntelHQ income backup');
    } catch (e) {
      $('#restore-summary').textContent = 'Couldn’t use that file: ' + e.message + '.';
      $('#btn-restore-go').hidden = true;
      $('#dlg-restore').showModal();
      return;
    }
    const byId = new Map(data.entries.map((e) => [e.id, e]));
    const plan = { add: [], update: [], same: 0, bad: 0 };
    for (const raw of d.entries) {
      const e = C.normalizeEntry(raw);
      if (!e.id || C.validateEntry(e).length) { plan.bad++; continue; }
      const have = byId.get(e.id);
      if (!have) plan.add.push(e);
      else if ((e.updatedAt || '') > (have.updatedAt || '')) plan.update.push(e);
      else plan.same++;
    }
    pendingRestore = { plan, d };
    $('#restore-summary').innerHTML = `Backup from <strong>${esc(d.exportedAt ? new Date(d.exportedAt).toLocaleString('en-US') : 'unknown date')}</strong>: ${d.entries.length} entries.<br>
      ${plan.add.length} new · ${plan.update.length} newer than this device’s copy · ${plan.same} already here${plan.bad ? ` · ${plan.bad} unreadable (skipped)` : ''}.<br>
      ${d.xAnalytics && d.xAnalytics.days ? `X analytics: ${Object.keys(d.xAnalytics.days).length} days (merged; days already here are replaced by the backup's).<br>` : ''}
      <span class="muted">Restore adds and updates; it never deletes entries already on this device.</span>`;
    $('#btn-restore-go').hidden = !(plan.add.length || plan.update.length || (d.xAnalytics && d.xAnalytics.days));
    $('#dlg-restore').showModal();
  });
  $('#btn-restore-go').addEventListener('click', () => {
    if (!pendingRestore) return;
    const { plan, d } = pendingRestore;
    for (const e of plan.add) data.entries.push(e);
    for (const e of plan.update) { const i = data.entries.findIndex((x) => x.id === e.id); if (i >= 0) data.entries[i] = e; }
    const bIds = new Set(data.batches.map((b) => b.id));
    for (const b of d.batches || []) if (b && b.id && !bIds.has(b.id)) data.batches.push(b);
    for (const x of d.destinations || []) if (typeof x === 'string') rememberDestination(x);
    const hKey = (h) => h.at + '|' + h.action + '|' + h.id + '|' + h.text;
    const hSet = new Set(data.history.map(hKey));
    for (const h of d.history || []) if (h && h.at && !hSet.has(hKey(h))) data.history.push(h);
    data.history.sort((a, b) => b.at.localeCompare(a.at));
    if (data.history.length > HISTORY_CAP) data.history.length = HISTORY_CAP;
    if (d.xAnalytics && window.XApp) window.XApp.importData(d.xAnalytics);
    log('restore', `${plan.add.length} added, ${plan.update.length} updated from a backup${d.xAnalytics && d.xAnalytics.days ? ', plus X analytics' : ''}`);
    save();
    pendingRestore = null;
    $('#dlg-restore').close();
    render();
  });

  // Another tab (IntelHQ or the full-screen page) changed something: reload. Also follow theme changes.
  window.addEventListener('storage', (e) => {
    if (e.key === KEY) { data = load(); render(); }
    if (e.key === 'ocs-theme') {
      if (e.newValue === 'light') document.documentElement.setAttribute('data-theme', 'light');
      else document.documentElement.removeAttribute('data-theme');
    }
  });

  let resizeTimer = null;
  window.addEventListener('resize', () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(() => renderOverview(currentRange()), 150); });
  // Inside IntelHQ the tab starts hidden (zero width); redraw the chart once it's shown.
  if ('IntersectionObserver' in window) new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) renderOverview(currentRange()); }).observe($('#trend'));
  if (location.hash === '#backup') setView('backup');
  render();
})();
