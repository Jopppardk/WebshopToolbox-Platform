-- Consecutive successful runs of the same job without changes are kept as one row (platform/run-cleanup.ts,
-- collapseRepeat): repeats counts them and first_started_at is when the streak began. Before this every
-- five-minute tick added a row per job, about 4,200 a day for one webshop. The index finds a job's previous run.
-- Additive only; existing rows count as one run each.
ALTER TABLE operation_runs ADD COLUMN repeats INTEGER NOT NULL DEFAULT 1;
ALTER TABLE operation_runs ADD COLUMN first_started_at TEXT;
CREATE INDEX operation_runs_module ON operation_runs(company_id,webshop_id,module,started_at);
