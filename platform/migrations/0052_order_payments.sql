-- Payments of orders sold on payment terms (B2B invoices in Shopify). The sale of such an order is booked on the
-- receivables account (Debitorer) instead of the clearing account, and each payment Shopify records on the order
-- moves the amount from Debitorer to the bank (manual payment, e.g. a bank transfer marked as paid) or to the
-- clearing account (a payment gateway whose payout clears it). Same shape as order_refunds. Additive only.
CREATE TABLE order_payments (
 company_id TEXT NOT NULL,
 webshop_id TEXT NOT NULL,
 module TEXT NOT NULL DEFAULT 'order_payments' CHECK(module='order_payments'),
 external_id TEXT NOT NULL CHECK(external_id GLOB 'gid://shopify/OrderTransaction/[0-9]*'),
 order_id TEXT NOT NULL CHECK(order_id GLOB 'gid://shopify/Order/[0-9]*'),
 occurred_at TEXT NOT NULL,
 payload_json TEXT NOT NULL CHECK(json_valid(payload_json)),
 imported_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY(company_id,webshop_id,external_id),
 FOREIGN KEY(company_id,webshop_id) REFERENCES webshops(company_id,id)
);
CREATE INDEX order_payments_order ON order_payments(company_id,webshop_id,order_id);
CREATE INDEX order_payments_date ON order_payments(company_id,webshop_id,occurred_at);
CREATE TRIGGER record_order_payments_insert AFTER INSERT ON order_payments
BEGIN INSERT INTO record_events(company_id,webshop_id,provider,module,external_id,event)
VALUES(NEW.company_id,NEW.webshop_id,'shopify','order_payments',NEW.external_id,'imported'); END;
CREATE TRIGGER record_order_payments_update AFTER UPDATE ON order_payments WHEN OLD.payload_json != NEW.payload_json
BEGIN INSERT INTO record_events(company_id,webshop_id,provider,module,external_id,event)
VALUES(NEW.company_id,NEW.webshop_id,'shopify','order_payments',NEW.external_id,'source_changed'); END;

-- Which payment status of an order (displayFinancialStatus) had its payments read, so an order is only asked again
-- when the status changes (e.g. PENDING → PARTIALLY_PAID → PAID).
CREATE TABLE order_payment_checks (
 company_id TEXT NOT NULL,
 webshop_id TEXT NOT NULL,
 order_id TEXT NOT NULL,
 financial_status TEXT NOT NULL,
 checked_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY(company_id,webshop_id,order_id),
 FOREIGN KEY(company_id,webshop_id) REFERENCES webshops(company_id,id)
);
