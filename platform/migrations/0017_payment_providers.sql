CREATE TABLE payment_connections (
 company_id TEXT NOT NULL, webshop_id TEXT NOT NULL, provider TEXT NOT NULL CHECK(provider IN ('flatpay','viabill')),
 identity TEXT NOT NULL, metadata_json TEXT NOT NULL, credentials_encrypted TEXT NOT NULL,
 start_date TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 1, verified_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY(company_id,webshop_id,provider), UNIQUE(provider,identity),
 FOREIGN KEY(company_id,webshop_id) REFERENCES webshops(company_id,id)
);
CREATE TABLE payment_records (
 company_id TEXT NOT NULL, webshop_id TEXT NOT NULL, provider TEXT NOT NULL, kind TEXT NOT NULL,
 external_id TEXT NOT NULL, occurred_at TEXT NOT NULL, payload_json TEXT NOT NULL,
 paid INTEGER NOT NULL DEFAULT 0 CHECK(paid IN (0,1)), imported_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY(company_id,webshop_id,provider,kind,external_id),
 FOREIGN KEY(company_id,webshop_id,provider) REFERENCES payment_connections(company_id,webshop_id,provider)
);
CREATE INDEX payment_records_period ON payment_records(company_id,webshop_id,provider,kind,occurred_at);
