import { integrationCatalog,type IntegrationId,type IntegrationSelection } from '@/lib/integration-catalog';
export async function integrationSelection(db:D1Database):Promise<IntegrationSelection> {
  const [credentials,settings] = await Promise.all([
    db.prepare("SELECT provider FROM integration_credentials WHERE tenant='sablen.dk'").all<{provider:string}>(),
    db.prepare("SELECT setting_key FROM app_settings WHERE tenant='sablen.dk' AND (setting_key LIKE 'integration_selection:%' OR setting_key IN ('viabill_credentials','emballage_credentials','flatpay_credentials'))").all<{setting_key:string}>(),
  ]);
  const connected=integrationCatalog.filter(p=>(p.id==='viabill'||p.id==='emballage'||p.id==='flatpay')?settings.results.some(s=>s.setting_key===p.id+'_credentials'):credentials.results.some(c=>c.provider===p.id)).map(p=>p.id);
  const selected=integrationCatalog.filter(p=>connected.includes(p.id) || settings.results.some(s=>s.setting_key==='integration_selection:'+p.id)).map(p=>p.id);
  return {selected,connected};
}
export async function selectIntegration(db:D1Database,provider:IntegrationId,add:boolean) {
  if (!add && (await integrationSelection(db)).connected.includes(provider)) return false;
  const key='integration_selection:'+provider;
  if (add) await db.prepare("INSERT INTO app_settings(tenant,setting_key,setting_value) VALUES('sablen.dk',?,'true') ON CONFLICT DO NOTHING").bind(key).run();
  else await db.prepare("DELETE FROM app_settings WHERE tenant='sablen.dk' AND setting_key=?").bind(key).run();
  return true;
}
