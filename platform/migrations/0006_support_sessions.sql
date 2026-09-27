CREATE TABLE support_sessions (
 id TEXT PRIMARY KEY,
 token_hash TEXT NOT NULL UNIQUE,
 admin_id TEXT NOT NULL REFERENCES users(id),
 user_id TEXT NOT NULL REFERENCES users(id),
 company_id TEXT NOT NULL REFERENCES companies(id),
 reason TEXT NOT NULL,
 expires_at INTEGER NOT NULL,
 revoked INTEGER NOT NULL DEFAULT 0 CHECK(revoked IN (0,1)),
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX support_admin ON support_sessions(admin_id,revoked);
