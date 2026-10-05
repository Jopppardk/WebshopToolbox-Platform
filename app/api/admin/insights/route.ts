import { NextResponse } from 'next/server';
import { prepareDatabase } from '@/db/database';

const tenant = 'sablen.dk';
const pageSize = 100;
const day = 24 * 60 * 60 * 1000;

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const page = Number(params.get('page') || 1);
  const status = params.get('status') || '';
  const now = Date.now();
  const until = params.get('until') || new Date(now).toISOString();
  const timestamp = Date.parse(until);
  if (!Number.isSafeInteger(page) || page < 1 || page > 100000 || !['', 'running', 'succeeded', 'failed', 'skipped'].includes(status) ||
      !Number.isFinite(timestamp) || new Date(timestamp).toISOString() !== until || timestamp > now || timestamp < now - day) {
    return NextResponse.json({ error: 'Ugyldigt filter eller tidsvindue. Opdatér jobhistorikken.' }, { status: 400 });
  }
  try {
    const db = await prepareDatabase(), since = new Date(timestamp - day).toISOString();
    const where = 'tenant=? AND started_at>=? AND started_at<=? AND (?=\'\' OR status=?)';
    const [runs, total, counts, latest] = await Promise.all([
      db.prepare(`SELECT id,job_key,job_name,status,started_at,finished_at,duration_ms,message
        FROM job_runs WHERE ${where} ORDER BY started_at DESC,id DESC LIMIT ? OFFSET ?`)
        .bind(tenant,since,until,status,status,pageSize,(page-1)*pageSize).all(),
      db.prepare(`SELECT COUNT(*) total FROM job_runs WHERE ${where}`)
        .bind(tenant,since,until,status,status).first<{ total: number }>(),
      db.prepare(`SELECT COUNT(*) total,
        COALESCE(SUM(CASE WHEN status='succeeded' THEN 1 ELSE 0 END),0) succeeded,
        COALESCE(SUM(CASE WHEN status='failed' THEN 1 ELSE 0 END),0) failed,
        COALESCE(SUM(CASE WHEN status='skipped' THEN 1 ELSE 0 END),0) skipped,
        COALESCE(SUM(CASE WHEN status='running' THEN 1 ELSE 0 END),0) running
        FROM job_runs WHERE tenant=? AND started_at>=? AND started_at<=?`).bind(tenant,since,until).first(),
      db.prepare(`SELECT id,job_key,job_name,status,started_at,finished_at,duration_ms,message FROM (
        SELECT id,job_key,job_name,status,started_at,finished_at,duration_ms,message,
        ROW_NUMBER() OVER (PARTITION BY job_key ORDER BY started_at DESC,id DESC) position
        FROM job_runs WHERE tenant=?) WHERE position=1 ORDER BY job_name`).bind(tenant).all(),
    ]);
    const summary = counts || { total: 0, succeeded: 0, failed: 0, skipped: 0, running: 0 };
    return NextResponse.json({ summary, latest: latest.results, runs: runs.results,
      pagination: { page, pageSize, total: total?.total || 0, until, since } }, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return NextResponse.json({ error: 'Jobindsigten kunne ikke indlæses.' }, { status: 503 });
  }
}
