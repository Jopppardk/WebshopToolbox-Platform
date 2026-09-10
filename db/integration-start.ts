export type DatedIntegration = 'shopify' | 'viabill' | 'dinero';
export function validStartDate(value: unknown): value is string {
  return typeof value === 'string' && (value === '' || /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0,10) === value);
}
export async function integrationStart(db: D1Database, provider: DatedIntegration) {
  const row = await db.prepare('SELECT setting_value FROM app_settings WHERE tenant=? AND setting_key=?').bind('sablen.dk', 'integration_start:'+provider).first<{setting_value:string}>();
  const value = row ? JSON.parse(row.setting_value) : '';
  if (!validStartDate(value)) throw Error('Integrationens startdato er ugyldig.');
  return value;
}
