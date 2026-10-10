-- Invoice settings per webshop (Indstillinger → Faktura-afsendelse → Danmark, "Egen opsætning for denne webshop").
-- A webshop without a row uses the company's invoice_settings/company_mail as before. A row is a full copy of the
-- company's settings when switched on, and is then edited on its own. History (months) stays company-wide.
-- Markets of the webshop inherit from it ("as Danmark"). Additive only.
CREATE TABLE webshop_invoice_settings (
 company_id TEXT NOT NULL,
 webshop_id TEXT NOT NULL,
 name TEXT NOT NULL,
 address TEXT NOT NULL,
 cvr TEXT NOT NULL,
 contact TEXT NOT NULL,
 subject TEXT NOT NULL,
 body TEXT NOT NULL,
 credit_subject TEXT,
 credit_body TEXT,
 logo_key TEXT,
 design_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(design_json)),
 revision INTEGER NOT NULL DEFAULT 1,
 updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY(company_id,webshop_id),
 FOREIGN KEY(company_id,webshop_id) REFERENCES webshops(company_id,id)
);
-- Same shape as company_mail. A webshop with its own invoice settings sends with this sender, or with the
-- standard sender until one is saved (never another webshop's domain).
CREATE TABLE webshop_mail (
 company_id TEXT NOT NULL,
 webshop_id TEXT NOT NULL,
 sender_name TEXT NOT NULL,
 reply_to TEXT NOT NULL DEFAULT '',
 custom_from TEXT NOT NULL DEFAULT '',
 account_id TEXT NOT NULL DEFAULT '',
 credentials_encrypted TEXT,
 revision TEXT NOT NULL,
 verified_revision TEXT,
 updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY(company_id,webshop_id),
 FOREIGN KEY(company_id,webshop_id) REFERENCES webshop_invoice_settings(company_id,webshop_id)
);
