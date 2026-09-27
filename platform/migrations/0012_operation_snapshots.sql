CREATE TABLE operation_snapshots (
 company_id TEXT NOT NULL, webshop_id TEXT NOT NULL,
 module TEXT NOT NULL CHECK(module IN ('orders','refunds','payouts','inventory')),
 external_id TEXT NOT NULL, occurred_at TEXT NOT NULL, payload_json TEXT NOT NULL,
 imported_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY(company_id,webshop_id,module,external_id),
 FOREIGN KEY(company_id,webshop_id) REFERENCES webshops(company_id,id)
);
CREATE TABLE operation_runs (
 id TEXT PRIMARY KEY, company_id TEXT NOT NULL, webshop_id TEXT NOT NULL,
 module TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('running','success','failed')),
 count INTEGER NOT NULL DEFAULT 0, message TEXT NOT NULL DEFAULT '',
 started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, finished_at TEXT,
 FOREIGN KEY(company_id,webshop_id) REFERENCES webshops(company_id,id)
);
CREATE INDEX operation_runs_shop ON operation_runs(company_id,webshop_id,started_at);
