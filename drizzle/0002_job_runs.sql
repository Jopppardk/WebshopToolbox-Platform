CREATE TABLE IF NOT EXISTS job_runs (
  id TEXT PRIMARY KEY,
  tenant TEXT NOT NULL DEFAULT 'sablen.dk',
  job_key TEXT NOT NULL,
  job_name TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('running', 'succeeded', 'failed', 'skipped')),
  started_at TEXT NOT NULL,
  finished_at TEXT,
  duration_ms INTEGER,
  message TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_job_runs_tenant_started ON job_runs(tenant, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_job_runs_tenant_job ON job_runs(tenant, job_key, started_at DESC);
PRAGMA optimize;
