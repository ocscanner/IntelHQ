/**
 * OC Scanner Election Wire — results Worker
 *
 * Every 5 minutes (cron) the Worker downloads whatever state files are due (each state about every
 * 10 minutes) plus AP if licensed, and saves results per race. Viewers only ever read what's saved.
 *
 *  GET  /v1/board            all races + seat summaries (cached 60s per Cloudflare location)
 *  GET  /v1/board?sim=1      same, with rehearsal (fake) results — always labeled SIM
 *  GET  /v1/feed             latest calls and retractions, newest first
 *  GET  /v1/counties?race=GA-SEN   county-by-county results for a Senate or governor race
 *  GET  /v1/local?area=OC    Orange County local contests (cities, schools, districts, measures)
 *  GET  /v1/local?area=CAP   California's statewide propositions (statewide Yes/No plus Orange County's count)
 *  GET  /v1/health           switches, feed status, when state feeds start
 *  GET  /v1/desk/check       200 if the desk token is valid
 *  GET  /v1/desk/preview?state=GA   download and parse one state now, without saving (desk token)
 *  POST /v1/desk/call        {raceId, party, candidate?, source, note?}       (desk token)
 *                            local races: {raceId: "OC-5031", winners: ["Name", ...], source}
 *                            propositions: {raceId: "CA-P1", winners: ["Yes"] or ["No"], source}
 *  POST /v1/desk/retract     {raceId}                                         (desk token)
 *  POST /v1/desk/clear       {raceId}  remove a desk call/retraction so the feed shows again
 *  POST /v1/desk/result      {raceId, pctIn, candidates:[{name,party,votes}]} (desk token)
 */
import universe from '../../data/races-2026.json';
import { buildBoard } from './board.js';
import { fetchAP } from './sources/ap.js';
import { simulate } from './sources/simulate.js';
import { normParty } from './parties.js';
import { runIngest, d1Store, allUnits } from './ingest.js';
import { ADAPTERS } from './feeds/states.js';
import { OC_LOCAL } from './feeds/oc-local.js';
import { CA_PROPS } from './feeds/ca-props.js';
import { buildLocal } from './local.js';
import { simulateCounties, simulateLocal, simulateProps } from './sources/simulate-extra.js';

const IDS = new Set(universe.races.map(r => r.id));
const LOCAL_IDS = new Set(OC_LOCAL.contests.map(c => `OC-${c.id}`));
const PROP_IDS = new Set(CA_PROPS.contests.map(c => `CA-P${c.id}`));
const isLocalId = id => LOCAL_IDS.has(id) || /^OC-\d{4}$/.test(id) || PROP_IDS.has(id);   // OC measures appear only on election night
// Areas on the board's local-style tabs: board id prefix, contest list, rehearsal data
const AREAS = {
  OC: { prefix: 'OC-', list: OC_LOCAL, sim: (now, cyc) => simulateLocal(OC_LOCAL, now, cyc) },
  CAP: { prefix: 'CA-P', list: CA_PROPS, sim: (now, cyc) => simulateProps(CA_PROPS, now, cyc) },
};
// States whose free files include county-by-county counts (see feeds/states.js)
const COUNTY_STATES = new Set(['AZ', 'CA', 'CO', 'FL', 'GA', 'IA', 'ID', 'MN', 'NC', 'PA', 'UT', 'VA']);
const countiesOn = env => /^(on|true|1|yes)$/i.test(String(env.COUNTY_FEEDS || ''));
const CACHE_SECONDS = 60;
const startOf = env => Date.parse(env.RESULTS_START || '2026-11-03T22:00:00Z');

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const cors = corsHeaders(request, env);
    if (request.method === 'OPTIONS') return new Response(null, { headers: cors });
    try {
      const p = url.pathname.replace(/\/$/, '');
      if (request.method === 'GET' && p === '/v1/board') return await board(request, env, ctx, url, cors);
      if (request.method === 'GET' && p === '/v1/feed') return json(await feed(env, url), cors, 30);
      if (request.method === 'GET' && p === '/v1/counties') return await cached(`counties?race=${url.searchParams.get('race')}&sim=${isSim(env, url) ? 1 : 0}`, () => counties(env, url), cors, ctx, url);
      if (request.method === 'GET' && p === '/v1/local') { const area = areaKey(url); return await cached(`local?area=${area}&sim=${isSim(env, url) ? 1 : 0}`, () => local(env, url, area), cors, ctx, url); }
      if (request.method === 'GET' && p === '/v1/health') return json(await health(env), cors, 0);
      if (p.startsWith('/v1/desk/')) {
        if (!authorized(request, env)) return json({ error: 'Desk token missing or wrong' }, cors, 0, 401);
        if (request.method === 'GET' && p === '/v1/desk/check') return json({ ok: true }, cors, 0);
        if (request.method === 'GET' && p === '/v1/desk/preview') return json(await preview(env, url), cors, 0);
        if (request.method === 'POST') {
          const body = await request.json().catch(() => ({}));
          const res = await desk(env, p.slice(9), body);
          await purge();
          return json(res, cors, 0, res.error ? 400 : 200);
        }
      }
      return json({ error: 'Not found', routes: ['/v1/board', '/v1/feed', '/v1/counties', '/v1/local?area=OC', '/v1/local?area=CAP', '/v1/health'] }, cors, 0, 404);
    } catch (e) {
      return json({ error: e.message }, cors, 0, 500);
    }
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(scheduledRun(env));
  },
};

/* ── Scheduled download ── */
export async function scheduledRun(env, { now = Date.now(), fetchImpl = fetch } = {}) {
  if (!env.DB) return { skipped: 'no database' };
  if (now < startOf(env) && env.INGEST_EARLY !== 'true') return { skipped: 'before results start' };
  const store = d1Store(env.DB);
  let apUsed = 0;
  if (env.AP_API_KEY) {
    apUsed = 1;
    const row = { unit: 'AP', state: 'US', fetched_at: now, ok: 1, status: 'ok', error: null, races: 0, meta: {} };
    try {
      const ap = await fetchAP(env, IDS);
      row.races = ap.races.size;
      const deskState = await loadDesk(env, false);
      await recordFeedCalls(env, [ap], deskState, now, false);
      await store.saveResults('AP', [...ap.races].map(([raceId, d]) => ({
        raceId, payload: { ...d, callSeen: deskState.seen.get(raceId)?.first_seen || null, updated: d.updated || new Date(now).toISOString() },
      })));
    } catch (e) { row.ok = 0; row.status = 'error'; row.error = e.message.slice(0, 200); }
    await store.saveUnits([row]);
  }
  const budget = Math.max(1, +(env.SUBREQUEST_BUDGET || 45) - apUsed);
  const out = await runIngest({ env: { ...env, SUBREQUEST_BUDGET: budget }, universe, store, fetchImpl, now });
  await purge();
  return { used: out.used + apUsed, units: out.units.length, races: out.results.length };
}

/* ── Board ── */
async function board(request, env, ctx, url, cors) {
  const sim = url.searchParams.get('sim') === '1' || env.SIMULATE === 'true';
  const cacheKey = new Request(`https://cache.local/board?sim=${sim ? 1 : 0}`);
  const cache = caches.default;
  const hit = await cache.match(cacheKey);
  if (hit && url.searchParams.get('fresh') !== '1') {
    const r = new Response(hit.body, hit);
    for (const [k, v] of Object.entries(cors)) r.headers.set(k, v);
    r.headers.set('X-Cache', 'HIT');
    return r;
  }

  const now = Date.now();
  const feeds = [];
  let sources;
  const deskState = await loadDesk(env, sim);
  if (sim) {
    const f = simulate(universe.races, now, +(env.SIM_CYCLE_MINUTES || 90));
    await recordFeedCalls(env, [f], deskState, now, true);
    for (const [id, d] of f.races) { const seen = deskState.seen.get(id); if (seen) d.callSeen = seen.first_seen; }
    feeds.push(f);
    sources = [{ name: 'Simulation', ok: true, note: 'Rehearsal data — not real results' }];
  } else {
    const held = now < startOf(env);
    const ap = new Map(), states = new Map();
    if (env.DB && !held) {
      for (const r of await d1Store(env.DB).loadResults()) (r.source === 'AP' ? ap : states).set(r.raceId, r.payload);
    }
    feeds.push({ name: 'AP', races: ap }, { name: 'States', races: states });
    sources = await feedStatus(env, now);
  }

  const out = buildBoard(universe, feeds, deskState, now);
  out.sources = sources;
  out.simulation = sim;
  out.resultsStart = new Date(startOf(env)).toISOString();
  out.desk = { calls: deskState.calls.size };

  const resp = json(out, cors, CACHE_SECONDS);
  resp.headers.set('X-Cache', 'MISS');
  ctx.waitUntil(cache.put(cacheKey, json(out, {}, CACHE_SECONDS)));
  return resp;
}

/** One status entry for AP and one per state (California's 53 units rolled up). */
async function feedStatus(env, now) {
  const rows = env.DB ? [...(await d1Store(env.DB).loadUnits()).values()] : [];
  const held = now < startOf(env);
  const ap = rows.find(r => r.unit === 'AP');
  const out = [{ name: 'AP', kind: 'ap', enabled: !!env.AP_API_KEY, ok: ap ? !!ap.ok : null, fetchedAt: ap?.fetched_at || null, error: ap?.error || null }];
  const byState = new Map();
  for (const u of allUnits(env)) {
    const s = byState.get(u.st) || { name: u.st, kind: 'state', label: u.label, confidence: u.confidence, units: 0, done: 0, errors: 0, notPosted: 0, races: 0, fetchedAt: null, error: null };
    s.units++;
    const r = rows.find(x => x.unit === u.id);
    if (r) {
      s.done++;
      s.races += r.races || 0;
      if (!r.ok) { s.errors++; s.error ||= r.error; }
      if (r.status === 'not posted') s.notPosted++;
      s.fetchedAt = s.fetchedAt == null ? r.fetched_at : Math.min(s.fetchedAt, r.fetched_at);
    }
    byState.set(u.st, s);
  }
  for (const s of byState.values()) {
    s.status = held ? 'waiting' : !s.done ? 'pending' : s.errors && s.races ? 'partial' : s.errors ? 'error' : s.notPosted === s.done ? 'not posted' : 'ok';
    s.ok = s.status === 'ok' || s.status === 'partial' ? true : s.status === 'error' ? false : null;
    out.push(s);
  }
  return out;
}

async function loadDesk(env, sim) {
  const calls = new Map(), results = new Map(), seen = new Map();
  if (!env.DB) return { calls, results, seen };
  const ns = sim ? 'sim' : 'live';
  const [c, r, s] = await env.DB.batch([
    env.DB.prepare('SELECT * FROM desk_call WHERE ns = ?').bind(ns),
    env.DB.prepare('SELECT * FROM desk_result WHERE ns = ?').bind(ns),
    env.DB.prepare('SELECT * FROM feed_seen WHERE ns = ?').bind(ns),
  ]);
  for (const row of c.results) calls.set(row.race_id, row);
  for (const row of r.results) { try { results.set(row.race_id, JSON.parse(row.payload)); } catch {} }
  for (const row of s.results) seen.set(row.race_id, row);
  return { calls, results, seen };
}

// Feed calls only come from AP (or the rehearsal feed). State files are numbers only.
async function recordFeedCalls(env, feeds, deskState, now, sim) {
  if (!env.DB) return;
  const ns = sim ? 'sim' : 'live';
  const stmts = [];
  const done = new Set();
  for (const f of feeds) for (const [id, d] of f.races) {
    if (done.has(id)) continue; done.add(id);
    const w = d.candidates.find(c => c.winner);
    const prev = deskState.seen.get(id);
    if (w && (!prev || prev.candidate !== w.name)) {
      stmts.push(env.DB.prepare('INSERT OR REPLACE INTO feed_seen (ns, race_id, party, candidate, source, first_seen) VALUES (?,?,?,?,?,?)').bind(ns, id, normParty(w.party), w.name, d.source, now));
      stmts.push(env.DB.prepare('INSERT INTO call_log (ns, race_id, party, candidate, source, kind, at) VALUES (?,?,?,?,?,?,?)').bind(ns, id, normParty(w.party), w.name, d.source, 'call', now));
      deskState.seen.set(id, { first_seen: now, candidate: w.name });
    } else if (!w && prev) {
      stmts.push(env.DB.prepare('DELETE FROM feed_seen WHERE ns = ? AND race_id = ?').bind(ns, id));
      // Rehearsal cycles restart; drop the stale call from the sim log instead of logging a retraction
      if (sim) stmts.push(env.DB.prepare("DELETE FROM call_log WHERE ns = 'sim' AND race_id = ?").bind(id));
      else stmts.push(env.DB.prepare('INSERT INTO call_log (ns, race_id, party, candidate, source, kind, at) VALUES (?,?,?,?,?,?,?)').bind(ns, id, prev.party, prev.candidate, d.source, 'retract', now));
      deskState.seen.delete(id);
    }
  }
  for (let i = 0; i < stmts.length; i += 90) await env.DB.batch(stmts.slice(i, i + 90));
}

/* ── County results (statewide races) ── */
const isSim = (env, url) => url.searchParams.get('sim') === '1' || env.SIMULATE === 'true';
async function cached(key, build, cors, ctx, url) {
  const cacheKey = new Request(`https://cache.local/${key}`);
  const cache = caches.default;
  const hit = url.searchParams.get('fresh') !== '1' && await cache.match(cacheKey);
  if (hit) { const r = new Response(hit.body, hit); for (const [k, v] of Object.entries(cors)) r.headers.set(k, v); r.headers.set('X-Cache', 'HIT'); return r; }
  const out = await build();
  ctx.waitUntil(cache.put(cacheKey, json(out, {}, CACHE_SECONDS)));
  const resp = json(out, cors, CACHE_SECONDS);
  resp.headers.set('X-Cache', 'MISS');
  return resp;
}
async function counties(env, url) {
  const id = String(url.searchParams.get('race') || '').toUpperCase();
  const race = universe.races.find(r => r.id === id);
  if (!race || race.chamber === 'house') return { raceId: id, available: false, reason: 'County results are shown for Senate and governor races.' };
  const base = { raceId: id, state: race.state };
  if (isSim(env, url)) {
    const f = simulate(universe.races.filter(r => r.id === id), Date.now(), +(env.SIM_CYCLE_MINUTES || 90));
    const d = f.races.get(id);
    return { ...base, available: true, simulation: true, ...simulateCounties({ ...race, candidates: d?.candidates || [], pctIn: d?.pctIn }, Date.now()) };
  }
  const supported = COUNTY_STATES.has(race.state) || !!env.AP_API_KEY;
  if (!supported) return { ...base, available: false, reason: `${race.stateName} doesn’t publish county-by-county results in a free file.` };
  if (!countiesOn(env)) return { ...base, available: false, off: true, reason: 'County downloads are switched off (COUNTY_FEEDS).' };
  if (Date.now() < startOf(env) || !env.DB) return { ...base, available: true, cands: [], counties: {} };
  const row = await d1Store(env.DB).loadCounties(id);
  return { ...base, available: true, ...(row || { cands: [], counties: {} }) };
}

/* ── Local-style tabs: Orange County contests and California propositions ── */
const areaKey = url => { const a = String(url.searchParams.get('area') || 'OC').toUpperCase(); return AREAS[a] ? a : 'OC'; };
async function local(env, url, area = 'OC') {
  const A = AREAS[area];
  const sim = isSim(env, url);
  const ns = sim ? 'sim' : 'live';
  const calls = new Map();
  let res = null;
  if (sim) res = A.sim(Date.now(), +(env.SIM_CYCLE_MINUTES || 90));
  else if (env.DB && Date.now() >= startOf(env)) res = await d1Store(env.DB).loadLocal(area);
  if (env.DB) {
    const { results } = await env.DB.prepare('SELECT * FROM desk_call WHERE ns = ? AND race_id LIKE ?').bind(ns, `${A.prefix}%`).all();
    for (const r of results) calls.set(r.race_id, r);
  }
  const out = buildLocal(A.list, res, calls, Date.now(), A.prefix);
  out.resultsStart = new Date(startOf(env)).toISOString();
  return out;
}

/* ── Calls feed ── */
async function feed(env, url) {
  if (!env.DB) return { items: [] };
  const ns = url.searchParams.get('sim') === '1' || env.SIMULATE === 'true' ? 'sim' : 'live';
  const limit = Math.min(200, +url.searchParams.get('limit') || 60);
  const { results } = await env.DB.prepare('SELECT race_id, party, candidate, source, kind, at FROM call_log WHERE ns = ? ORDER BY at DESC, id DESC LIMIT ?').bind(ns, limit).all();
  const byId = new Map(universe.races.map(r => [r.id, r]));
  return {
    items: results.map(x => {
      const r = byId.get(x.race_id);
      if (!r && x.race_id.startsWith('OC-')) {
        const c = OC_LOCAL.contests.find(c => `OC-${c.id}` === x.race_id);
        return { ...x, name: c?.name || `Orange County contest ${x.race_id.slice(3)}`, chamber: 'local', flip: false };
      }
      if (!r && PROP_IDS.has(x.race_id)) {
        const c = CA_PROPS.contests.find(c => `CA-P${c.id}` === x.race_id);
        return { ...x, name: c.name, chamber: 'props', flip: false };
      }
      return { ...x, name: r?.name, chamber: r?.chamber, flip: !!(x.kind === 'call' && r?.holder.party && r.holder.party !== x.party) };
    }),
  };
}

/* ── Desk: test one state's feed right now ── */
async function preview(env, url) {
  const st = String(url.searchParams.get('state') || '').toUpperCase();
  if (!ADAPTERS[st]) return { error: `No feed for ${st || 'that state'}. Feeds: ${Object.keys(ADAPTERS).join(', ')}` };
  const store = env.DB ? d1Store(env.DB) : { loadUnits: async () => new Map() };
  const out = await runIngest({
    env: { ...env, STATE_FEEDS: st, SUBREQUEST_BUDGET: env.PREVIEW_BUDGET || 45 },
    universe, store, force: true, only: [st], dryRun: true,
  });
  const byId = new Map(universe.races.map(r => [r.id, r]));
  return {
    state: st, source: ADAPTERS[st].label, confidence: ADAPTERS[st].confidence, downloads: out.used,
    countyDownloads: countiesOn(env) ? 'on' : 'off (set COUNTY_FEEDS = "on" to include them)',
    units: out.units.map(u => ({ unit: u.unit, status: u.status, error: u.error, races: u.races })),
    counties: out.counties.map(({ raceId, payload }) => ({ raceId, counties: Object.keys(payload.counties).length, unmatchedRows: payload.counties.null ? 'some county names did not match' : undefined })),
    local: out.locals.map(({ area, payload }) => ({
      area, generated: payload.generated, contests: payload.contests.length,
      sample: payload.contests.slice(0, 5).map(c => `${c.id}: ${c.candidates.slice(0, 3).map(x => `${x.name} ${x.votes}`).join(', ')}`),
    })),
    races: out.results.map(({ raceId, payload }) => ({
      raceId, name: byId.get(raceId)?.name, pctIn: payload.pctIn, pctLabel: payload.pctLabel,
      candidates: payload.candidates.slice(0, 4).map(c => `${c.name} (${c.party}) ${c.votes.toLocaleString('en-US')}`),
    })),
  };
}

/* ── Desk actions ── */
async function desk(env, action, b) {
  if (!env.DB) return { error: 'D1 database not bound' };
  const ns = b.sim ? 'sim' : 'live';
  const id = String(b.raceId || '').toUpperCase();
  const isLocal = isLocalId(id);
  if (!IDS.has(id) && !isLocal) return { error: `Unknown race ${b.raceId}` };
  const now = Date.now();
  if (action === 'call' && isLocal) {
    const winners = (Array.isArray(b.winners) ? b.winners : [b.candidate]).map(w => String(w || '').trim().slice(0, 80)).filter(Boolean).slice(0, 12);
    if (!winners.length) return { error: 'winners required' };
    if (PROP_IDS.has(id) && (winners.length !== 1 || !/^(Yes|No)$/.test(winners[0]))) return { error: 'A proposition call is "Yes" (passes) or "No" (fails)' };
    const source = String(b.source || 'OC Scanner desk').slice(0, 40);
    const cand = winners.join(' | ');
    await env.DB.batch([
      env.DB.prepare('INSERT OR REPLACE INTO desk_call (ns, race_id, party, candidate, source, note, called_at, retracted_at) VALUES (?,?,?,?,?,?,?,NULL)')
        .bind(ns, id, null, cand, source, b.note ? String(b.note).slice(0, 280) : null, now),
      env.DB.prepare('INSERT INTO call_log (ns, race_id, party, candidate, source, kind, at) VALUES (?,?,?,?,?,?,?)').bind(ns, id, null, cand, source, 'call', now),
    ]);
    return { ok: true, raceId: id, winners, source };
  }
  if (action === 'result' && isLocal) return { error: 'Vote entry is for national races; local numbers come from the Registrar' };
  if (action === 'call') {
    const party = normParty(b.party);
    if (party === 'O' && !b.candidate) return { error: 'party required' };
    const source = String(b.source || 'OC Scanner desk').slice(0, 40);
    if (!b.candidate) b.candidate = universe.races.find(r => r.id === id).candidates.find(c => normParty(c.party) === party)?.name || null;
    await env.DB.batch([
      env.DB.prepare('INSERT OR REPLACE INTO desk_call (ns, race_id, party, candidate, source, note, called_at, retracted_at) VALUES (?,?,?,?,?,?,?,NULL)')
        .bind(ns, id, party, b.candidate || null, source, b.note ? String(b.note).slice(0, 280) : null, now),
      env.DB.prepare('INSERT INTO call_log (ns, race_id, party, candidate, source, kind, at) VALUES (?,?,?,?,?,?,?)').bind(ns, id, party, b.candidate || null, source, 'call', now),
    ]);
    return { ok: true, raceId: id, party, source };
  }
  if (action === 'retract') {
    const prev = await env.DB.prepare('SELECT * FROM desk_call WHERE ns = ? AND race_id = ?').bind(ns, id).first();
    await env.DB.batch([
      env.DB.prepare('INSERT OR REPLACE INTO desk_call (ns, race_id, party, candidate, source, note, called_at, retracted_at) VALUES (?,?,?,?,?,?,?,?)')
        .bind(ns, id, prev?.party || null, prev?.candidate || null, prev?.source || null, b.note || null, prev?.called_at || null, now),
      env.DB.prepare('INSERT INTO call_log (ns, race_id, party, candidate, source, kind, at) VALUES (?,?,?,?,?,?,?)').bind(ns, id, prev?.party || null, prev?.candidate || null, prev?.source || 'OC Scanner desk', 'retract', now),
    ]);
    return { ok: true, raceId: id, retracted: true };
  }
  if (action === 'clear') {
    await env.DB.prepare('DELETE FROM desk_call WHERE ns = ? AND race_id = ?').bind(ns, id).run();
    return { ok: true, raceId: id, cleared: true };
  }
  if (action === 'result') {
    const cands = (b.candidates || []).slice(0, 12).map(c => ({ name: String(c.name || '').slice(0, 80), party: normParty(c.party), votes: Math.max(0, Math.round(+c.votes || 0)), winner: false }));
    if (!cands.length) return { error: 'candidates required' };
    const payload = { candidates: cands, pctIn: b.pctIn == null ? null : Math.max(0, Math.min(100, +b.pctIn)), pctLabel: 'expected vote', updated: new Date(now).toISOString() };
    await env.DB.prepare('INSERT OR REPLACE INTO desk_result (ns, race_id, payload, updated_at) VALUES (?,?,?,?)').bind(ns, id, JSON.stringify(payload), now).run();
    return { ok: true, raceId: id };
  }
  return { error: `Unknown desk action ${action}` };
}

async function health(env) {
  const now = Date.now();
  return {
    ok: true,
    simulateDefault: env.SIMULATE === 'true',
    resultsStart: new Date(startOf(env)).toISOString(),
    stateFeedsHeld: now < startOf(env) && env.INGEST_EARLY !== 'true',
    ap: !!env.AP_API_KEY,
    stateFeeds: Object.values(ADAPTERS).map(a => ({ state: a.st, source: a.label, format: a.format, confidence: a.confidence })),
    countyFeeds: countiesOn(env) ? 'on' : 'off', countyStates: [...COUNTY_STATES],
    localContests: { OC: OC_LOCAL.contests.length, CAP: CA_PROPS.contests.length },
    downloadBudgetPerRun: +(env.SUBREQUEST_BUDGET || 45),
    desk: !!env.DESK_TOKEN, database: !!env.DB,
    races: universe.races.length,
  };
}

/* ── helpers ── */
function authorized(request, env) {
  if (!env.DESK_TOKEN) return false;
  const got = (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  if (got.length !== env.DESK_TOKEN.length) return false;
  let diff = 0;
  for (let i = 0; i < got.length; i++) diff |= got.charCodeAt(i) ^ env.DESK_TOKEN.charCodeAt(i);
  return diff === 0;
}
async function purge() {
  const cache = caches.default;
  await Promise.all(['board?sim=0', 'board?sim=1', ...Object.keys(AREAS).flatMap(a => [`local?area=${a}&sim=0`, `local?area=${a}&sim=1`])].map(k => cache.delete(new Request(`https://cache.local/${k}`))));
}
function corsHeaders(request, env) {
  const origin = request.headers.get('Origin') || '';
  const allowed = (env.ALLOWED_ORIGINS || 'https://ocscanner.github.io,https://ocscanner.news').split(',').map(s => s.trim());
  const ok = allowed.includes(origin) || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin) || /\.pages\.dev$/.test(origin);
  return {
    'Access-Control-Allow-Origin': ok ? origin : '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}
function json(obj, headers, maxAge = 0, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...headers, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': maxAge ? `public, max-age=${maxAge}` : 'no-store' },
  });
}
