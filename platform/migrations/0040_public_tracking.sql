CREATE TABLE shipment_tracking_cache (
 company_id TEXT NOT NULL, webshop_id TEXT NOT NULL, parcel_key TEXT NOT NULL,
 source_key TEXT NOT NULL, url TEXT NOT NULL, carrier TEXT NOT NULL, tracking_number TEXT NOT NULL,
 shipped_at TEXT NOT NULL, data_json TEXT, checked_at TEXT, attempted_at TEXT, error TEXT,
 next_check INTEGER NOT NULL DEFAULT 0, lease_owner TEXT, lease_until INTEGER NOT NULL DEFAULT 0,
 terminal INTEGER NOT NULL DEFAULT 0, expires_at INTEGER NOT NULL,
 PRIMARY KEY(company_id,webshop_id,parcel_key),
 FOREIGN KEY(company_id,webshop_id) REFERENCES webshops(company_id,id) ON DELETE CASCADE
);
CREATE INDEX shipment_tracking_due ON shipment_tracking_cache(terminal,next_check,lease_until);
