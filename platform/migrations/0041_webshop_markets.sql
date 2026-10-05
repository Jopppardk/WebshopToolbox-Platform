-- Markets a webshop invoices and books besides its home market (e.g. Sweden on sabeln.se in SEK).
-- The market itself (countries, currency, domain) comes from Shopify Markets; this keeps the shop's choices:
-- whether orders there are invoiced and booked, the invoice language, the store name, contact and footer on the
-- invoice and the invoice mail (Indstillinger → Faktura-afsendelse, one tab per country). Orders to markets that are not set up and enabled stay on hold, as before. Additive only.
CREATE TABLE webshop_markets (
 company_id TEXT NOT NULL,
 webshop_id TEXT NOT NULL,
 market_id TEXT NOT NULL CHECK(market_id GLOB 'gid://shopify/Market/[0-9]*'),
 name TEXT NOT NULL,
 countries_json TEXT NOT NULL CHECK(json_valid(countries_json) AND json_type(countries_json)='array'),
 currency TEXT NOT NULL CHECK(length(currency)=3 AND currency NOT GLOB '*[^A-Z]*'),
 locale TEXT NOT NULL CHECK(locale IN ('da','sv','en')),
 store_name TEXT NOT NULL,
 -- Contact line and footer text on the market's invoices (e.g. info@sabeln.se); NULL uses the Danish ones.
 contact TEXT,
 footer TEXT,
 invoice_subject TEXT NOT NULL,
 invoice_body TEXT NOT NULL,
 vat_mode TEXT NOT NULL DEFAULT 'domestic' CHECK(vat_mode IN ('domestic')),
 enabled INTEGER NOT NULL DEFAULT 0 CHECK(enabled IN (0,1)),
 revision INTEGER NOT NULL DEFAULT 1,
 updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY(company_id,webshop_id,market_id),
 FOREIGN KEY(company_id,webshop_id) REFERENCES webshops(company_id,id)
);
