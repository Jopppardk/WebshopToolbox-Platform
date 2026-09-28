-- Append-only record history; never stores source payloads, credentials or mail bodies.
CREATE TABLE record_events (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 company_id TEXT NOT NULL, webshop_id TEXT NOT NULL, provider TEXT NOT NULL,
 module TEXT NOT NULL, external_id TEXT NOT NULL, event TEXT NOT NULL,
 at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 details_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(details_json)),
 FOREIGN KEY(company_id,webshop_id) REFERENCES webshops(company_id,id)
);
CREATE INDEX record_events_scope ON record_events(company_id,webshop_id,provider,module,external_id,id);
CREATE TRIGGER record_operation_snapshots_insert AFTER INSERT ON operation_snapshots 
BEGIN INSERT INTO record_events(company_id,webshop_id,provider,module,external_id,event)
VALUES(NEW.company_id,NEW.webshop_id,'shopify',NEW.module,NEW.external_id,'imported'); END;
CREATE TRIGGER record_operation_snapshots_update AFTER UPDATE ON operation_snapshots WHEN OLD.payload_json != NEW.payload_json
BEGIN INSERT INTO record_events(company_id,webshop_id,provider,module,external_id,event)
VALUES(NEW.company_id,NEW.webshop_id,'shopify',NEW.module,NEW.external_id,'source_changed'); END;
CREATE TRIGGER record_payment_records_insert AFTER INSERT ON payment_records 
BEGIN INSERT INTO record_events(company_id,webshop_id,provider,module,external_id,event)
VALUES(NEW.company_id,NEW.webshop_id,NEW.provider,NEW.kind,NEW.external_id,'imported'); END;
CREATE TRIGGER record_payment_records_update AFTER UPDATE ON payment_records WHEN OLD.payload_json != NEW.payload_json
BEGIN INSERT INTO record_events(company_id,webshop_id,provider,module,external_id,event)
VALUES(NEW.company_id,NEW.webshop_id,NEW.provider,NEW.kind,NEW.external_id,'source_changed'); END;
CREATE TRIGGER record_receipt_insert AFTER INSERT ON production_receipts
BEGIN INSERT INTO record_events(company_id,webshop_id,provider,module,external_id,event,details_json)
VALUES(NEW.company_id,NEW.webshop_id,NEW.provider,NEW.module,NEW.external_id,'receipt.'||NEW.phase,
json_object('destination',NEW.destination,'guid',json_extract(NEW.payload_json,'$.guid'),
'voucherNumber',json_extract(NEW.payload_json,'$.voucherNumber'),'fileGuid',json_extract(NEW.payload_json,'$.voucher.FileGuid'),
'reference',json_extract(NEW.payload_json,'$.voucher.ExternalReference'),
'messageId',CASE WHEN NEW.provider='invoice' AND substr(COALESCE(json_extract(NEW.payload_json,'$.receipt'),''),1,1)!='{' THEN json_extract(NEW.payload_json,'$.receipt') END)); END;
CREATE TRIGGER record_receipt_update AFTER UPDATE ON production_receipts
BEGIN INSERT INTO record_events(company_id,webshop_id,provider,module,external_id,event,details_json)
VALUES(NEW.company_id,NEW.webshop_id,NEW.provider,NEW.module,NEW.external_id,'receipt.'||NEW.phase,
json_object('destination',NEW.destination,'guid',json_extract(NEW.payload_json,'$.guid'),
'voucherNumber',json_extract(NEW.payload_json,'$.voucherNumber'),'fileGuid',json_extract(NEW.payload_json,'$.voucher.FileGuid'),
'reference',json_extract(NEW.payload_json,'$.voucher.ExternalReference'),
'messageId',CASE WHEN NEW.provider='invoice' AND substr(COALESCE(json_extract(NEW.payload_json,'$.receipt'),''),1,1)!='{' THEN json_extract(NEW.payload_json,'$.receipt') END)); END;
CREATE TRIGGER record_invoice_insert AFTER INSERT ON platform_invoices

BEGIN INSERT INTO record_events(company_id,webshop_id,provider,module,external_id,event,details_json)
VALUES(NEW.company_id,NEW.webshop_id,'shopify','orders',NEW.external_id,'invoice.'||NEW.status,json_object('documentId',NEW.id)); END;
CREATE TRIGGER record_invoice_update AFTER UPDATE ON platform_invoices
WHEN OLD.status!=NEW.status
BEGIN INSERT INTO record_events(company_id,webshop_id,provider,module,external_id,event,details_json)
VALUES(NEW.company_id,NEW.webshop_id,'shopify','orders',NEW.external_id,'invoice.'||NEW.status,json_object('documentId',NEW.id)); END;
CREATE TRIGGER record_report_insert AFTER INSERT ON platform_payout_documents

BEGIN INSERT INTO record_events(company_id,webshop_id,provider,module,external_id,event,details_json)
VALUES(NEW.company_id,NEW.webshop_id,'shopify','payouts',NEW.external_id,'report.'||NEW.status,json_object('documentId',NEW.id)); END;
CREATE TRIGGER record_report_update AFTER UPDATE ON platform_payout_documents
WHEN OLD.status!=NEW.status
BEGIN INSERT INTO record_events(company_id,webshop_id,provider,module,external_id,event,details_json)
VALUES(NEW.company_id,NEW.webshop_id,'shopify','payouts',NEW.external_id,'report.'||NEW.status,json_object('documentId',NEW.id)); END;
