CREATE TABLE integration_history (
 company_id TEXT NOT NULL REFERENCES companies(id),
 scope TEXT NOT NULL DEFAULT '',
 provider TEXT NOT NULL CHECK(provider IN ('history','shopify','dinero','viabill','flatpay')),
 start_date TEXT NOT NULL DEFAULT '',
 months INTEGER NOT NULL DEFAULT 24 CHECK(months BETWEEN 1 AND 120),
 revision INTEGER NOT NULL DEFAULT 1,
 PRIMARY KEY(company_id,scope,provider)
);
CREATE TABLE operation_acknowledgements (
 company_id TEXT NOT NULL REFERENCES companies(id),
 run_id TEXT NOT NULL REFERENCES operation_runs(id),
 PRIMARY KEY(company_id,run_id)
);

CREATE TABLE operation_snapshots_next (
 company_id TEXT NOT NULL, webshop_id TEXT NOT NULL,
 module TEXT NOT NULL CHECK(module IN ('orders','refunds','payouts','inventory','payments')),
 external_id TEXT NOT NULL, occurred_at TEXT NOT NULL, payload_json TEXT NOT NULL,
 imported_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY(company_id,webshop_id,module,external_id),
 FOREIGN KEY(company_id,webshop_id) REFERENCES webshops(company_id,id)
);

INSERT INTO operation_snapshots_next SELECT * FROM operation_snapshots;
DROP TABLE operation_snapshots;
ALTER TABLE operation_snapshots_next RENAME TO operation_snapshots;

CREATE TABLE emballage_connections (
 company_id TEXT NOT NULL,webshop_id TEXT NOT NULL,
 identity TEXT NOT NULL,credentials_encrypted TEXT NOT NULL,
 context_json TEXT NOT NULL,config_json TEXT NOT NULL,
 revision INTEGER NOT NULL DEFAULT 1,
 PRIMARY KEY(company_id,webshop_id),
 FOREIGN KEY(company_id,webshop_id) REFERENCES webshops(company_id,id)
);
