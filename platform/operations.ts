import { dataCutoff } from './tier1-history';
import { payoutSummaryFields } from './payout-calculations';
import { checkInvoice } from './order-check';
import { salesDraft } from './sales-preview';
import { requireCompany, requireWebshop } from './auth';
import { jsonBody } from './invitations';
import { orderQuery, shopAccess, loadCompleteOrder } from './invoice-source';
import { HttpError, reply, type Actor, type PlatformEnv } from './types';

const page='pageInfo { hasNextPage endCursor }';
const queries:Record<string,string>={
 orders:`query ToolboxSales($after:String,$query:String!){orders(first:50,after:$after,sortKey:CREATED_AT,reverse:true,query:$query){nodes{id name createdAt updatedAt processedAt cancelledAt test displayFinancialStatus displayFulfillmentStatus fulfillments{createdAt status} paymentGatewayNames currentTotalPriceSet{shopMoney{amount currencyCode}} totalRefundedSet{shopMoney{amount currencyCode}}} ${page}}}`,
 refunds:`query ToolboxRefunds($after:String,$query:String!){shopifyPaymentsAccount{balanceTransactions(first:50,after:$after,query:$query,sortKey:PROCESSED_AT,reverse:true){nodes{id type test transactionDate amount{amount currencyCode} fee{amount currencyCode} net{amount currencyCode} associatedOrder{id name} associatedPayout{id status} sourceOrderTransactionId} ${page}}}}`,
 payouts:`query ToolboxPayouts($after:String,$query:String!){shopifyPaymentsAccount{payouts(first:50,after:$after,query:$query,sortKey:ISSUED_AT,reverse:true){nodes{id issuedAt status transactionType net{amount currencyCode} summary{${payoutSummaryFields.map(f=>f+' { amount currencyCode }').join(' ')}}} ${page}}}}`,
 inventory:`query ToolboxInventory($after:String){inventoryItems(first:25,after:$after){nodes{id tracked unitCost{amount currencyCode} variant{title sku product{title status}} inventoryLevels(first:100){nodes{location{id name isActive} quantities(names:["on_hand"]){name quantity}} ${page}}} ${page}}}`,
};
queries.payments=queries.refunds.replace('ToolboxRefunds','ToolboxPayments');
// Incremental order sync: oldest change first, so a stored watermark never skips an order.
const ordersSince=queries.orders.replace('ToolboxSales','ToolboxSalesSince').replace('sortKey:CREATED_AT,reverse:true','sortKey:UPDATED_AT,reverse:false');

type Node=Record<string,any>;
// updatedAt only moves the sync watermark; storing it would mark every edited order as changed content.
const stored=({updatedAt:_updatedAt,...n}:Node)=>JSON.stringify(n);
type Page={nodes:Node[];pageInfo:{hasNextPage:boolean;endCursor:string|null}};
function money(value:any){if(!value||typeof value.amount!=='string'||!/^[-]?\d+(\.\d+)?$/.test(value.amount)||!Number.isFinite(Number(value.amount))||!(/^[A-Z]{3}$/).test(value.currencyCode))throw new HttpError(409,'Udbyderen returnerede et ugyldigt beløb.');}
export async function handleOperations(request:Request,env:PlatformEnv,actor:Actor,company:string,shop:string,module:string){
 await requireWebshop(env.PLATFORM_DB,actor,company,shop);
 const db=env.PLATFORM_DB,url=new URL(request.url);
 if(module==='insights'&&(!actor.platformAdmin||actor.support))throw new HttpError(403,'Joboversigten findes kun i Tier 0.');
 if(module==='insights'&&request.method==='GET')return reply({runs:(await db.prepare('SELECT id,module,status,count,message,started_at,finished_at FROM operation_runs WHERE company_id=? AND webshop_id=? ORDER BY started_at DESC,id DESC LIMIT 100').bind(company,shop).all()).results});
 if(module==='connection-test'&&request.method==='POST'){
  await requireCompany(db,actor,company,true);if(actor.support)throw new HttpError(403,'Afslut impersonering før forbindelsestest.');await jsonBody(request);
  const saved=await db.prepare('SELECT credentials_encrypted FROM webshop_connections WHERE company_id=? AND webshop_id=?').bind(company,shop).first<{credentials_encrypted:string}>();
  const result=await orderQuery<{shop:{name:string}}>(await shopAccess(env,company,shop),'query ToolboxShop { shop { name } }',{});
  if(!result.shop?.name)throw new HttpError(409,'Shopify returnerede ikke butikkens navn.');
  const changed=await db.prepare('UPDATE webshop_connections SET verified_at=CURRENT_TIMESTAMP WHERE company_id=? AND webshop_id=? AND credentials_encrypted=?').bind(company,shop,saved?.credentials_encrypted||'').run();if(changed.meta.changes!==1)throw new HttpError(409,'Forbindelsen er ændret under testen. Prøv igen.');return reply({name:result.shop.name});
 }
 if(module==='sales-preview' &&request.method==='POST'){
  const b=await jsonBody(request);if(typeof b.externalId!=='string')throw new HttpError(400,'Vælg en ordre.');
  const order=await loadCompleteOrder(b.externalId,await shopAccess(env,company,shop),checkInvoice);
  const invoice=checkInvoice(order);
  const connection=await db.prepare('SELECT chart_json FROM accounting_connections WHERE company_id=?').bind(company).first<{chart_json:string}>();
  const mapping=await db.prepare('SELECT accounts_json FROM accounting_mapping WHERE company_id=?').bind(company).first<{accounts_json:string}>();
  return reply({invoice,draft:salesDraft(invoice,mapping?JSON.parse(mapping.accounts_json):{},connection?JSON.parse(connection.chart_json):[],false),externalWrites:'blocked'});
 }
 if(!queries[module])throw new HttpError(404,'Modulet findes ikke.');
 if(request.method==='GET'){
  const offset=Number(url.searchParams.get('offset')||0),search=url.searchParams.get('search')||'';
  if(!Number.isSafeInteger(offset)||offset<0||search.length>100)throw new HttpError(400,'Ugyldigt filter.');
  const rows=await db.prepare("SELECT external_id,payload_json,imported_at FROM operation_snapshots WHERE company_id=? AND webshop_id=? AND module=? AND (?='' OR instr(lower(payload_json),lower(?))>0) ORDER BY occurred_at DESC,external_id LIMIT 101 OFFSET ?").bind(company,shop,module,search,search,offset).all<{external_id:string;payload_json:string;imported_at:string}>();
  return reply({rows:rows.results.slice(0,100).map(r=>({...JSON.parse(r.payload_json),importedAt:r.imported_at})),hasMore:rows.results.length>100,offset,externalWrites:'blocked'});
 }
 if(request.method!=='POST')throw new HttpError(405,'Brug Hent data.');
 await requireCompany(db,actor,company,true);
 if(actor.support)throw new HttpError(403,'Afslut impersonering før import.');
 const b=await jsonBody(request),after=b.after??null,since=b.since??null;
 if(after!==null&&(typeof after!=='string'||!after||after.length>2048))throw new HttpError(400,'Ugyldig fortsættelse.');
 if(since!==null&&(module!=='orders'||typeof since!=='string'||!/^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/.test(since)||!Number.isFinite(Date.parse(since))))throw new HttpError(400,'Ugyldigt ændringstidspunkt.');
 const from=await dataCutoff(env,company,shop);
 const run=crypto.randomUUID();await db.prepare("INSERT INTO operation_runs(id,company_id,webshop_id,module,status) VALUES(?,?,?,?,'running')").bind(run,company,shop,module).run();
 try{
  const access=await shopAccess(env,company,shop);
  // Without read_all_orders Shopify silently returns only the last 60 days of orders.
  let warning:string|undefined;
  if(module==='orders'&&after===null&&from<new Date(Date.now()-59*86400000).toISOString()){
   const scopes=await orderQuery<{currentAppInstallation:{accessScopes:Array<{handle:string}>}}>(access,'query OrderHistoryAccess{currentAppInstallation{accessScopes{handle}}}',{},'Shopify-appens adgang kunne ikke kontrolleres.');
   if(!scopes.currentAppInstallation?.accessScopes?.some(s=>s.handle==='read_all_orders'))warning='Shopify-appen mangler read_all_orders. Shopify returnerer derfor kun ordrer fra de seneste 60 dage, selvom historikken går længere tilbage. Anmod om read_all_orders i Shopify-appen for at hente ældre ordrer.';
  }
  const data=await orderQuery<Record<string,any>>(access,since?ordersSince:queries[module],{after,...(module==='inventory'?{}:{query:module==='orders'?(since?`updated_at:>='${since}' `:'')+'created_at:>='+from:module==='payments'?`processed_at:>='${from}'`:module==='refunds'?`transaction_type:refund processed_at:>='${from}'`:`issued_at:>='${from}'`})},'Data kunne ikke hentes. Kontrollér Shopify-appens læseadgang til ordrer, Payments eller lager.');
  const connection:Page=module==='orders'?data.orders:module==='inventory'?data.inventoryItems:['refunds','payments'].includes(module)?data.shopifyPaymentsAccount?.balanceTransactions:data.shopifyPaymentsAccount?.payouts;
  if(!Array.isArray(connection?.nodes)||typeof connection.pageInfo?.hasNextPage!=='boolean'||connection.pageInfo.hasNextPage&&(!connection.pageInfo.endCursor||connection.pageInfo.endCursor===after))throw new HttpError(409,'Udbyderen returnerede en ufuldstændig side.');
  const nodes=connection.nodes.filter(n=>(module==='orders'?true:module==='refunds'?!n.test&&n.type==='REFUND':module==='payments'?!n.test:true) && (module==='inventory'||String(module==='orders'?n.createdAt:['refunds','payments'].includes(module)?n.transactionDate:n.issuedAt)>=from));
  const seen=new Set<string>();
  const statements=nodes.map(n=>{
   if(typeof n.id!=='string'||!/^gid:\/\/shopify\/[A-Za-z]+\/\d+$/.test(n.id)||seen.has(n.id))throw new HttpError(409,'Udbyderen returnerede ugyldige eller gentagne ID’er.');seen.add(n.id);
   const date=module==='inventory'?new Date().toISOString():module==='orders'?n.createdAt:['refunds','payments'].includes(module)?n.transactionDate:n.issuedAt;
   if(!Number.isFinite(Date.parse(date)))throw new HttpError(409,'Udbyderen returnerede en ugyldig dato.');
   if(module==='orders')money(n.currentTotalPriceSet?.shopMoney);
   if(module==='payouts')money(n.net);
   if(['refunds','payments'].includes(module)){[n.amount,n.fee,n.net].forEach(money);if(n.amount.currencyCode!==n.fee.currencyCode||n.amount.currencyCode!==n.net.currencyCode)throw new HttpError(409,'Tilbagebetalingen har forskellige valutaer.');}
   if(module==='inventory'){
    if(n.unitCost)money(n.unitCost);
    if(!Array.isArray(n.inventoryLevels?.nodes)||n.inventoryLevels.pageInfo?.hasNextPage!==false)throw new HttpError(409,'Lageret har flere lokationer end denne import kan vise. Ingen delvis lagerlinje gemmes.');
    // A missing on_hand quantity is not an error: such items are listed on Lager instead.
    for(const level of n.inventoryLevels.nodes)if(!level.location?.id||typeof level.location.isActive!=='boolean')throw new HttpError(409,'Ufuldstændig lagerlokation.');
   }
   return db.prepare('INSERT INTO operation_snapshots(company_id,webshop_id,module,external_id,occurred_at,payload_json) VALUES(?,?,?,?,?,?) ON CONFLICT(company_id,webshop_id,module,external_id) DO UPDATE SET occurred_at=excluded.occurred_at,payload_json=excluded.payload_json,imported_at=CURRENT_TIMESTAMP').bind(company,shop,module,n.id,new Date(date).toISOString(),stored(n));
  });
  if(module==='orders')for(const n of nodes)statements.push(db.prepare('INSERT INTO invoice_orders(company_id,webshop_id,external_id,name,created_at,payload_json) VALUES(?,?,?,?,?,?) ON CONFLICT(company_id,webshop_id,external_id) DO UPDATE SET name=excluded.name').bind(company,shop,n.id,n.name,n.createdAt,stored(n)));
  await db.batch([...statements,db.prepare("UPDATE operation_runs SET status='success',count=?,message=?,finished_at=CURRENT_TIMESTAMP WHERE id=?").bind(nodes.length,warning||'',run)]);
  const maxUpdatedAt=module==='orders'?nodes.map(n=>String(n.updatedAt||'')).filter(v=>Number.isFinite(Date.parse(v))).sort().at(-1)??null:undefined;
  return reply({count:nodes.length,...connection.pageInfo,...(warning?{warning}:{}),...(maxUpdatedAt!==undefined?{maxUpdatedAt}:{})});
 }catch(error){
  const message=error instanceof HttpError?error.message:'Importen kunne ikke gennemføres. Ingen eksterne ændringer er foretaget.';
  await db.prepare("UPDATE operation_runs SET status='failed',message=?,finished_at=CURRENT_TIMESTAMP WHERE id=?").bind(message,run).run();
  throw error;
 }
}

export async function dashboardData(env:PlatformEnv,actor:Actor,company:string){
 const db=env.PLATFORM_DB;await requireCompany(db,actor,company);
 const access=`(?=1 OR (w.status='active' AND EXISTS(SELECT 1 FROM company_memberships m WHERE m.company_id=w.company_id AND m.user_id=? AND (m.role='admin' OR EXISTS(SELECT 1 FROM webshop_memberships wm WHERE wm.company_id=w.company_id AND wm.webshop_id=w.id AND wm.user_id=m.user_id)))))`;
 const rows=await db.prepare(`SELECT o.module,count(*) count,max(o.imported_at) importedAt FROM operation_snapshots o JOIN webshops w ON w.company_id=o.company_id AND w.id=o.webshop_id WHERE o.company_id=? AND ${access} GROUP BY o.module`).bind(company,actor.platformAdmin?1:0,actor.id).all();
 const failures=await db.prepare(`SELECT count(*) count FROM operation_runs o JOIN webshops w ON w.company_id=o.company_id AND w.id=o.webshop_id WHERE o.company_id=? AND o.status='failed' AND ${access}`).bind(company,actor.platformAdmin?1:0,actor.id).first<{count:number}>();
 return reply({modules:rows.results,failedRuns:failures?.count||0});
}
