import { database } from './database';
import { loadCredentials } from './credentials';
import { eiAccess, getEIConfig } from './emballage';
import { eiReports, isSubmitted } from '@/lib/emballage-api';
import { recentQuarters } from '@/lib/emballage-reporting';
import { runTrackedJob } from './job-runs';
const tenant = 'sablen.dk';
export async function monitorEmballagePeriods(now = Date.now()) {
  const db = database(), config = await getEIConfig(db);
  if (!config.startDate || !config.responsibility || !await loadCredentials('emballage', true)) return;
  const claim = await db.prepare("INSERT INTO app_settings(tenant,setting_key,setting_value) VALUES(?,'emballage_period_poll',?) ON CONFLICT(tenant,setting_key) DO UPDATE SET setting_value=excluded.setting_value,updated_at=CURRENT_TIMESTAMP WHERE CAST(app_settings.setting_value AS INTEGER)<=?").bind(tenant,String(now),now-3600000).run();
  if (claim.meta.changes !== 1) return;
  return runTrackedJob('emballage-periods', 'Emballage · Nye indberetningsperioder', async () => {
    const { key, context } = await eiAccess(), reports = await eiReports(key);
    const quarters = recentQuarters(new Date(now));
    let added = 0;
    for (const report of reports) {
      const quarter = quarters.find(q => q.start === report.period.start_date && q.end === report.period.end_date && q.start >= config.startDate);
      if (!quarter || report.responsibility?.code !== config.responsibility || report.responsibility.product_area?.slug !== 'packaging' || !report.accepts_writes || isSubmitted(report.status)) continue;
      const id = `notice:emballage:${context.organisation.id}:${context.api_key.is_test ? 'test' : 'live'}:${report.id}`;
      const notice = { id, title: 'Åben for emballageindberetning', message: `${quarter.label} er åben hos Emballage Indberetning.${context.api_key.is_test ? ' Testtilstand.' : ''}`, createdAt: new Date(now).toISOString(), read: false };
      const result = await db.prepare('INSERT INTO app_settings(tenant,setting_key,setting_value) VALUES(?,?,?) ON CONFLICT(tenant,setting_key) DO NOTHING').bind(tenant,id,JSON.stringify(notice)).run();
      added += result.meta.changes;
    }
    return { message: added ? `${added} nye perioder vises under klokken.` : 'Ingen nye indberetningsperioder.' };
  });
}
