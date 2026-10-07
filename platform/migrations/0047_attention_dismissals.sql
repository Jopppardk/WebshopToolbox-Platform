-- "Afvis" in Kræver handling (platform/attention.ts): a post the customer has checked and wants off the list. Who
-- and when are kept, and the title as it was shown, for "Vis afviste" and "Fortryd". job is the automatic job the
-- post belongs to (for uncertain posts provider.module); the dismissal also stops that job's automatic attempts
-- for the post until it is restored. Additive only.
CREATE TABLE attention_dismissals (
 company_id TEXT NOT NULL, webshop_id TEXT NOT NULL,
 kind TEXT NOT NULL CHECK(kind IN ('failed','uncertain','market','waiting')),
 job TEXT NOT NULL, external_id TEXT NOT NULL,
 title TEXT NOT NULL DEFAULT '', dismissed_by TEXT NOT NULL,
 dismissed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY(company_id,webshop_id,kind,job,external_id),
 FOREIGN KEY(company_id,webshop_id) REFERENCES webshops(company_id,id)
);
