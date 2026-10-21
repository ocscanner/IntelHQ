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
