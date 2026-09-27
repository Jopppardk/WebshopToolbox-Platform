CREATE TABLE platform_payout_documents (
 company_id TEXT NOT NULL,webshop_id TEXT NOT NULL,external_id TEXT NOT NULL,
 id TEXT NOT NULL UNIQUE,status TEXT NOT NULL CHECK(status IN ('generating','generated')),
 r2_key TEXT NOT NULL,source_json TEXT NOT NULL,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY(company_id,webshop_id,external_id),
 FOREIGN KEY(company_id,webshop_id) REFERENCES webshops(company_id,id)
);
