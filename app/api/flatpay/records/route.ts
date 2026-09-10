import {refreshFlatpayUpcoming} from '@/db/flatpay-upcoming';
import { NextResponse } from 'next/server';
import {ensureFlatpayReport,flatpayReportStateKey} from '@/db/flatpay-report';
import { database } from '@/db/database';
import { loadCredentials } from '@/db/credentials';
import { flatpayRead,flatpayDateRange } from '@/lib/flatpay-api';
const reply=(data:unknown,status=200)=>NextResponse.json(data,{status,headers:{'Cache-Control':'no-store'}});
export async function POST(request:Request){
 if(request.headers.get('origin')!==new URL(request.url).origin||!request.headers.get('content-type')?.startsWith('application/json'))return reply({error:'Start læsetesten fra Toolbox.'},403);
 try{
 const reportWarnings:string[]=[];
 const c=await loadCredentials('flatpay');if(!c)throw Error('Forbind Flatpay under Indstillinger først.');
 const b=await request.json() as {start:string;end:string;kind:string};flatpayDateRange(b.start,b.end,c.startDate);
 if(!['transactions','settlements','payments'].includes(b.kind))throw Error('Ugyldig datatype.');
 const kind=b.kind as 'transactions'|'settlements'|'payments';
 const dateField=kind==='transactions'?'PurchaseDate':kind==='settlements'?'CreatedDate':'PaidDate';
 const rows=await flatpayRead({username:c.username,password:c.password},kind,{[dateField+'From']:b.start+'T00:00:00Z',[dateField+'To']:b.end+'T23:59:59.999Z',...(kind==='settlements'?{AgreementNumber:c.agreementNumber}:{})});
 const today=new Date().toISOString().slice(0,10),upcomingEnd=new Date(Date.now()+30*86400000).toISOString().slice(0,10),upcomingStart=c.startDate>today?c.startDate:today;
 if(kind==='payments'&&upcomingStart<=upcomingEnd){const upcoming=await flatpayRead({username:c.username,password:c.password},'payments',{ScheduledDateFrom:upcomingStart+'T00:00:00Z',ScheduledDateTo:upcomingEnd+'T23:59:59.999Z'});rows.push(...upcoming.filter(r=>r.paidDate==null&&typeof r.scheduledDate==='string'&&r.scheduledDate.slice(0,10)>=upcomingStart&&r.scheduledDate.slice(0,10)<=upcomingEnd));}
 const dateKey=kind==='transactions'?'purchaseDate':kind==='settlements'?'createdDate':'paidDate';
 const selected=rows.filter(r=>r.merchantID===c.merchantID&&(kind==='payments'?r.agreementNumber===c.agreementNumber:kind==='settlements'?(r.agreementNumber===c.agreementNumber||r.agreementID===c.agreementId)&&(r.agreementNumber==null||r.agreementNumber===c.agreementNumber)&&(r.agreementID==null||r.agreementID===c.agreementId):r.agreementID===c.agreementId));
 const fields=kind==='transactions'?['transactionID','purchaseDate','registrationDate','transactionType','transactionCode','currency','grossAmount','fees','interchange','netAmount','settlementNumber','paidDate']:kind==='payments'?['paymentID','paidDate','scheduledDate','currency','payoutAmount','settlements']:['id','settlementID','settlementNumber','createdDate','paidDate','currency','grossPurchase','grossSettlement','netSettlement','payout','feeAmount','refundAmount','deduction','chargeback','rollingReserve','rollingRelease','chargebackFees','schemeFees','transactionFee','addedSum','deductedSum','balanceTransfer','otherFees'];
 const data=selected.filter(r=>(typeof r[dateKey]==='string'&&String(r[dateKey]).slice(0,10)>=b.start&&String(r[dateKey]).slice(0,10)<=b.end)||(kind==='payments'&&r.paidDate==null&&typeof r.scheduledDate==='string'&&r.scheduledDate.slice(0,10)>=upcomingStart&&r.scheduledDate.slice(0,10)<=upcomingEnd)).map(r=>Object.fromEntries(fields.map(key=>[key,typeof r[key]==='string'||typeof r[key]==='number'?r[key]:null])));
 if(kind==='payments'){
   const db=database();
   await refreshFlatpayUpcoming(db,c,upcomingStart,upcomingEnd);
   const valid=data.filter(r=>typeof r.paymentID==='string'&&r.paymentID&&typeof r.payoutAmount==='number'&&Number.isFinite(r.payoutAmount)&&typeof r.currency==='string'&&/^[A-Z]{3}$/.test(r.currency)&&typeof (r.paidDate??r.scheduledDate)==='string'&&Number.isFinite(Date.parse(String(r.paidDate??r.scheduledDate))));
   if(valid.length!==data.length)throw Error('Flatpay-udbetalingerne mangler ID, dato, valuta eller beløb og kunne ikke gemmes i oversigten.');
   for(let i=0;i<valid.length;i+=50)await db.batch(valid.slice(i,i+50).map(r=>db.prepare("INSERT INTO app_settings(tenant,setting_key,setting_value) VALUES(?,?,?) ON CONFLICT(tenant,setting_key) DO UPDATE SET setting_value=excluded.setting_value,updated_at=CURRENT_TIMESTAMP WHERE json_extract(excluded.setting_value,'$.paidDate') IS NOT NULL OR json_extract(app_settings.setting_value,'$.paidDate') IS NULL").bind('sablen.dk',`flatpay:payout:${c.merchantID}:${c.agreementId}:${r.paymentID}`,JSON.stringify({...r,merchantID:c.merchantID,agreementID:c.agreementId}))));
   for(const r of valid.filter(r=>r.paidDate).slice(0,5)){
    const id=`flatpay:payout:${c.merchantID}:${c.agreementId}:${r.paymentID}`;
    const report=await db.prepare("SELECT setting_value FROM app_settings WHERE tenant='sablen.dk' AND setting_key=?").bind(flatpayReportStateKey(id)).first();
    if(!report)try{await ensureFlatpayReport(db,id);}catch{reportWarnings.push('Rapport '+String(r.paymentID)+' kunne ikke dannes. Prøv Dan rapport under Udbetalingsrapporter.');}
   }
 }
 return reply({records:data,reportWarnings,agreementNumber:c.agreementNumber,fetchedAt:new Date().toISOString(),readOnly:true,note:'Læsning af Flatpay-data. Beløb og typer vises som leveret af API’et; ingen bogføring eller tilbagebetaling udføres.'});
 }catch(e){return reply({error:e instanceof Error?e.message:'Flatpay-data kunne ikke hentes.'},422);}
}
