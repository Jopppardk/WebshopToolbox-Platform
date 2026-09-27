ALTER TABLE invoice_settings ADD COLUMN design_json TEXT NOT NULL DEFAULT '{}';
ALTER TABLE invoice_settings ADD COLUMN revision INTEGER NOT NULL DEFAULT 1;
