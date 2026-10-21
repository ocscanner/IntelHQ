/**
 * OC Scanner Election Wire — results Worker
 *
 * Every 5 minutes (cron) the Worker downloads whatever state files are due (each state about every
 * 10 minutes) plus AP if licensed, and saves results per race. Viewers only ever read what's saved.
 *
 *  GET  /v1/board            all races + seat summaries (cached 60s per Cloudflare location)
 *  GET  /v1/board?sim=1      same, with rehearsal (fake) results — always labeled SIM
 *  GET  /v1/feed             latest calls and retractions, newest first
 *  GET  /v1/health           switches, feed status, when state feeds start
 *  GET  /v1/desk/check       200 if the desk token is valid
 *  GET  /v1/desk/preview?state=GA   download and parse one state now, without saving (desk token)
 *  POST /v1/desk/call        {raceId, party, candidate?, source, note?}       (desk token)
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

const IDS = new Set(universe.races.map(r => r.id));
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
      return json({ error: 'Not found', routes: ['/v1/board', '/v1/feed', '/v1/health'] }, cors, 0, 404);
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
    units: out.units.map(u => ({ unit: u.unit, status: u.status, error: u.error, races: u.races })),
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
  if (!IDS.has(id)) return { error: `Unknown race ${b.raceId}` };
  const now = Date.now();
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
  await Promise.all([cache.delete(new Request('https://cache.local/board?sim=0')), cache.delete(new Request('https://cache.local/board?sim=1'))]);
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
