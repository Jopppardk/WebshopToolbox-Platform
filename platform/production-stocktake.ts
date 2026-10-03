import {requireCompany,requireWebshop} from './auth';
import {shopAccess} from './invoice-source';
import {readInventory} from './inventory-source';
import {unseal} from './connections';
import {readDineroAccounts,readDineroAccountBalance} from './dinero-read';
import {dineroClient,DineroHttpError} from './dinero-write';
import {financePeriods} from './finance-calculations';
import {verifyVoucher} from '../lib/dinero-sale';
import {productionWrites,bookingDate} from './production-policy';
import {readReceipt,saveReceipt,uncertainReceipt,type Receipt,type ReceiptKey} from './production-receipts';
import {HttpError,reply,type Actor,type PlatformEnv} from './types';
// The inventory account's booked balance in Dinero, read live: a reconciliation never trusts a cached ledger.
export async function dineroInventory(env:PlatformEnv,company:string,supplied?:Record<string,string>){
 const db=env.PLATFORM_DB;
 const c=await db.prepare('SELECT organization_id,credentials_encrypted FROM accounting_connections WHERE company_id=?').bind(company).first<{organization_id:string;credentials_encrypted:string}>();
 if(!c)throw new HttpError(409,'Forbind Dinero under Integrationer for at se lagerværdien i regnskabet.');
 const m=await db.prepare('SELECT accounts_json FROM accounting_mapping WHERE company_id=?').bind(company).first<{accounts_json:string}>();
 const account=Number(String(JSON.parse(m?.accounts_json||'{}').inventory||'').match(/^\d+/)?.[0])||0;
 if(!account)throw new HttpError(409,'Vælg lagerkonto under Integrationer for at se lagerværdien i Dinero.');
 try{return {organizationId:c.organization_id,...await readDineroAccountBalance(supplied||await unseal(env,[company,'dinero',c.organization_id],c.credentials_encrypted),account,financePeriods().today)};}
 catch(e){throw new HttpError(409,e instanceof Error&&/^(Dinero|Lagerkontoen)/.test(e.message)?e.message:'Lagerværdien kunne ikke hentes fra Dinero.');}
}
// The inventory account is company-wide in Dinero, so it is compared with all the company's active Shopify webshops together.
export async function companyInventory(env:PlatformEnv,company:string,shop:string,current?:Awaited<ReturnType<typeof readInventory>>){
 const ids=(await env.PLATFORM_DB.prepare("SELECT c.webshop_id id FROM webshop_connections c JOIN webshops w ON w.company_id=c.company_id AND w.id=c.webshop_id WHERE c.company_id=? AND c.provider='shopify' AND w.status='active' ORDER BY c.webshop_id").bind(company).all<{id:string}>()).results.map(r=>r.id);
 if(!ids.includes(shop))ids.push(shop);
 const reads=await Promise.all(ids.map(id=>id===shop&&current?current:readInventory(env,company,id)));
 const valueMinor=reads.reduce((sum,r)=>sum+r.totalValueMinor,0);
 if(!Number.isSafeInteger(valueMinor))throw new HttpError(409,'Ugyldig samlet lagerværdi.');
 return {shops:ids.length,valueMinor,incomplete:reads.reduce((n,r)=>n+(r.incomplete?.length||0),0),dkk:reads.every(r=>r.rows.every(x=>x.currency==='DKK'))};
}
export function assertReconcilable(all:Awaited<ReturnType<typeof companyInventory>>){
 if(!all.dkk)throw new HttpError(409,'Lagerregulering kræver kostpriser i DKK.');
 if(all.incomplete)throw new HttpError(409,`${all.incomplete} lagerstyrede varer mangler lagerantal eller kostpris i Shopify. Ret dem, før Dinero reguleres.`);
}
// A regulation still in flight, uncertain or lying as a draft is not yet in Dinero's balance; another one would count the difference twice.
export async function assertNoPendingRegulation(env:PlatformEnv,company:string,organizationId:string,credentials:Record<string,string>){
 const rows=(await env.PLATFORM_DB.prepare("SELECT phase,payload_json FROM production_receipts WHERE company_id=? AND provider='shopify' AND module='stocktake' AND destination=? AND phase IN ('prepared','creating','booking','uncertain','draft')").bind(company,organizationId).all<{phase:string;payload_json:string}>()).results;
 if(rows.some(r=>r.phase!=='draft'))throw new HttpError(409,'En tidligere lagerregulering afventer afklaring. Kontrollér Dinero, før lageret reguleres igen.');
 if(!rows.length)return;
 const client=await dineroClient(credentials);
 for(const row of rows){
  const guid=String(JSON.parse(row.payload_json).guid||'');
  if(!/^[\da-f]{8}(-[\da-f]{4}){3}-[\da-f]{12}$/i.test(guid))throw new HttpError(409,'En tidligere lagerregulering afventer afklaring. Kontrollér Dinero, før lageret reguleres igen.');
  let remote:any;try{remote=await client(`vouchers/manuel/${guid}`,'GET');}catch(e){if(e instanceof DineroHttpError&&e.status===404)continue;throw new HttpError(409,'Tidligere lagerreguleringer kunne ikke kontrolleres i Dinero.');}
  if(remote?.Status!=='Booked')throw new HttpError(409,'En lagerregulering ligger som kladde i Dinero. Bogfør eller slet kladden, før lageret reguleres igen.');
 }
}
export async function commitStocktake(env:PlatformEnv,actor:Actor,company:string,shop:string,input:Record<string,unknown>){
 await requireCompany(env.PLATFORM_DB,actor,company,true);await requireWebshop(env.PLATFORM_DB,actor,company,shop);
 if(!productionWrites(env)||actor.support||actor.platformAdmin)throw new HttpError(403,'Lagerændringer er ikke aktiveret her.');
 const db=env.PLATFORM_DB,id=String(input.id||'');
 if(!/^[a-f0-9-]{36}$/.test(id)||input.confirmation!==true)throw new HttpError(400,'Godkend en gyldig lageroptælling.');
 const state=await db.prepare('SELECT * FROM stocktakes WHERE company_id=? AND webshop_id=? AND id=?').bind(company,shop,id).first<any>();
 if(!state||state.version!==input.version||state.phase!=='prepared')throw new HttpError(409,'Forslaget er ændret eller behandlet.');
 const value=JSON.parse(state.payload_json),receiptKey:ReceiptKey={company,shop,provider:'shopify',module:'stocktake',externalId:id,destination:value.account.organizationId};
 const prior=await readReceipt(env,receiptKey);if(prior){if(['booked','draft'].includes(prior.phase))return reply({...prior.payload,phase:prior.phase,message:'Den eksisterende lagerregulering er bevaret.'});throw new HttpError(409,'Lagerreguleringen afventer afklaring. Den gentages ikke.');}
 if(value.expiresAt<Date.now())throw new HttpError(409,'Forslaget er udløbet.');
 await bookingDate(env,company,shop,'shopify',value.voucher?.VoucherDate||new Date().toISOString());
 const connection=await db.prepare('SELECT * FROM accounting_connections WHERE company_id=?').bind(company).first<any>(),mapping=await db.prepare('SELECT accounts_json FROM accounting_mapping WHERE company_id=?').bind(company).first<any>(),prefs=await db.prepare('SELECT * FROM tier1_preferences WHERE company_id=? AND webshop_id=?').bind(company,shop).first<any>();
 if(connection?.organization_id!==value.account.organizationId||connection?.revision!==value.account.revision||mapping?.accounts_json!==value.account.mapping||!prefs)throw new HttpError(409,'Opsætningen er ændret.');
 const credentials=await unseal(env,[company,'dinero',connection.organization_id],connection.credentials_encrypted),chart=await readDineroAccounts(credentials);
 if([value.account.inventory,value.account.adjustment].some(n=>!chart.some(a=>Number(a.number)===n&&!a.hidden&&!a.vatCode)))throw new HttpError(409,'Lagerkontiene er ikke længere gyldige.');
 const fresh=await readInventory(env,company,shop),reconcile=value.kind==='reconcile';
 if(reconcile){
  const all=await companyInventory(env,company,shop,fresh);assertReconcilable(all);
  if(all.valueMinor!==value.shopifyValueMinor)throw new HttpError(409,'Lagerværdien i webshoppen er ændret. Hent et nyt forslag.');
  if((await dineroInventory(env,company,credentials)).balanceMinor!==value.dineroValueMinor)throw new HttpError(409,'Lagerværdien i Dinero er ændret. Hent et nyt forslag.');
  await assertNoPendingRegulation(env,company,connection.organization_id,credentials);
 }
 for(const c of value.changes){const row=fresh.rows.find(r=>r.inventoryItemId===c.inventoryItemId&&r.locationId===c.locationId);if(!row||row.quantity!==c.compareQuantity||row.unitCostMinor!==c.unitCostMinor||row.currency!=='DKK')throw new HttpError(409,'Lagerantal eller kostpris er ændret. Hent et nyt forslag.');}
 const access=await shopAccess(env,company,shop),client=await dineroClient(credentials),book=JSON.parse(prefs.preferences_json).automation?.inventoryBookDinero===true;
 const claimPayload={...value,stocktakeVersion:state.version,connectionRevision:connection.revision,preferencesRevision:prefs.revision,mappingJson:mapping.accounts_json,approvedBy:actor.id,book};
 let claim:Receipt;
 if(reconcile){
  // One atomic claim: no other inventory regulation for this Dinero organization may be in flight or have finished since this proposal was made.
  // Otherwise two approvals of the same old balance could both book the whole difference.
  const version=crypto.randomUUID(),inserted=await db.prepare(`INSERT INTO production_receipts(company_id,webshop_id,provider,module,external_id,destination,phase,version,payload_json) SELECT ?,?,'shopify','stocktake',?,?,'prepared',?,? WHERE NOT EXISTS(SELECT 1 FROM production_receipts WHERE company_id=? AND provider='shopify' AND module='stocktake' AND destination=? AND (phase IN ('prepared','creating','booking','uncertain') OR updated_at>=?)) ON CONFLICT DO NOTHING`).bind(company,shop,id,receiptKey.destination,version,JSON.stringify(claimPayload),company,receiptKey.destination,state.created_at).run();
  if(!inserted.meta.changes)throw new HttpError(409,'En anden lagerregulering er behandlet eller i gang. Hent lagerstatus igen.');
  claim={phase:'prepared',version,payload:claimPayload};
 }else claim=await saveReceipt(env,receiptKey,null,'prepared',claimPayload);
 claim=await saveReceipt(env,receiptKey,claim,'creating',claim.payload);
 let released=false;
 try{
  if(!reconcile){
  const query='mutation SetStocktake($input:InventorySetQuantitiesInput!,$key:String!) { inventorySetQuantities(input:$input) @idempotent(key:$key) { inventoryAdjustmentGroup { createdAt } userErrors { message } } }';
  const quantities=value.changes.map((c:any)=>({inventoryItemId:c.inventoryItemId,locationId:c.locationId,quantity:c.quantity,changeFromQuantity:c.compareQuantity}));
  const response=await fetch(`https://${access.shop}/admin/api/2026-07/graphql.json`,{method:'POST',redirect:'manual',signal:AbortSignal.timeout(25000),headers:{'Content-Type':'application/json','X-Shopify-Access-Token':access.accessToken},body:JSON.stringify({query,variables:{key:id,input:{name:'on_hand',reason:'correction',referenceDocumentUri:`logistics://webshoptoolbox.dk/${shop}/stocktake/${id}`,quantities}}})});
  const result=await response.json() as any,r=result.data?.inventorySetQuantities;
  if(!response.ok||result.errors?.length||!r?.inventoryAdjustmentGroup||!Array.isArray(r.userErrors)||r.userErrors.length)throw new Error('Shopify did not confirm');
  claim=await saveReceipt(env,receiptKey,claim,'creating',{...claim.payload,shopifyUpdated:true});
  }
  if(!value.voucher){claim=await saveReceipt(env,receiptKey,claim,'booked',claim.payload);return reply({phase:'booked',message:'Lagerantal opdateret. Værdien er uændret; intet finansbilag oprettet.'});}
  const expected=[{net:-value.adjustmentMinor,tax:0,gross:-value.adjustmentMinor}];
  let created:any;
  try{created=await client('vouchers/manuel','POST',value.voucher);}
  catch(e){
   // A 4xx answer is Dinero refusing the voucher: nothing was created. A reconciliation has touched nothing else,
   // so its claim is released and the reason shown. Timeouts, 408, 429 and 5xx stay uncertain below.
   if(reconcile&&e instanceof DineroHttpError&&e.status>=400&&e.status<500&&![408,429].includes(e.status)){
    await releaseClaim(env,receiptKey,claim.version,{reason:'dinero-rejected',status:e.status,detail:e.detail},actor.id);
    released=true;throw new HttpError(409,`Dinero afviste finansbilaget (HTTP ${e.status})${e.detail?': '+e.detail:''}. Intet er bogført, og reguleringen kan prøves igen.`);
   }
   if(e instanceof DineroHttpError)claim={...claim,payload:{...claim.payload,dineroError:{status:e.status,detail:e.detail}}};
   throw e;
  }
  if(!/^[\da-f]{8}(-[\da-f]{4}){3}-[\da-f]{12}$/i.test(created?.Guid||''))throw new Error('Missing GUID');
  claim=await saveReceipt(env,receiptKey,claim,'creating',{...claim.payload,guid:created.Guid,expected});
  let remote=verifyVoucher(await client(`vouchers/manuel/${created.Guid}`,'GET'),value.voucher,expected);
  if(remote.Guid.toLowerCase()!==created.Guid.toLowerCase()||remote.Status!=='Draft')throw new Error('Unverified draft');
  claim=await saveReceipt(env,receiptKey,claim,'draft',claim.payload);
  if(book){claim=await saveReceipt(env,receiptKey,claim,'booking',claim.payload);await client(`vouchers/manuel/${created.Guid}/book`,'POST',{Timestamp:remote.Timestamp});remote=verifyVoucher(await client(`vouchers/manuel/${created.Guid}`,'GET'),value.voucher,expected);if(remote.Status!=='Booked'||remote.Guid.toLowerCase()!==created.Guid.toLowerCase())throw new Error('Unverified booking');claim=await saveReceipt(env,receiptKey,claim,'booked',{...claim.payload,voucherNumber:remote.VoucherNumber});}
  return reply({phase:claim.phase,voucherNumber:remote.VoucherNumber,message:reconcile?(book?'Lagerkontoen i Dinero er reguleret til webshoppens lagerværdi.':'Reguleringen af lagerkontoen er oprettet som kladde i Dinero. Bogfør den i Dinero.'):book?'Lageret er opdateret, og reguleringen er bogført i Dinero.':'Lageret er opdateret, og reguleringen er oprettet som kladde i Dinero.'});
 }catch(e){if(released)throw e;await uncertainReceipt(env,receiptKey,claim);throw new HttpError(409,'Lagerreguleringen er uafklaret. Kontrollér Shopify og Dinero; handlingen gentages ikke automatisk.');}
}
// Removes a reconciliation claim that is known to have no voucher in Dinero, keeping the history in record_events and the audit log.
async function releaseClaim(env:PlatformEnv,key:ReceiptKey,version:string,details:Record<string,unknown>,actorId:string){
 const db=env.PLATFORM_DB,where="company_id=? AND webshop_id=? AND provider=? AND module=? AND external_id=? AND destination=? AND version=?",args=[key.company,key.shop,key.provider,key.module,key.externalId,key.destination,version];
 const result=await db.batch([
  db.prepare("INSERT INTO record_events(company_id,webshop_id,provider,module,external_id,event,details_json) SELECT company_id,webshop_id,provider,module,external_id,'cleanup.receipt_cleared',? FROM production_receipts WHERE "+where).bind(JSON.stringify(details),...args),
  db.prepare("DELETE FROM production_receipts WHERE "+where).bind(...args),
  db.prepare("INSERT INTO audit_events(id,company_id,actor_id,action,resource_id,details_json) SELECT ?,?,?,'stocktake.released',?,? WHERE changes()=1").bind(crypto.randomUUID(),key.company,actorId,key.externalId,JSON.stringify({shop:key.shop,...details})),
 ]);
 if(result[1].meta.changes!==1)throw new HttpError(409,'Reguleringen er ændret. Hent lagerstatus igen.');
}
// Regulations that block a new one; only a reconciliation without a Dinero voucher ID can be released, after the user has checked Dinero.
export async function pendingRegulations(env:PlatformEnv,company:string){
 const rows=(await env.PLATFORM_DB.prepare("SELECT webshop_id,external_id,phase,payload_json,updated_at FROM production_receipts WHERE company_id=? AND provider='shopify' AND module='stocktake' AND destination=(SELECT organization_id FROM accounting_connections WHERE company_id=?) AND phase IN ('prepared','creating','booking','uncertain') ORDER BY updated_at DESC LIMIT 20").bind(company,company).all<{webshop_id:string;external_id:string;phase:string;payload_json:string;updated_at:string}>()).results;
 return rows.map(r=>{const p=JSON.parse(r.payload_json),stale=Date.parse(r.updated_at.replace(' ','T')+'Z')<Date.now()-15*60000;
  return {id:r.external_id,shop:r.webshop_id,phase:r.phase,at:r.updated_at,kind:p.kind==='reconcile'?'reconcile':'count',adjustmentMinor:Number(p.adjustmentMinor)||0,dineroError:p.dineroError||null,releasable:p.kind==='reconcile'&&!p.guid&&(r.phase==='uncertain'||stale)};});
}
export async function releaseRegulation(env:PlatformEnv,actor:Actor,company:string,input:Record<string,unknown>){
 await requireCompany(env.PLATFORM_DB,actor,company,true);if(actor.support)throw new HttpError(403,'Afslut impersonering før frigivelse.');
 if(input.confirmation!=='no-voucher-in-dinero'||typeof input.externalId!=='string'||!/^[a-f0-9-]{36}$/.test(input.externalId))throw new HttpError(400,'Bekræft, at der ikke findes et bilag i Dinero.');
 const found=(await pendingRegulations(env,company)).find(r=>r.id===input.externalId);
 if(!found?.releasable)throw new HttpError(409,'Reguleringen kan ikke frigives her. Kontakt support.');
 const row=await env.PLATFORM_DB.prepare("SELECT destination,version FROM production_receipts WHERE company_id=? AND webshop_id=? AND provider='shopify' AND module='stocktake' AND external_id=?").bind(company,found.shop,found.id).first<{destination:string;version:string}>();
 if(!row)throw new HttpError(409,'Reguleringen er ændret. Hent lagerstatus igen.');
 await releaseClaim(env,{company,shop:found.shop,provider:'shopify',module:'stocktake',externalId:found.id,destination:row.destination},row.version,{reason:'user-confirmed-no-voucher',phase:found.phase},actor.id);
 return reply({released:found.id,message:'Reguleringen er frigivet. Du kan regulere igen.'});
}
