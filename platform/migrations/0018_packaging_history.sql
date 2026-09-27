CREATE TABLE packaging_snapshots (
 company_id TEXT NOT NULL, webshop_id TEXT NOT NULL, event_id TEXT NOT NULL, payload_json TEXT NOT NULL,
 PRIMARY KEY(company_id,webshop_id,event_id), FOREIGN KEY(company_id,webshop_id) REFERENCES webshops(company_id,id)
);
CREATE TABLE packaging_sync (
 company_id TEXT NOT NULL, webshop_id TEXT NOT NULL, coverage_start TEXT NOT NULL, coverage_end TEXT NOT NULL,
 synced_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY(company_id,webshop_id),
 FOREIGN KEY(company_id,webshop_id) REFERENCES webshops(company_id,id)
);
