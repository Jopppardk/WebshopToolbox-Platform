-- Shipping labels from Salg (the printer icon): the order's shipment is created in Shipmondo with Shipmondo's own
-- product and pickup point, and its label is printed on the printer chosen for the webshop. One row per order
-- keeps a label from being created twice; an uncertain creation is never retried automatically. Additive only.
ALTER TABLE shipping_connections ADD COLUMN printer_json TEXT CHECK(printer_json IS NULL OR json_valid(printer_json));
CREATE TABLE shipping_labels (
 company_id TEXT NOT NULL,
 webshop_id TEXT NOT NULL,
 order_id TEXT NOT NULL CHECK(order_id GLOB 'gid://shopify/Order/[0-9]*'),
 sales_order_id INTEGER,
 shipment_id INTEGER,
 phase TEXT NOT NULL CHECK(phase IN ('creating','created','uncertain')),
 print_count INTEGER NOT NULL DEFAULT 0,
 printed_at TEXT,
 message TEXT,
 actor_id TEXT,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY(company_id,webshop_id,order_id),
 FOREIGN KEY(company_id,webshop_id) REFERENCES webshops(company_id,id)
);
