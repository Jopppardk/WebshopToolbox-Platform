CREATE TABLE IF NOT EXISTS integration_credentials (
  tenant TEXT NOT NULL,
  provider TEXT NOT NULL CHECK (provider IN ('shopify', 'dinero')),
  ciphertext TEXT NOT NULL,
  iv TEXT NOT NULL,
  display_name TEXT,
  verified_at TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (tenant, provider)
);
PRAGMA optimize;
