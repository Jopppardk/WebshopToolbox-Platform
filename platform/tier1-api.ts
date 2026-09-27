import { handleTier1Emballage } from './tier1-emballage';
import { handleFeeds } from './feeds';
import { handleTier1Data } from './tier1-data';
import { handleHistory } from './tier1-history';
import { handleTier1Connections } from './tier1-connections';
import { requireCompany, requireWebshop } from './auth';
import { financeService } from './finance-source';
import { handleTier1Settings } from './tier1-settings';
import { HttpError, reply, type Actor, type PlatformEnv } from './types';

// The customer portal is shared by local, dev and production deployments.
// Incomplete contracts fail explicitly, never masquerading as empty live data.
export async function handleTier1(request:Request, env:PlatformEnv, actor:Actor) {
  if(actor.platformAdmin || actor.support) throw new HttpError(403,'Åbn Tier 1 med en virksomhedsbruger.');
  const db=env.PLATFORM_DB, url=new URL(request.url);
  const match=url.pathname.match(/^\/api\/platform\/tier1\/shops\/([\w-]+)(\/.*)$/);
  if(!match) throw new HttpError(404,'Funktionen findes ikke.');
  const company=await db.prepare('SELECT company_id FROM users WHERE id=?').bind(actor.id).first<{company_id:string}>();
  if(!company?.company_id) throw new HttpError(403,'Ingen virksomhed.');
  await requireCompany(db,actor,company.company_id);
  const [,shop,path]=match;
  if(shop!=='none') await requireWebshop(db,actor,company.company_id,shop);
  if(path==='/feeds'||path.startsWith('/feeds/'))return handleFeeds(request,env,actor,company.company_id,shop,path);
  if(path==='/emballage/connection'||path==='/emballage/reporting')return handleTier1Emballage(request,env,actor,company.company_id,shop,path);
  if(path==='/admin/history'||path==='/integrations/start-date')return handleHistory(request,env,actor,company.company_id,shop,path);
  const data=await handleTier1Data(request,env,actor,company.company_id,shop,path);if(data)return data;
  if(path==='/integrations' || path==='/integrations/selection' || /^\/(flatpay|viabill)\/connection$/.test(path))return handleTier1Connections(request,env,actor,company.company_id,shop,path);
  if(path==='/admin/settings') {
    if(shop==='none')throw new HttpError(409,'Opret din webshop under Integrationer først.');
    return handleTier1Settings(request,env,actor,company.company_id,shop);
  }
  if(request.method!=='GET') throw new HttpError(501,'Denne handling er endnu ikke tilsluttet i den nye Tier 1.');
  if(path==='/dashboard/finance') {
    await requireCompany(db,actor,company.company_id,true);
    return reply(await financeService(env,company.company_id).dashboardFinance());
  }
  if(path==='/dinero/accounts') {
    await requireCompany(db,actor,company.company_id,true);
    const row=await db.prepare('SELECT chart_json,verified_at FROM accounting_connections WHERE company_id=?').bind(company.company_id).first<{chart_json:string;verified_at:string}>();
    return reply({accounts:row?JSON.parse(row.chart_json):[],fetchedAt:row?.verified_at||null});
  }
  throw new HttpError(501,'Denne funktion er endnu ikke tilsluttet i den nye Tier 1.');
}
