import { NextResponse } from 'next/server';
import { loadCredentials } from '@/db/credentials';
import { flatpayRead,flatpayDateRange } from '@/lib/flatpay-api';
const reply=(data:unknown,status=200)=>NextResponse.json(data,{status,headers:{'Cache-Control':'no-store'}});
export async function POST(request:Request){
 if(request.headers.get('origin')!==new URL(request.url).origin||!request.headers.get('content-type')?.startsWith('application/json'))return reply({error:'Start læsetesten fra Toolbox.'},403);
 try{
 const c=await loadCredentials('flatpay');if(!c)throw Error('Forbind Flatpay under Indstillinger først.');
 const b=await request.json() as {start:string;end:string;kind:string};flatpayDateRange(b.start,b.end,c.startDate);
 if(!['transactions','settlements','payments'].includes(b.kind))throw Error('Ugyldig datatype.');
 const kind=b.kind as 'transactions'|'settlements'|'payments';
 const dateField=kind==='transactions'?'PurchaseDate':kind==='settlements'?'CreatedDate':'PaidDate';
 const rows=await flatpayRead({username:c.username,password:c.password},kind,{[dateField+'From']:b.start+'T00:00:00Z',[dateField+'To']:b.end+'T23:59:59.999Z',...(kind==='settlements'?{AgreementNumber:c.agreementNumber}:{})});
 const dateKey=kind==='transactions'?'purchaseDate':kind==='settlements'?'createdDate':'paidDate';
 const selected=rows.filter(r=>r.merchantID===c.merchantID&&(kind==='payments'?r.agreementNumber===c.agreementNumber:r.agreementID===c.agreementId));
 const fields=kind==='transactions'?['transactionID','purchaseDate','registrationDate','transactionType','transactionCode','currency','grossAmount','fees','interchange','netAmount','settlementNumber','paidDate']:kind==='payments'?['paymentID','paidDate','scheduledDate','currency','payoutAmount','settlements']:['settlementID','settlementNumber','createdDate','paidDate','currency','grossPurchase','grossSettlement','netSettlement','payout','feeAmount','refundAmount','deduction','chargeback','rollingReserve','rollingRelease','chargebackFees','schemeFees','transactionFee','addedSum','deductedSum','balanceTransfer','otherFees'];
 const data=selected.filter(r=>typeof r[dateKey]==='string'&&String(r[dateKey]).slice(0,10)>=b.start&&String(r[dateKey]).slice(0,10)<=b.end).map(r=>Object.fromEntries(fields.map(key=>[key,typeof r[key]==='string'||typeof r[key]==='number'?r[key]:null])));
 return reply({records:data,agreementNumber:c.agreementNumber,fetchedAt:new Date().toISOString(),readOnly:true,note:'Læsning af Flatpay-data. Beløb og typer vises som leveret af API’et; ingen bogføring eller tilbagebetaling udføres.'});
 }catch(e){return reply({error:e instanceof Error?e.message:'Flatpay-data kunne ikke hentes.'},422);}
}
