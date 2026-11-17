-- Cloudflare E-mail as an integration (Integrationer → Cloudflare E-mail): one Cloudflare account and API token per
-- company, and the domains approved for sending from it. Faktura-afsendelse, Trustpilot-invitationer and later
-- features only choose an address and a name on one of these domains. The older per-sender credentials
-- (company_mail, webshop_mail, market_mail) are moved here by code the first time the company's connection is read,
-- because they are encrypted per address; they are kept unchanged as a fallback. Additive only.
CREATE TABLE mail_connections (
 company_id TEXT PRIMARY KEY REFERENCES companies(id),
 account_id TEXT NOT NULL CHECK(length(account_id)=32 AND account_id NOT GLOB '*[^a-f0-9]*'),
 credentials_encrypted TEXT NOT NULL,
 revision TEXT NOT NULL,
 -- 'token': the token was checked with Cloudflare when saved; 'migrated': moved from an approved sender.
 source TEXT NOT NULL CHECK(source IN ('token','migrated')),
 -- Whether the token may list the account's sending domains (Zone read); otherwise domains are approved by a test mail.
 discovery INTEGER NOT NULL DEFAULT 0 CHECK(discovery IN (0,1)),
 updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE mail_domains (
 company_id TEXT NOT NULL REFERENCES mail_connections(company_id) ON DELETE CASCADE,
 domain TEXT NOT NULL CHECK(domain=lower(domain) AND length(domain) BETWEEN 3 AND 253),
 -- 'cloudflare': listed by Cloudflare as enabled for sending; 'test': a test mail from it was accepted; 'migrated'.
 source TEXT NOT NULL CHECK(source IN ('cloudflare','test','migrated')),
 verified_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY(company_id,domain)
);
