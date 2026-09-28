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
 AND m.accounts_json=json_extract(NEW.payload_json,'$.mappingJson'))
 OR (json_extract(NEW.payload_json,'$.paymentRevision') IS NOT NULL AND NOT EXISTS(SELECT 1 FROM payment_connections pc WHERE pc.company_id=NEW.company_id AND pc.webshop_id=NEW.webshop_id AND pc.provider=NEW.provider AND pc.revision=json_extract(NEW.payload_json,'$.paymentRevision')))
 OR (json_extract(NEW.payload_json,'$.bookingDates') IS NOT NULL AND (
 EXISTS(SELECT 1 FROM json_each(NEW.payload_json,'$.bookingDates') d WHERE NOT EXISTS(SELECT 1 FROM booking_start_dates b WHERE b.company_id=NEW.company_id AND b.webshop_id=NEW.webshop_id AND b.provider=json_extract(d.value,'$.provider') AND b.start_date=json_extract(d.value,'$.start_date')))
 OR (SELECT count(*) FROM booking_start_dates b WHERE b.company_id=NEW.company_id AND b.webshop_id=NEW.webshop_id)!=json_array_length(NEW.payload_json,'$.bookingDates'))))
BEGIN SELECT RAISE(ABORT,'Opsaetningen er aendret under kontrollen'); END;

CREATE TRIGGER stocktake_claim_requires_prepared
BEFORE UPDATE OF phase ON production_receipts
WHEN NEW.module='stocktake' AND NEW.phase='creating' AND OLD.phase='prepared'
 AND NOT EXISTS(SELECT 1 FROM stocktakes s WHERE s.company_id=NEW.company_id AND s.webshop_id=NEW.webshop_id AND s.id=NEW.external_id AND s.phase='prepared' AND s.version=json_extract(NEW.payload_json,'$.stocktakeVersion'))
BEGIN SELECT RAISE(ABORT,'Lagerforslaget er ændret'); END;
CREATE TRIGGER stocktake_preserves_production_claim
BEFORE UPDATE ON stocktakes
WHEN EXISTS(SELECT 1 FROM production_receipts r WHERE r.company_id=OLD.company_id AND r.webshop_id=OLD.webshop_id AND r.module='stocktake' AND r.external_id=OLD.id)
BEGIN SELECT RAISE(ABORT,'Lagerforslaget har en produktionskvittering'); END;
