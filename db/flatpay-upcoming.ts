import {flatpayRead} from '@/lib/flatpay-api';
type Scope=Record<string,string>;
type Upcoming={id:string;source:'settlement';settlementNumber:string;scheduledDate:string;paidDate:null;currency:string;payoutAmount:number;merchantID:string;agreementID:string};
const key=(c:Scope)=>`flatpay_upcoming:${c.merchantID}:${c.agreementId}`;
export async function refreshFlatpayUpcoming(db:D1Database,c:Scope,start:string,end:string){
 const rows=await flatpayRead({username:c.username,password:c.password},'settlements',{AgreementNumber:c.agreementNumber,ScheduledDateFrom:start+'T00:00:00Z',ScheduledDateTo:end+'T23:59:59.999Z'});
 const entries=new Map<string,Upcoming>();
 for(const r of rows){
  if(r.merchantID!==c.merchantID||r.agreementNumber!==c.agreementNumber||(r.agreementID!=null&&r.agreementID!==c.agreementId)||r.paidDate!=null)continue;
  if(typeof r.scheduledDate!=='string'||r.scheduledDate.slice(0,10)<start||r.scheduledDate.slice(0,10)>end)continue;
  if(!Number.isFinite(Date.parse(r.scheduledDate))||typeof r.settlementNumber!=='string'||!/^\d+$/.test(r.settlementNumber)||typeof r.netSettlement!=='number'||!Number.isFinite(r.netSettlement)||typeof r.currency!=='string'||!/^[A-Z]{3}$/.test(r.currency))throw Error('En kommende Flatpay-afregning mangler nummer, dato, valuta eller nettobeløb.');
  // Payout is zero until the actual bank payment is created. NetSettlement is
  // an estimate and must never be passed to the payout booking/report workflow.
  const value:Upcoming={id:`flatpay:upcoming:${c.merchantID}:${c.agreementId}:${r.settlementNumber}`,source:'settlement',settlementNumber:r.settlementNumber,scheduledDate:r.scheduledDate,paidDate:null,currency:r.currency,payoutAmount:r.netSettlement,merchantID:c.merchantID,agreementID:c.agreementId};
  const previous=entries.get(value.id);if(previous&&JSON.stringify(previous)!==JSON.stringify(value))throw Error('Flatpay returnerede modstridende kommende afregninger.');
  entries.set(value.id,value);
 }
 const value=JSON.stringify({entries:[...entries.values()],fetchedAt:new Date().toISOString()});
 if(value.length>1000000)throw Error('Listen over kommende Flatpay-afregninger er for stor.');
 // Replace a successful snapshot, including an empty one, to remove paid,
 // cancelled or rescheduled estimates. Failed reads preserve the last snapshot.
 const events=[...entries.values()].flatMap(entry=>{
  const previous="SELECT value FROM app_settings,json_each(json_extract(setting_value,'$.entries')) WHERE tenant='sablen.dk' AND setting_key=? AND json_extract(value,'$.id')=?";
  const at=new Date().toISOString();
  return [db.prepare(`INSERT INTO payout_events(id,tenant,external_id,kind,at,data_json) SELECT ?,'sablen.dk',?,'received',?,? WHERE NOT EXISTS(${previous}) AND NOT EXISTS(SELECT 1 FROM payout_events WHERE tenant='sablen.dk' AND external_id=? AND kind='received')`).bind(crypto.randomUUID(),entry.id,at,JSON.stringify({status:'Kommende · forventet'}),key(c),entry.id,entry.id),
   db.prepare(`INSERT INTO payout_events(id,tenant,external_id,kind,at,data_json) SELECT ?,'sablen.dk',?,'estimate',?,? FROM (${previous}) WHERE json_extract(value,'$.scheduledDate') IS NOT ? OR json_extract(value,'$.payoutAmount') IS NOT ?`).bind(crypto.randomUUID(),entry.id,at,JSON.stringify({date:entry.scheduledDate,amount:entry.payoutAmount,currency:entry.currency}),key(c),entry.id,entry.scheduledDate,entry.payoutAmount)];
 });
 const write=db.prepare("INSERT INTO app_settings(tenant,setting_key,setting_value) VALUES('sablen.dk',?,?) ON CONFLICT(tenant,setting_key) DO UPDATE SET setting_value=excluded.setting_value,updated_at=CURRENT_TIMESTAMP").bind(key(c),value);
 await db.batch([...events,write]);
 return entries.size;
}
export async function readFlatpayUpcoming(db:D1Database,c:Scope|null){
 if(!c)return [];
 const row=await db.prepare("SELECT setting_value FROM app_settings WHERE tenant='sablen.dk' AND setting_key=?").bind(key(c)).first<{setting_value:string}>();
 if(!row)return [];
 const payments=await db.prepare("SELECT json_extract(setting_value,'$.settlements') settlements FROM app_settings WHERE tenant='sablen.dk' AND substr(setting_key,1,15)='flatpay:payout:' AND json_extract(setting_value,'$.merchantID')=? AND json_extract(setting_value,'$.agreementID')=?").bind(c.merchantID,c.agreementId).all<{settlements:string|null}>();
 const actual=new Set(payments.results.flatMap(p=>(p.settlements||'').split(/[,;\s]+/)));
 return (JSON.parse(row.setting_value).entries as Upcoming[]).filter(r=>r.merchantID===c.merchantID&&r.agreementID===c.agreementId&&r.scheduledDate.slice(0,10)>=c.startDate&&!actual.has(r.settlementNumber));
}
