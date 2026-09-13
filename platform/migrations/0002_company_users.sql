-- Fail rather than choose an owner if an existing user belongs to multiple companies.
CREATE UNIQUE INDEX one_company_per_user ON company_memberships(user_id);
ALTER TABLE users ADD COLUMN company_id TEXT REFERENCES companies(id);
UPDATE users SET company_id=(SELECT company_id FROM company_memberships m WHERE m.user_id=users.id);
-- Validate existing administrator assignments without discarding any data.
CREATE TABLE validate_admin_ownership (valid INTEGER CHECK(valid=1));
INSERT INTO validate_admin_ownership SELECT 0 FROM users u JOIN platform_admins a ON a.user_id=u.id WHERE u.company_id IS NOT NULL;
DROP TABLE validate_admin_ownership;
CREATE TRIGGER immutable_user_company BEFORE UPDATE OF company_id ON users
WHEN OLD.company_id IS NOT NEW.company_id
BEGIN SELECT RAISE(ABORT,'User company cannot change'); END;
CREATE TRIGGER company_member_owner_insert BEFORE INSERT ON company_memberships
WHEN NOT EXISTS(SELECT 1 FROM users u WHERE u.id=NEW.user_id AND u.company_id=NEW.company_id)
BEGIN SELECT RAISE(ABORT,'Company membership must match user owner'); END;
CREATE TRIGGER company_member_owner_update BEFORE UPDATE ON company_memberships
WHEN NOT EXISTS(SELECT 1 FROM users u WHERE u.id=NEW.user_id AND u.company_id=NEW.company_id)
BEGIN SELECT RAISE(ABORT,'Company membership must match user owner'); END;
CREATE TRIGGER portal_admin_owner BEFORE INSERT ON platform_admins
WHEN EXISTS(SELECT 1 FROM users WHERE id=NEW.user_id AND company_id IS NOT NULL)
BEGIN SELECT RAISE(ABORT,'Company users cannot be portal administrators'); END;
