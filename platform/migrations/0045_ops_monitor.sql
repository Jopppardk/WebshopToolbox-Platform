-- Operations monitoring for the platform admins (platform/ops-monitor.ts). ops_state holds the scheduler's
-- heartbeat and the date of the last daily mail; ops_alerts one row per problem (stalled webshop, module that
-- keeps failing, scheduler failing), so each is mailed once when it starts and once when it is resolved.
-- No foreign keys: an alert outlives the run rows it was found from. Additive only.
CREATE TABLE ops_state (
 id INTEGER PRIMARY KEY CHECK(id=1),
 last_tick_at TEXT, last_tick_ok_at TEXT, last_tick_error TEXT NOT NULL DEFAULT '',
 digest_date TEXT NOT NULL DEFAULT ''
);
INSERT INTO ops_state(id) VALUES(1);
CREATE TABLE ops_alerts (
 key TEXT PRIMARY KEY, kind TEXT NOT NULL CHECK(kind IN ('scheduler','stalled','failing')),
 company_id TEXT, webshop_id TEXT, message TEXT NOT NULL DEFAULT '',
 first_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, last_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 notified_at TEXT, resolved_at TEXT, resolved_notified_at TEXT
);
CREATE INDEX ops_alerts_open ON ops_alerts(resolved_at);
