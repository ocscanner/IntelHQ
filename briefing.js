/* OC Scanner IntelHQ — sidebar navigation + Briefing (first screen).
 *
 * Sidebar: replaces the old group dropdowns (#navgroups is hidden by CSS; its buttons stay in the
 * page so nothing else breaks). Tabs are still switched by hq.js activateTab(); hq.js calls
 * window.onTabActivated(pid) so the sidebar can follow.
 *
 * Briefing: built from data hq.js already loads (handed over through window.ocsFeed from loadNWS,
 * loadLocalNews, loadTicker and loadLaunches), the newsroom and income workspaces in this browser,
 * and the Status tab's SRC_HEALTH. While the Briefing is on screen it also reads three small public
 * feeds: IEM current observations (Storm Index stations), NIFC fires in SoCal, and the aircraft count
 * from oc-radar-proxy. Nothing here posts anything: "Draft" and "Copy" only prepare text for you.
 */
(function () {
  'use strict';

  // ── Small helpers ─────────────────────────────────────────────────────────
  const $ = (s, el) => (el || document).querySelector(s);
  const esc = (s) => String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} },
  };
  const ago = (t) => {
    if (!t) return '';
    const m = Math.round((Date.now() - new Date(t).getTime()) / 60000);
    if (isNaN(m)) return '';
    if (m < 1) return 'just now';
    if (m < 60) return m + 'm ago';
    if (m < 60 * 24) return Math.floor(m / 60) + 'h ' + (m % 60) + 'm ago';
    return Math.floor(m / 1440) + 'd ago';
  };
  const clock = (t) => new Date(t).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/Los_Angeles' });
  const dayClock = (t) => new Date(t).toLocaleString('en-US', { weekday: 'short', hour: 'numeric', minute: '2-digit', timeZone: 'America/Los_Angeles' });
  const fmt = (v, d) => (v === null || v === undefined || isNaN(v) ? '—' : Number(v).toFixed(d || 0));

  // Simple stroke icons (decorative)
  const ICON = {
    grid: '<rect x="3" y="3" width="7" height="9" rx="1"/><rect x="14" y="3" width="7" height="5" rx="1"/><rect x="14" y="12" width="7" height="9" rx="1"/><rect x="3" y="16" width="7" height="5" rx="1"/>',
    doc: '<path d="M4 4h12l4 4v12H4z"/><path d="M8 10h8M8 14h8M8 18h5"/>',
    ballot: '<rect x="4" y="9" width="16" height="11" rx="1"/><path d="M8 9V4h8v5"/><path d="M10 6.5l1.5 1.5 3-3"/>',
    signal: '<circle cx="12" cy="12" r="2"/><path d="M8 8a6 6 0 000 8M16 8a6 6 0 010 8M5 5a10 10 0 000 14M19 5a10 10 0 010 14"/>',
    target: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3"/><path d="M12 2v4M12 18v4M2 12h4M18 12h4"/>',
    paper: '<path d="M4 5h13v14H6a2 2 0 01-2-2z"/><path d="M17 9h3v8a2 2 0 01-2 2"/><path d="M8 9h5M8 13h5"/>',
    dollar: '<path d="M12 3v18"/><path d="M16.5 7.5c-.8-1.2-2.4-2-4.5-2-2.5 0-4 1.3-4 3s1.5 2.5 4 3 4 1.4 4 3.2-1.6 3.3-4 3.3c-2.2 0-3.9-.9-4.7-2.3"/>',
    pulse: '<path d="M3 12h4l3-7 4 14 3-7h4"/>',
    rail: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16"/>',
    star: '<path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z"/>',
    menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
    close: '<path d="M6 6l12 12M18 6L6 18"/>',
  };
  const svg = (name, extra) => `<svg class="bi-ico${extra ? ' ' + extra : ''}" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${ICON[name]}</svg>`;

  // ── Navigation model (same tabs and groups as before) ─────────────────────
  const NAV = [
    { key: 'briefing', label: 'Briefing', icon: 'grid' },
    { group: 'newsroom', label: 'Newsroom', icon: 'doc', badge: 'review', items: [
      ['newsroom:overview', 'Command Desk'], ['newsroom:discovery', 'Discovery Inbox'], ['newsroom:queue', 'Story Queue'],
      ['newsroom:research', 'Research Files'], ['newsroom:reviews', 'Review Queue'], ['newsroom:planner', 'Planner & Review'],
      ['newsroom:digest', 'Digest Builder'], ['newsroom:distribution', 'Distribution Studio']] },
    { key: 'elections', label: 'Elections', icon: 'ballot' },
    { group: 'ops', label: 'Live Ops', icon: 'signal', items: [
      ['streams', 'Streams'], ['traffic', 'Flights & Traffic'], ['radar', 'Radar'], ['firecams', 'Fire Cams'], ['storm', 'Storm Index']] },
    { group: 'intel', label: 'Intel', icon: 'target', badge: 'nws', items: [
      ['space', 'Space'], ['military', 'Military'], ['osint', 'OSINT'], ['intel', 'Intel']] },
    { group: 'news', label: 'News & Weather', icon: 'paper', items: [
      ['news', 'Live News'], ['weather', 'Weather'], ['liveries', 'Special Liveries']] },
    { key: 'income', label: 'Income', icon: 'dollar' },
    { key: 'status', label: 'Status', icon: 'pulse', badge: 'failing' },
  ];
  const LABELS = {};
  NAV.forEach((n) => { if (n.key) LABELS[n.key] = n.label; (n.items || []).forEach(([k, l]) => { LABELS[k] = l; }); });
  const GROUP_OF = {};
  NAV.forEach((n) => (n.items || []).forEach(([k]) => { GROUP_OF[k.split(':')[0]] = n.group; }));

  const side = {
    rail: store.get('ocs-side-rail', false),
    open: store.get('ocs-side-open', { newsroom: false, ops: true, intel: false, news: false }),
    pins: store.get('ocs-side-pins', ['radar', 'storm', 'newsroom:reviews']),
    current: 'briefing',
  };

  function go(key) {
    const [tab, view] = key.split(':');
    if (typeof activateTab === 'function') activateTab(tab);
    if (view && typeof window.setNewsroomView === 'function') window.setNewsroomView(view);
    try { history.replaceState(null, '', '#' + tab); } catch (e) {}
    closeDrawer();
    window.scrollTo({ top: 0 });
  }
  window.ocsGo = go;

  function navItemHTML(key, label, sub) {
    const pinned = side.pins.includes(key);
    return `<div class="sn-row${sub ? ' sub' : ''}" data-key="${esc(key)}">
      <button type="button" class="sn-link" data-go="${esc(key)}">${sub ? '' : ''}<span class="sn-lbl">${esc(label)}</span><span class="sn-badge" data-badge-for="${esc(key)}"></span></button>
      <button type="button" class="sn-pin${pinned ? ' on' : ''}" data-pin="${esc(key)}" aria-pressed="${pinned}" aria-label="${pinned ? 'Unpin' : 'Pin'} ${esc(label)}" title="${pinned ? 'Unpin' : 'Pin to the top'}">${svg('star')}</button>
    </div>`;
  }

  function renderSidebar() {
    const el = $('#sidenav');
    if (!el) return;
    document.body.classList.toggle('side-rail', !!side.rail);
    let html = `<div class="sn-head">
        <div class="sn-brand"><span class="sn-name">OC SCANNER</span><span class="sn-sub">INTEL HQ</span></div>
        <button type="button" class="sn-railbtn" data-rail aria-label="${side.rail ? 'Expand sidebar' : 'Collapse sidebar to icons'}" title="${side.rail ? 'Expand' : 'Collapse'}">${svg('rail')}</button>
        <button type="button" class="sn-closebtn" data-close-drawer aria-label="Close menu">${svg('close')}</button>
      </div>`;
    if (side.pins.length) {
      html += `<div class="sn-section"><div class="sn-cap">Pinned</div>${side.pins.filter((k) => LABELS[k]).map((k) => navItemHTML(k, LABELS[k], true)).join('')}</div>`;
    }
    html += '<nav class="sn-nav" aria-label="IntelHQ sections">';
    for (const n of NAV) {
      if (n.key) {
        html += `<div class="sn-top" data-key="${n.key}"><button type="button" class="sn-link top" data-go="${n.key}" title="${esc(n.label)}">${svg(n.icon)}<span class="sn-lbl">${esc(n.label)}</span><span class="sn-badge" data-badge="${n.badge || ''}"></span></button></div>`;
      } else {
        const open = !!side.open[n.group];
        html += `<div class="sn-group${open ? ' open' : ''}" data-group="${n.group}">
          <button type="button" class="sn-link top" data-toggle="${n.group}" aria-expanded="${open}" title="${esc(n.label)}">${svg(n.icon)}<span class="sn-lbl">${esc(n.label)}</span><span class="sn-badge" data-badge="${n.badge || ''}"></span><span class="sn-caret" aria-hidden="true">▾</span></button>
          <div class="sn-items">${n.items.map(([k, l]) => navItemHTML(k, l, true)).join('')}</div>
        </div>`;
      }
    }
    html += '</nav><p class="sn-foot">Tap ☆ to pin a tab to the top.</p>';
    el.innerHTML = html;
    markActive(side.current);
    refreshBadges();
  }

  function markActive(pid) {
    side.current = pid;
    document.querySelectorAll('#sidenav [data-go]').forEach((b) => {
      const k = b.dataset.go;
      const on = k === pid || (k.startsWith(pid + ':') && pid === 'newsroom' && k === 'newsroom:' + (window.__nrView || 'overview'));
      b.classList.toggle('active', on);
      if (on) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
    });
    document.querySelectorAll('#sidenav .sn-group').forEach((g) => g.classList.toggle('hasactive', GROUP_OF[pid] === g.dataset.group));
  }

  document.addEventListener('click', (ev) => {
    const t = ev.target.closest('#sidenav [data-go], #sidenav [data-toggle], #sidenav [data-pin], #sidenav [data-rail], [data-close-drawer], [data-open-drawer], #side-backdrop');
    if (!t) return;
    if (t.dataset.go) {
      const k = t.dataset.go;
      if (k.startsWith('newsroom:')) window.__nrView = k.split(':')[1];
      go(k);
    } else if (t.dataset.toggle) {
      const g = t.dataset.toggle;
      if (side.rail && !isDrawer()) { side.rail = false; store.set('ocs-side-rail', false); side.open[g] = true; }
      else side.open[g] = !side.open[g];
      store.set('ocs-side-open', side.open);
      renderSidebar();
      resized();
    } else if (t.dataset.pin) {
      const k = t.dataset.pin;
      side.pins = side.pins.includes(k) ? side.pins.filter((x) => x !== k) : side.pins.concat(k).slice(-8);
      store.set('ocs-side-pins', side.pins);
      renderSidebar();
    } else if (t.hasAttribute('data-rail')) {
      side.rail = !side.rail;
      store.set('ocs-side-rail', side.rail);
      renderSidebar();
      resized();
    } else if (t.hasAttribute('data-open-drawer')) {
      openDrawer();
    } else {
      closeDrawer();
    }
  });
  // Maps and canvases size themselves to their box; tell them the box changed.
  function resized() { setTimeout(() => window.dispatchEvent(new Event('resize')), 220); }

  const isDrawer = () => window.matchMedia('(max-width: 900px)').matches;
  function openDrawer() {
    document.body.classList.add('side-open');
    $('#side-backdrop').hidden = false;
    const first = $('#sidenav [data-go].active') || $('#sidenav [data-go]');
    if (first) first.focus();
  }
  function closeDrawer() {
    if (!document.body.classList.contains('side-open')) return;
    document.body.classList.remove('side-open');
    $('#side-backdrop').hidden = true;
    const btn = $('#side-menu-btn');
    if (btn && isDrawer()) btn.focus();
  }
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeDrawer(); });

  // ── Badges ────────────────────────────────────────────────────────────────
  function newsroomState() { return store.get('intelHQ-newsroom-v1', null); }
  function failingSources() {
    try { return Object.entries(SRC_HEALTH).filter(([, h]) => h.ok === false).map(([n, h]) => ({ name: n, h })); } catch (e) { return []; } // eslint-disable-line no-undef
  }
  function refreshBadges() {
    const nr = newsroomState();
    const review = nr && Array.isArray(nr.stories) ? nr.stories.filter((s) => s.status === 'review').length : 0;
    const failing = failingSources().length;
    const nws = ocAlerts().length;
    const set = (sel, val, cls) => document.querySelectorAll(sel).forEach((b) => { b.textContent = val ? String(val) : ''; b.className = 'sn-badge' + (val ? ' ' + cls : ''); });
    set('#sidenav [data-badge="review"], #sidenav [data-badge-for="newsroom:reviews"]', review, 'amber');
    set('#sidenav [data-badge="failing"], #sidenav [data-badge-for="status"]', failing, 'red');
    set('#sidenav [data-badge="nws"]', nws, 'red');
    const storm = B.storm ? B.storm.status : null;
    document.querySelectorAll('#sidenav [data-badge-for="storm"]').forEach((b) => {
      b.textContent = storm && storm !== 'ok' ? '●' : '';
      b.className = 'sn-badge dot' + (storm === 'crit' ? ' red' : storm === 'warn' ? ' amber' : '');
    });
  }

  // ── Briefing data ─────────────────────────────────────────────────────────
  const B = { nwsAll: null, local: [], ticker: [], launches: null, stations: null, storm: null, fires: null, aircraft: null, wx: null, loaded: {} };
  const SAME_OC = '006059';
  const CRIT_EVENTS = ['Red Flag Warning', 'High Wind Warning', 'Excessive Heat Warning', 'Flash Flood Warning', 'Extreme Wind Warning', 'Evacuation Immediate', 'Fire Warning', 'Tsunami Warning', 'Earthquake Warning'];
  // Same 17 stations and rules as the Storm Index (conditions/index.html).
  const STATIONS = [['KSNA', 'John Wayne / Santa Ana'], ['KFUL', 'Fullerton'], ['KSLI', 'Los Alamitos'], ['KLGB', 'Long Beach'], ['KTOA', 'Torrance'], ['KEMT', 'El Monte'], ['KPOC', 'La Verne'], ['KCNO', 'Chino'], ['KONT', 'Ontario'], ['KAJO', 'Corona'], ['KRAL', 'Riverside'], ['KRIV', 'March ARB'], ['KHMT', 'Hemet'], ['KF70', 'French Valley'], ['KNFG', 'Camp Pendleton'], ['KOKB', 'Oceanside'], ['KCRQ', 'Carlsbad']];
  const STALE_MIN = 120;

  function ocAlerts() {
    const feats = B.nwsAll || [];
    return feats.filter((f) => ((f.properties && f.properties.geocode && f.properties.geocode.SAME) || []).includes(SAME_OC))
      .filter((f) => !f.properties.expires || new Date(f.properties.expires) > new Date());
  }
  const isCritAlert = (p) => CRIT_EVENTS.includes(p.event) || p.severity === 'Extreme' || p.severity === 'Severe';

  // hq.js hands over what it has already fetched.
  window.ocsFeed = function (kind, data) {
    if (kind === 'nwsAll') B.nwsAll = Array.isArray(data) ? data : [];
    else if (kind === 'local') B.local = data || [];
    else if (kind === 'ticker') B.ticker = data || [];
    else if (kind === 'launches') B.launches = data || [];
    B.loaded[kind] = Date.now();
    refreshBadges();
    if (briefingVisible()) render();
  };

  const kt2mph = (v) => (v === null || v === undefined ? null : v * 1.15078);
  function classify(s) {
    if (!s.ok || s.age === null || s.age > STALE_MIN) return 'off';
    const g = s.gust || 0, w = s.wind || 0, rh = s.rh;
    if (g >= 45 || (rh !== null && rh !== undefined && rh <= 15 && (g >= 25 || w >= 15))) return 'crit';
    if (g >= 30 || w >= 20 || (rh !== null && rh !== undefined && rh <= 20)) return 'warn';
    return 'ok';
  }
  async function getJSON(url, ms) {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), ms || 12000);
    try {
      const r = await fetch(url, { signal: ctl.signal, headers: { Accept: 'application/json' } });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return await r.json();
    } finally { clearTimeout(t); }
  }

  async function loadStations() {
    try {
      const j = await getJSON('https://mesonet.agron.iastate.edu/api/1/currents.json?network=CA_ASOS');
      const m = new Map();
      (j.data || []).forEach((x) => m.set('K' + x.station, x));
      B.stations = STATIONS.map(([id, name]) => {
        const x = m.get(id);
        const age = x && x.utc_valid ? Math.round((Date.now() - new Date(x.utc_valid).getTime()) / 60000) : null;
        const s = { id, name, ok: !!x, age, wind: x ? kt2mph(x.sknt) : null, gust: x ? kt2mph(x.gust) : null, dir: x ? x.drct : null, rh: x ? x.relh : null, temp: x ? x.tmpf : null };
        s.status = classify(s);
        return s;
      });
      B.wx = B.stations.find((s) => s.id === 'KSNA');
      updateStorm();
      if (typeof markHealth === 'function') markHealth('Briefing: weather stations (IEM)', true); // eslint-disable-line no-undef
    } catch (e) {
      if (typeof markHealth === 'function') markHealth('Briefing: weather stations (IEM)', false, e.message); // eslint-disable-line no-undef
    }
  }
  // County status, same rule as the Storm Index.
  function updateStorm() {
    if (!B.stations) return;
    const crit = B.stations.filter((s) => s.status === 'crit');
    const warn = B.stations.filter((s) => s.status === 'warn');
    const alerts = ocAlerts();
    let status = 'ok';
    if (alerts.some((f) => CRIT_EVENTS.includes(f.properties.event)) || crit.length >= 2) status = 'crit';
    else if (alerts.length || crit.length || warn.length >= 2) status = 'warn';
    const live = B.stations.filter((s) => s.status !== 'off');
    const peak = live.reduce((m, s) => (s.gust !== null && (!m || s.gust > m.gust) ? s : m), null);
    B.storm = { status, crit: crit.length, warn: warn.length, live: live.length, peak };
    // Remember status changes for the timeline.
    const hist = store.get('ocs-briefing-storm', []);
    if (!hist.length || hist[0].status !== status) {
      hist.unshift({ status, at: new Date().toISOString() });
      store.set('ocs-briefing-storm', hist.slice(0, 20));
    }
  }

  async function loadFires() {
    const SOCAL = '-119.6,32.5,-116.0,34.9';
    const url = 'https://services3.arcgis.com/T4QMspbfLg3qTGWY/arcgis/rest/services/WFIGS_Incident_Locations_Current/FeatureServer/0/query?where=' +
      encodeURIComponent("IncidentTypeCategory='WF' AND ContainmentDateTime IS NULL") +
      `&geometry=${SOCAL}&geometryType=esriGeometryEnvelope&inSR=4326&spatialRel=esriSpatialRelIntersects&outSR=4326` +
      '&outFields=IncidentName,IncidentSize,PercentContained,POOCounty,FireDiscoveryDateTime&f=json';
    try {
      const j = await getJSON(url);
      const now = Date.now();
      B.fires = (j.features || []).map((f) => f.attributes || {}).map((a) => ({
        name: a.IncidentName || 'Unnamed fire', acres: a.IncidentSize, pct: a.PercentContained, county: a.POOCounty || '',
        found: a.FireDiscoveryDateTime ? new Date(a.FireDiscoveryDateTime).toISOString() : null,
      })).filter((f) => (f.acres || 0) >= 10 || (f.found && now - new Date(f.found).getTime() < 12 * 3600e3))
        .sort((a, b) => (b.found || '').localeCompare(a.found || ''));
      if (typeof markHealth === 'function') markHealth('Briefing: SoCal fires (NIFC)', true); // eslint-disable-line no-undef
    } catch (e) {
      if (typeof markHealth === 'function') markHealth('Briefing: SoCal fires (NIFC)', false, e.message); // eslint-disable-line no-undef
    }
  }

  async function loadAircraft() {
    try {
      const url = (typeof getRadarAPIs === 'function' ? getRadarAPIs()[0] : null); // eslint-disable-line no-undef
      if (!url) return;
      const j = await getJSON(url, 8000);
      const list = typeof parseAircraft === 'function' ? parseAircraft(j) : (j.ac || []); // eslint-disable-line no-undef
      const mil = typeof isMilitary === 'function' ? list.filter((a) => { try { return isMilitary(a); } catch (e) { return false; } }).length : null; // eslint-disable-line no-undef
      B.aircraft = { total: list.length, mil, at: Date.now() };
    } catch (e) { /* the Radar tab reports its own health */ }
  }

  const due = { stations: 0, fires: 0, aircraft: 0 };
  async function refreshData() {
    if (!briefingVisible() || document.hidden) return;
    const now = Date.now();
    const jobs = [];
    if (now >= due.stations) { due.stations = now + 5 * 60e3; jobs.push(loadStations()); }
    if (now >= due.fires) { due.fires = now + 10 * 60e3; jobs.push(loadFires()); }
    if (now >= due.aircraft) { due.aircraft = now + 5 * 60e3; jobs.push(loadAircraft()); }
    if (jobs.length) { await Promise.allSettled(jobs); refreshBadges(); }
    render();
  }
  setInterval(refreshData, 30000);

  // "Since you last checked": the last time you actually looked at the Briefing for 20+ seconds
  // (or pressed "Mark all seen"). A quick reload doesn't count, so it won't hide what's new.
  let lastCheck = store.get('ocs-briefing-lastcheck', null) || new Date(Date.now() - 6 * 3600e3).toISOString();
  let lastCheckKnown = !!store.get('ocs-briefing-lastcheck', null);
  let viewedMs = 0, viewStart = null;
  function trackView() {
    const on = briefingVisible() && !document.hidden;
    if (on && viewStart === null) viewStart = Date.now();
    if (!on && viewStart !== null) { viewedMs += Date.now() - viewStart; viewStart = null; }
  }
  function rememberCheck() {
    trackView();
    const total = viewedMs + (viewStart !== null ? Date.now() - viewStart : 0);
    if (total >= 20000) store.set('ocs-briefing-lastcheck', new Date().toISOString());
  }
  document.addEventListener('visibilitychange', () => { trackView(); if (!document.hidden) refreshData(); else rememberCheck(); });
  window.addEventListener('pagehide', rememberCheck);

  const dismissed = store.get('ocs-briefing-dismissed', {});
  function isDismissed(key) { const t = dismissed[key]; return t && Date.now() - t < 6 * 3600e3; }

  // ── What needs you ────────────────────────────────────────────────────────
  function buildActions() {
    const out = [];
    for (const f of ocAlerts()) {
      const p = f.properties;
      const crit = isCritAlert(p);
      out.push({
        key: 'nws:' + (p.id || f.id),
        tone: crit ? 'red' : 'amber',
        title: p.event,
        detail: `${(p.areaDesc || '').split(';').slice(0, 3).join(', ')}${p.expires ? ' · until ' + dayClock(p.expires) : ''} · ${p.senderName || 'NWS'}`,
        copy: `${p.event} for ${(p.areaDesc || 'Orange County area').split(';').map((s) => s.trim()).join(', ')}${p.expires ? ', until ' + dayClock(p.expires) : ''}. ${p.headline ? p.headline + '. ' : ''}Source: ${p.senderName || 'National Weather Service'}.`,
        buttons: [['copy', 'Copy alert text', true], ['go:newsroom:discovery', 'Draft in Newsroom'], ['go:storm', 'Storm Index']],
      });
    }
    // Only when the stations themselves are elevated; an alert alone is already listed above.
    if (B.storm && B.storm.status !== 'ok' && (B.storm.crit || B.storm.warn)) {
      const s = B.storm;
      out.push({
        key: 'storm:' + s.status + ':' + new Date().toDateString(),
        tone: s.status === 'crit' ? 'red' : 'amber',
        title: `Storm Index: ${s.status === 'crit' ? 'Critical' : 'Elevated'}`,
        detail: `${s.crit} critical, ${s.warn} elevated of ${STATIONS.length} stations${s.peak ? ` · peak gust ${fmt(s.peak.gust)} mph at ${s.peak.name}` : ''}`,
        buttons: [['go:storm', 'Storm Index', true], ['go:firecams', 'Fire Cams']],
      });
    }
    // New fires worth acting on: anything in Orange County, or 50+ acres elsewhere in SoCal, found in the last 12 h.
    // Smaller ones still count under Conditions.
    const notable = (x) => /orange/i.test(x.county || '') || (x.acres || 0) >= 50;
    for (const f of (B.fires || []).filter((x) => x.found && Date.now() - new Date(x.found).getTime() < 12 * 3600e3 && notable(x))) {
      out.push({
        key: 'fire:' + f.name + ':' + f.found,
        tone: 'red',
        title: `New fire: ${f.name}`,
        detail: `${f.acres ? fmt(f.acres) + ' acres' : 'size not reported'} · ${f.pct !== null && f.pct !== undefined ? fmt(f.pct) + '% contained' : 'containment not reported'}${f.county ? ' · ' + f.county + ' County' : ''} · reported ${ago(f.found)}`,
        copy: `${f.name} fire${f.county ? ', ' + f.county + ' County' : ''}: ${f.acres ? fmt(f.acres) + ' acres' : 'size not yet reported'}, ${f.pct !== null && f.pct !== undefined ? fmt(f.pct) + '% contained' : 'containment not yet reported'}. Source: NIFC incident data.`,
        buttons: [['go:firecams', 'Fire Cams', true], ['copy', 'Copy details'], ['go:newsroom:discovery', 'Draft in Newsroom']],
      });
    }
    const nr = newsroomState();
    if (nr && Array.isArray(nr.stories)) {
      const review = nr.stories.filter((s) => s.status === 'review');
      const ready = nr.stories.filter((s) => s.status === 'ready');
      if (review.length) out.push({ key: 'review:' + review.length, tone: 'amber', title: `${review.length} ${review.length === 1 ? 'story' : 'stories'} waiting for review`, detail: review.slice(0, 2).map((s) => '“' + s.title + '”').join(', '), buttons: [['go:newsroom:reviews', 'Review', true]] });
      if (ready.length) out.push({ key: 'ready:' + ready.length, tone: 'amber', title: `${ready.length} ${ready.length === 1 ? 'story is' : 'stories are'} ready to publish`, detail: ready.slice(0, 2).map((s) => '“' + s.title + '”').join(', '), buttons: [['go:newsroom:distribution', 'Distribution Studio', true]] });
    }
    const failing = failingSources();
    if (failing.length) out.push({ key: 'failing:' + failing.map((f) => f.name).join('|'), tone: 'blue', title: `${failing.length} data ${failing.length === 1 ? 'source is' : 'sources are'} failing`, detail: failing.slice(0, 4).map((f) => f.name).join(', '), buttons: [['go:status', 'Status', true]] });
    const rank = { red: 0, amber: 1, blue: 2 };
    return out.filter((a) => !isDismissed(a.key)).sort((a, b) => rank[a.tone] - rank[b.tone]);
  }

  // ── Timeline ──────────────────────────────────────────────────────────────
  function buildTimeline() {
    const ev = [];
    for (const f of ocAlerts()) ev.push({ at: f.properties.sent || f.properties.effective, kind: 'ALERT', tone: isCritAlert(f.properties) ? 'red' : 'amber', text: `${f.properties.event} issued by ${f.properties.senderName || 'NWS'}` });
    for (const f of B.fires || []) if (f.found) ev.push({ at: f.found, kind: 'FIRE', tone: /orange/i.test(f.county || '') || (f.acres || 0) >= 50 ? 'red' : 'amber', text: `${f.name}${f.county ? ' (' + f.county + ')' : ''} reported${f.acres ? ', ' + fmt(f.acres) + ' acres' : ''}` });
    for (const h of store.get('ocs-briefing-storm', []).slice(0, 5)) ev.push({ at: h.at, kind: 'STORM INDEX', tone: h.status === 'crit' ? 'red' : h.status === 'warn' ? 'amber' : 'green', text: `County status ${h.status === 'crit' ? 'Critical' : h.status === 'warn' ? 'Elevated' : 'back to Normal'}` });
    for (const it of headlines().slice(0, 8)) if (it.pub) ev.push({ at: it.pub, kind: 'HEADLINE', tone: 'blue', text: `${it.title} (${it.src})`, link: it.link });
    const nr = newsroomState();
    if (nr && Array.isArray(nr.stories)) for (const s of nr.stories) {
      const at = s.updatedAt || s.createdAt;
      if (at) ev.push({ at, kind: 'NEWSROOM', tone: 'amber', text: `“${s.title}” · ${s.status}` });
    }
    for (const f of failingSources()) ev.push({ at: new Date(f.h.lastAttempt).toISOString(), kind: 'SYSTEM', tone: 'red', text: `${f.name} failing${f.h.lastError ? ': ' + f.h.lastError : ''}` });
    try {
      const inc = store.get('ocs-income-v1', null);
      if (inc && Array.isArray(inc.entries)) for (const e of inc.entries) if (e.createdAt && e.kind === 'revenue') ev.push({ at: e.createdAt, kind: 'INCOME', tone: 'green', text: `Income added: ${window.IncomeCore ? window.IncomeCore.formatMoney(e.net) : ''} ${window.IncomeCore ? window.IncomeCore.sourceLabel(e.source) : e.source}` });
    } catch (e) {}
    const valid = ev.filter((e) => e.at && !isNaN(new Date(e.at)));
    valid.sort((a, b) => new Date(b.at) - new Date(a.at));
    const fresh = valid.filter((e) => new Date(e.at) > new Date(lastCheck));
    return { fresh: fresh.slice(0, 14), recent: valid.slice(0, 6) };
  }

  function headlines() {
    const seen = new Set();
    return [...(B.local || []), ...(B.ticker || [])].filter((it) => {
      const k = (it.title || '').slice(0, 50).toLowerCase();
      if (!it.title || seen.has(k)) return false;
      seen.add(k); return true;
    }).map((it) => Object.assign({}, it, { pub: it.pub ? new Date(it.pub).toISOString() : null }))
      .sort((a, b) => (b.pub || '').localeCompare(a.pub || ''));
  }

  function income() {
    const C = window.IncomeCore;
    const d = store.get('ocs-income-v1', null);
    if (!C || !d || !Array.isArray(d.entries) || !d.entries.length) return null;
    const entries = d.entries.map(C.normalizeEntry);
    const r = C.rangeFor('this-month', C.todayPacific());
    const now = C.summarize(entries, r).revenue.net;
    const before = C.summarize(entries, C.previousRange(r)).revenue.net;
    return { now, before, pct: C.pctChange(now, before), money: C.formatMoney };
  }

  // ── Render ────────────────────────────────────────────────────────────────
  function briefingVisible() { const p = $('#panel-briefing'); return !!(p && p.classList.contains('active')); }
  const TONE = { red: 'var(--danger)', amber: 'var(--warn)', blue: 'var(--accent)', green: 'var(--accent3)' };
  let lastActions = [];

  function render() {
    const el = $('#panel-briefing');
    if (!el || !briefingVisible()) return;
    const actions = buildActions();
    lastActions = actions;
    const tl = buildTimeline();
    const urgent = actions.filter((a) => a.tone === 'red').length;
    const routine = actions.length - urgent;
    const pill = urgent ? ['NEEDS ATTENTION', 'red'] : actions.some((a) => a.tone === 'amber') ? ['CHECK IN', 'amber'] : ['ALL CLEAR', 'green'];
    const s = B.storm, wx = B.wx;
    const alerts = ocAlerts();
    const fires = B.fires;
    const inc = income();
    const news = headlines().slice(0, 5);
    const nextLaunch = (B.launches || []).find((l) => new Date(l.net).getTime() > Date.now() - 30 * 60e3);
    const storeAt = (x) => (x ? ago(x) : 'loading');

    el.innerHTML = `
    <div class="bf">
      <div class="bf-head">
        <div class="bf-title"><h2>Briefing</h2><span class="bf-pill ${pill[1]}">${pill[0]}</span>
          <span class="bf-sum">${urgent ? urgent + ' urgent · ' : ''}${routine ? routine + ' routine' : urgent ? '' : 'Nothing needs you right now'}</span></div>
        <span class="bf-meta">${esc(new Date().toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'America/Los_Angeles' }))} · updated ${esc(clock(Date.now()))}</span>
      </div>
      <div class="bf-quick">
        <button type="button" class="bf-btn primary" data-act="newstory">+ New story</button>
        <button type="button" class="bf-btn" data-act="go:newsroom:distribution">Draft X post</button>
        <button type="button" class="bf-btn" data-act="go:newsroom:discovery">Discovery inbox</button>
        <button type="button" class="bf-btn" data-act="go:streams">Streams</button>
        <button type="button" class="bf-btn" data-act="go:radar">Radar</button>
      </div>
      <div class="bf-grid">
        <div class="bf-col main">
          <section class="bf-card">
            <div class="bf-ch"><h3>Act on this</h3><span class="bf-hint">most urgent first · clears itself when done</span></div>
            ${actions.length ? actions.map((a, i) => `
              <div class="bf-act ${a.tone}">
                <span class="bf-dot" style="background:${TONE[a.tone]}"></span>
                <div class="bf-act-txt"><strong>${esc(a.title)}</strong><span>${esc(a.detail)}</span></div>
                <div class="bf-act-btns">${a.buttons.map(([act, label, primary]) => `<button type="button" class="bf-btn${primary ? ' primary' : ''}" data-act="${esc(act)}" data-i="${i}">${esc(label)}</button>`).join('')}
                  <button type="button" class="bf-x" data-dismiss="${i}" aria-label="Hide “${esc(a.title)}” for 6 hours" title="Hide for 6 hours">×</button></div>
              </div>`).join('') : '<p class="bf-empty">Nothing needs you right now. Alerts, new fires, stories waiting for review and failing sources show up here.</p>'}
          </section>
          <section class="bf-card">
            <div class="bf-ch"><h3>Since you last checked</h3><span class="bf-hint">${lastCheckKnown ? esc(dayClock(lastCheck)) + ' · ' + esc(ago(lastCheck)) : 'last 6 hours'}</span>
              <button type="button" class="bf-link" data-act="seen">Mark all seen</button></div>
            ${(tl.fresh.length ? tl.fresh : []).map((e) => `
              <div class="bf-tl"><span class="bf-tl-t">${esc(clock(e.at))}</span><span class="bf-tl-k" style="color:${TONE[e.tone]}">${esc(e.kind)}</span>
              <span class="bf-tl-x">${e.link ? `<a href="${esc(e.link)}" target="_blank" rel="noopener noreferrer">${esc(e.text)}</a>` : esc(e.text)}</span></div>`).join('') ||
              `<p class="bf-empty">Nothing new since then.${tl.recent.length ? ' Most recent:' : ''}</p>${tl.recent.slice(0, 3).map((e) => `<div class="bf-tl dim"><span class="bf-tl-t">${esc(clock(e.at))}</span><span class="bf-tl-k">${esc(e.kind)}</span><span class="bf-tl-x">${esc(e.text)}</span></div>`).join('')}`}
          </section>
        </div>
        <div class="bf-col side">
          <section class="bf-card">
            <div class="bf-ch"><h3>Conditions · OC</h3><button type="button" class="bf-link" data-act="go:storm">Storm Index →</button></div>
            <div class="bf-tiles">
              <button type="button" class="bf-tile" data-act="go:weather"><span class="k">NWS</span><span class="v" style="color:${alerts.length ? TONE[alerts.some((f) => isCritAlert(f.properties)) ? 'red' : 'amber'] : TONE.green}">${B.nwsAll === null ? '…' : alerts.length ? esc(alerts[0].properties.event) + (alerts.length > 1 ? ' +' + (alerts.length - 1) : '') : 'None active'}</span></button>
              <button type="button" class="bf-tile" data-act="go:storm"><span class="k">Storm Index</span><span class="v" style="color:${s ? TONE[s.status === 'crit' ? 'red' : s.status === 'warn' ? 'amber' : 'green'] : 'inherit'}">${s ? (s.status === 'crit' ? 'Critical' : s.status === 'warn' ? 'Elevated' : 'Normal') : '…'}</span></button>
              <button type="button" class="bf-tile" data-act="go:firecams"><span class="k">Fires · SoCal</span><span class="v" style="color:${fires && fires.length ? TONE.amber : TONE.green}">${fires === null ? '…' : fires.length ? fires.length + ' active' : 'None'}</span></button>
              <button type="button" class="bf-tile" data-act="go:weather"><span class="k">KSNA</span><span class="v">${wx && wx.ok ? `${fmt(wx.temp)}°F · ${fmt(wx.wind)}${wx.gust ? 'g' + fmt(wx.gust) : ''} mph · ${fmt(wx.rh)}%` : '…'}</span></button>
            </div>
            ${fires && fires.length ? `<p class="bf-small">${fires.slice(0, 3).map((f) => esc(f.name) + (f.acres ? ' ' + fmt(f.acres) + ' ac' : '') + (f.pct !== null && f.pct !== undefined ? ' · ' + fmt(f.pct) + '%' : '')).join(' · ')}</p>` : ''}
          </section>
          <section class="bf-card">
            <div class="bf-ch"><h3>Headlines</h3><button type="button" class="bf-link" data-act="go:news">Live News →</button></div>
            ${news.length ? news.map((n) => `<a class="bf-news" href="${esc(n.link)}" target="_blank" rel="noopener noreferrer"><span>${esc(n.title)}</span><small>${esc(n.src)}${n.pub ? ' · ' + esc(ago(n.pub)) : ''}</small></a>`).join('') : '<p class="bf-empty">Loading headlines…</p>'}
          </section>
          <section class="bf-card bf-row3">
            <button type="button" class="bf-tile" data-act="go:radar"><span class="k">Aircraft · OC</span><span class="v big">${B.aircraft ? B.aircraft.total : '…'}</span></button>
            <button type="button" class="bf-tile" data-act="go:military"><span class="k">Military</span><span class="v big">${B.aircraft && B.aircraft.mil !== null ? B.aircraft.mil : '…'}</span></button>
            <button type="button" class="bf-tile" data-act="go:space"><span class="k">Next launch</span><span class="v">${nextLaunch ? esc(countdown(nextLaunch.net)) : 'Open Space'}</span></button>
          </section>
          <section class="bf-card bf-inc">
            <div><span class="k">Income · this month</span><span class="v big">${inc ? esc(inc.money(inc.now)) : '—'}</span>
              <small>${inc ? (inc.pct === null ? 'nothing in the same days last month' : `<span style="color:${inc.pct >= 0 ? TONE.green : TONE.red}">${inc.pct >= 0 ? '▲' : '▼'} ${Math.abs(inc.pct * 100).toFixed(0)}%</span> vs the same days last month`) : 'No income entered on this device yet'}</small></div>
            <button type="button" class="bf-link" data-act="go:income">Income →</button>
          </section>
        </div>
      </div>
      <p class="bf-foot">Conditions ${esc(storeAt(B.loaded.nwsAll))} · stations ${B.stations ? 'live' : 'loading'} · fires ${B.fires ? 'live' : 'loading'}. Nothing here posts anything; Copy and Draft only prepare text for you to check.</p>
    </div>`;
  }
  function countdown(net) {
    const ms = new Date(net).getTime() - Date.now();
    if (ms <= 0) return 'Now';
    const h = Math.floor(ms / 3600e3), d = Math.floor(h / 24);
    return d ? `T−${d}d ${h % 24}h` : `T−${h}h ${Math.floor((ms % 3600e3) / 60e3)}m`;
  }

  document.addEventListener('click', async (ev) => {
    const d = ev.target.closest('#panel-briefing [data-dismiss]');
    if (d) {
      const a = lastActions[+d.dataset.dismiss];
      if (a) { dismissed[a.key] = Date.now(); store.set('ocs-briefing-dismissed', dismissed); render(); }
      return;
    }
    const b = ev.target.closest('#panel-briefing [data-act]');
    if (!b) return;
    const act = b.dataset.act;
    if (act.startsWith('go:')) { const k = act.slice(3); if (k.startsWith('newsroom:')) window.__nrView = k.split(':')[1]; go(k); return; }
    if (act === 'newstory') { go('newsroom:overview'); if (typeof window.focusNewsroomCapture === 'function') window.focusNewsroomCapture(); return; }
    if (act === 'seen') { lastCheck = new Date().toISOString(); lastCheckKnown = true; store.set('ocs-briefing-lastcheck', lastCheck); render(); return; }
    if (act === 'copy') {
      const a = lastActions[+b.dataset.i];
      if (!a || !a.copy) return;
      try { await navigator.clipboard.writeText(a.copy); b.textContent = 'Copied ✓'; }
      catch (e) { b.textContent = 'Copy failed'; }
      setTimeout(() => render(), 1800);
    }
  });

  // hq.js calls this from activateTab().
  window.onTabActivated = function (pid) {
    markActive(pid);
    trackView();
    if (pid !== 'briefing') rememberCheck();
    if (pid === 'briefing') refreshData();
  };

  // ── Start ─────────────────────────────────────────────────────────────────
  function init() {
    if (!$('#sidenav')) {
      const aside = document.createElement('aside');
      aside.id = 'sidenav';
      aside.setAttribute('aria-label', 'IntelHQ navigation');
      document.body.prepend(aside);
      const bd = document.createElement('div');
      bd.id = 'side-backdrop'; bd.hidden = true;
      document.body.prepend(bd);
    }
    const hdr = $('#hdr .logo-area');
    if (hdr && !$('#side-menu-btn')) {
      const btn = document.createElement('button');
      btn.type = 'button'; btn.id = 'side-menu-btn'; btn.setAttribute('data-open-drawer', '');
      btn.setAttribute('aria-label', 'Open menu');
      btn.innerHTML = svg('menu') + '<span>Menu</span>';
      hdr.prepend(btn);
    }
    document.body.classList.add('has-side');
    renderSidebar();
    const active = document.querySelector('.panel.active');
    markActive(active ? active.id.replace('panel-', '') : 'briefing');
    setInterval(refreshBadges, 30000);
    trackView();
    refreshData();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
