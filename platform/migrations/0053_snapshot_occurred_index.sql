-- The automatic sales and invoice jobs look for due orders among those placed within the last 90 days
-- (production-jobs.ts, processRows) instead of reading every order on every run.
CREATE INDEX IF NOT EXISTS operation_snapshots_occurred ON operation_snapshots(company_id,webshop_id,module,occurred_at);
