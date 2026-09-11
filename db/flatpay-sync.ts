import {database} from './database';
import {loadCredentials} from './credentials';
import {loadHistory} from './history';
import {historyWindow} from '@/lib/history-policy';
import {ensureFlatpayReport} from './flatpay-report';

const day=(date:string,n:number)=>new Date(Date.parse(date+'T00:00:00Z')+n*86400000).toISOString().slice(0,10);
type Dispatch=(path:string,body:Record<string,unknown>)=>Promise<Response>;
// Called under the scheduler's shared lease. Replay history as well as the recent
// window: late registrations must not disappear behind a permanent high-water mark.
export async function syncFlatpay(kind:'payouts'|'refunds',dispatch:Dispatch,now=new Date(),manual=false){
 const db=database(),c=await loadCredentials('flatpay',true);
 if(!c)return {status:'skipped' as const,message:'Flatpay er ikke forbundet.'};
 const settings=await db.prepare("SELECT setting_value FROM app_settings WHERE tenant='sablen.dk' AND setting_key='admin_settings'").first<{setting_value:string}>();
 if(!manual&&(!settings||JSON.parse(settings.setting_value)?.automation?.[kind]!==true))return {status:'skipped' as const,message:'Automatikken er fravalgt under Indstillinger.'};
 const policy=historyWindow(await loadHistory(db),now),start=[c.startDate,policy.effectiveDate].sort().at(-1)!,today=now.toISOString().slice(0,10);
 if(start>today)return {status:'skipped' as const,message:'Flatpays startdato ligger i fremtiden.'};
 const key=`flatpay_sync:${kind}`,scope=JSON.stringify([c.merchantID,c.agreementId,start]);
 const row=await db.prepare("SELECT setting_value FROM app_settings WHERE tenant='sablen.dk' AND setting_key=?").bind(key).first<{setting_value:string}>();
 const previous=row?JSON.parse(row.setting_value):null;
 const cursor=previous?.scope===scope&&typeof previous.next==='string'&&previous.next>=start&&previous.next<=today?previous.next:start;
 const end=day(cursor,27)<today?day(cursor,27):today,recent=day(today,-27)>start?day(today,-27):start;
 const ranges=[{from:cursor,to:end}];
 if(end<today)ranges.push({from:recent,to:today});
 let count=0;const reportWarnings:string[]=[];
 for(const range of ranges){
  const response=await dispatch(kind==='payouts'?'/api/flatpay/records':'/api/flatpay/refunds',kind==='payouts'?{kind:'payments',start:range.from,end:range.to}:{from:range.from,to:range.to});
  const result=await response.json() as {error?:string;records?:unknown[];synced?:number;hasNextPage?:boolean;reportWarnings?:string[]};
  if(!response.ok||result.error)throw Error(result.error||'Flatpay-hentningen fejlede.');
  if(result.hasNextPage)throw Error('Flatpay returnerede en uventet fortsættelse; perioden er ikke markeret færdig.');
  count+=result.records?.length??result.synced??0;
  reportWarnings.push(...(result.reportWarnings??[]));
 }
 // Manual refresh must not advance or overwrite the scheduler's progress.
 if(!manual)await db.prepare("INSERT INTO app_settings(tenant,setting_key,setting_value) VALUES('sablen.dk',?,?) ON CONFLICT(tenant,setting_key) DO UPDATE SET setting_value=excluded.setting_value,updated_at=CURRENT_TIMESTAMP").bind(key,JSON.stringify({scope,next:end<today?day(end,1):start})).run();
 return {reportWarnings:[...new Set(reportWarnings)],message:`${count} Flatpay-${kind==='payouts'?'udbetalinger':'refunderinger'} hentet. Historik kontrolleret til ${end}.`};
}

export async function syncFlatpayReports(){
 const db=database(),c=await loadCredentials('flatpay',true);
 if(!c)return {status:'skipped' as const,message:'Flatpay er ikke forbundet.'};
 const settings=await db.prepare("SELECT setting_value FROM app_settings WHERE tenant='sablen.dk' AND setting_key='admin_settings'").first<{setting_value:string}>();
 if(!settings||JSON.parse(settings.setting_value)?.automation?.payouts!==true)return {status:'skipped' as const,message:'Udbetalingsautomatikken er fravalgt.'};
 const rows=await db.prepare("SELECT p.setting_key FROM app_settings p LEFT JOIN app_settings r ON r.tenant=p.tenant AND r.setting_key='flatpay_report:'||p.setting_key WHERE p.tenant='sablen.dk' AND substr(p.setting_key,1,15)='flatpay:payout:' AND json_extract(p.setting_value,'$.merchantID')=? AND json_extract(p.setting_value,'$.agreementID')=? AND substr(json_extract(p.setting_value,'$.paidDate'),1,10)>=? AND r.setting_key IS NULL ORDER BY p.updated_at,p.setting_key LIMIT 5").bind(c.merchantID,c.agreementId,c.startDate).all<{setting_key:string}>();
 let failed=0;
 for(const row of rows.results){try{await ensureFlatpayReport(db,row.setting_key);}catch{failed++;await db.prepare("UPDATE app_settings SET updated_at=CURRENT_TIMESTAMP WHERE tenant='sablen.dk' AND setting_key=?").bind(row.setting_key).run();}}
 if(failed)throw Error(`${failed} Flatpay-rapporter kunne ikke dannes. Se Dokumenter → Udbetalingsrapporter.`);
 return {message:`${rows.results.length} Flatpay-rapporter dannet.`};
}
