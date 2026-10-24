-- Carrier tracking APIs that need the merchant's own key (platform/bring.ts). Shipmondo's public pages redirect Bring
-- parcels to Bring's own site, so Bring is read from the Mybring tracking API. One key per webshop. Additive only.
CREATE TABLE carrier_connections (
 company_id TEXT NOT NULL, webshop_id TEXT NOT NULL, provider TEXT NOT NULL CHECK(provider='bring'),
 credentials_encrypted TEXT NOT NULL, revision TEXT NOT NULL,
 verified_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY(company_id,webshop_id,provider),
 FOREIGN KEY(company_id,webshop_id) REFERENCES webshops(company_id,id)
);
