-- The bell lists and counts failed runs every minute per open portal; without this it scans the webshop's whole
-- run log. The second index lets the daily cleanup find old runs without a full scan. Additive only.
CREATE INDEX operation_runs_failed ON operation_runs(company_id,webshop_id,started_at) WHERE status='failed';
CREATE INDEX operation_runs_started ON operation_runs(started_at);
