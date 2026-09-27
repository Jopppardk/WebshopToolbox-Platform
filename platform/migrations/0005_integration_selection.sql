CREATE TABLE company_integrations (
 company_id TEXT NOT NULL REFERENCES companies(id),
 integration_id TEXT NOT NULL CHECK(integration_id IN ('flatpay','viabill','emballage')),
 PRIMARY KEY(company_id,integration_id)
);
