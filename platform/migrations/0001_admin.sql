PRAGMA foreign_keys = ON;
CREATE TABLE companies (
 id TEXT PRIMARY KEY, name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 120),
 status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','inactive')), created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE webshops (
 id TEXT PRIMARY KEY, company_id TEXT NOT NULL REFERENCES companies(id), name TEXT NOT NULL,
 domain TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','inactive')),
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, UNIQUE(company_id,id), UNIQUE(domain)
);
CREATE TABLE users (
 id TEXT PRIMARY KEY, identity_issuer TEXT NOT NULL, identity_subject TEXT NOT NULL, email TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','inactive')), UNIQUE(identity_issuer,identity_subject)
);
CREATE TABLE platform_admins (user_id TEXT PRIMARY KEY REFERENCES users(id));
CREATE TABLE company_memberships (
 company_id TEXT NOT NULL REFERENCES companies(id), user_id TEXT NOT NULL REFERENCES users(id),
 role TEXT NOT NULL CHECK(role IN ('admin','member')), PRIMARY KEY(company_id,user_id)
);
CREATE TABLE webshop_memberships (
 company_id TEXT NOT NULL, webshop_id TEXT NOT NULL, user_id TEXT NOT NULL,
 role TEXT NOT NULL CHECK(role IN ('operator','reader')), PRIMARY KEY(company_id,webshop_id,user_id),
 FOREIGN KEY(company_id,webshop_id) REFERENCES webshops(company_id,id),
 FOREIGN KEY(company_id,user_id) REFERENCES company_memberships(company_id,user_id)
);
CREATE TABLE audit_events (
 id TEXT PRIMARY KEY, company_id TEXT REFERENCES companies(id), actor_id TEXT NOT NULL REFERENCES users(id),
 action TEXT NOT NULL, resource_id TEXT NOT NULL, details_json TEXT NOT NULL,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX audit_company ON audit_events(company_id,created_at,id);
-- Test-only source isolation fixture. Runtime imports are not enabled yet.
CREATE TABLE source_records (
 id TEXT PRIMARY KEY, company_id TEXT NOT NULL, webshop_id TEXT NOT NULL,
 provider TEXT NOT NULL, external_id TEXT NOT NULL, record_type TEXT NOT NULL,
 FOREIGN KEY(company_id,webshop_id) REFERENCES webshops(company_id,id),
 UNIQUE(company_id,webshop_id,provider,record_type,external_id)
);
