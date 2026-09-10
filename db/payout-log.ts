import {loadCredentials} from './credentials';
import {loadHistory} from './history';
import {readFlatpayUpcoming} from './flatpay-upcoming';
import {historyWindow} from '@/lib/history-policy';
import {unifiedPayout} from '@/lib/unified-payouts';
import {payoutLogEvent,type StoredPayoutEvent,type PayoutLogData} from '@/lib/payout-log';
const tenant='sablen.dk';
export async function readPayoutLog(db:D1Database,id:string,provider:string,offset=0):Promise<PayoutLogData|null>{
 let payload:Record<string,unknown>,date:string,created:string|null=null,booking='pending';
 const ids=[id];
 if(provider==='flatpay'){
  const c=await loadCredentials('flatpay',true);if(!c)return null;
  if(id.startsWith(`flatpay:payout:${c.merchantID}:${c.agreementId}:`)){
   const row=await db.prepare('SELECT setting_value FROM app_settings WHERE tenant=? AND setting_key=?').bind(tenant,id).first<{setting_value:string}>();if(!row)return null;payload=JSON.parse(row.setting_value);
   for(const n of String(payload.settlements||'').split(/[,;\s]+/).filter(n=>/^\d{1,30}$/.test(n)).slice(0,30))ids.push(`flatpay:upcoming:${c.merchantID}:${c.agreementId}:${n}`);
  }else{const found=(await readFlatpayUpcoming(db,c)).find(p=>p.id===id);if(!found)return null;payload=found;booking='expected';}
  if(payload.merchantID!==c.merchantID||payload.agreementID!==c.agreementId)return null;
  date=String(payload.paidDate||payload.scheduledDate||'');if(date.slice(0,10)<c.startDate||date<historyWindow(await loadHistory(db)).cutoff)return null;
 }else{
  const cutoff=historyWindow(await loadHistory(db,provider==='viabill'?'viabill':'shopify')).cutoff;
  const row=await db.prepare("SELECT payload_json,occurred_at,created_at,booking_status FROM integration_records WHERE tenant=? AND record_type='payout' AND external_id=? AND json_extract(payload_json,'$.provider')=? AND occurred_at>=?").bind(tenant,id,provider,cutoff).first<{payload_json:string;occurred_at:string;created_at:string;booking_status:string}>();if(!row)return null;
  payload=JSON.parse(row.payload_json);date=row.occurred_at;created=row.created_at;booking=row.booking_status;
 }
 const dinero=await loadCredentials('dinero',true),org=dinero?.organizationId||'';
 const receiptKey=provider==='flatpay'?`flatpay_draft:${org}:${id}`:`payout_production:${id}`;
 const receipt=await db.prepare('SELECT setting_value FROM app_settings WHERE tenant=? AND setting_key=?').bind(tenant,receiptKey).first<{setting_value:string}>();
 const state=receipt?JSON.parse(receipt.setting_value):null,current=state?.organizationId===org?state:null;
 if(current)booking=current.phase;
 const slots=ids.map(()=>'?').join(',');
 const existing=await db.prepare(`SELECT kind FROM payout_events WHERE tenant=? AND external_id=? AND (organization_id='' OR organization_id=?) AND kind IN ('received','phase') GROUP BY kind`).bind(tenant,id,org).all<{kind:string}>();
 const legacy=!existing.results.some(e=>e.kind==='received');
 const fallback:StoredPayoutEvent[]=[];
 if(legacy)fallback.push({id:'legacy-received',kind:'legacy_received',at:created,data_json:'{}'});
 if(!current&&booking==='booked')fallback.push({id:'legacy-booked',kind:'legacy_phase',at:null,data_json:JSON.stringify({phase:'booked',message:'Bogført; tidspunktet er ikke bevaret.'})});
 if(current&&!existing.results.some(e=>e.kind==='phase'))fallback.push({id:'legacy-phase',kind:'legacy_phase',at:current.updatedAt||null,data_json:JSON.stringify({phase:current.phase,message:current.message})});
 // Existing manual audits preserve each separate attempt, including attempts
 // made before this journal was deployed. Only expose this ledger's audits.
 const audits=`FROM app_settings WHERE tenant=? AND setting_key GLOB 'manual_booking:*' AND json_extract(setting_value,'$.externalId')=? AND json_extract(setting_value,'$.kind') IN ('payout','flatpay') AND COALESCE(json_extract(setting_value,'$.organizationId'),json_extract(setting_value,'$.previous.organizationId'))=?`;
 const query=`SELECT * FROM (
 SELECT id,kind,at,data_json FROM payout_events WHERE tenant=? AND external_id IN (${slots}) AND (organization_id='' OR organization_id=?)
 UNION ALL SELECT setting_key||':start','manual_started',json_extract(setting_value,'$.confirmedAt'),'{}' ${audits}
 UNION ALL SELECT setting_key||':end',CASE WHEN json_extract(setting_value,'$.outcome')='completed' THEN 'manual_completed' ELSE 'manual_failed' END,json_extract(setting_value,'$.finishedAt'),json_object('message',json_extract(setting_value,'$.message')) ${audits} AND json_extract(setting_value,'$.outcome') IN ('completed','failed')
 UNION ALL SELECT json_extract(value,'$.id'),json_extract(value,'$.kind'),json_extract(value,'$.at'),json_extract(value,'$.data_json') FROM json_each(?)
 ) ORDER BY julianday(at) DESC,id DESC LIMIT 101 OFFSET ?`;
 const rows=await db.prepare(query).bind(tenant,...ids,org,tenant,id,org,tenant,id,org,JSON.stringify(fallback),offset).all<StoredPayoutEvent>();
 const payout=unifiedPayout({id,provider,date,payload_json:JSON.stringify(payload),booking_status:booking});
 const money=new Intl.NumberFormat('da-DK',{style:'currency',currency:payout.currency}).format(payout.amount);
 const details=[{label:'Udbyder',value:payout.label},{label:'Udbetalings-ID',value:String(payload.paymentID||payload.entryUUID||payload.settlementNumber||id.split('/').pop())},{label:'Beløb',value:money},{label:'Udbetalingsstatus',value:payout.status},{label:payload.paidDate?'Udbetalt den':'Udbetalingsdato',value:date.slice(0,10)}];
 if(payload.settlements)details.push({label:'Afregningsnumre',value:String(payload.settlements)});
 if(provider==='shopify_payments')details.push({label:'Retning',value:payload.transactionType==='DEPOSIT'?'Til banken':'Fra banken'});
 if(current?.guid)details.push({label:'Bilags-ID i Dinero',value:current.guid});
 if(current?.voucherNumber)details.push({label:'Bilagsnummer i Dinero',value:String(current.voucherNumber)});
 if(current?.organizationId)details.push({label:'Dinero-regnskab',value:current.organizationId});
 const voucher=current?.proposal?.voucher||current?.snapshot?.voucher;
 if(voucher?.ExternalReference)details.push({label:'Reference i Dinero',value:voucher.ExternalReference});
 if(provider==='viabill')for(const entry of (Array.isArray(payload.entries)?payload.entries:[]))details.push({label:String(entry.date)+' · '+String(entry.type),value:String(entry.text||'')+' · '+new Intl.NumberFormat('da-DK',{style:'currency',currency:entry.currency}).format(entry.amountMinor/100)});
 return {name:payout.label+' · '+details[1].value,events:rows.results.slice(0,100).map(payoutLogEvent),details,nextOffset:rows.results.length>100?offset+100:null,legacy};
}
