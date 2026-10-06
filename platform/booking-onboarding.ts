import { bookingSources } from './catalog';
import { readExistingVoucher } from './dinero-read';
import { requireCompany, requireWebshop } from './auth';
import { seal, unseal } from './connections';
import { jsonBody } from './invitations';
import { HttpError, reply, type Actor, type PlatformEnv } from './types';

// Shopify's updatedAt only drives the incremental sync and says nothing about the booked content. A refund (or a
// return) changes the payment status, the refunded amount and the current total, but it is booked as its own
// voucher and leaves the booked sale correct, so those fields do not make the sale "changed". A cancellation does.
const volatile=['updatedAt','displayFinancialStatus','totalRefundedSet','currentTotalPriceSet'];
export function sameSource(a?:string|null,b?:string|null){
 if(a===b)return true;
 if(!a||!b)return false;
 try{const strip=(v:string)=>{const o=JSON.parse(v);if(o&&typeof o==='object')for(const key of volatile)delete o[key];return JSON.stringify(o);};return strip(a)===strip(b);}catch{return false;}
}

export function onboardingStatus(date:string, sourceDate:string, dineroDate:string, receipt?:{voucher_status:string;source_json:string}, sourceJson?:string) {
 if(receipt) return !sameSource(receipt.source_json,sourceJson)?'booked_changed':receipt.voucher_status==='Booked'?'booked':'draft';
 if(!sourceDate||!dineroDate)return 'setup_required';
 const event=new Date(date.length===10?date+'T12:00:00Z':date);
 if(!Number.isFinite(event.getTime()))return 'uncertain';
 const day=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Copenhagen',year:'numeric',month:'2-digit',day:'2-digit'}).format(event);
 return day<[sourceDate,dineroDate].sort()[1]?'historical':'reconciliation_required';
}

// ids: the posts a page shows. Without it every receipt of the webshop is read, which grows with each booked post.
export async function bookingStatuses(env:PlatformEnv,company:string,shop:string,ids?:string[]){
 const only=ids?' AND r.external_id IN (SELECT value FROM json_each(?))':'',scope=ids?[company,shop,JSON.stringify([...new Set(ids)])]:[company,shop];
 const dates=(await env.PLATFORM_DB.prepare('SELECT provider,start_date FROM booking_start_dates WHERE company_id=? AND webshop_id=?').bind(company,shop).all<{provider:string;start_date:string}>()).results;
 const receipts=(await env.PLATFORM_DB.prepare('SELECT r.* FROM accounting_reconciliations r JOIN accounting_connections c ON c.company_id=r.company_id AND c.organization_id=r.organization_id WHERE r.company_id=? AND r.webshop_id=?'+only).bind(...scope).all<any>()).results;
 // Only what the status needs: the phase and, for booked posts, the source they were booked from.
 const live=(await env.PLATFORM_DB.prepare("SELECT r.provider,r.module,r.external_id,r.phase,CASE WHEN r.phase='booked' THEN json_extract(r.payload_json,'$.sourceJson') END AS source_json FROM production_receipts r JOIN accounting_connections c ON c.company_id=r.company_id AND c.organization_id=r.destination WHERE r.company_id=? AND r.webshop_id=?"+only).bind(...scope).all<any>()).results;
 const attempts=(await env.PLATFORM_DB.prepare('SELECT job,external_id,failures FROM production_attempts r WHERE r.company_id=? AND r.webshop_id=?'+only).bind(...scope).all<any>()).results;
 const preferences=await env.PLATFORM_DB.prepare('SELECT preferences_json FROM tier1_preferences WHERE company_id=? AND webshop_id=?').bind(company,shop).first<{preferences_json:string}>();
 const automation=preferences?JSON.parse(preferences.preferences_json).automation||{}:{};
 return (provider:string,module:string,id:string,date:string,sourceJson:string,upcoming=false)=>{
  const found=live.find(r=>r.provider===provider&&r.module===module&&r.external_id===id);
  const receipt=receipts.find(r=>r.provider===provider&&r.module===module&&r.external_id===id);
  const job=provider==='shopify'?({orders:'sales',refunds:'refunds',order_refunds:'order_refunds',payouts:'payouts'} as Record<string,string>)[module]:provider==='flatpay'&&module==='payments'?'flatpay':undefined;
  const failed=job&&attempts.some(a=>a.job===job&&a.external_id===id&&a.failures>0);
  if(found){
   if(found.phase==='booked')return !sameSource(found.source_json,sourceJson)?'booked_changed':'booked';
   if(['uncertain','held'].includes(found.phase))return 'failed_manual';
   if(failed)return found.phase==='prepared'&&automation[job==='flatpay'?'payouts':job==='order_refunds'?'refunds':job!]?'failed_retry':'failed_manual';
   return found.phase;
  }
  if(receipt)return onboardingStatus(date,'','',receipt,sourceJson);
  // A payout that has not been paid out yet is simply waiting; earlier refused attempts are not failures.
  if(upcoming)return 'expected';
  if(failed)return automation[job==='flatpay'?'payouts':job==='order_refunds'?'refunds':job!]?'failed_retry':'failed_manual';
  if(provider==='shopify'&&module==='orders'){
   const source=JSON.parse(sourceJson);
   if(!source.cancelledAt&&typeof source.displayFulfillmentStatus==='string'&&source.displayFulfillmentStatus!=='FULFILLED')return 'pending';
  }
  return onboardingStatus(date,dates.find(d=>d.provider===provider)?.start_date||'',dates.find(d=>d.provider==='dinero')?.start_date||'',undefined,sourceJson);
 };
}

const guidPattern=/^[\da-f]{8}(-[\da-f]{4}){3}-[\da-f]{12}$/i;
const hash=async(value:unknown)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(value)))),x=>x.toString(16).padStart(2,'0')).join('');

// Explicit customer-triggered, read-only Dinero verification. This does not import history
// or infer a match from an order number/amount. Confirmation binds a reviewed pair.
export async function handleReconciliation(request:Request,env:PlatformEnv,actor:Actor,company:string,shop:string){
 const db=env.PLATFORM_DB;
 await requireCompany(db,actor,company,true);
 await requireWebshop(db,actor,company,shop);
 if(request.method!=='POST')throw new HttpError(405,'Brug Kontrollér bilag.');
 const b=await jsonBody(request);
 const provider=String(b.provider||''),module=String(b.module||''),externalId=String(b.externalId||''),guid=String(b.guid||'').trim().toLowerCase();
 if(!bookingSources.includes(provider)||!guidPattern.test(guid)||!externalId||externalId.length>300)throw new HttpError(400,'Vælg datakilde, eksternt ID og et gyldigt Dinero-bilags-GUID.');
 const operation=provider==='shopify';
 if(!(operation?['orders','refunds','payouts']:provider==='flatpay'?['payments','transactions']:['payout']).includes(module))throw new HttpError(400,'Vælg en gyldig posttype.');
 const sourceQuery=operation?'SELECT payload_json,occurred_at FROM operation_snapshots WHERE company_id=? AND webshop_id=? AND module=? AND external_id=?':'SELECT payload_json,occurred_at FROM payment_records WHERE company_id=? AND webshop_id=? AND kind=? AND external_id=? AND provider=?';
 const sourceArgs=operation?[company,shop,module,externalId]:[company,shop,module,externalId,provider];
 const source=await db.prepare(sourceQuery).bind(...sourceArgs).first<{payload_json:string;occurred_at:string}>();
 if(!source)throw new HttpError(404,'Posten findes ikke i den valgte webshop. Hent den via integrationen først.');
 const connection=await db.prepare('SELECT organization_id,credentials_encrypted,revision FROM accounting_connections WHERE company_id=?').bind(company).first<any>();
 if(!connection)throw new HttpError(409,'Forbind Dinero først.');
 const credentials=await unseal(env,[company,'dinero',connection.organization_id],connection.credentials_encrypted);
 if(credentials.organizationId!==connection.organization_id)throw new HttpError(409,'Dinero-organisationen stemmer ikke.');
 const voucher=await readExistingVoucher(credentials,guid);
 const evidence={provider,module,externalId,guid,organization:connection.organization_id,revision:connection.revision,sourceHash:await hash(source),voucherHash:await hash(voucher)};
 const scope=[company,shop,actor.id,'reconciliation'];
 if(b.action==='preview')return reply({voucher,source:JSON.parse(source.payload_json),sourceDate:source.occurred_at,organization:connection.organization_id,confirmation:await seal(env,scope,{...evidence,expires:Date.now()+600000})});
 if(b.action!=='confirm'||b.confirmMatch!==true||typeof b.confirmation!=='string')throw new HttpError(400,'Kontrollér og bekræft sammenhængen først.');
 let previous:any;try{previous=await unseal(env,scope,b.confirmation);}catch{throw new HttpError(409,'Kontrollen er ugyldig. Kontrollér bilaget igen.');}
 if(previous.expires<Date.now()||!Number.isFinite(previous.expires)||Object.entries(evidence).some(([key,value])=>previous[key]!==value))throw new HttpError(409,'Posten, forbindelsen eller bilaget er ændret. Kontrollér igen.');
 if(voucher.status!=='Booked')throw new HttpError(409,'Bilaget er en kladde. Det kan ikke gemmes som bogført. Kontrollér igen efter bogføring i Dinero.');
 // Atomic preconditions: a concurrent source refresh or organization change must not
 // attach a reviewed voucher to a different snapshot. Unique GUID prevents reuse.
 const sourceExists=operation?'SELECT 1 FROM operation_snapshots WHERE company_id=? AND webshop_id=? AND module=? AND external_id=? AND payload_json=? AND occurred_at=?':'SELECT 1 FROM payment_records WHERE company_id=? AND webshop_id=? AND kind=? AND external_id=? AND provider=? AND payload_json=? AND occurred_at=?';
 try{
  const result=await db.prepare(`INSERT INTO accounting_reconciliations(company_id,webshop_id,provider,module,external_id,organization_id,voucher_guid,voucher_number,voucher_status,source_json,evidence_json,actor_id) SELECT ?,?,?,?,?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM accounting_connections WHERE company_id=? AND organization_id=? AND revision=?) AND EXISTS(${sourceExists})`).bind(company,shop,provider,module,externalId,connection.organization_id,guid,voucher.number===null?null:String(voucher.number),voucher.status,source.payload_json,JSON.stringify(voucher),actor.id,company,connection.organization_id,connection.revision,...sourceArgs,source.payload_json,source.occurred_at).run();
  if(!result.meta.changes)throw new HttpError(409,'Data er ændret. Kontrollér igen.');
 }catch(e){if(e instanceof HttpError)throw e;throw new HttpError(409,'Posten eller bilaget er allerede afstemt. Tidligere dokumentation er bevaret.');}
 return reply({ok:true,status:voucher.status==='Booked'?'booked':'draft',message:'Sammenhæng og Dinero-status gemt. Ingen bogføring er udført.'});
}
