-- Custom app "Webshop-synkronisering" (platform/shop-sync.ts): chosen collections and products are created in a
-- target webshop from a source webshop of the same company and kept in sync. One setup per company.
-- shop_sync_products/-variants/-collections link the source to what was created in the target. Synced target
-- products are left out of the target's inventory value (inventory-source.ts). Additive only.
CREATE TABLE shop_sync_settings (
 company_id TEXT PRIMARY KEY REFERENCES companies(id),
 source_webshop_id TEXT NOT NULL, target_webshop_id TEXT NOT NULL CHECK(target_webshop_id<>source_webshop_id),
 source_location_id TEXT NOT NULL, target_location_id TEXT NOT NULL,
 interval_minutes INTEGER NOT NULL CHECK(interval_minutes IN (15,30,60,180,360,720,1440)),
 enabled INTEGER NOT NULL DEFAULT 0 CHECK(enabled IN (0,1)),
 selection_json TEXT NOT NULL DEFAULT '{"collections":[],"products":[]}',
 revision TEXT NOT NULL, updated_by TEXT NOT NULL, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 lock_until INTEGER NOT NULL DEFAULT 0, last_run_at TEXT, next_run_at INTEGER NOT NULL DEFAULT 0, last_result_json TEXT,
 FOREIGN KEY(company_id,source_webshop_id) REFERENCES webshops(company_id,id),
 FOREIGN KEY(company_id,target_webshop_id) REFERENCES webshops(company_id,id)
);
-- state: creating (a create was sent without a certain answer; found by its tag before anything is sent again),
-- linked, removed (no longer chosen or gone in the source: set to draft in the target and no longer synced).
CREATE TABLE shop_sync_products (
 company_id TEXT NOT NULL, source_webshop_id TEXT NOT NULL, source_product_id TEXT NOT NULL,
 target_webshop_id TEXT NOT NULL, target_product_id TEXT,
 state TEXT NOT NULL CHECK(state IN ('creating','linked','removed')),
 title TEXT NOT NULL DEFAULT '', fingerprint TEXT NOT NULL DEFAULT '', files_fingerprint TEXT NOT NULL DEFAULT '',
 synced_at TEXT, error TEXT,
 PRIMARY KEY(company_id,source_product_id),
 FOREIGN KEY(company_id,source_webshop_id) REFERENCES webshops(company_id,id),
 FOREIGN KEY(company_id,target_webshop_id) REFERENCES webshops(company_id,id)
);
CREATE INDEX shop_sync_products_target ON shop_sync_products(company_id,target_webshop_id,target_product_id);
-- last_quantity: the target's available quantity after the last sync; what the target sold since is taken from the
-- source. pending_json: a stock change that was sent without a certain answer; resolved before anything else is sent.
CREATE TABLE shop_sync_variants (
 company_id TEXT NOT NULL, source_variant_id TEXT NOT NULL, source_product_id TEXT NOT NULL,
 source_item_id TEXT NOT NULL, target_item_id TEXT NOT NULL,
 last_quantity INTEGER, pending_json TEXT,
 state TEXT NOT NULL DEFAULT 'ok' CHECK(state IN ('ok','uncertain')), error TEXT,
 PRIMARY KEY(company_id,source_variant_id)
);
CREATE TABLE shop_sync_collections (
 company_id TEXT NOT NULL, source_collection_id TEXT NOT NULL, target_collection_id TEXT,
 title TEXT NOT NULL DEFAULT '', fingerprint TEXT NOT NULL DEFAULT '', synced_at TEXT, error TEXT,
 PRIMARY KEY(company_id,source_collection_id)
);
