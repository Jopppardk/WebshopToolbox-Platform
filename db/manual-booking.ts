import {database} from './database';
import {loadCredentials} from './credentials';
import {dineroClient, DineroHttpError} from './dinero-client';
import {runTransfer} from './sales-transfer';
import {runSinglePayout} from './payout-automation';
import {runSingleRefund} from './refund-automation';
import {flatpayDraftAction} from './flatpay-draft';
import {bookFlatpay} from './flatpay-automation';
import {shipmentDate, type InvoiceSource} from '@/lib/invoice-check';
import {TransferError,verifyVoucher,type Voucher,type Expected} from '@/lib/dinero-sale';
import {validateSettings} from '@/lib/admin-settings';

type Kind='sale'|'payout'|'refund'|'flatpay';
type Receipt={phase:string;version?:string;updatedAt:string;organizationId:string;guid?:string;draftTest?:boolean;message?:string;snapshot?:{voucher:Voucher;expected:Expected};proposal?:{voucher:Voucher;expected:Expected};[key:string]:unknown};
type Input={kind:Kind;externalId:string;action:'inspect'|'retry';version?:string;confirmed?:boolean};
const tenant='sablen.dk';
const patterns:Record<Kind,RegExp>={sale:/^gid:\/\/shopify\/Order\/\d{1,30}$/,payout:/^gid:\/\/shopify\/ShopifyPaymentsPayout\/\d{1,30}$/,refund:/^gid:\/\/shopify\/ShopifyPaymentsTransaction\/\d{1,30}$/,flatpay:/^flatpay:payout:[\w.:-]{1,180}$/};
const digest=async(value:string)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)))).map(n=>n.toString(16).padStart(2,'0')).join('');

// Confirmation is tied to the exact durable receipt. Claiming that receipt also
// excludes the scheduler; an old browser or concurrent retry cannot reset it.
export async function manualBooking(body:Input,actor:string){
 if(!body||!patterns[body.kind]?.test(body.externalId)||!['inspect','retry'].includes(body.action))throw new TransferError('Ugyldig manuel bogføring.');
 const db=database(),credentials=await loadCredentials('dinero',true);
 if(!credentials?.organizationId)throw new TransferError('Forbind Dinero først.');
 const {kind,externalId}=body,recordType=kind==='sale'?'order':kind;
 let source:InvoiceSource|undefined;
 if(kind==='flatpay'){
  const c=await loadCredentials('flatpay',true);
  const row=await db.prepare('SELECT setting_value FROM app_settings WHERE tenant=? AND setting_key=?').bind(tenant,externalId).first<{setting_value:string}>();
  const p=row?JSON.parse(row.setting_value):null;
  if(!c||!p||!externalId.startsWith(`flatpay:payout:${c.merchantID}:${c.agreementId}:`)||p.merchantID!==c.merchantID||p.agreementID!==c.agreementId||!p.paidDate||p.paidDate.slice(0,10)<c.startDate)throw new TransferError('Kun gennemførte udbetalinger på den aktuelle Flatpay-aftale kan behandles.');
 }else{
  const row=await db.prepare('SELECT booking_status,payload_json FROM integration_records WHERE tenant=? AND record_type=? AND external_id=?').bind(tenant,recordType,externalId).first<{booking_status:string;payload_json:string}>();
  if(!row)throw new TransferError('Posten findes ikke.');
  if(['booked','cancelled'].includes(row.booking_status))throw new TransferError('Posten er allerede bogført eller annulleret.');
  const data=JSON.parse(row.payload_json);
  if(kind==='sale'){source=data;if(data.cancelledAt||data.displayFulfillmentStatus!=='FULFILLED')throw new TransferError('Kun fuldt afsendte, ikke-annullerede salg kan bogføres.');}
  else if(data.provider!=='shopify_payments')throw new TransferError('Manuel bogføring understøttes ikke for denne udbyder.');
 }
 const key=kind==='flatpay'?`flatpay_draft:${credentials.organizationId}:${externalId}`:`${kind==='sale'?'sales_transfer':kind+'_production'}:${externalId}`;
 const row=await db.prepare('SELECT setting_value FROM app_settings WHERE tenant=? AND setting_key=?').bind(tenant,key).first<{setting_value:string}>();
 const state:Receipt|null=row?JSON.parse(row.setting_value):null;
 if(state&&(state.organizationId!==credentials.organizationId||state.draftTest||state.phase==='archived'))throw new TransferError('Testbilag, arkiverede bilag og bilag i andre regnskaber kræver særskilt afklaring.');
 if(state?.phase==='booked')throw new TransferError('Bilaget er allerede bogført. Opdatér oversigten.');
 if(state&&['creating','booking','recovering'].includes(state.phase)&&(!Number.isFinite(Date.parse(state.updatedAt))||Date.now()-Date.parse(state.updatedAt)<20*60*1000))throw new TransferError('Overførslen kan stadig arbejde. Vent mindst 20 minutter fra forsøgets start og kontrollér igen.');
 const version=await digest(row?.setting_value||'none');
 const wanted=state?.proposal||state?.snapshot;
 if(body.action==='inspect')return {version,phase:state?.phase||'pending',guid:state?.guid,message:state?.message,reference:wanted?.voucher.ExternalReference,organizationId:credentials.organizationId};
 if(body.confirmed!==true||body.version!==version)throw new TransferError('Bekræft kontrollen af Dinero på den aktuelle status først.');
 const claimed:Receipt={...(state||{}),phase:'recovering',organizationId:credentials.organizationId,version:crypto.randomUUID(),updatedAt:new Date().toISOString()};
 let raw=JSON.stringify(claimed);
 const claim=row?await db.prepare('UPDATE app_settings SET setting_value=?,updated_at=CURRENT_TIMESTAMP WHERE tenant=? AND setting_key=? AND setting_value=?').bind(raw,tenant,key,row.setting_value).run():await db.prepare('INSERT INTO app_settings(tenant,setting_key,setting_value) VALUES(?,?,?) ON CONFLICT DO NOTHING').bind(tenant,key,raw).run();
 if(claim.meta.changes!==1)throw new TransferError('En anden kørsel har ændret posten. Hent status igen.');
 const auditKey=`manual_booking:${crypto.randomUUID()}`;
 const audit={kind,externalId,actor,confirmedAt:claimed.updatedAt,previous:state,outcome:'started'};
 // If audit persistence fails, leave the durable claim in place and send nothing.
 await db.prepare('INSERT INTO app_settings(tenant,setting_key,setting_value) VALUES(?,?,?)').bind(tenant,auditKey,JSON.stringify(audit)).run();
 async function replace(next:Receipt|null){
  const result=next?await db.prepare('UPDATE app_settings SET setting_value=?,updated_at=CURRENT_TIMESTAMP WHERE tenant=? AND setting_key=? AND setting_value=?').bind(JSON.stringify(next),tenant,key,raw).run():await db.prepare('DELETE FROM app_settings WHERE tenant=? AND setting_key=? AND setting_value=?').bind(tenant,key,raw).run();
  if(result.meta.changes!==1)throw new TransferError('Posten blev ændret under kontrollen. Hent status igen.');
  raw=next?JSON.stringify(next):'';
 }
 try{
  let resume:Receipt|null=null;
  if(state?.guid){
   if(!wanted)throw new TransferError('Det oprindelige bogføringsgrundlag mangler.');
   const client=await dineroClient(credentials);
   let remote:unknown,missing=false;
   try{remote=await client(`vouchers/manuel/${state.guid}`,'GET');}catch(e){if(!(e instanceof DineroHttpError)||e.status!==404)throw e;missing=true;}
   if(!missing){
    const verified=verifyVoucher(remote,wanted.voucher,wanted.expected);
    if(verified.Guid.toLowerCase()!==state.guid.toLowerCase())throw new TransferError('Dinero returnerede et andet bilag.');
    resume={...state,phase:verified.Status==='Booked'?'booked':'draft',version:crypto.randomUUID(),updatedAt:new Date().toISOString(),voucherNumber:verified.VoucherNumber};
   }
  }
  await replace(resume);
  let message='';
  if(resume?.phase==='booked'){
   if(kind!=='flatpay')await db.prepare("UPDATE integration_records SET booking_status='booked' WHERE tenant=? AND record_type=? AND external_id=?").bind(tenant,recordType,externalId).run();
   message='Bilaget var allerede bogført i Dinero. Referencen er gendannet; intet nyt bilag er oprettet.';
  }else if(kind==='sale'){
   const date=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Copenhagen',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(shipmentDate(source!)));
   let result=await runTransfer({externalId,action:'prepare',date},actor);
   const approval={externalId,confirmNumber:result.state?.snapshot.invoiceNumber,noOtherBooking:true,storebuddyStopped:true};
   if(result.state?.phase==='prepared')result=await runTransfer({...approval,action:'create',version:result.state.version},actor);
   const settings=await db.prepare("SELECT setting_value FROM app_settings WHERE tenant=? AND setting_key='admin_settings'").bind(tenant).first<{setting_value:string}>();
   if(result.state?.phase==='draft'&&settings&&validateSettings(JSON.parse(settings.setting_value)).automation.salesBookDinero)result=await runTransfer({...approval,action:'book',version:result.state.version},actor);
   if(!['draft','booked'].includes(result.state?.phase||''))throw new TransferError('Salget kræver fortsat kontrol.');
   message=result.state?.phase==='booked'?'Salget er bogført i Dinero.':'Salget er oprettet som kladde, som valgt under Indstillinger.';
  }else if(kind==='payout')message=(await runSinglePayout(externalId)).message;
  else if(kind==='refund')message=(await runSingleRefund(externalId)).message;
  else{
   let result=await flatpayDraftAction({externalId,action:'preview'});
   if(result.phase==='prepared'&&'version' in result)result=await flatpayDraftAction({externalId,action:'create',version:result.version});
   if(!['draft','booked'].includes(result.phase||''))throw new TransferError('Flatpay-overførslen kræver fortsat kontrol.');
   const settings=await db.prepare("SELECT setting_value FROM app_settings WHERE tenant=? AND setting_key='admin_settings'").bind(tenant).first<{setting_value:string}>();
   const book=settings&&validateSettings(JSON.parse(settings.setting_value)).automation.payoutsBookDinero;
   if(book)await bookFlatpay(externalId,credentials);
   message=book?'Udbetalingen er bogført i Dinero med rapport.':'Udbetalingen er oprettet som kladde med rapport, som valgt under Indstillinger.';
  }
  await db.prepare('UPDATE app_settings SET setting_value=? WHERE tenant=? AND setting_key=?').bind(JSON.stringify({...audit,outcome:'completed',message,finishedAt:new Date().toISOString()}),tenant,auditKey).run();
  return {message};
 }catch(error){
  // Only undo our own claim, never overwrite a newer receipt from an external write.
  if(raw)await replace({...claimed,...state,phase:'uncertain',updatedAt:new Date().toISOString()}).catch(()=>undefined);
  await db.prepare('UPDATE app_settings SET setting_value=? WHERE tenant=? AND setting_key=?').bind(JSON.stringify({...audit,outcome:'failed',finishedAt:new Date().toISOString()}),tenant,auditKey).run();
  throw error;
 }
}
