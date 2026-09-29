-- Integration providers are defined once in platform/catalog.ts and validated there.
-- The fixed provider lists in these CHECK constraints are removed so a new integration
-- no longer needs a migration. Columns, keys, indexes and data are otherwise unchanged.
-- Apply only after a Cloudflare Time Travel restore point (see docs/platform/PROVIDER-REGISTRY.md).
PRAGMA defer_foreign_keys = true;

-- References payment_connections and booking_start_dates; recreated unchanged below.
DROP TRIGGER production_claim_requires_current_configuration;

CREATE TABLE payment_connections_next (
 company_id TEXT NOT NULL, webshop_id TEXT NOT NULL, provider TEXT NOT NULL CHECK(provider GLOB '[a-z]*' AND length(provider)<=40),
 identity TEXT NOT NULL, metadata_json TEXT NOT NULL, credentials_encrypted TEXT NOT NULL,
 start_date TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 1, verified_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY(company_id,webshop_id,provider), UNIQUE(provider,identity),
 FOREIGN KEY(company_id,webshop_id) REFERENCES webshops(company_id,id)
);
INSERT INTO payment_connections_next(company_id,webshop_id,provider,identity,metadata_json,credentials_encrypted,start_date,revision,verified_at)
 SELECT company_id,webshop_id,provider,identity,metadata_json,credentials_encrypted,start_date,revision,verified_at FROM payment_connections;

-- payment_records references payment_connections. Dropping the parent while children point
-- at it leaves deferred FK violations that a rename does not clear, so the child is rebuilt
-- against the new parent first. Renaming the parent then rewrites that reference.
CREATE TABLE payment_records_next (
 company_id TEXT NOT NULL, webshop_id TEXT NOT NULL, provider TEXT NOT NULL, kind TEXT NOT NULL,
 external_id TEXT NOT NULL, occurred_at TEXT NOT NULL, payload_json TEXT NOT NULL,
 paid INTEGER NOT NULL DEFAULT 0 CHECK(paid IN (0,1)), imported_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY(company_id,webshop_id,provider,kind,external_id),
 FOREIGN KEY(company_id,webshop_id,provider) REFERENCES payment_connections_next(company_id,webshop_id,provider)
);
INSERT INTO payment_records_next(company_id,webshop_id,provider,kind,external_id,occurred_at,payload_json,paid,imported_at)
 SELECT company_id,webshop_id,provider,kind,external_id,occurred_at,payload_json,paid,imported_at FROM payment_records;
DROP TABLE payment_records;
DROP TABLE payment_connections;
ALTER TABLE payment_connections_next RENAME TO payment_connections;
ALTER TABLE payment_records_next RENAME TO payment_records;
CREATE INDEX payment_records_period ON payment_records(company_id,webshop_id,provider,kind,occurred_at);
CREATE TRIGGER record_payment_records_insert AFTER INSERT ON payment_records
BEGIN INSERT INTO record_events(company_id,webshop_id,provider,module,external_id,event)
VALUES(NEW.company_id,NEW.webshop_id,NEW.provider,NEW.kind,NEW.external_id,'imported'); END;
CREATE TRIGGER record_payment_records_update AFTER UPDATE ON payment_records WHEN OLD.payload_json != NEW.payload_json
BEGIN INSERT INTO record_events(company_id,webshop_id,provider,module,external_id,event)
VALUES(NEW.company_id,NEW.webshop_id,NEW.provider,NEW.kind,NEW.external_id,'source_changed'); END;

CREATE TABLE company_integrations_next (
 company_id TEXT NOT NULL REFERENCES companies(id),
 integration_id TEXT NOT NULL CHECK(integration_id GLOB '[a-z]*' AND length(integration_id)<=40),
 PRIMARY KEY(company_id,integration_id)
);
INSERT INTO company_integrations_next(company_id,integration_id) SELECT company_id,integration_id FROM company_integrations;
DROP TABLE company_integrations;
ALTER TABLE company_integrations_next RENAME TO company_integrations;

CREATE TABLE integration_history_next (
 company_id TEXT NOT NULL REFERENCES companies(id),
 scope TEXT NOT NULL DEFAULT '',
 provider TEXT NOT NULL CHECK(provider GLOB '[a-z]*' AND length(provider)<=40),
 start_date TEXT NOT NULL DEFAULT '',
 months INTEGER NOT NULL DEFAULT 24 CHECK(months BETWEEN 1 AND 120),
 revision INTEGER NOT NULL DEFAULT 1,
 PRIMARY KEY(company_id,scope,provider)
);
INSERT INTO integration_history_next(company_id,scope,provider,start_date,months,revision)
 SELECT company_id,scope,provider,start_date,months,revision FROM integration_history;
DROP TABLE integration_history;
ALTER TABLE integration_history_next RENAME TO integration_history;

CREATE TABLE booking_start_dates_next (
 company_id TEXT NOT NULL, webshop_id TEXT NOT NULL,
 provider TEXT NOT NULL CHECK(provider GLOB '[a-z]*' AND length(provider)<=40),
 start_date TEXT NOT NULL DEFAULT '', revision INTEGER NOT NULL DEFAULT 1,
 PRIMARY KEY(company_id,webshop_id,provider),
 FOREIGN KEY(company_id,webshop_id) REFERENCES webshops(company_id,id)
);
INSERT INTO booking_start_dates_next(company_id,webshop_id,provider,start_date,revision)
 SELECT company_id,webshop_id,provider,start_date,revision FROM booking_start_dates;
DROP TABLE booking_start_dates;
ALTER TABLE booking_start_dates_next RENAME TO booking_start_dates;

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
