import { sanitizeDiagnostic } from '@/lib/diagnostics';
import { database } from './database';

export type JobOutcome = { status?: 'succeeded' | 'skipped'; message?: string } | void;

const safeMessage = (value: unknown, fallback: string) => {
  const text = value instanceof Error ? value.message : typeof value === 'string' ? value : fallback;
  return sanitizeDiagnostic(text, 500) || fallback;
};

export async function runTrackedJob(jobKey: string, jobName: string, task: () => Promise<JobOutcome>) {
  const db = database(), id = crypto.randomUUID(), started = Date.now(), startedAt = new Date(started).toISOString();
  await db.prepare('INSERT INTO job_runs(id,tenant,job_key,job_name,status,started_at) VALUES(?,?,?,?,?,?)')
    .bind(id, 'sablen.dk', jobKey, jobName, 'running', startedAt).run();
  try {
    const outcome = await task(), status = outcome?.status || 'succeeded', finished = Date.now();
    await db.prepare('UPDATE job_runs SET status=?,finished_at=?,duration_ms=?,message=? WHERE tenant=? AND id=?')
      .bind(status, new Date(finished).toISOString(), finished - started, safeMessage(outcome?.message, status === 'skipped' ? 'Jobbet blev sprunget over.' : 'Jobbet blev gennemført.'), 'sablen.dk', id).run();
    return outcome;
  } catch (error) {
    const finished = Date.now();
    await db.prepare('UPDATE job_runs SET status=?,finished_at=?,duration_ms=?,message=? WHERE tenant=? AND id=?')
      .bind('failed', new Date(finished).toISOString(), finished - started, safeMessage(error, 'Jobbet fejlede.'), 'sablen.dk', id).run();
    throw error;
  }
}
