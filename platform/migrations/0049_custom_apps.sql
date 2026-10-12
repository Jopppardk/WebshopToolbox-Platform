-- Custom apps (platform/custom-apps.ts): an app built for one customer is turned on for exactly one company by a
-- platform administrator in Tier 0. app_id is the primary key, so an app can never be on for two companies.
-- The app's code lives in the repository; this table only says which company may use it. Additive only.
CREATE TABLE custom_apps (
 app_id TEXT PRIMARY KEY,
 company_id TEXT NOT NULL REFERENCES companies(id),
 enabled_by TEXT NOT NULL,
 enabled_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX custom_apps_company ON custom_apps(company_id);
