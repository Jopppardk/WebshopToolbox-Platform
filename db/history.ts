import { defaultHistory, validateHistory, historyWindow, type HistoryPolicy } from '@/lib/history-policy';
export async function loadHistory(db: D1Database) {
  const row = await db.prepare("SELECT setting_value FROM app_settings WHERE tenant = 'sablen.dk' AND setting_key = 'history_policy'").first<{ setting_value: string }>();
  return row ? validateHistory(JSON.parse(row.setting_value) as HistoryPolicy) : defaultHistory;
}
// Bounded housekeeping on API activity. Import start only hides old data; retention removes it.
export async function cleanupHistory(db: D1Database, bucket: R2Bucket) {
  const { retentionCutoff } = historyWindow(await loadHistory(db));
  const expired = await db.prepare("SELECT id, external_id, record_type FROM integration_records WHERE tenant = 'sablen.dk' AND occurred_at < ? ORDER BY occurred_at LIMIT 50").bind(retentionCutoff).all<{ id: string; external_id: string; record_type: string }>();
  let reportKeys: { results: { report_key: string }[] } = { results: [] };
  try { reportKeys = await db.prepare("SELECT json_extract(payload_json,'$.reportKey') AS report_key FROM integration_records WHERE tenant='sablen.dk' AND record_type='payout' AND occurred_at < ? AND json_extract(payload_json,'$.reportKey') IS NOT NULL LIMIT 50").bind(retentionCutoff).all<{ report_key: string }>(); } catch { /* Legacy test/storage shape has no report metadata. */ }
  const keys = [...expired.results.filter(row => row.record_type === 'invoice').map(row => `invoices/${encodeURIComponent(row.external_id)}.pdf`), ...reportKeys.results.map(row => row.report_key)];
  if (keys.length) await bucket.delete(keys);
  if (expired.results.length) await db.batch(expired.results.map(row => db.prepare("DELETE FROM integration_records WHERE id = ? AND tenant = 'sablen.dk' AND occurred_at < ?").bind(row.id, retentionCutoff)));
  // Remove expired proposal/line details, but retain a minimal duplicate-prevention receipt.
  const transfers = await db.prepare("SELECT setting_key, setting_value FROM app_settings WHERE tenant = 'sablen.dk' AND setting_key GLOB 'sales_transfer:*' AND json_extract(setting_value, '$.snapshot.occurredAt') < ? LIMIT 50").bind(retentionCutoff).all<{ setting_key: string; setting_value: string }>();
  if (transfers.results.length) await db.batch(transfers.results.map(row => {
    const state = JSON.parse(row.setting_value);
    if (state.phase === 'prepared') return db.prepare("DELETE FROM app_settings WHERE tenant = 'sablen.dk' AND setting_key = ? AND setting_value = ?").bind(row.setting_key, row.setting_value);
    const receipt = { phase: 'archived', version: crypto.randomUUID(), updatedAt: state.updatedAt, externalId: state.externalId, organizationId: state.organizationId, guid: state.guid, voucherNumber: state.voucherNumber };
    return db.prepare("UPDATE app_settings SET setting_value = ? WHERE tenant = 'sablen.dk' AND setting_key = ? AND setting_value = ?").bind(JSON.stringify(receipt), row.setting_key, row.setting_value);
  }));
  try { await db.prepare("DELETE FROM job_runs WHERE tenant = 'sablen.dk' AND started_at < ?").bind(retentionCutoff).run(); } catch { /* Tabellen findes først efter jobindsigt-migrationen. */ }
}
