import { database } from './database';
import { loadCredentials } from './credentials';
import { readDineroAccounts } from './dinero-accounts';
import type { PreviewAccount } from '@/lib/sales-preview';
type Snapshot = { accounts: PreviewAccount[]; fetchedAt: string; startedAt: string };
const tenant = 'sablen.dk';
async function context() {
  const credentials = await loadCredentials('dinero', true);
  if (!credentials?.organizationId) throw new Error('Forbind Dinero under Administration først.');
  return { credentials, key: `dinero_chart:${credentials.organizationId}`, db: database() };
}
export async function loadDineroChart(): Promise<Snapshot | null> {
  const { db, key } = await context();
  const row = await db.prepare('SELECT setting_value FROM app_settings WHERE tenant = ? AND setting_key = ?').bind(tenant, key).first<{ setting_value: string }>();
  return row ? JSON.parse(row.setting_value) as Snapshot : null;
}
export async function syncDineroChart() {
  const { credentials, key, db } = await context();
  const startedAt = new Date().toISOString();
  const accounts = await readDineroAccounts(credentials);
  if (!accounts.length) throw new Error('Dinero returnerede en tom kontoplan. Den gemte kontoplan bevares.');
  const snapshot: Snapshot = { accounts, startedAt, fetchedAt: new Date().toISOString() };
  // Replace the complete snapshot atomically; failed/older syncs cannot erase valid data.
  await db.prepare(`INSERT INTO app_settings (tenant, setting_key, setting_value) VALUES (?, ?, ?)
    ON CONFLICT(tenant, setting_key) DO UPDATE SET setting_value = excluded.setting_value, updated_at = CURRENT_TIMESTAMP
    WHERE json_extract(excluded.setting_value, '$.startedAt') > json_extract(app_settings.setting_value, '$.startedAt')`)
    .bind(tenant, key, JSON.stringify(snapshot)).run();
  return loadDineroChart();
}
