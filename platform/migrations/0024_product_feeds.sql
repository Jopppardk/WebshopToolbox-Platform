CREATE TABLE product_feeds (
 id TEXT PRIMARY KEY,
 company_id TEXT NOT NULL,
 webshop_id TEXT NOT NULL,
 name TEXT NOT NULL,
 service TEXT NOT NULL CHECK(service='partnerads'),
 config_json TEXT NOT NULL,
 enabled INTEGER NOT NULL DEFAULT 0 CHECK(enabled IN (0,1)),
 public_token TEXT NOT NULL UNIQUE,
 revision INTEGER NOT NULL DEFAULT 1,
 xml_key TEXT,
 item_count INTEGER,
 generated_at INTEGER,
 refresh_lock TEXT,
 lock_until INTEGER NOT NULL DEFAULT 0,
 last_attempt INTEGER NOT NULL DEFAULT 0,
 last_error TEXT,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY(company_id,webshop_id) REFERENCES webshops(company_id,id)
);
CREATE INDEX product_feeds_shop ON product_feeds(company_id,webshop_id);
