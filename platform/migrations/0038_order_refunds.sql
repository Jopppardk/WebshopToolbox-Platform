-- Refunds per Shopify order, whatever the payment gateway (Shopify Payments, MobilePay, Flatpay, ViaBill …).
-- Each refund is booked against the same clearing account as the sale and gets its own credit note.
-- Kept apart from operation_snapshots (whose module list is fixed) so the large order table is not rebuilt.
-- The constant module column lets the shared booking code read it like operation_snapshots. Additive only.
CREATE TABLE order_refunds (
 company_id TEXT NOT NULL,
 webshop_id TEXT NOT NULL,
 module TEXT NOT NULL DEFAULT 'order_refunds' CHECK(module='order_refunds'),
 external_id TEXT NOT NULL CHECK(external_id GLOB 'gid://shopify/Refund/[0-9]*'),
 order_id TEXT NOT NULL CHECK(order_id GLOB 'gid://shopify/Order/[0-9]*'),
 occurred_at TEXT NOT NULL,
 payload_json TEXT NOT NULL CHECK(json_valid(payload_json)),
 imported_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY(company_id,webshop_id,external_id),
 FOREIGN KEY(company_id,webshop_id) REFERENCES webshops(company_id,id)
);
CREATE INDEX order_refunds_order ON order_refunds(company_id,webshop_id,order_id);
CREATE INDEX order_refunds_date ON order_refunds(company_id,webshop_id,occurred_at);
CREATE TRIGGER record_order_refunds_insert AFTER INSERT ON order_refunds
BEGIN INSERT INTO record_events(company_id,webshop_id,provider,module,external_id,event)
VALUES(NEW.company_id,NEW.webshop_id,'shopify','order_refunds',NEW.external_id,'imported'); END;
CREATE TRIGGER record_order_refunds_update AFTER UPDATE ON order_refunds WHEN OLD.payload_json != NEW.payload_json
BEGIN INSERT INTO record_events(company_id,webshop_id,provider,module,external_id,event)
VALUES(NEW.company_id,NEW.webshop_id,'shopify','order_refunds',NEW.external_id,'source_changed'); END;

-- Which refunded amount of an order has been read, so an order is only asked for again when it changes.
CREATE TABLE order_refund_checks (
 company_id TEXT NOT NULL,
 webshop_id TEXT NOT NULL,
 order_id TEXT NOT NULL,
 refunded TEXT NOT NULL,
 checked_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY(company_id,webshop_id,order_id),
 FOREIGN KEY(company_id,webshop_id) REFERENCES webshops(company_id,id)
);

-- One credit note per refund, numbered after the invoice it credits (e.g. 2683-K1).
CREATE TABLE platform_credit_notes (
 company_id TEXT NOT NULL,
 webshop_id TEXT NOT NULL,
 external_id TEXT NOT NULL,
 id TEXT NOT NULL UNIQUE,
 order_id TEXT NOT NULL,
 number TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('generating','generated')),
 r2_key TEXT NOT NULL,
 source_json TEXT NOT NULL,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY(company_id,webshop_id,external_id),
 UNIQUE(company_id,webshop_id,number),
 FOREIGN KEY(company_id,webshop_id) REFERENCES webshops(company_id,id)
);
