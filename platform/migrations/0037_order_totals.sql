-- Original order total and Shopify's net payment (received minus refunded) per order, in the shop's
-- currency, so Salg shows the right amount and realized amount after refunds and returns. Kept with
-- the order's market, outside the order snapshot. All existing rows are marked for a refresh, which the
-- market step does in portions. Additive only.
ALTER TABLE order_markets ADD COLUMN order_total TEXT;
ALTER TABLE order_markets ADD COLUMN net_payment TEXT;
UPDATE order_markets SET updated_at='2000-01-01 00:00:00';
