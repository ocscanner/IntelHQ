-- OC Scanner Election Wire — D1 schema
-- ns = 'live' for election night, 'sim' for rehearsal data (kept fully separate)

CREATE TABLE IF NOT EXISTS desk_call (
  ns TEXT NOT NULL,
  race_id TEXT NOT NULL,
  party TEXT,
  candidate TEXT,
  source TEXT,            -- who made the call you are relaying: AP, DDHQ, NBC, OC Scanner desk…
  note TEXT,
  called_at INTEGER,
  retracted_at INTEGER,   -- set = the desk has pulled this call (hides any feed call too)
  PRIMARY KEY (ns, race_id)
);

CREATE TABLE IF NOT EXISTS desk_result (
  ns TEXT NOT NULL,
  race_id TEXT NOT NULL,
  payload TEXT NOT NULL,  -- JSON {candidates:[{name,party,votes}], pctIn}
  updated_at INTEGER,
  PRIMARY KEY (ns, race_id)
);

CREATE TABLE IF NOT EXISTS feed_seen (
  ns TEXT NOT NULL,
  race_id TEXT NOT NULL,
  party TEXT,
  candidate TEXT,
  source TEXT,
  first_seen INTEGER,
  PRIMARY KEY (ns, race_id)
);

CREATE TABLE IF NOT EXISTS call_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ns TEXT NOT NULL,
  race_id TEXT NOT NULL,
  party TEXT,
  candidate TEXT,
  source TEXT,
  kind TEXT NOT NULL,     -- call | retract
  at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS call_log_ns_at ON call_log (ns, at DESC);

-- Scheduled downloads: one row per download job ("unit"): a state, or one California race
CREATE TABLE IF NOT EXISTS feed_unit (
  unit TEXT PRIMARY KEY,
  state TEXT,
  fetched_at INTEGER,
  ok INTEGER,
  status TEXT,            -- ok | unchanged | not posted | error
  error TEXT,
  races INTEGER,
  meta TEXT               -- JSON: cached election id, file version, ETags
);

-- Latest numbers per race and source (AP or STATE). Only rewritten when the numbers change.
CREATE TABLE IF NOT EXISTS feed_result (
  race_id TEXT NOT NULL,
  source TEXT NOT NULL,
  payload TEXT NOT NULL,
  hash TEXT,
  updated_at INTEGER,
  PRIMARY KEY (race_id, source)
);

-- Per-county results for statewide races (Senate, governor), one row per race and source.
-- Filled only when COUNTY_FEEDS = "on" (needs Workers Paid: the county files are large).
CREATE TABLE IF NOT EXISTS county_result (
  race_id TEXT NOT NULL,
  source TEXT NOT NULL,
  payload TEXT NOT NULL,  -- JSON {cands:[{name,party}], counties:{fips:{v:[...], pct}}}
  updated_at INTEGER,
  PRIMARY KEY (race_id, source)
);

-- Local contests (Orange County Registrar): one row per area with every contest
CREATE TABLE IF NOT EXISTS local_result (
  area TEXT PRIMARY KEY,
  payload TEXT NOT NULL,
  updated_at INTEGER
);
