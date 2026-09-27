CREATE UNIQUE INDEX unique_user_email ON users(lower(email));
ALTER TABLE users ADD COLUMN full_name TEXT;
ALTER TABLE users ADD COLUMN phone TEXT;
CREATE TABLE invitations (
 id TEXT PRIMARY KEY,
 user_id TEXT NOT NULL UNIQUE REFERENCES users(id),
 token_hash TEXT NOT NULL UNIQUE,
 expires_at INTEGER NOT NULL,
 state TEXT NOT NULL CHECK(state IN ('pending','accepted','revoked')) DEFAULT 'pending',
 delivery TEXT NOT NULL CHECK(delivery IN ('pending','sent','uncertain','preview')) DEFAULT 'pending',
 claim_id TEXT,
 created_by TEXT NOT NULL REFERENCES users(id),
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TRIGGER last_company_admin_status BEFORE UPDATE OF status ON users
WHEN OLD.status='active' AND NEW.status='inactive'
 AND EXISTS(SELECT 1 FROM company_memberships WHERE user_id=OLD.id AND role='admin')
 AND (SELECT count(*) FROM company_memberships m JOIN users u ON u.id=m.user_id WHERE m.company_id=OLD.company_id AND m.role='admin' AND u.status='active')=1
BEGIN SELECT RAISE(ABORT,'LAST_COMPANY_ADMIN'); END;
CREATE TRIGGER last_company_admin_role BEFORE UPDATE OF role ON company_memberships
WHEN OLD.role='admin' AND NEW.role<>'admin'
 AND EXISTS(SELECT 1 FROM users WHERE id=OLD.user_id AND status='active')
 AND (SELECT count(*) FROM company_memberships m JOIN users u ON u.id=m.user_id WHERE m.company_id=OLD.company_id AND m.role='admin' AND u.status='active')=1
BEGIN SELECT RAISE(ABORT,'LAST_COMPANY_ADMIN'); END;
CREATE TRIGGER last_company_admin_delete BEFORE DELETE ON company_memberships
WHEN OLD.role='admin' AND EXISTS(SELECT 1 FROM users WHERE id=OLD.user_id AND status='active')
 AND (SELECT count(*) FROM company_memberships m JOIN users u ON u.id=m.user_id WHERE m.company_id=OLD.company_id AND m.role='admin' AND u.status='active')=1
BEGIN SELECT RAISE(ABORT,'LAST_COMPANY_ADMIN'); END;
