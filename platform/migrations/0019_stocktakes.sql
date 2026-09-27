CREATE TABLE stocktakes (
 company_id TEXT NOT NULL, webshop_id TEXT NOT NULL, id TEXT NOT NULL, version TEXT NOT NULL,
 phase TEXT NOT NULL CHECK(phase IN ('prepared','simulated','cancelled')),
 payload_json TEXT NOT NULL, created_by TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY(company_id,webshop_id,id), FOREIGN KEY(company_id,webshop_id) REFERENCES webshops(company_id,id),
 FOREIGN KEY(created_by) REFERENCES users(id)
);
