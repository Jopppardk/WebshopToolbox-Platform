-- Demokonto: one company is marked as a demo. It is isolated from providers and mail, cannot be
-- edited or deleted from Tier 0, and its data is rebuilt every night (see platform/demo.ts).
-- Additive only; every existing company stays a normal company (demo=0).
ALTER TABLE companies ADD COLUMN demo INTEGER NOT NULL DEFAULT 0 CHECK(demo IN (0,1));
CREATE TABLE demo_state (
 id TEXT PRIMARY KEY CHECK(id='demo'),
 reset_day TEXT NOT NULL,
 reset_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
