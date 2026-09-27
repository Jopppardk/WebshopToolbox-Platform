CREATE TABLE company_mail (
 company_id TEXT PRIMARY KEY REFERENCES companies(id),
 sender_name TEXT NOT NULL,
 reply_to TEXT NOT NULL DEFAULT '',
 custom_from TEXT NOT NULL DEFAULT '',
 account_id TEXT NOT NULL DEFAULT '',
 credentials_encrypted TEXT,
 revision TEXT NOT NULL,
 verified_revision TEXT,
 updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE mail_test_deliveries (
 company_id TEXT NOT NULL REFERENCES companies(id),
 request_id TEXT NOT NULL,
 actor_id TEXT NOT NULL REFERENCES users(id),
 recipient TEXT NOT NULL,
 sender TEXT NOT NULL,
 mode TEXT NOT NULL CHECK(mode IN ('standard','custom')),
 status TEXT NOT NULL CHECK(status IN ('uncertain','accepted','preview','rejected')),
 receipt TEXT,
 created_at INTEGER NOT NULL,
 PRIMARY KEY(company_id,request_id)
);
CREATE INDEX mail_test_rate ON mail_test_deliveries(company_id,created_at);
