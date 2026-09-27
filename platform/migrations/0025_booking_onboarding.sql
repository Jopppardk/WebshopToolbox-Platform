-- History settings never grant permission to book. No customer dates are inferred.
CREATE TABLE booking_start_dates (
 company_id TEXT NOT NULL, webshop_id TEXT NOT NULL,
 provider TEXT NOT NULL CHECK(provider IN ('shopify','dinero','flatpay','viabill')),
 start_date TEXT NOT NULL DEFAULT '', revision INTEGER NOT NULL DEFAULT 1,
 PRIMARY KEY(company_id,webshop_id,provider),
 FOREIGN KEY(company_id,webshop_id) REFERENCES webshops(company_id,id)
);
CREATE TABLE accounting_reconciliations (
 company_id TEXT NOT NULL, webshop_id TEXT NOT NULL, provider TEXT NOT NULL,
 module TEXT NOT NULL, external_id TEXT NOT NULL, organization_id TEXT NOT NULL,
 voucher_guid TEXT NOT NULL, voucher_number TEXT, voucher_status TEXT NOT NULL CHECK(voucher_status IN ('Booked','Draft')),
 source_json TEXT NOT NULL, evidence_json TEXT NOT NULL,
 actor_id TEXT NOT NULL REFERENCES users(id), created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY(company_id,webshop_id,provider,module,external_id,organization_id),
 UNIQUE(organization_id,voucher_guid),
 FOREIGN KEY(company_id,webshop_id) REFERENCES webshops(company_id,id)
);
