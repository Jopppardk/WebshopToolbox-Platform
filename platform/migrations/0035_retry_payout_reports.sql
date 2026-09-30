-- Payout report failures now name the payout and the reason, but only on the first failure.
-- Failures recorded before that change carried no reason; retry them once so the bell explains them.
-- Only retry scheduling changes; no report, payout or bookkeeping data is touched.
UPDATE production_attempts SET failures=0,next_attempt_at=0 WHERE job='reports';
