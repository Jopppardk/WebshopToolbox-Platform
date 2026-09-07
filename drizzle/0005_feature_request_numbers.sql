CREATE TABLE IF NOT EXISTS feature_request_numbers (
  tenant TEXT NOT NULL,
  feature_request_id TEXT NOT NULL,
  reference_number INTEGER NOT NULL,
  PRIMARY KEY (tenant, feature_request_id),
  UNIQUE (tenant, reference_number)
);
PRAGMA optimize;
