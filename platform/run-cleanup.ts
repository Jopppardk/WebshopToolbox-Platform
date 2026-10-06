// The run log (operation_runs) gets a row for every job step and processed post, so it grows every five minutes.
// Runs older than 90 days are deleted in small batches on each scheduled tick; the posts' own history
// (record_events, receipts) is kept. Cheap when there is nothing to delete (index operation_runs_started).
import type { PlatformEnv } from './types';

export const runRetentionDays = 90;
export async function cleanupRuns(env: PlatformEnv, batch = 500) {
  const db = env.PLATFORM_DB, older = `datetime('now','-${runRetentionDays} days')`;
  const old = `SELECT id FROM operation_runs WHERE started_at<${older} ORDER BY started_at LIMIT ${batch}`;
  const [, deleted] = await db.batch([
    db.prepare(`DELETE FROM operation_acknowledgements WHERE run_id IN (${old})`),
    db.prepare(`DELETE FROM operation_runs WHERE id IN (${old})`),
  ]);
  return deleted.meta.changes ?? 0;
}
