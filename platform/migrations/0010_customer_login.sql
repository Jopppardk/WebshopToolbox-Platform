CREATE TABLE customer_login_challenges (
 id TEXT PRIMARY KEY, user_id TEXT REFERENCES users(id), code_hash TEXT NOT NULL,
 browser_hash TEXT NOT NULL, invitation_id TEXT REFERENCES invitations(id), invitation_hash TEXT,
 expires_at INTEGER NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, consumed INTEGER NOT NULL DEFAULT 0,
 claim_id TEXT, delivery TEXT NOT NULL DEFAULT 'pending'
);
CREATE INDEX customer_login_expiry ON customer_login_challenges(expires_at);
CREATE TABLE customer_sessions (
 token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id),
 expires_at INTEGER NOT NULL, last_seen INTEGER NOT NULL, created_at INTEGER NOT NULL
);
CREATE INDEX customer_session_user ON customer_sessions(user_id);
CREATE TABLE customer_login_limits (key TEXT PRIMARY KEY, count INTEGER NOT NULL, expires_at INTEGER NOT NULL);
CREATE TRIGGER revoke_customer_sessions AFTER UPDATE OF status,email ON users
WHEN OLD.status='active' OR OLD.email<>NEW.email
BEGIN
 DELETE FROM customer_sessions WHERE user_id=NEW.id;
 DELETE FROM customer_login_challenges WHERE user_id=NEW.id;
END;
CREATE TRIGGER revoke_company_sessions AFTER UPDATE OF status ON companies
BEGIN
 DELETE FROM customer_sessions WHERE user_id IN (SELECT id FROM users WHERE company_id=NEW.id);
 DELETE FROM customer_login_challenges WHERE user_id IN (SELECT id FROM users WHERE company_id=NEW.id);
END;
