import {NextResponse} from 'next/server';
import {prepareDatabase} from '@/db/database';
import {loadCredentials} from '@/db/credentials';
import {loadHistory} from '@/db/history';
import {paymentPeriod} from '@/lib/shopify-payments';
import {flatpayRead} from '@/lib/flatpay-api';
import {flatpayRefund} from '@/lib/flatpay-refunds';
export async function POST(request:Request){
 const reply=(data:unknown,status=200)=>NextResponse.json(data,{status,headers:{'Cache-Control':'no-store'}});
 if(request.headers.get('origin')!==new URL(request.url).origin||!request.headers.get('content-type')?.startsWith('application/json'))return reply({error:'Start hentningen fra Toolbox.'},403);
 try{
  const c=await loadCredentials('flatpay',true);if(!c)throw Error('Forbind Flatpay under Indstillinger først.');
  const b=await request.json() as {from:string;to:string;after?:string};const db=await prepareDatabase(),policy=await loadHistory(db);
  const range=paymentPeriod(b.from,b.to,{...policy,startDate:c.startDate>policy.startDate?c.startDate:policy.startDate});
  if(range.start>=range.end)return reply({synced:0,hasNextPage:false,endCursor:null});
  const start=b.after??range.start;if(typeof start!=='string'||!Number.isFinite(Date.parse(start))||new Date(start).toISOString()!==start||start<range.start||start>range.end)throw Error('Ugyldig fortsættelse.');
  if(start>=range.end)return reply({synced:0,hasNextPage:false,endCursor:null});
  const end=new Date(Math.min(Date.parse(start)+30*86400000,Date.parse(range.end))).toISOString();
  const rows=await flatpayRead({username:c.username,password:c.password},'transactions',{PurchaseDateFrom:start,PurchaseDateTo:new Date(Date.parse(end)-1).toISOString(),TransactionCode:'REFU06'});
  const selected=rows.map(r=>flatpayRefund(r,c.merchantID,c.agreementId)).filter(r=>r!==null&&r.transactionDate>=start&&r.transactionDate<end);
  const unique=new Map<string,NonNullable<ReturnType<typeof flatpayRefund>>>();for(const r of selected){if(!r)continue;const previous=unique.get(r.id);if(previous&&JSON.stringify(previous)!==JSON.stringify(r))throw Error('Flatpay returnerede modstridende refunderinger med samme ID.');unique.set(r.id,r);}
  const refunds=[...unique.values()];for(let i=0;i<refunds.length;i+=50)await db.batch(refunds.slice(i,i+50).map(r=>db.prepare('INSERT INTO app_settings(tenant,setting_key,setting_value) VALUES(?,?,?) ON CONFLICT(tenant,setting_key) DO UPDATE SET setting_value=excluded.setting_value,updated_at=CURRENT_TIMESTAMP').bind('sablen.dk',r.id,JSON.stringify(r))));
  return reply({synced:refunds.length,hasNextPage:end<range.end,endCursor:end<range.end?end:null});
 }catch(e){return reply({error:e instanceof Error?e.message:'Flatpay-refunderinger kunne ikke hentes.'},422);}
}
