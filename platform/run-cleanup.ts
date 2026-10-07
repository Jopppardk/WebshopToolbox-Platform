// The run log (operation_runs) gets a row for every job step and processed post, so it grows every five minutes.
// Two things keep it small:
// - collapseRepeat: a successful run that changed nothing (count 0) replaces the job's previous run when that was
//   the same, so a quiet job is one row with a repeat count instead of one row per tick. Failures, runs that
//   imported or processed something, and the change between them are always kept.
// - cleanupRuns: runs older than 90 days are deleted in small batches on each scheduled tick; the posts' own
//   history (record_events, receipts) is kept. Cheap when there is nothing to delete (index operation_runs_started).
import type { PlatformEnv } from './types';

export const runRetentionDays = 90;
export async function cleanupRuns(env: PlatformEnv, batch = 500) {
  const db = env.PLATFORM_DB,
    older = `datetime('now','-${runRetentionDays} days')`;
  const old = `SELECT id FROM operation_runs WHERE started_at<${older} ORDER BY started_at LIMIT ${batch}`;
  const [, deleted] = await db.batch([
    db.prepare(
      `DELETE FROM operation_acknowledgements WHERE run_id IN (${old})`,
    ),
    db.prepare(`DELETE FROM operation_runs WHERE id IN (${old})`),
  ]);
  return deleted.meta.changes ?? 0;
}

// Call after a run is marked successful. Merges it with the job's previous run if both succeeded without changes
// (count 0, same message); returns true when they were merged.
export async function collapseRepeat(db: D1Database, runId: string) {
  const previous = await db
    .prepare(
      `SELECT p.id,p.repeats,COALESCE(p.first_started_at,p.started_at) since FROM operation_runs r
 JOIN operation_runs p ON p.id=(SELECT q.id FROM operation_runs q WHERE q.company_id=r.company_id AND q.webshop_id=r.webshop_id
  AND q.module=r.module AND q.id<>r.id AND q.started_at<=r.started_at ORDER BY q.started_at DESC,q.id DESC LIMIT 1)
 WHERE r.id=? AND r.status='success' AND r.count=0 AND p.status='success' AND p.count=0 AND p.message=r.message`,
    )
    .bind(runId)
    .first<{ id: string; repeats: number; since: string }>();
  if (!previous) return false;
  await db.batch([
    db
      .prepare(
        'UPDATE operation_runs SET repeats=repeats+?,first_started_at=? WHERE id=?',
      )
      .bind(previous.repeats, previous.since, runId),
    db.prepare('DELETE FROM operation_runs WHERE id=?').bind(previous.id),
  ]);
  return true;
}
