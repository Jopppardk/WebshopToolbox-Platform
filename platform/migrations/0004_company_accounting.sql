-- One accounting configuration shared by all webshops owned by a company.
-- Credentials and live provider connections are deliberately not part of this test release.
CREATE TABLE company_accounting (
 company_id TEXT PRIMARY KEY REFERENCES companies(id),
 provider TEXT NOT NULL CHECK(provider IN ('dinero','e-conomic')),
 account_name TEXT NOT NULL CHECK(length(account_name) BETWEEN 1 AND 120),
 status TEXT NOT NULL DEFAULT 'pending' CHECK(status = 'pending'),
 updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
