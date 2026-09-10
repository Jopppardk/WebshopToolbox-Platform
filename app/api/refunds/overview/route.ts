import {NextRequest,NextResponse} from 'next/server';
import {prepareDatabase} from '@/db/database';
import {loadCredentials} from '@/db/credentials';
import {loadHistory} from '@/db/history';
import {paymentPeriod} from '@/lib/shopify-payments';
export async function GET(request:NextRequest){
 const reply=(data:unknown,status=200)=>NextResponse.json(data,{status,headers:{'Cache-Control':'no-store'}});
 try{
 const p=request.nextUrl.searchParams,offset=Number(p.get('offset')||0);if(!Number.isSafeInteger(offset)||offset<0)throw Error('Ugyldigt sidetal.');
 const db=await prepareDatabase(),policy=await loadHistory(db),c=await loadCredentials('flatpay',true);
 const shop=paymentPeriod(p.get('from'),p.get('to'),await loadHistory(db,'shopify'));
 const flat=paymentPeriod(p.get('from'),p.get('to'),{...policy,startDate:c&&c.startDate>policy.startDate?c.startDate:policy.startDate});
 const search=(p.get('search')||'').trim().slice(0,100);
 const source=`WITH refunds AS (
 SELECT external_id id,occurred_at date,payload_json,booking_status,currency,amount_minor gross,json_extract(payload_json,'$.feeMinor') fees,json_extract(payload_json,'$.netMinor') net FROM integration_records WHERE tenant='sablen.dk' AND record_type='refund' AND json_extract(payload_json,'$.provider')='shopify_payments' AND occurred_at>=? AND occurred_at<?
 UNION ALL SELECT setting_key id,json_extract(setting_value,'$.transactionDate') date,setting_value payload_json,'not_enabled' booking_status,json_extract(setting_value,'$.amount.currencyCode') currency,json_extract(setting_value,'$.grossMinor') gross,json_extract(setting_value,'$.feeMinor') fees,json_extract(setting_value,'$.netMinor') net FROM app_settings WHERE tenant='sablen.dk' AND setting_key LIKE 'flatpay:refund:%' AND json_extract(setting_value,'$.transactionDate')>=? AND json_extract(setting_value,'$.transactionDate')<? AND json_extract(setting_value,'$.merchantID')=? AND json_extract(setting_value,'$.agreementID')=?
 ),filtered AS (SELECT * FROM refunds WHERE ?='' OR instr(lower(COALESCE(json_extract(payload_json,'$.associatedOrder.name'),'')||' '||id||' '||COALESCE(json_extract(payload_json,'$.settlementNumber'),'')),lower(?))>0)`;
 const args=[shop.start,shop.end,flat.start,flat.end,c?.merchantID||'',c?.agreementId||'',search,search];
 const [rows,summary]=await Promise.all([db.prepare(source+' SELECT * FROM filtered ORDER BY date DESC,id DESC LIMIT 50 OFFSET ?').bind(...args,offset).all<{id:string;payload_json:string;booking_status:string}>(),db.prepare(source+' SELECT currency,COUNT(*) count,SUM(gross) gross,SUM(fees) fees,SUM(net) net FROM filtered GROUP BY currency ORDER BY currency').bind(...args).all()]);
 return reply({payments:rows.results.map(r=>({...JSON.parse(r.payload_json),id:r.id,bookingStatus:r.booking_status})),summary:summary.results});
 }catch(e){return reply({error:e instanceof Error?e.message:'Tilbagebetalingerne kunne ikke vises.'},400);}
}
