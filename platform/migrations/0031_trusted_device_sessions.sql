-- "Stol på denne enhed": a trusted session stays signed in for 30 days and ends after 7 days
-- without use; other sessions keep the 30-minute idle limit. Additive only.
ALTER TABLE customer_sessions ADD COLUMN idle_seconds INTEGER NOT NULL DEFAULT 1800 CHECK(idle_seconds IN (1800,604800));
