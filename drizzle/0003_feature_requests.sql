CREATE TABLE IF NOT EXISTS feature_requests (
  id TEXT PRIMARY KEY,
  tenant TEXT NOT NULL DEFAULT 'sablen.dk',
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  desired_outcome TEXT,
  area TEXT NOT NULL,
  priority TEXT NOT NULL CHECK (priority IN ('low', 'medium', 'high', 'critical')),
  status TEXT NOT NULL DEFAULT 'proposed' CHECK (status IN ('proposed', 'clarification', 'ready', 'in_progress', 'testing', 'production', 'rejected')),
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_feature_requests_tenant_updated ON feature_requests(tenant, updated_at DESC);
PRAGMA optimize;
