-- Each market's invoice settings mirror the Danish ones (Indstillinger → Faktura-afsendelse, a tab per country):
-- company details, design and logo, invoice and credit-note mail texts, and its own mail sender (own domain).
-- NULL in a market column means "as Danmark". Credit-note mail texts are added for Danmark too. Additive only.
ALTER TABLE invoice_settings ADD COLUMN credit_subject TEXT;
ALTER TABLE invoice_settings ADD COLUMN credit_body TEXT;
ALTER TABLE webshop_markets ADD COLUMN issuer_json TEXT CHECK(issuer_json IS NULL OR json_valid(issuer_json));
ALTER TABLE webshop_markets ADD COLUMN design_json TEXT CHECK(design_json IS NULL OR json_valid(design_json));
-- NULL uses the Danish logo; '' means no logo.
ALTER TABLE webshop_markets ADD COLUMN logo_key TEXT;
ALTER TABLE webshop_markets ADD COLUMN credit_subject TEXT;
ALTER TABLE webshop_markets ADD COLUMN credit_body TEXT;
-- Same shape as company_mail, per market. A market without a row sends with the Danish sender settings.
CREATE TABLE market_mail (
 company_id TEXT NOT NULL,
 webshop_id TEXT NOT NULL,
 market_id TEXT NOT NULL,
 sender_name TEXT NOT NULL,
 reply_to TEXT NOT NULL DEFAULT '',
 custom_from TEXT NOT NULL DEFAULT '',
 account_id TEXT NOT NULL DEFAULT '',
 credentials_encrypted TEXT,
 revision TEXT NOT NULL,
 verified_revision TEXT,
 updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY(company_id,webshop_id,market_id),
 FOREIGN KEY(company_id,webshop_id,market_id) REFERENCES webshop_markets(company_id,webshop_id,market_id)
);
