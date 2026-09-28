CREATE TABLE production_jobs (
 company_id TEXT NOT NULL, webshop_id TEXT NOT NULL, job TEXT NOT NULL,
 cursor_json TEXT NOT NULL DEFAULT '{}', next_run_at INTEGER NOT NULL DEFAULT 0,
 lease_owner TEXT, lease_until INTEGER NOT NULL DEFAULT 0,
 PRIMARY KEY(company_id,webshop_id,job),
 FOREIGN KEY(company_id,webshop_id) REFERENCES webshops(company_id,id)
);
CREATE TABLE production_attempts (
 company_id TEXT NOT NULL, webshop_id TEXT NOT NULL, job TEXT NOT NULL, external_id TEXT NOT NULL,
 attempted_at INTEGER NOT NULL, next_attempt_at INTEGER NOT NULL, failures INTEGER NOT NULL DEFAULT 0,
 PRIMARY KEY(company_id,webshop_id,job,external_id),
 FOREIGN KEY(company_id,webshop_id) REFERENCES webshops(company_id,id)
);

CREATE TRIGGER production_claim_requires_current_configuration
BEFORE UPDATE OF phase ON production_receipts
WHEN NEW.phase IN ('creating','booking') AND OLD.phase IN ('prepared','draft')
 AND json_extract(NEW.payload_json,'$.connectionRevision') IS NOT NULL
 AND (NOT EXISTS(SELECT 1 FROM accounting_connections c WHERE c.company_id=NEW.company_id
 AND c.organization_id=NEW.destination AND c.revision=json_extract(NEW.payload_json,'$.connectionRevision'))
 OR NOT EXISTS(SELECT 1 FROM tier1_preferences p WHERE p.company_id=NEW.company_id AND p.webshop_id=NEW.webshop_id
 AND p.revision=json_extract(NEW.payload_json,'$.preferencesRevision'))
 OR NOT EXISTS(SELECT 1 FROM accounting_mapping m WHERE m.company_id=NEW.company_id
 AND m.accounts_json=json_extract(NEW.payload_json,'$.mappingJson')))
BEGIN SELECT RAISE(ABORT,'Opsaetningen er aendret under kontrollen'); END;
