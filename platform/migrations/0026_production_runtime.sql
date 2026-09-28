-- Durable tenant-scoped receipts. Never purge these with source history.
CREATE TABLE production_receipts (
 company_id TEXT NOT NULL, webshop_id TEXT NOT NULL, provider TEXT NOT NULL,
 module TEXT NOT NULL, external_id TEXT NOT NULL, destination TEXT NOT NULL,
 phase TEXT NOT NULL CHECK(phase IN ('prepared','creating','draft','booking','booked','sending','accepted','uncertain')),
 version TEXT NOT NULL, payload_json TEXT NOT NULL,
 updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY(company_id,webshop_id,provider,module,external_id,destination),
 FOREIGN KEY(company_id,webshop_id) REFERENCES webshops(company_id,id)
);


-- Serialize reconciliation and creation at the database boundary. Either the
-- checked existing voucher or the production claim wins, never both.
CREATE TRIGGER production_claim_requires_unreconciled
BEFORE UPDATE OF phase ON production_receipts
WHEN NEW.phase='creating' AND OLD.phase='prepared' AND EXISTS (
 SELECT 1 FROM accounting_reconciliations r WHERE r.company_id=NEW.company_id
 AND r.webshop_id=NEW.webshop_id AND r.provider=NEW.provider AND r.module=NEW.module
 AND r.external_id=NEW.external_id AND r.organization_id=NEW.destination
)
BEGIN SELECT RAISE(ABORT,'Posten er allerede afstemt'); END;
CREATE TRIGGER reconciliation_requires_no_production_claim
BEFORE INSERT ON accounting_reconciliations
WHEN EXISTS (SELECT 1 FROM production_receipts r WHERE r.company_id=NEW.company_id
 AND r.webshop_id=NEW.webshop_id AND r.provider=NEW.provider AND r.module=NEW.module
 AND r.external_id=NEW.external_id AND r.destination=NEW.organization_id AND r.phase!='prepared')
BEGIN SELECT RAISE(ABORT,'Posten behandles allerede'); END;
