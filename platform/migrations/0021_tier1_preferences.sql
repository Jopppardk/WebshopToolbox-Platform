CREATE TABLE tier1_preferences (
  company_id TEXT NOT NULL,
  webshop_id TEXT NOT NULL,
  preferences_json TEXT NOT NULL,
  revision TEXT NOT NULL,
  PRIMARY KEY(company_id,webshop_id),
  FOREIGN KEY(company_id,webshop_id) REFERENCES webshops(company_id,id)
);
