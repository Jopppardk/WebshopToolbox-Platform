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
  `CREATE TABLE IF NOT EXISTS feature_requests (
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
  )`,
  `CREATE INDEX IF NOT EXISTS idx_feature_requests_tenant_updated
    ON feature_requests(tenant, updated_at DESC)`,
  `CREATE TABLE IF NOT EXISTS feature_request_numbers (
    tenant TEXT NOT NULL,
    feature_request_id TEXT NOT NULL,
    reference_number INTEGER NOT NULL,
    PRIMARY KEY (tenant, feature_request_id),
    UNIQUE (tenant, reference_number)
  )`,
  `INSERT OR IGNORE INTO feature_requests (id, tenant, title, description, desired_outcome, area, priority, status, created_by)
    VALUES ('backlog-viabill-integration', 'sablen.dk', 'Integration til ViaBill', 'ViaBill skal integreres til betalinger og udbetalinger. Arbejdet afventer de nødvendige oplysninger og afklaringer fra ViaBill.', 'Færdiggør forbindelsen, synkroniseringen og bogføringsflowet, når ViaBill har leveret den manglende information.', 'Integrationer', 'high', 'clarification', 'rene@sablen.dk')`,
  `INSERT OR IGNORE INTO feature_requests (id, tenant, title, description, desired_outcome, area, priority, status, created_by)
    VALUES ('backlog-flatpay-integration', 'sablen.dk', 'Integration til Flatpay', 'Flatpay skal integreres til betalinger og udbetalinger. Arbejdet afventer API-information og adgangsoplysninger fra Flatpay.', 'Byg import og bogføringsflow, når Flatpay har leveret dokumentation og adgang.', 'Integrationer', 'high', 'clarification', 'rene@sablen.dk')`,
  `INSERT OR IGNORE INTO feature_requests (id, tenant, title, description, desired_outcome, area, priority, status, created_by)
    VALUES ('backlog-packaging-reporting-integration', 'sablen.dk', 'Integration til Emballageindberetning.dk', 'Den eksisterende emballageregistrering skal forbindes til Emballageindberetning.dk. Arbejdet afventer godkendelse fra Emballageindberetning.dk.', 'Automatisér indberetningen med kontrol og tydelig status, når adgangen er godkendt.', 'Integrationer', 'medium', 'clarification', 'rene@sablen.dk')`,
  `INSERT OR IGNORE INTO feature_requests (id, tenant, title, description, desired_outcome, area, priority, status, created_by)
    VALUES ('backlog-sales-analysis', 'sablen.dk', 'Salgsanalyse-side', 'Opret en salgsanalyse-side, som giver et samlet og anvendeligt overblik over salget i webshoppen.', 'Vis relevante nøgletal, udvikling og mulighed for at analysere salget over valgte perioder.', 'Salg', 'medium', 'proposed', 'rene@sablen.dk')`,
];
