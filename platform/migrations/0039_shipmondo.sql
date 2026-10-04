-- Tracking only. Credentials and webhook identities belong to a single webshop.
CREATE TABLE shipping_connections (
 company_id TEXT NOT NULL, webshop_id TEXT NOT NULL, provider TEXT NOT NULL CHECK(provider='shipmondo'),
 credentials_encrypted TEXT NOT NULL, revision TEXT NOT NULL, webhook_id TEXT NOT NULL UNIQUE,
 webhook_secret_encrypted TEXT NOT NULL, verified_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 last_event_at TEXT, PRIMARY KEY(company_id,webshop_id,provider),
 FOREIGN KEY(company_id,webshop_id) REFERENCES webshops(company_id,id)
);
CREATE TABLE shipping_events (
 company_id TEXT NOT NULL, webshop_id TEXT NOT NULL, provider TEXT NOT NULL DEFAULT 'shipmondo',
 event_id TEXT NOT NULL, shipment_id TEXT NOT NULL, tracking_number TEXT NOT NULL, carrier TEXT NOT NULL,
 occurred_at TEXT NOT NULL, status TEXT NOT NULL, status_text TEXT NOT NULL, state TEXT NOT NULL,
 received_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY(company_id,webshop_id,provider,event_id),
 FOREIGN KEY(company_id,webshop_id,provider) REFERENCES shipping_connections(company_id,webshop_id,provider) ON DELETE CASCADE
);
CREATE INDEX shipping_events_tracking ON shipping_events(company_id,webshop_id,carrier,tracking_number,occurred_at);
