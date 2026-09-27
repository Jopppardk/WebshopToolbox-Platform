CREATE TABLE accounting_connections (
 company_id TEXT PRIMARY KEY REFERENCES companies(id), organization_id TEXT NOT NULL,
 credentials_encrypted TEXT NOT NULL, revision TEXT NOT NULL,
 chart_json TEXT NOT NULL, verified_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE accounting_mapping (
 company_id TEXT PRIMARY KEY REFERENCES companies(id), accounts_json TEXT NOT NULL,
 updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
