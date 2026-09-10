import {readFlatpayUpcoming} from '@/db/flatpay-upcoming';
import {NextRequest,NextResponse} from 'next/server';
import {prepareDatabase} from '@/db/database';
import {loadHistory} from '@/db/history';
import {historyWindow} from '@/lib/history-policy';
import {loadCredentials} from '@/db/credentials';
import {unifiedPayout} from '@/lib/unified-payouts';
export async function GET(request:NextRequest){
 const reply=(data:unknown,status=200)=>NextResponse.json(data,{status,headers:{'Cache-Control':'no-store'}});
 try{
 const offset=Number(request.nextUrl.searchParams.get('offset')||0);if(!Number.isSafeInteger(offset)||offset<0)return reply({error:'Ugyldigt sidetal.'},400);
 const db=await prepareDatabase(),{cutoff}=historyWindow(await loadHistory(db)),flatpay=await loadCredentials('flatpay',true);
 const shopifyCutoff=historyWindow(await loadHistory(db,'shopify')).cutoff,viaBillCutoff=historyWindow(await loadHistory(db,'viabill')).cutoff;
 const upcoming=await readFlatpayUpcoming(db,flatpay);
 const source=`WITH payouts AS (
 SELECT external_id id,json_extract(payload_json,'$.provider') provider,occurred_at date,payload_json,booking_status FROM integration_records WHERE tenant='sablen.dk' AND record_type='payout' AND ((occurred_at>=? AND json_extract(payload_json,'$.provider')='shopify_payments') OR (occurred_at>=? AND json_extract(payload_json,'$.provider')='viabill'))
 UNION ALL SELECT setting_key id,'flatpay' provider,COALESCE(json_extract(setting_value,'$.paidDate'),json_extract(setting_value,'$.scheduledDate')) date,setting_value payload_json,'test' booking_status FROM app_settings WHERE tenant='sablen.dk' AND setting_key LIKE 'flatpay:payout:%' AND COALESCE(json_extract(setting_value,'$.paidDate'),json_extract(setting_value,'$.scheduledDate'))>=? AND substr(COALESCE(json_extract(setting_value,'$.paidDate'),json_extract(setting_value,'$.scheduledDate')),1,10)>=? AND json_extract(setting_value,'$.merchantID')=? AND json_extract(setting_value,'$.agreementID')=?
 UNION ALL SELECT json_extract(value,'$.id') id,'flatpay' provider,json_extract(value,'$.scheduledDate') date,value payload_json,'expected' booking_status FROM json_each(?) WHERE json_extract(value,'$.scheduledDate')>=? )`;
 const args=[shopifyCutoff,viaBillCutoff,cutoff,flatpay?.startDate||'9999-12-31',flatpay?.merchantID||'',flatpay?.agreementId||'',JSON.stringify(upcoming),cutoff];
 const [rows,count]=await Promise.all([db.prepare(source+' SELECT * FROM payouts ORDER BY julianday(date) DESC,provider,id LIMIT 50 OFFSET ?').bind(...args,offset).all<{id:string;provider:string;date:string;payload_json:string;booking_status:string}>(),db.prepare(source+' SELECT COUNT(*) total FROM payouts').bind(...args).first<{total:number}>()]);
 const dinero=await loadCredentials('dinero',true);
 const config=await db.prepare("SELECT setting_value FROM app_settings WHERE tenant='sablen.dk' AND setting_key='flatpay_production'").first<{setting_value:string}>();
 const holds=config?JSON.parse(config.setting_value).holdIds:[];
 for(const row of rows.results.filter(r=>r.provider==='flatpay'&&r.booking_status!=='expected')){const state=dinero?.organizationId?await db.prepare("SELECT json_extract(setting_value,'$.phase') phase FROM app_settings WHERE tenant='sablen.dk' AND setting_key=?").bind(`flatpay_draft:${dinero.organizationId}:${row.id}`).first<{phase:string}>():null;row.booking_status=state?.phase||(Array.isArray(holds)&&holds.includes(row.id)?'held':'pending');}
 return reply({payouts:rows.results.map(unifiedPayout),total:count?.total||0});
 }catch{return reply({error:'Den samlede udbetalingsoversigt kunne ikke hentes.'},503);}
}
