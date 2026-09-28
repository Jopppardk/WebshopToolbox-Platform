CREATE TABLE welcome_template (
 id INTEGER PRIMARY KEY CHECK(id=1), subject TEXT NOT NULL, body TEXT NOT NULL,
 version INTEGER NOT NULL DEFAULT 1
);
INSERT INTO welcome_template(id,subject,body) VALUES(1,'Velkommen til WebshopToolbox',
'Hej {{name}}

Velkommen til WebshopToolbox. Færdiggør tilmeldingen for {{company}} her:

{{link}}

Du har 3 måneders gratis abonnement fra den dag, du aktiverer din adgang. Vi kontakter virksomheden i god tid inden udløb.

Der opkræves ikke automatisk betaling. Et betalt abonnement kræver dit udtrykkelige tilvalg.

Venlig hilsen
WebshopToolbox');
CREATE TABLE public_signups (
 company_id TEXT PRIMARY KEY REFERENCES companies(id),
 user_id TEXT NOT NULL UNIQUE REFERENCES users(id),
 cvr TEXT NOT NULL UNIQUE CHECK(length(cvr)=8),
 terms_version TEXT NOT NULL, accepted_at INTEGER NOT NULL,
 trial_started_at INTEGER, trial_ends_at INTEGER, contact_due_at INTEGER,
 contacted_at INTEGER,
 template_version INTEGER NOT NULL
);
-- The trial begins once, on verified invitation acceptance, never on an anonymous request.
CREATE TRIGGER signup_trial_start AFTER UPDATE OF status ON users
WHEN NEW.status='active' AND OLD.status='inactive'
BEGIN
 UPDATE public_signups SET trial_started_at=unixepoch(),
 trial_ends_at=unixepoch(datetime('now','+3 months','floor')),
 contact_due_at=unixepoch(datetime('now','+3 months','floor','-14 days'))
 WHERE user_id=NEW.id AND trial_started_at IS NULL;
END;
