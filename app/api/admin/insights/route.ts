import { NextResponse } from 'next/server';
import { prepareDatabase } from '@/db/database';

const tenant = 'sablen.dk';

export async function GET() {
  try {
    const db = await prepareDatabase(), since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const [runs, counts, latest] = await Promise.all([
      db.prepare(`SELECT id,job_key,job_name,status,started_at,finished_at,duration_ms,message
        FROM job_runs WHERE tenant=? ORDER BY started_at DESC LIMIT 100`).bind(tenant).all(),
      db.prepare(`SELECT COUNT(*) total,
        SUM(CASE WHEN status='succeeded' THEN 1 ELSE 0 END) succeeded,
        SUM(CASE WHEN status='failed' THEN 1 ELSE 0 END) failed,
        SUM(CASE WHEN status='skipped' THEN 1 ELSE 0 END) skipped,
        SUM(CASE WHEN status='running' THEN 1 ELSE 0 END) running
        FROM job_runs WHERE tenant=? AND started_at>=?`).bind(tenant,since).first(),
      db.prepare(`SELECT id,job_key,job_name,status,started_at,finished_at,duration_ms,message FROM (
        SELECT id,job_key,job_name,status,started_at,finished_at,duration_ms,message,
        ROW_NUMBER() OVER (PARTITION BY job_key ORDER BY started_at DESC) position
        FROM job_runs WHERE tenant=?) WHERE position=1 ORDER BY job_name`).bind(tenant).all(),
    ]);
    const summary = counts || { total: 0, succeeded: 0, failed: 0, skipped: 0, running: 0 };
    return NextResponse.json({ summary, latest: latest.results, runs: runs.results }, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return NextResponse.json({ error: 'Jobindsigten kunne ikke indlæses.' }, { status: 503 });
  }
}
