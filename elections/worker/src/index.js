/**
 * OC Scanner Election Wire — results Worker
 *
 *  GET  /v1/board            all races + seat summaries (cached ~20s per Cloudflare location)
 *  GET  /v1/board?sim=1      same, with rehearsal (fake) results — always labeled SIM
 *  GET  /v1/feed             latest calls and retractions, newest first
 *  GET  /v1/health           which sources are on and whether they answered
 *  GET  /v1/desk/check       200 if the desk token is valid
 *  POST /v1/desk/call        {raceId, party, candidate?, source, note?}       (desk token)
 *  POST /v1/desk/retract     {raceId}                                         (desk token)
 *  POST /v1/desk/clear       {raceId}  remove a desk call/retraction so the feed shows again
 *  POST /v1/desk/result      {raceId, pctIn, candidates:[{name,party,votes}]} (desk token)
 */
import universe from '../../data/races-2026.json';
import { buildBoard } from './board.js';
import { fetchAP } from './sources/ap.js';
import { fetchCASOS } from './sources/ca-sos.js';
import { simulate } from './sources/simulate.js';
import { normParty } from './parties.js';

const IDS = new Set(universe.races.map(r => r.id));
const CACHE_SECONDS = 20;

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const cors = corsHeaders(request, env);
    if (request.method === 'OPTIONS') return new Response(null, { headers: cors });
    try {
      const p = url.pathname.replace(/\/$/, '');
      if (request.method === 'GET' && p === '/v1/board') return await board(request, env, ctx, url, cors);
      if (request.method === 'GET' && p === '/v1/feed') return json(await feed(env, url), cors, 10);
      if (request.method === 'GET' && p === '/v1/health') return json(await health(env), cors, 0);
      if (p.startsWith('/v1/desk/')) {
        if (!authorized(request, env)) return json({ error: 'Desk token missing or wrong' }, cors, 0, 401);
        if (request.method === 'GET' && p === '/v1/desk/check') return json({ ok: true }, cors, 0);
        if (request.method === 'POST') {
          const body = await request.json().catch(() => ({}));
          const res = await desk(env, p.slice(9), body);
          await purge(request);
          return json(res, cors, 0, res.error ? 400 : 200);
        }
      }
      return json({ error: 'Not found', routes: ['/v1/board', '/v1/feed', '/v1/health'] }, cors, 0, 404);
    } catch (e) {
      return json({ error: e.message }, cors, 0, 500);
    }
  },
};

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
  const sources = [];
  const feeds = [];
  if (sim) {
    feeds.push(simulate(universe.races, now, +(env.SIM_CYCLE_MINUTES || 90)));
    sources.push({ name: 'Simulation', ok: true, note: 'Rehearsal data — not real results' });
  } else {
    for (const [name, fn] of [['AP', () => fetchAP(env, IDS)], ['CA SOS', () => fetchCASOS(env)]]) {
      try {
        const f = await fn();
        if (f.enabled) feeds.push(f);
        sources.push({ name, ok: true, enabled: f.enabled, races: f.races.size, errors: f.errors?.slice(0, 3) });
      } catch (e) {
        sources.push({ name, ok: false, enabled: true, error: e.message });
      }
    }
  }

  const deskState = await loadDesk(env, sim);
  // Remember when each feed call was first seen so the calls feed has a time.
  await recordFeedCalls(env, feeds, deskState, now, sim);
  for (const f of feeds) for (const [id, d] of f.races) { const seen = deskState.seen.get(id); if (seen) d.callSeen = seen.first_seen; }

  const out = buildBoard(universe, feeds, deskState, now);
  out.sources = sources;
  out.simulation = sim;
  out.desk = { calls: deskState.calls.size };

  const resp = json(out, cors, CACHE_SECONDS);
  resp.headers.set('X-Cache', 'MISS');
  ctx.waitUntil(cache.put(cacheKey, json(out, {}, CACHE_SECONDS)));
  return resp;
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
  // D1 batches are capped; chunk them.
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

/* ── Desk ── */
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
  return {
    ok: true,
    simulateDefault: env.SIMULATE === 'true',
    sources: { AP: !!env.AP_API_KEY, 'CA SOS': env.CA_SOS !== 'off' },
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
