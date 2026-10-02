-- Country and currency of each Shopify order (Shopify Markets), kept apart from the order snapshot so
-- adding them never makes already booked orders look changed. Filled by the order sync and, for
-- orders synced before this, by a background backfill. Additive only.
CREATE TABLE order_markets (
 company_id TEXT NOT NULL,
 webshop_id TEXT NOT NULL,
 external_id TEXT NOT NULL,
 country TEXT CHECK(country IS NULL OR (length(country)=2 AND country NOT GLOB '*[^A-Z]*')),
 currency TEXT CHECK(currency IS NULL OR (length(currency)=3 AND currency NOT GLOB '*[^A-Z]*')),
 presentment_total TEXT,
 updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY(company_id,webshop_id,external_id),
 FOREIGN KEY(company_id,webshop_id) REFERENCES webshops(company_id,id)
);
CREATE INDEX order_markets_country ON order_markets(company_id,webshop_id,country);
