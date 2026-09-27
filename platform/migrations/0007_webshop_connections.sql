CREATE TABLE webshop_connections (
 company_id TEXT NOT NULL,
 webshop_id TEXT NOT NULL,
 provider TEXT NOT NULL,
 shop_domain TEXT NOT NULL,
 credentials_encrypted TEXT NOT NULL,
 updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY(company_id,webshop_id),
 UNIQUE(company_id,provider,shop_domain),
 FOREIGN KEY(company_id,webshop_id) REFERENCES webshops(company_id,id)
);
