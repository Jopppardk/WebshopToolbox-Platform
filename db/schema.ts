export const retentionMonths = 24;

export const schemaStatements = [
  `CREATE TABLE IF NOT EXISTS integration_records (
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
  )`,
  `CREATE INDEX IF NOT EXISTS idx_integration_records_type_date
    ON integration_records(tenant, record_type, occurred_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_integration_records_expiry
    ON integration_records(expires_at)`,
  `CREATE TABLE IF NOT EXISTS system_errors (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant TEXT NOT NULL DEFAULT 'sablen.dk',
    source TEXT NOT NULL,
    message TEXT NOT NULL,
    details_json TEXT,
    resolved_at TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE INDEX IF NOT EXISTS idx_system_errors_active
    ON system_errors(tenant, created_at DESC)
    WHERE resolved_at IS NULL`,
  `CREATE TABLE IF NOT EXISTS app_settings (
    tenant TEXT NOT NULL,
    setting_key TEXT NOT NULL,
    setting_value TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (tenant, setting_key)
  )`,
  `CREATE TABLE IF NOT EXISTS invoice_email_deliveries (
    id TEXT PRIMARY KEY,
    tenant TEXT NOT NULL DEFAULT 'sablen.dk',
    external_id TEXT NOT NULL,
    recipient TEXT NOT NULL,
    delivery_mode TEXT NOT NULL CHECK (delivery_mode IN ('test', 'customer')),
    status TEXT NOT NULL CHECK (status IN ('sending', 'sent', 'failed')),
    provider_message_id TEXT,
    error_message TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(tenant, external_id, recipient, delivery_mode)
  )`,
  `CREATE TABLE IF NOT EXISTS integration_credentials (
    tenant TEXT NOT NULL,
    provider TEXT NOT NULL CHECK (provider IN ('shopify', 'dinero')),
    ciphertext TEXT NOT NULL,
    iv TEXT NOT NULL,
    display_name TEXT,
    verified_at TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (tenant, provider)
  )`,
  `CREATE TABLE IF NOT EXISTS job_runs (
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
  )`,
  `CREATE INDEX IF NOT EXISTS idx_job_runs_tenant_started
    ON job_runs(tenant, started_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_job_runs_tenant_job
    ON job_runs(tenant, job_key, started_at DESC)`,
];
