-- Trustpilot-invitationer (Tools → Anmeldelser): the webshop's own review invitation mails instead of
-- Trustpilot's automatic invitations. One template per language (Danish, Swedish) with its own delay, the
-- images uploaded for the mails, and one row per order that was invited (or deliberately skipped), so an
-- order is mailed at most once and an uncertain send is never repeated. Additive only.
CREATE TABLE review_invitation_settings (
 company_id TEXT NOT NULL,
 webshop_id TEXT NOT NULL,
 enabled INTEGER NOT NULL DEFAULT 0 CHECK(enabled IN (0,1)),
 -- When invitations were switched on: only orders shipped from then on are invited, never the history.
 start_at TEXT,
 templates_json TEXT NOT NULL CHECK(json_valid(templates_json)),
 revision INTEGER NOT NULL DEFAULT 1,
 updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY(company_id,webshop_id),
 FOREIGN KEY(company_id,webshop_id) REFERENCES webshops(company_id,id)
);
CREATE TABLE review_invitations (
 company_id TEXT NOT NULL,
 webshop_id TEXT NOT NULL,
 external_id TEXT NOT NULL,
 order_name TEXT NOT NULL,
 locale TEXT CHECK(locale IS NULL OR locale IN ('da','sv')),
 recipient TEXT,
 sender TEXT,
 status TEXT NOT NULL CHECK(status IN ('sending','sent','uncertain','skipped')),
 reason TEXT,
 receipt TEXT,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 sent_at TEXT,
 PRIMARY KEY(company_id,webshop_id,external_id),
 FOREIGN KEY(company_id,webshop_id) REFERENCES webshops(company_id,id)
);
CREATE INDEX review_invitations_recent ON review_invitations(company_id,webshop_id,created_at);
-- Images in the mails are served publicly at /mail-images/{id} (mail clients fetch them without a login);
-- the id is random and the file lives in R2 under the company and webshop.
CREATE TABLE review_mail_images (
 id TEXT PRIMARY KEY CHECK(length(id)=32 AND id NOT GLOB '*[^a-f0-9]*'),
 company_id TEXT NOT NULL,
 webshop_id TEXT NOT NULL,
 r2_key TEXT NOT NULL,
 content_type TEXT NOT NULL CHECK(content_type IN ('image/png','image/jpeg','image/gif','image/webp')),
 bytes INTEGER NOT NULL,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY(company_id,webshop_id) REFERENCES webshops(company_id,id)
);
CREATE INDEX review_mail_images_shop ON review_mail_images(company_id,webshop_id);
