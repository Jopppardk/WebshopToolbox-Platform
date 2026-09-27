CREATE TABLE finance_state (
 tenant TEXT NOT NULL REFERENCES companies(id), setting_key TEXT NOT NULL, setting_value TEXT NOT NULL,
 updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY(tenant,setting_key)
);
CREATE TABLE finance_ledger (
 company_id TEXT NOT NULL REFERENCES companies(id), organization TEXT NOT NULL, guid TEXT NOT NULL,
 account INTEGER NOT NULL, date TEXT NOT NULL, minor INTEGER NOT NULL, type TEXT NOT NULL,
 PRIMARY KEY(company_id,organization,guid)
);
CREATE INDEX finance_ledger_date ON finance_ledger(company_id,organization,date);
