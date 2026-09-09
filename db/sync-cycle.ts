import { database } from './database';

export const cycleKey = 'scheduled_sync_cycle';
// Longer than Cloudflare's 15-minute scheduled invocation lifetime. A killed
// worker cannot still be writing when another cycle reclaims this lease.
export const cycleLeaseMs = 20 * 60_000;
export type SyncCycle = {
  owner: string; scheduledTime: number; startedAt: string;
  finishedAt: string | null; lastFinishedAt: string | null;
  status: 'running' | 'succeeded' | 'failed'; leaseUntil: number;
};
export async function runSyncCycle(scheduledTime: number, task: () => Promise<{ failed: boolean }>) {
  const db = database();
  const row = await db.prepare('SELECT setting_value FROM app_settings WHERE tenant=? AND setting_key=?').bind('sablen.dk', cycleKey).first<{ setting_value: string }>();
  const previous = row ? JSON.parse(row.setting_value) as SyncCycle : null;
  if (previous && (previous.leaseUntil > Date.now() || previous.scheduledTime >= scheduledTime)) return;
  const state: SyncCycle = { owner: crypto.randomUUID(), scheduledTime, startedAt: new Date().toISOString(), finishedAt: null, lastFinishedAt: previous?.lastFinishedAt || null, status: 'running', leaseUntil: Date.now() + cycleLeaseMs };
  const raw = JSON.stringify(state);
  const claim = row
    ? await db.prepare('UPDATE app_settings SET setting_value=?,updated_at=CURRENT_TIMESTAMP WHERE tenant=? AND setting_key=? AND setting_value=?').bind(raw, 'sablen.dk', cycleKey, row.setting_value).run()
    : await db.prepare('INSERT INTO app_settings(tenant,setting_key,setting_value) VALUES(?,?,?) ON CONFLICT DO NOTHING').bind('sablen.dk', cycleKey, raw).run();
  if (claim.meta.changes !== 1) return;
  let failed = true;
  let taskError: unknown;
  let taskThrew = false;
  try { failed = (await task()).failed; }
  catch (error) { taskThrew = true; taskError = error; }
  {
    const finishedAt = new Date().toISOString();
    const result = await db.prepare('UPDATE app_settings SET setting_value=?,updated_at=CURRENT_TIMESTAMP WHERE tenant=? AND setting_key=? AND setting_value=?')
      .bind(JSON.stringify({ ...state, finishedAt, lastFinishedAt: finishedAt, status: failed ? 'failed' : 'succeeded', leaseUntil: 0 }), 'sablen.dk', cycleKey, raw).run();
    if (result.meta.changes !== 1) throw new Error('Synkroniseringens slutstatus kunne ikke gemmes. Kontrollér Indsigt.');
  }
  if (taskThrew) throw taskError;
}
