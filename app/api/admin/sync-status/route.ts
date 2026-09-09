import { NextResponse } from 'next/server';
import { prepareDatabase } from '@/db/database';
import { cycleKey, type SyncCycle } from '@/db/sync-cycle';
import { normalizeSyncInterval, millisecondsToNextRun } from '@/lib/sync-schedule';

export async function GET() {
  try {
    const db = await prepareDatabase();
    const rows = await db.prepare('SELECT setting_key,setting_value FROM app_settings WHERE tenant=? AND setting_key IN (?,?)').bind('sablen.dk', 'admin_settings', cycleKey).all<{ setting_key: string; setting_value: string }>();
    const settings = rows.results.find(row => row.setting_key === 'admin_settings');
    const cycleRow = rows.results.find(row => row.setting_key === cycleKey);
    const cycle = cycleRow ? JSON.parse(cycleRow.setting_value) as SyncCycle : null;
    const intervalMinutes = normalizeSyncInterval(settings ? JSON.parse(settings.setting_value).syncIntervalMinutes : 5);
    const now = Date.now();
    return NextResponse.json({ intervalMinutes, serverNow: now, nextScheduledAt: now + millisecondsToNextRun(now, intervalMinutes),
      status: cycle?.status === 'running' && (cycle.leaseUntil <= now || Date.parse(cycle.startedAt) + 15 * 60000 <= now) ? 'interrupted' : cycle?.status || 'unknown',
      startedAt: cycle?.startedAt || null, finishedAt: cycle?.lastFinishedAt || null,
      blockedUntil: cycle?.status === 'running' ? cycle.leaseUntil : null,
    }, { headers: { 'Cache-Control': 'no-store' } });
  } catch { return NextResponse.json({ error: 'Synkroniseringsstatus kunne ikke hentes.' }, { status: 503, headers: { 'Cache-Control': 'no-store' } }); }
}
