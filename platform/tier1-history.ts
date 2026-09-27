import { requireCompany } from './auth';
import { jsonBody } from './invitations';
import { HttpError,reply,type Actor,type PlatformEnv } from './types';
import { historyWindow,validateHistory } from './tier1/src/lib/history-policy';

export async function historyPolicy(env:PlatformEnv,company:string){
 const row=await env.PLATFORM_DB.prepare("SELECT months,start_date FROM integration_history WHERE company_id=? AND scope='' AND provider='history'").bind(company).first<{months:number;start_date:string}>();
 const fallback=await env.PLATFORM_DB.prepare('SELECT months FROM invoice_settings WHERE company_id=?').bind(company).first<{months:number}>();
 return {months:row?.months||fallback?.months||24,startDate:row?.start_date||''};
}
export async function providerStart(env:PlatformEnv,company:string,shop:string,provider:string){
 const scope=provider==='dinero'?'':shop==='none'?'':shop;
 const row=await env.PLATFORM_DB.prepare("SELECT start_date FROM integration_history WHERE company_id=? AND provider=? AND scope IN (?, '') ORDER BY length(scope) DESC LIMIT 1").bind(company,provider,scope).first<{start_date:string}>();
 if(!row&&scope&&['flatpay','viabill'].includes(provider)){const saved=await env.PLATFORM_DB.prepare('SELECT start_date FROM payment_connections WHERE company_id=? AND webshop_id=? AND provider=?').bind(company,scope,provider).first<{start_date:string}>();return saved?.start_date||'';}
 return row?.start_date||'';
}
export async function dataCutoff(env:PlatformEnv,company:string,shop:string,provider='shopify'){
 const policy=await historyPolicy(env,company),start=await providerStart(env,company,shop,provider);
 return historyWindow({...policy,startDate:start>policy.startDate?start:policy.startDate}).cutoff;
}
export async function dataStartDate(env:PlatformEnv,company:string,shop:string,provider='shopify'){
 return new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Copenhagen',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(await dataCutoff(env,company,shop,provider)));
}
export async function handleHistory(request:Request,env:PlatformEnv,actor:Actor,company:string,shop:string,path:string){
 const db=env.PLATFORM_DB,isHistory=path==='/admin/history';
 const body=request.method==='POST'?await jsonBody(request):{};
 const provider=isHistory?'history':String(body.provider||new URL(request.url).searchParams.get('provider')||'');
 if(!['history','shopify','dinero','flatpay','viabill'].includes(provider)||(!isHistory&&provider==='history'))throw new HttpError(400,'Vælg en gyldig integration.');
 const scope=isHistory||provider==='dinero'||shop==='none'?'':shop;
 const existing=await db.prepare('SELECT start_date,months,revision FROM integration_history WHERE company_id=? AND scope=? AND provider=?').bind(company,scope,provider).first<{start_date:string;months:number;revision:number}>();
 if(request.method==='POST'){
  await requireCompany(db,actor,company,true);
  const policy=await historyPolicy(env,company);
  let value;
  try{value=validateHistory({months:isHistory?Number(body.months):24,startDate:body.startDate as string});}catch{throw new HttpError(400,'Angiv en gyldig dato og 1–120 måneders historik.');}
  if(value.startDate>new Date().toISOString().slice(0,10))throw new HttpError(400,'Startdato må ikke ligge i fremtiden.');
  if(isHistory&&value.startDate!==policy.startDate&&!body.confirmStartDateChange)throw new HttpError(400,'Bekræft ændringen af startdato.');
  if(body.revision!==undefined&&body.revision!==(existing?.revision||0))throw new HttpError(409,'Indstillingerne er ændret. Genindlæs.');
  await db.batch([...(scope&&['flatpay','viabill'].includes(provider)?[db.prepare('UPDATE payment_connections SET start_date=?,revision=revision+1 WHERE company_id=? AND webshop_id=? AND provider=?').bind(value.startDate,company,scope,provider)]:[]),db.prepare('INSERT INTO integration_history(company_id,scope,provider,start_date,months) VALUES(?,?,?,?,?) ON CONFLICT(company_id,scope,provider) DO UPDATE SET start_date=excluded.start_date,months=excluded.months,revision=integration_history.revision+1').bind(company,scope,provider,value.startDate,value.months),db.prepare('INSERT INTO audit_events(id,company_id,actor_id,action,resource_id,details_json) VALUES(?,?,?,?,?,?)').bind(crypto.randomUUID(),company,actor.id,'history.updated',scope||company,JSON.stringify({provider,...value}))]);
 }else if(request.method!=='GET')throw new HttpError(405,'Brug Gem.');
 if(isHistory){const policy=await historyPolicy(env,company);return reply({policy,...historyWindow(policy)});}
 return reply({startDate:await providerStart(env,company,shop,provider),source:'Tom dato følger fælles historik. Gælder fra næste hentning; gemte bilag bevares.'});
}
