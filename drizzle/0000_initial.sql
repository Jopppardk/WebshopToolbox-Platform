CREATE TABLE IF NOT EXISTS integration_records (
  id TEXT PRIMARY KEY,
  tenant TEXT NOT NULL DEFAULT 'sablen.dk',
  record_type TEXT NOT NULL CHECK (record_type IN ('order', 'payment', 'refund', 'payout', 'invoice')),
  external_id TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  amount_minor INTEGER,
  currency TEXT NOT NULL DEFAULT 'DKK',
  booking_status TEXT NOT NULL DEFAULT 'pending',
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at TEXT NOT NULL,
  UNIQUE(tenant, record_type, external_id)
);
CREATE INDEX IF NOT EXISTS idx_integration_records_type_date ON integration_records(tenant, record_type, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_integration_records_expiry ON integration_records(expires_at);
CREATE TABLE IF NOT EXISTS system_errors (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant TEXT NOT NULL DEFAULT 'sablen.dk',
  source TEXT NOT NULL,
  message TEXT NOT NULL,
  details_json TEXT,
  resolved_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_system_errors_active ON system_errors(tenant, created_at DESC) WHERE resolved_at IS NULL;
CREATE TABLE IF NOT EXISTS app_settings (
  tenant TEXT NOT NULL,
  setting_key TEXT NOT NULL,
  setting_value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (tenant, setting_key)
);
PRAGMA optimize;


