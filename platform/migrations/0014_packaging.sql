CREATE TABLE platform_packaging (
 company_id TEXT NOT NULL,webshop_id TEXT NOT NULL,id TEXT NOT NULL,
 payload_json TEXT NOT NULL,version INTEGER NOT NULL DEFAULT 1,
 PRIMARY KEY(company_id,webshop_id,id),
 FOREIGN KEY(company_id,webshop_id) REFERENCES webshops(company_id,id)
);
CREATE TABLE platform_packaging_prices (
 company_id TEXT NOT NULL,webshop_id TEXT NOT NULL,
 household REAL NOT NULL DEFAULT 0,commercial REAL,
 PRIMARY KEY(company_id,webshop_id),
 FOREIGN KEY(company_id,webshop_id) REFERENCES webshops(company_id,id)
);
