-- Integrationer → Cloudflare E-mail: an approved sending domain can be limited to some of the company's webshops
-- (e.g. sablen.dk only for Sablen). A domain without rows here may be used by every webshop. Additive only.
CREATE TABLE mail_domain_webshops (
 company_id TEXT NOT NULL,
 domain TEXT NOT NULL,
 webshop_id TEXT NOT NULL,
 PRIMARY KEY(company_id,domain,webshop_id),
 FOREIGN KEY(company_id,domain) REFERENCES mail_domains(company_id,domain) ON DELETE CASCADE,
 FOREIGN KEY(company_id,webshop_id) REFERENCES webshops(company_id,id)
);
