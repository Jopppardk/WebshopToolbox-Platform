import { orderPaymentIntegration, paymentProviders } from './catalog';
import {recordHistory} from './record-history';
import { payoutStatusLabel } from './tier1/src/lib/payout-status';
import { normalizeSyncInterval } from './tier1/src/lib/sync-schedule';
import {handleProductionSale} from './production-sales';
import {handleProductionOther} from './production-proposals';
import {productionWrites} from './production-policy';
import { bookingStatuses } from './booking-onboarding';
import { bookingStatusLabel } from './tier1/src/lib/booking-status';
import {handleMail} from './mail';
import { flatpayRefund } from './flatpay-refunds';
import { requireCompany } from './auth';
import { jsonBody } from './invitations';
import { unseal } from './connections';
import { readDineroAccounts,readDineroSuppliers } from './dinero-read';
import { handleOperations } from './operations';
import { runSalesNow } from './production-jobs';
import { handleStocktake } from './stocktake';
import { handleInvoices } from './invoices';
import { handleDocuments } from './documents';
import { handlePackaging } from './packaging';
import { handlePayments } from './payments';
import { financeService } from './finance-source';
import { dataCutoff,dataStartDate } from './tier1-history';
import { orderPeriodWindow } from './tier1/src/lib/order-period';
import { formatDate } from './tier1/src/lib/format';
import { HOME_COUNTRY } from './order-markets';
import { legacyRefundSql, saleBookedSql, syncOrderRefunds, type OrderRefund } from './order-refunds';
import { ensureCreditNote } from './credit-notes';
import { ensureMarketRow } from './invoice-profiles';
import { HttpError,reply,type Actor,type PlatformEnv } from './types';

const forwarded=(request:Request,body:unknown,method='POST')=>new Request(request.url,{method,headers:request.headers,body:JSON.stringify(body)});
function minor(amount:string,currency:string){const digits=new Intl.NumberFormat('en',{style:'currency',currency}).resolvedOptions().maximumFractionDigits!;const match=/^(-?)(\d+)(?:\.(\d+))?$/.exec(amount);if(!match||/[1-9]/.test((match[3]||'').slice(digits)))throw new HttpError(409,'Ugyldigt beløb.');const n=Number(match[2])*10**digits+Number((match[3]||'').padEnd(digits,'0').slice(0,digits));if(!Number.isSafeInteger(n))throw new HttpError(409,'Beløbet er for stort.');return match[1]?-n:n;}
// Whether an order waits because its market is not set up: the same rule as order-markets.ts, for list views.
async function marketHold(db:D1Database,company:string,shop:string){
 const enabled=(await db.prepare('SELECT countries_json,currency FROM webshop_markets WHERE company_id=? AND webshop_id=? AND enabled=1').bind(company,shop).all<{countries_json:string;currency:string}>()).results.map(r=>({countries:JSON.parse(r.countries_json) as string[],currency:r.currency}));
 return (country:string|null,currency:string|null,shopCurrency:string|null)=>{
  if(!country||country===HOME_COUNTRY)return !!currency&&!!shopCurrency&&currency!==shopCurrency;
  return !currency||!enabled.some(m=>m.countries.includes(country)&&m.currency===currency);
 };
}
function pageNumber(value:string|null,fallback:number,max=100000){const n=value===null?fallback:Number(value);if(!Number.isSafeInteger(n)||n<0||n>max)throw new HttpError(400,'Ugyldigt sidetal.');return n;}
export async function handleTier1Data(request:Request,env:PlatformEnv,actor:Actor,company:string,shop:string,path:string):Promise<Response|null>{
 const db=env.PLATFORM_DB,url=new URL(request.url),get=request.method==='GET';
 if(path==='/runtime'&&get)return reply({production:env.PLATFORM_ENV==='production',bookkeeping:productionWrites(env),customerEmail:env.PLATFORM_ENV==='production'&&env.PLATFORM_CUSTOMER_EMAIL==='enabled'});
 if(path==='/bookkeeping/manual'&&!get&&productionWrites(env)){
  const b=await jsonBody(request);const next=forwarded(request,b);
  return b.kind==='sale'?handleProductionSale(next,env,actor,company,shop):handleProductionOther(next,env,actor,company,shop,String(b.kind));
 }
 if(path==='/invoices/email'&&!get&&env.PLATFORM_ENV==='production'&&env.PLATFORM_CUSTOMER_EMAIL==='enabled'){
  const b=await jsonBody(request);return handleInvoices(forwarded(request,{webshopId:shop,externalId:b.externalId}),env,actor,company,'send');
 }
 const blocked=['/bookkeeping/manual','/sales/transfer','/refunds/transfer','/payouts/transfer','/flatpay/draft','/flatpay/production','/invoices/email'];
 if(blocked.includes(path)&&!get)throw new HttpError(403,'Denne overførsel er ikke tilgængelig her. Brug Bogfør manuelt på posten i produktionsportalen.');
 const runs=async()=> (await db.prepare('SELECT * FROM operation_runs WHERE company_id=? AND webshop_id=? ORDER BY started_at DESC,id DESC LIMIT 1000').bind(company,shop).all<any>()).results;
 if(path==='/admin/sync-status'&&get){const row=(await runs())[0],saved=await db.prepare('SELECT preferences_json FROM tier1_preferences WHERE company_id=? AND webshop_id=?').bind(company,shop).first<{preferences_json:string}>();return reply({automatic:productionWrites(env),intervalMinutes:normalizeSyncInterval(saved?JSON.parse(saved.preferences_json).syncIntervalMinutes:15),serverNow:Date.now(),status:row?.status==='success'?'succeeded':row?.status||'unknown',startedAt:row?.started_at||null,finishedAt:row?.finished_at||null,blockedUntil:null});}
 if(path==='/admin/insights'&&get){
  if(!actor.platformAdmin||actor.support)throw new HttpError(403,'Joboversigten findes kun i Tier 0.');
  const list=(await runs()).map(r=>({...r,job_key:r.module,job_name:r.module,status:r.status==='success'?'succeeded':r.status,duration_ms:r.finished_at?Date.parse(r.finished_at)-Date.parse(r.started_at):null}));
  const status=url.searchParams.get('status'),filtered=status?list.filter(r=>r.status===status):list,p=Math.max(1,pageNumber(url.searchParams.get('page'),1));
  return reply({summary:{total:list.length,succeeded:list.filter(r=>r.status==='succeeded').length,failed:list.filter(r=>r.status==='failed').length,skipped:0,running:list.filter(r=>r.status==='running').length},latest:list.slice(0,20),runs:filtered.slice((p-1)*50,p*50),pagination:{page:p,pageSize:50,total:filtered.length,until:new Date().toISOString(),since:list.at(-1)?.started_at||new Date().toISOString()}});
 }
 if(path==='/admin/errors'&&(!actor.platformAdmin||actor.support))throw new HttpError(403,'Jobfejl vises i Tier 0.');
 if(path==='/notifications'){
  // Any user with webshop access may mark the failures they were shown as seen; the list itself keeps them.
  if(!get){
   const b=await jsonBody(request,8000);
   if(b.action!=='seen'||!Array.isArray(b.ids)||b.ids.length>100||b.ids.some(id=>typeof id!=='string'||!/^[a-f0-9-]{36}$/.test(id)))throw new HttpError(400,'Ugyldig markering af fejl.');
   // Seeing the list covers everything up to the newest failure shown, also older ones beyond
   // the 50 listed; failures that arrive later stay unseen.
   if(b.ids.length)await db.prepare("INSERT OR IGNORE INTO operation_acknowledgements(company_id,run_id) SELECT r.company_id,r.id FROM operation_runs r WHERE r.company_id=? AND r.webshop_id=? AND r.status='failed' AND r.started_at<=(SELECT max(started_at) FROM operation_runs WHERE company_id=? AND webshop_id=? AND status='failed' AND id IN (SELECT value FROM json_each(?)))").bind(company,shop,company,shop,JSON.stringify(b.ids)).run();
  }
  const errors=(await db.prepare("SELECT r.id,r.module AS source,r.message,COALESCE(r.finished_at,r.started_at) AS created_at,EXISTS(SELECT 1 FROM operation_acknowledgements a WHERE a.company_id=r.company_id AND a.run_id=r.id) AS seen FROM operation_runs r WHERE r.company_id=? AND r.webshop_id=? AND r.status='failed' ORDER BY r.started_at DESC,r.id DESC LIMIT 50").bind(company,shop).all<{id:string;source:string;message:string;created_at:string;seen:number}>()).results;
  const unseen=await db.prepare("SELECT count(*) AS n FROM operation_runs r WHERE r.company_id=? AND r.webshop_id=? AND r.status='failed' AND NOT EXISTS(SELECT 1 FROM operation_acknowledgements a WHERE a.company_id=r.company_id AND a.run_id=r.id)").bind(company,shop).first<{n:number}>();
  return reply({notifications:[],incidents:{warnings:0,alarms:unseen?.n||0},errors:errors.map(e=>({...e,seen:!!e.seen}))});
 }
 if(path==='/admin/errors'){
  if(!get){
   if(request.method!=='POST')throw new HttpError(405,'Brug Gem.');await requireCompany(db,actor,company,true);const b=await jsonBody(request);
   if(typeof b.id!=='string')throw new HttpError(400,'Vælg en fejl til kvittering. Mailnotifikationer er ikke aktiveret i dev.');
   await db.prepare("INSERT OR IGNORE INTO operation_acknowledgements(company_id,run_id) SELECT company_id,id FROM operation_runs WHERE company_id=? AND webshop_id=? AND id=? AND status='failed'").bind(company,shop,b.id).run();
  }
  const errors=(await db.prepare("SELECT r.id,r.module AS source,r.message,r.started_at AS created_at FROM operation_runs r WHERE r.company_id=? AND r.webshop_id=? AND r.status='failed' AND NOT EXISTS(SELECT 1 FROM operation_acknowledgements a WHERE a.company_id=r.company_id AND a.run_id=r.id) ORDER BY r.started_at DESC LIMIT 100").bind(company,shop).all()).results;
  return path==='/admin/errors'?reply({errors,openCount:errors.length,notifications:{enabled:false,warnings:false,alarms:false,email:''}}):reply({notifications:[],incidents:{warnings:0,alarms:errors.length}});
 }
 if(path==='/dinero/suppliers'){
  await requireCompany(db,actor,company,true);if(!get){if(request.method!=='POST')throw new HttpError(405,'Brug Hent.');await jsonBody(request);}
  const saved=await db.prepare('SELECT organization_id,credentials_encrypted FROM accounting_connections WHERE company_id=?').bind(company).first<any>();if(!saved)throw new HttpError(409,'Forbind Dinero først.');
  try{return reply({suppliers:await readDineroSuppliers(await unseal(env,[company,'dinero',saved.organization_id],saved.credentials_encrypted)),fetchedAt:new Date().toISOString()});}catch{throw new HttpError(409,'Leverandørerne kunne ikke hentes fra Dinero.');}
 }
 if(path==='/dinero/accounts'&&!get){
  if(request.method!=='POST')throw new HttpError(405,'Brug Synkronisér.');await requireCompany(db,actor,company,true);await jsonBody(request);
  const saved=await db.prepare('SELECT organization_id,credentials_encrypted,revision FROM accounting_connections WHERE company_id=?').bind(company).first<any>();if(!saved)throw new HttpError(409,'Forbind Dinero først.');
  let accounts;try{accounts=await readDineroAccounts(await unseal(env,[company,'dinero',saved.organization_id],saved.credentials_encrypted));}catch{throw new HttpError(409,'Kontoplanen kunne ikke hentes. Tidligere kontoplan er bevaret.');}
  const update=await db.prepare('UPDATE accounting_connections SET chart_json=?,verified_at=CURRENT_TIMESTAMP WHERE company_id=? AND revision=?').bind(JSON.stringify(accounts),company,saved.revision).run();if(!update.meta.changes)throw new HttpError(409,'Forbindelsen blev ændret. Hent igen.');return reply({accounts,fetchedAt:new Date().toISOString()});
 }
 if(path==='/dashboard/finance'&&get){await requireCompany(db,actor,company,true);await financeService(env,company).syncDashboardFinance();return reply(await financeService(env,company).dashboardFinance());}
 if(path==='/dashboard/platform'&&get){
  const list=(await runs()).filter(r=>Date.parse(r.started_at+'Z')>Date.now()-86400000),count=(status:string)=>list.filter(r=>r.status===status).length;
  const connections=await db.prepare('SELECT verified_at FROM webshop_connections WHERE company_id=? AND webshop_id=?').bind(company,shop).first<any>();
  const accounting=await db.prepare('SELECT verified_at FROM accounting_connections WHERE company_id=?').bind(company).first<any>();
  const snapshots=(await db.prepare('SELECT module,sum(CASE WHEN substr(occurred_at,1,10)=? THEN 1 ELSE 0 END) AS total,max(imported_at) AS updated FROM operation_snapshots WHERE company_id=? AND webshop_id=? GROUP BY module').bind(new Date().toISOString().slice(0,10),company,shop).all<any>()).results;
  const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Copenhagen',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  const lower=new Date(Date.parse(today)-86400000).toISOString().slice(0,10),upper=new Date(Date.parse(today)+2*86400000).toISOString().slice(0,10);
  const day=(value:string)=>value.length===10?value:new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Copenhagen',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(value));
  const sourceRows=(await db.prepare("SELECT 'shopify' provider,module,external_id,occurred_at,payload_json FROM operation_snapshots WHERE company_id=? AND webshop_id=? AND module IN ('orders','payouts') AND occurred_at>=? AND occurred_at<? UNION ALL SELECT provider,kind module,external_id,occurred_at,payload_json FROM payment_records WHERE company_id=? AND webshop_id=? AND ((provider='flatpay' AND kind='payments') OR (provider='viabill' AND kind='payout')) AND occurred_at>=? AND occurred_at<?").bind(company,shop,lower,upper,company,shop,lower,upper).all<any>()).results;
  const statusFor=await bookingStatuses(env,company,shop);
  const activity=(module:string)=>{const selected=sourceRows.filter(r=>(module==='orders'?r.module==='orders':r.module!=='orders')&&day(r.occurred_at)===today);let synced=0,failed=0;for(const r of selected){const status=statusFor(r.provider,r.module,r.external_id,r.occurred_at,r.payload_json);if(['booked','draft'].includes(status))synced++;else if(['failed_retry','failed_manual','uncertain','held','booked_changed'].includes(status))failed++;}return {total:selected.length,synced,failed,pending:selected.length-synced-failed};};
  const providers=[{key:'shopify',name:'Shopify',connected:!!connections?.verified_at,checkedAt:connections?.verified_at||null,health:'unknown'},{key:'dinero',name:'Dinero',connected:!!accounting,checkedAt:accounting?.verified_at||null,health:'unknown'}];
  return reply({inactive:providers.filter(p=>!p.connected).length,connected:providers.filter(p=>p.connected).length,providers,failed:count('failed'),succeeded:count('success'),skipped:0,running:count('running'),successRate:list.length?100*count('success')/list.length:null,checkedAt:new Date().toISOString(),activity:{today,orders:activity('orders'),payouts:activity('payouts'),updated:Object.fromEntries(['sales','refunds','packaging'].map(k=>[k,snapshots.find(r=>r.module===(k==='sales'?'orders':k))?.updated||null]))}});
 }
 if(path==='/shopify/packaging'){
  if(shop==='none')throw new HttpError(409,'Forbind webshoppen først.');
  const today=new Date().toISOString().slice(0,10),year=Number(today.slice(0,4)),month=Number(today.slice(5,7))-1,q=Math.floor(month/3)*3;
  const date=(y:number,m:number,d=1)=>new Date(Date.UTC(y,m,d)).toISOString().slice(0,10);
  const periods:Record<string,[string,string]>={currentQuarter:[date(year,q),today],previousQuarter:[date(year,q-3),date(year,q,0)],yearToDate:[date(year,0),today],previousYear:[date(year-1,0),date(year,0,0)],custom:[url.searchParams.get('start')||date(year,q),url.searchParams.get('end')||today]};
  if(!get){
   if(request.method!=='POST')throw new HttpError(405,'Brug Gem.');await requireCompany(db,actor,company,true);const b=await jsonBody(request);
   if(b.action==='delete'){
    if(!Number.isSafeInteger(b.version))throw new HttpError(409,'Genindlæs posten før sletning.');
    const deleted=await db.prepare('DELETE FROM platform_packaging WHERE company_id=? AND webshop_id=? AND id=? AND version=?').bind(company,shop,b.id,b.version).run();if(!deleted.meta.changes)throw new HttpError(409,'Posten er ændret. Genindlæs.');await db.prepare('INSERT INTO audit_events(id,company_id,actor_id,action,resource_id,details_json) VALUES(?,?,?,?,?,?)').bind(crypto.randomUUID(),company,actor.id,'packaging.deleted',shop,JSON.stringify({id:b.id,version:b.version})).run();return reply({ok:true});
   }
   const from=await dataStartDate(env,company,shop);
   const input=b.action==='price'?{action:'prices',household:b.pricePerKg,commercial:b.commercialPricePerKg}:b.action==='upsert'?{...(b.entry as object),action:'save'}:b.action==='sync'?{action:'sync',start:[String(b.start||from),from].sort().at(-1),end:b.end||today}:b;
   const response=await handlePackaging(forwarded(request,input),env,actor,company,shop);if(!response.ok)return response;
  }
  const result:Record<string,unknown>={};let prices:any={},lastSyncedAt=null;
  for(const [key,[from,to]] of Object.entries(periods)){const next=new URL(request.url);next.searchParams.set('from',from);next.searchParams.set('to',to);const response=await handlePackaging(new Request(next,{headers:request.headers}),env,actor,company,shop);if(!response.ok)return response;const value=await response.json() as any;result[key]=value.period;prices=value.prices;lastSyncedAt=value.sync?.synced_at||null;}
  return reply({periods:result,pricePerKg:prices.household,commercialPricePerKg:prices.commercial,lastSyncedAt});
 }
 // A market's tab (?marketId=) has its own sender, company details, design and logo; Danmark's tab has none.
 const marketId=url.searchParams.get('marketId');
 if(marketId&&!/^gid:\/\/shopify\/Market\/\d{1,30}$/.test(marketId))throw new HttpError(400,'Vælg et marked.');
 const withShop=()=>{const next=new URL(request.url);next.searchParams.set('webshopId',shop);return new Request(next,request);};
 if(path==='/invoices/sender'||path==='/invoices/sender/test'){
  if(!marketId)return handleMail(request,env,actor,company,path.endsWith('/test')?'test':undefined);
  if(shop==='none')throw new HttpError(409,'Forbind en webshop først.');
  if(request.method!=='GET'&&!actor.support)await ensureMarketRow(env,company,shop,marketId);
  return handleMail(request,env,actor,company,path.endsWith('/test')?'test':undefined,undefined,{shop,market:marketId});
 }
 if(path==='/invoices/logo')return handleInvoices(marketId?withShop():request,env,actor,company,'logo');
 if(path==='/invoices/preview'){if(shop==='none')throw new HttpError(409,'Opret en webshop for at se fakturaeksemplet.');const next=new URL(request.url);next.searchParams.set('webshopId',shop);return handleInvoices(new Request(next,request),env,actor,company,'preview');}
 if(path==='/invoices/settings')return handleInvoices(marketId?withShop():request,env,actor,company,'settings');
 const dataPaths=['/shopify/orders','/shopify/orders/process','/shopify/refunds','/shopify/payouts','/shopify/payments','/refunds/overview','/payouts/overview','/sales/log','/payouts/log','/refunds/log','/sales/preview','/shopify/inventory','/documents','/invoices','/invoices/pdf','/invoices/email-test','/flatpay/records','/flatpay/sync','/flatpay/refunds','/viabill/records','/pensopay/records','/order-refunds','/order-refunds/sync','/order-refunds/credit-note'];
 if(!dataPaths.includes(path))return null;
 if(shop==='none')throw new HttpError(409,'Forbind en webshop først.');
 if(path==='/shopify/inventory'){
  if(get)return handleStocktake(request,env,actor,company,shop);
  const b=await jsonBody(request,40000);const response=await handleStocktake(forwarded(request,b),env,actor,company,shop);
  if(['prepare','prepare-reconcile'].includes(String(b.action))&&response.ok){const d=await response.json() as any;return reply({...d,operationId:d.id});}return response;
 }
 // Tilbagebetalinger: every refund of an order, whatever the gateway, with its credit note and booking.
 if(path==='/order-refunds/sync'){
  if(request.method!=='POST')throw new HttpError(405,'Brug Hent tilbagebetalinger.');
  const result=await syncOrderRefunds(env,company,shop,25);
  return reply({synced:result.refunds,orders:result.orders,more:result.orders===25});
 }
 if(path==='/order-refunds/credit-note'){
  if(!get)throw new HttpError(405,'Brug Hent.');
  const id=url.searchParams.get('externalId')||'';if(!/^gid:\/\/shopify\/Refund\/\d{1,30}$/.test(id))throw new HttpError(400,'Vælg en tilbagebetaling.');
  let note=await db.prepare("SELECT number,r2_key FROM platform_credit_notes WHERE company_id=? AND webshop_id=? AND external_id=? AND status='generated'").bind(company,shop,id).first<{number:string;r2_key:string}>();
  if(!note&&!actor.support){
   // Made on first view when the order was invoiced here, exactly as booking or mailing would make it.
   const row=await db.prepare('SELECT payload_json FROM order_refunds WHERE company_id=? AND webshop_id=? AND external_id=?').bind(company,shop,id).first<{payload_json:string}>();
   const made=row?await ensureCreditNote(env,company,shop,JSON.parse(row.payload_json)):null;
   if(made)note={number:made.number,r2_key:made.key};
  }
  if(!note)throw new HttpError(404,'Der findes ingen kreditnota. Ordren er ikke faktureret i WebshopToolbox.');
  const file=await env.PLATFORM_DOCUMENTS.get(note.r2_key);if(!file)throw new HttpError(404,'Den gemte kreditnota mangler.');
  return new Response(file.body,{headers:{'Content-Type':'application/pdf','Content-Disposition':'inline; filename="kreditnota-'+note.number+'.pdf"','Cache-Control':'no-store'}});
 }
 if(path==='/order-refunds'){
  if(!get)throw new HttpError(405,'Brug Hent.');
  const from=await dataCutoff(env,company,shop),status=await bookingStatuses(env,company,shop),held=await marketHold(db,company,shop);
  const connected=new Set((await db.prepare('SELECT provider FROM payment_connections WHERE company_id=? AND webshop_id=?').bind(company,shop).all<{provider:string}>()).results.map(r=>r.provider));
  const rows=(await db.prepare(`SELECT s.external_id,s.occurred_at,s.payload_json,c.number credit_number,m.country,m.currency market_currency,
 EXISTS(SELECT 1 FROM platform_invoices i WHERE i.company_id=s.company_id AND i.webshop_id=s.webshop_id AND i.external_id=s.order_id AND i.status='generated') invoiced,${legacyRefundSql} legacy,${saleBookedSql} sale_booked,
 (SELECT r.phase FROM production_receipts r WHERE r.company_id=s.company_id AND r.webshop_id=s.webshop_id AND r.provider='invoice' AND r.module='credit_email' AND r.external_id=c.id) mail
 FROM order_refunds s LEFT JOIN platform_credit_notes c ON c.company_id=s.company_id AND c.webshop_id=s.webshop_id AND c.external_id=s.external_id AND c.status='generated'
 LEFT JOIN order_markets m ON m.company_id=s.company_id AND m.webshop_id=s.webshop_id AND m.external_id=s.order_id
 WHERE s.company_id=? AND s.webshop_id=? AND s.occurred_at>=? ORDER BY s.occurred_at DESC,s.external_id LIMIT 5001`).bind(company,shop,from).all<any>()).results;
  if(rows.length>5000)throw new HttpError(409,'Vælg en kortere historik.');
  const fromDay=url.searchParams.get('from')||'',toDay=url.searchParams.get('to')||'',search=(url.searchParams.get('search')||'').trim().toLowerCase();
  const offset=pageNumber(url.searchParams.get('offset'),0),limit=pageNumber(url.searchParams.get('limit'),25,100)||25;
  const list=rows.map(row=>{
   const r=JSON.parse(row.payload_json) as OrderRefund,digits=new Intl.NumberFormat('en',{style:'currency',currency:r.currency}).resolvedOptions().maximumFractionDigits!;
   const foreign=held(row.country??null,row.market_currency??null,r.currency);
   const booking=row.legacy?'booked':status('shopify','order_refunds',r.id,r.processedAt,row.payload_json);
   return {id:r.id,orderId:r.orderId,orderName:r.orderName,date:r.processedAt,currency:r.currency,amount:r.gross/10**digits,full:r.full,
    gateways:r.gateways.map(g=>{const label=orderPaymentIntegration([g.gateway],connected);return label==='Uden integration'?g.name||label:label;}),
    lines:r.lines.map(l=>({kind:l.kind,title:l.title,quantity:l.quantity,amount:(l.net+l.tax)/10**digits})),note:r.note,problem:r.problem,
    creditNote:row.credit_number||null,invoiced:!!row.invoiced,mailed:row.mail==='accepted',legacy:!!row.legacy,foreign,booking:row.legacy||['booked','draft','booked_changed','failed_manual','failed_retry','historical','setup_required'].includes(booking)?booking:foreign?'foreign':!row.sale_booked?'sale_pending':booking};
  }).filter(r=>(!fromDay||r.date.slice(0,10)>=fromDay)&&(!toDay||r.date.slice(0,10)<=toDay)&&(!search||[r.orderName,r.id,r.creditNote||'',...r.gateways].join(' ').toLowerCase().includes(search)));
  const totals:Record<string,{currency:string;count:number;amount:number}>={};
  for(const r of list){const t=totals[r.currency]??={currency:r.currency,count:0,amount:0};t.count++;t.amount=Math.round((t.amount+r.amount)*100)/100;}
  return reply({total:list.length,refunds:list.slice(offset,offset+limit),totals:Object.values(totals)});
 }
 if(path==='/sales/preview'){
  const response=await handleOperations(request,env,actor,company,shop,'sales-preview');if(!response.ok)return response;const data=await response.json() as any;return reply({...data,notes:['Kontrollen opretter ingen bogføring.'],checkedAt:new Date().toISOString()});
 }
 // After Synkronisér nu: invoice, send and book fulfilled orders right away, as far as the automation switches allow.
 if(path==='/shopify/orders/process'){if(get)throw new HttpError(405,'Brug Synkronisér nu.');await requireCompany(env.PLATFORM_DB,actor,company,true);return reply(await runSalesNow(env,company,shop));}
 if(path==='/shopify/orders'){
  if(!get){const response=await handleOperations(request,env,actor,company,shop,'orders');if(!response.ok)return response;const data=await response.json() as any;return reply({...data,synced:data.count,invoicesCreated:0,orders:[]});}
  const offset=pageNumber(url.searchParams.get('offset'),0),limit=pageNumber(url.searchParams.get('limit'),50,100)||50;
  let period;try{period=orderPeriodWindow(url.searchParams.get('period')||'all',await dataCutoff(env,company,shop));}catch{throw new HttpError(400,'Vælg en gyldig periode.');}
  const countryFilter=url.searchParams.get('country')||'';
  if(countryFilter&&countryFilter!=='unknown'&&!/^[A-Z]{2}$/.test(countryFilter))throw new HttpError(400,'Vælg et gyldigt land.');
  const markets="FROM operation_snapshots s LEFT JOIN order_markets m ON m.company_id=s.company_id AND m.webshop_id=s.webshop_id AND m.external_id=s.external_id WHERE s.company_id=? AND s.webshop_id=? AND s.module='orders' AND s.occurred_at>=? AND s.occurred_at<? AND (?='' OR (?='unknown' AND m.country IS NULL) OR m.country=?)";
  const total=await db.prepare('SELECT count(*) AS n '+markets).bind(company,shop,period.from,period.until,countryFilter,countryFilter,countryFilter).first<{n:number}>();
  const countries=(await db.prepare("SELECT m.country,count(*) n FROM operation_snapshots s JOIN order_markets m ON m.company_id=s.company_id AND m.webshop_id=s.webshop_id AND m.external_id=s.external_id WHERE s.company_id=? AND s.webshop_id=? AND s.module='orders' AND m.country IS NOT NULL GROUP BY m.country ORDER BY n DESC").bind(company,shop).all<{country:string;n:number}>()).results;
  const rows=(await db.prepare('SELECT s.payload_json,m.country,m.currency market_currency,m.presentment_total,m.order_total,m.net_payment '+markets+' ORDER BY s.occurred_at DESC,s.external_id LIMIT ? OFFSET ?').bind(company,shop,period.from,period.until,countryFilter,countryFilter,countryFilter,limit,offset).all<{payload_json:string;country:string|null;market_currency:string|null;presentment_total:string|null;order_total:string|null;net_payment:string|null}>()).results;
  const bookingStatus=await bookingStatuses(env,company,shop);
  const held=await marketHold(db,company,shop);
  const connectedPayments=new Set((await db.prepare('SELECT provider FROM payment_connections WHERE company_id=? AND webshop_id=?').bind(company,shop).all<{provider:string}>()).results.map(r=>r.provider));
  const money=(amount:string,currency:string)=>new Intl.NumberFormat('da-DK',{style:'currency',currency}).format(Number(amount));
  const todayWindow=orderPeriodWindow('today',await dataCutoff(env,company,shop));
  const today=await db.prepare("SELECT count(*) AS n FROM operation_snapshots WHERE company_id=? AND webshop_id=? AND module='orders' AND occurred_at>=? AND occurred_at<?").bind(company,shop,todayWindow.from,todayWindow.until).first<{n:number}>();
  return reply({total:total?.n||0,today:today?.n||0,countries:countries.map(c=>c.country),orders:rows.map(row=>{const o=JSON.parse(row.payload_json),m=o.currentTotalPriceSet.shopMoney;return {country:row.country??null,customerCurrency:row.market_currency??null,customerTotal:row.presentment_total&&row.market_currency&&row.market_currency!==m.currencyCode?money(row.presentment_total,row.market_currency):null,id:o.name+(o.test?' (test)':''),externalId:o.id,date:formatDate(o.createdAt),createdAt:o.createdAt,shipped:o.cancelledAt?'Annulleret':o.displayFulfillmentStatus==='FULFILLED'?'Afsendt':'Ikke afsendt',amount:money(row.order_total??m.amount,m.currencyCode),realized:money(row.net_payment??String(Math.max(0,Number(m.amount)-Number(o.totalRefundedSet?.shopMoney.amount||0))),m.currencyCode),status:held(row.country??null,row.market_currency??null,m.currencyCode)?'Afventer · marked ikke sat op':bookingStatusLabel(bookingStatus('shopify','orders',o.id,o.createdAt,row.payload_json)),currency:m.currencyCode,total:m.amount,paymentStatus:o.displayFinancialStatus,paymentProvider:orderPaymentIntegration(o.paymentGatewayNames,connectedPayments)};})});
 }
 if(['/sales/log','/payouts/log','/refunds/log'].includes(path)){
  if(!get)throw new HttpError(405,'Brug Hent log.');
  const provider=url.searchParams.get('provider')||'shopify',normalized=provider==='shopify_payments'?'shopify':provider;
  if(!['shopify',...paymentProviders].includes(normalized)||path==='/sales/log'&&normalized!=='shopify')throw new HttpError(400,'Vælg en gyldig udbyder.');
  const module=path==='/sales/log'?'orders':path==='/refunds/log'?(normalized==='flatpay'?'transactions':(url.searchParams.get('externalId')||'').startsWith('gid://shopify/Refund/')?'order_refunds':'refunds'):normalized==='flatpay'?'payments':normalized==='viabill'?'payout':normalized==='pensopay'?'settlements':'payouts';
  return recordHistory(env,company,shop,normalized,module,url.searchParams.get('externalId')||'',pageNumber(url.searchParams.get('offset'),0));
 }
 if(path==='/documents'){
  if(!get)return handleDocuments(request,env,actor,company,shop);
  const id=url.searchParams.get('externalId');
  if(id){const doc=await db.prepare('SELECT id FROM platform_payout_documents WHERE company_id=? AND webshop_id=? AND external_id=?').bind(company,shop,id).first<{id:string}>();if(!doc)throw new HttpError(404,'Generér rapporten først.');const next=new URL(request.url);next.searchParams.set('id',doc.id);return handleDocuments(new Request(next,request),env,actor,company,shop);}
  const rows=(await db.prepare("SELECT s.external_id,s.payload_json,d.status FROM operation_snapshots s LEFT JOIN platform_payout_documents d ON d.company_id=s.company_id AND d.webshop_id=s.webshop_id AND d.external_id=s.external_id WHERE s.company_id=? AND s.webshop_id=? AND s.module='payouts' ORDER BY occurred_at DESC LIMIT 1000").bind(company,shop).all<any>()).results;
  const flatpay=(await db.prepare("SELECT p.external_id,p.payload_json,d.status FROM payment_records p LEFT JOIN platform_payout_documents d ON d.company_id=p.company_id AND d.webshop_id=p.webshop_id AND d.external_id='flatpay:'||p.external_id WHERE p.company_id=? AND p.webshop_id=? AND p.provider='flatpay' AND p.kind='payments' AND (p.paid=1 OR p.external_id LIKE 'upcoming:%') ORDER BY p.occurred_at DESC LIMIT 1000").bind(company,shop).all<any>()).results;
  const failed=new Set((await db.prepare("SELECT external_id FROM production_attempts WHERE company_id=? AND webshop_id=? AND job='reports' AND failures>0").bind(company,shop).all<{external_id:string}>()).results.map(r=>r.external_id));
  const documents=[...rows.map(r=>{const p=JSON.parse(r.payload_json);return {externalId:r.external_id,date:p.issuedAt,provider:'shopify',amount:p.net,filename:r.external_id.split('/').pop()+'.pdf',ready:r.status==='generated',status:p.status,failed:r.status!=='generated'&&failed.has(r.external_id)};}),
   // Upcoming Flatpay settlements are listed like Shopify's scheduled payouts; their report follows the payout.
   ...flatpay.map(r=>{const p=JSON.parse(r.payload_json),upcoming=r.external_id.startsWith('upcoming:');return {externalId:'flatpay:'+r.external_id,date:upcoming?p.scheduledDate:p.paidDate,provider:'flatpay',amount:{amount:String(p.payoutAmount),currencyCode:p.currency},filename:upcoming?'Afregning '+p.settlementNumber:'flatpay-'+r.external_id+'.pdf',ready:r.status==='generated',status:upcoming?'SCHEDULED':'PAID',failed:r.status!=='generated'&&failed.has('flatpay:'+r.external_id)};})];
  documents.sort((a,b)=>String(b.date).localeCompare(String(a.date)));
  return reply({documents});
 }
 if(path.startsWith('/invoices')){
  const b:any=get?Object.fromEntries(url.searchParams):await jsonBody(request);
  if(path==='/invoices/pdf'){const next=new URL(request.url);next.searchParams.set('webshopId',shop);return handleInvoices(new Request(next,request),env,actor,company,'pdf');}
  if(path==='/invoices/email-test'){
   if(request.method!=='POST')throw new HttpError(405,'Brug Send eksempelfaktura som test.');
   const response=await handleInvoices(forwarded(request,{webshopId:shop,recipient:b.recipient,requestId:b.requestId,...(typeof b.marketId==='string'?{marketId:b.marketId}:{})}),env,actor,company,'example-test');if(!response.ok)return response;const result=await response.json() as any;
   if(result.status!=='accepted')throw new HttpError(409,result.status==='preview'?'Lokal test: mailen er kun forhåndsvist, ikke sendt.':'Mailafsendelsen er usikker. Kontrollér status før nyt forsøg.');return reply({sent:true,recipient:result.recipient,invoiceNumber:'EKSEMPEL-001'});
  }
  let generated=0,hasMore=false,nextOffset=0;const warnings:string[]=[];
  if(!get){
   const cutoff=await dataCutoff(env,company,shop);
   const offset=Number(b.offset||0);if(!Number.isSafeInteger(offset)||offset<0)throw new HttpError(400,'Ugyldig side.');
   const ids=b.all?(await db.prepare('SELECT external_id FROM invoice_orders WHERE company_id=? AND webshop_id=? AND created_at>=? ORDER BY created_at DESC,external_id LIMIT 6 OFFSET ?').bind(company,shop,cutoff,offset).all<{external_id:string}>()).results:[{external_id:b.externalId}];
   hasMore=ids.length>5;nextOffset=offset+5;
   for(const item of ids.slice(0,5)){
    if(!await db.prepare('SELECT 1 AS found FROM invoice_orders WHERE company_id=? AND webshop_id=? AND external_id=? AND created_at>=?').bind(company,shop,item.external_id,cutoff).first())throw new HttpError(404,'Ordren findes ikke i den valgte historik.');
    try{const response=await handleInvoices(forwarded(request,{externalId:item.external_id,webshopId:shop}),env,actor,company,'generate');if(!response.ok)return response;generated++;}catch(e){if(!b.all)throw e;warnings.push(e instanceof HttpError?e.message:'Fakturaen kræver kontrol.');}
   }
  }
  const rows=(await db.prepare('SELECT external_id,id,status,created_at FROM platform_invoices WHERE company_id=? AND webshop_id=? ORDER BY created_at DESC').bind(company,shop).all()).results;return reply({statuses:Object.fromEntries(rows.map((r:any)=>[r.external_id,r.status==='generated'?'Genereret':'Kræver kontrol'])),versions:Object.fromEntries(rows.map((r:any)=>[r.external_id,r.id])),generated,hasMore,nextOffset,warnings});
 }
 if(path==='/flatpay/records'||path==='/flatpay/sync'||path==='/flatpay/refunds'||path==='/viabill/records'||path==='/pensopay/records'){
  const provider=path.includes('flatpay')?'flatpay':path.includes('pensopay')?'pensopay':'viabill';
  const paymentRows=async()=>{const next=new URL(request.url);next.searchParams.set('from',[next.searchParams.get('from')||'',await dataStartDate(env,company,shop,provider)].sort().at(-1)!);const response=await handlePayments(new Request(next,{headers:request.headers}),env,actor,company,shop,provider,'records');if(!response.ok)return response;const d=await response.json() as any;const totals:Record<string,any>={};for(const r of d.rows){const t=totals[r.currency]??={currency:r.currency,count:0,amountMinor:0};t.count++;t.amountMinor+=r.amountMinor||0;}return reply({records:d.rows,totals:Object.values(totals),hasMore:d.hasMore});};
  if(get){if(provider==='viabill'&&url.searchParams.has('id')){const row=await db.prepare("SELECT payload_json FROM payment_records WHERE company_id=? AND webshop_id=? AND provider='viabill' AND kind=? AND json_extract(payload_json,'$.id')=?").bind(company,shop,url.searchParams.get('kind')||'payout',url.searchParams.get('id')).first<{payload_json:string}>();if(!row)throw new HttpError(404,'Posten findes ikke.');return reply({record:JSON.parse(row.payload_json)});}return paymentRows();}
  const b=await jsonBody(request),cutoff=await dataStartDate(env,company,shop,provider);
  const saved=await db.prepare('SELECT start_date FROM payment_connections WHERE company_id=? AND webshop_id=? AND provider=?').bind(company,shop,provider).first<{start_date:string}>();const start=[String((provider==='flatpay'&&path==='/flatpay/sync'?b.next:undefined)||b.from||b.start||cutoff),cutoff,saved?.start_date||''].sort().at(-1)!;
  const end=String(b.to||b.end||new Date().toISOString().slice(0,10));
  if(!/^\d{4}-\d{2}-\d{2}$/.test(start)||!Number.isFinite(Date.parse(start))||!/^\d{4}-\d{2}-\d{2}$/.test(end)||!Number.isFinite(Date.parse(end)))throw new HttpError(400,'Vælg en gyldig periode.');
  const boundedEnd=provider==='flatpay'&&path==='/flatpay/sync'?[end,new Date(Date.parse(start)+30*86400000).toISOString().slice(0,10)].sort()[0]:end;
  const response=await handlePayments(forwarded(request,{...b,start,end:boundedEnd,kind:b.kind||(path==='/flatpay/refunds'?'transactions':provider==='flatpay'?'payments':provider==='pensopay'?'settlements':'payout'),cursor:b.next||b.cursor}),env,actor,company,shop,provider,'records');if(!response.ok)return response;const data=await response.json() as any;
  if(path==='/flatpay/records'){const next=new URL(request.url);next.searchParams.set('kind',String(b.kind||'transactions'));next.searchParams.set('from',start);next.searchParams.set('to',end);const records:unknown[]=[];for(let offset=0;offset<=1000;offset+=50){next.searchParams.set('offset',String(offset));const response=await handlePayments(new Request(next,{headers:request.headers}),env,actor,company,shop,provider,'records');if(!response.ok)return response;const value=await response.json() as any;records.push(...value.rows);if(!value.hasMore)return reply({records});}throw new HttpError(409,'Vælg en kortere periode med højst 1000 poster.');}
  return reply({...data,...(path==='/flatpay/sync'?{next:boundedEnd<end?new Date(Date.parse(boundedEnd)+86400000).toISOString().slice(0,10):null}:{}),synced:data.count,skipped:0,mismatches:0,message:'Poster hentet. Ingen bogføring udført.'});
 }
 if(!get){const module=path.includes('payout')?'payouts':path.includes('refund')?'refunds':'payments';const response=await handleOperations(request,env,actor,company,shop,module);if(!response.ok)return response;const data=await response.json() as any;return reply({...data,synced:data.count});}
 const module=path.includes('payout')?'payouts':path.includes('refund')?'refunds':'payments';
 const bookingStatus=await bookingStatuses(env,company,shop);
 const from=await dataCutoff(env,company,shop),offset=pageNumber(url.searchParams.get('offset'),0),limit=pageNumber(url.searchParams.get('limit'),50,100)||50;
 const rows=(await db.prepare('SELECT payload_json FROM operation_snapshots WHERE company_id=? AND webshop_id=? AND module=? AND occurred_at>=? ORDER BY occurred_at DESC,external_id LIMIT 10001').bind(company,shop,module,from).all<{payload_json:string}>()).results.map(r=>JSON.parse(r.payload_json));
 if(rows.length>10000)throw new HttpError(409,'Vælg en kortere historik.');
 if(module==='payouts'){
  // Each provider stores its payouts under its own kind; Pensopay 'payments' are card payments, not payouts.
  const payments=(await db.prepare("SELECT provider,kind,payload_json,occurred_at,external_id FROM payment_records WHERE company_id=? AND webshop_id=? AND ((provider='flatpay' AND kind='payments') OR (provider='viabill' AND kind='payout') OR (provider='pensopay' AND kind='settlements')) AND occurred_at>=? ORDER BY occurred_at DESC LIMIT 10001").bind(company,shop,from).all<any>()).results;
  const list=rows.map(p=>({id:p.id,provider:'shopify_payments',label:'Shopify Payments',date:p.issuedAt,amount:Number(p.net.amount),currency:p.net.currencyCode,status:payoutStatusLabel(p.status),booking:bookingStatus('shopify','payouts',p.id,p.issuedAt,JSON.stringify(p),p.status!=='PAID'&&!['FAILED','CANCELED','CANCELLED'].includes(p.status)),canBook:false,detail:{}}));
  for(const row of payments){const p=JSON.parse(row.payload_json);if(row.provider==='pensopay'){list.push({id:row.external_id,provider:'pensopay',label:'Pensopay',date:p.payoutDate||p.date,amount:p.amountMinor/100,currency:p.currency,status:p.cancelled?'Annulleret':p.paidDate?'Udbetalt':'Kommende',booking:'not_enabled',canBook:false,detail:p});continue;}list.push({id:row.external_id,provider:row.provider,label:row.provider==='flatpay'?'Flatpay':'ViaBill',date:row.occurred_at,amount:row.provider==='flatpay'?p.payoutAmount:p.amountMinor/10**new Intl.NumberFormat('en',{style:'currency',currency:p.currency}).resolvedOptions().maximumFractionDigits!,currency:p.currency,status:row.provider==='flatpay'?(p.paidDate?'Udbetalt':'Kommende'):'Udbetalt',booking:bookingStatus(row.provider,row.kind,row.external_id,row.occurred_at,row.payload_json,row.provider==='flatpay'&&!p.paidDate),canBook:false,detail:p});}
  list.sort((a,b)=>b.date.localeCompare(a.date));return reply({total:list.length,payouts:list.slice(offset,offset+limit)});
 }
 const refundSources=new Map<string,{externalId:string;json:string}>();
 if(module==='refunds'){
  const saved=await db.prepare("SELECT metadata_json FROM payment_connections WHERE company_id=? AND webshop_id=? AND provider='flatpay'").bind(company,shop).first<{metadata_json:string}>();
  if(saved){const metadata=JSON.parse(saved.metadata_json),cutoff=await dataStartDate(env,company,shop,'flatpay');const records=(await db.prepare("SELECT external_id,payload_json FROM payment_records WHERE company_id=? AND webshop_id=? AND provider='flatpay' AND kind='transactions' AND occurred_at>=? LIMIT 10001").bind(company,shop,cutoff).all<{external_id:string;payload_json:string}>()).results;if(records.length>10000)throw new HttpError(409,'Vælg en kortere historik.');for(const r of records){try{const p=flatpayRefund(JSON.parse(r.payload_json),metadata.merchantID,metadata.agreementId);if(p){rows.push(p);refundSources.set(p.id,{externalId:r.external_id,json:r.payload_json});}}catch{throw new HttpError(409,'Flatpay-refunderingen kræver kontrol af beløbsgrundlaget.');}}}
  rows.sort((a,b)=>b.transactionDate.localeCompare(a.transactionDate));
 }
 const filtered=rows.filter(p=>(!url.searchParams.get('from')||p.transactionDate.slice(0,10)>=url.searchParams.get('from')!)&&(!url.searchParams.get('to')||p.transactionDate.slice(0,10)<=url.searchParams.get('to')!)&&(!url.searchParams.get('search')||JSON.stringify(p).toLowerCase().includes(url.searchParams.get('search')!.toLowerCase())));
 const summary:Record<string,any>={};for(const p of filtered){const c=p.amount.currencyCode;const s=summary[c]??={currency:c,count:0,gross:0,fees:0,net:0};s.count++;s.gross+=minor(p.amount.amount,c);s.fees+=minor(p.fee.amount,c);s.net+=minor(p.net.amount,c);}
 return reply({payments:filtered.slice(offset,offset+limit).map(p=>({...p,logExternalId:refundSources.get(p.id)?.externalId||p.id,bookingStatus:module==='payments'?'not_enabled':bookingStatus(p.provider==='flatpay'?'flatpay':'shopify',p.provider==='flatpay'?'transactions':'refunds',refundSources.get(p.id)?.externalId||p.id,p.transactionDate,refundSources.get(p.id)?.json||JSON.stringify(p))})),summary:Object.values(summary)});
}
