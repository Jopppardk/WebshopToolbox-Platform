CREATE TABLE support_tickets (
 id TEXT PRIMARY KEY, company_id TEXT NOT NULL REFERENCES companies(id),
 created_by TEXT NOT NULL REFERENCES users(id), subject TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','waiting_customer','resolved')),
 priority TEXT NOT NULL DEFAULT 'normal' CHECK(priority IN ('normal','high')),
 version INTEGER NOT NULL DEFAULT 1,
 created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 UNIQUE(company_id,id)
);
CREATE INDEX support_tickets_queue ON support_tickets(status,updated_at);
CREATE INDEX support_tickets_company ON support_tickets(company_id,updated_at);
CREATE TABLE support_ticket_messages (
 id TEXT PRIMARY KEY, company_id TEXT NOT NULL, ticket_id TEXT NOT NULL,
 author_id TEXT NOT NULL REFERENCES users(id), author_kind TEXT NOT NULL CHECK(author_kind IN ('customer','support')),
 body TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 FOREIGN KEY(company_id,ticket_id) REFERENCES support_tickets(company_id,id)
);
CREATE INDEX support_ticket_thread ON support_ticket_messages(company_id,ticket_id,created_at);
