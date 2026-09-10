export type UnifiedPayout={id:string;provider:string;label:string;date:string;amount:number;currency:string;status:string;booking:string;canBook:boolean;detail:Record<string,unknown>};
export function unifiedPayout(row:{id:string;provider:string;date:string;payload_json:string;booking_status:string}):UnifiedPayout{
 const p=JSON.parse(row.payload_json);
 if(row.provider==='shopify_payments')return {id:row.id,provider:row.provider,label:'Shopify Payments',date:row.date,amount:Number(p.net.amount),currency:p.net.currencyCode,status:({PAID:'Udbetalt',SCHEDULED:'Planlagt',IN_TRANSIT:'Under overførsel',FAILED:'Fejlet',CANCELED:'Annulleret'} as Record<string,string>)[p.status]||p.status,booking:row.booking_status,canBook:p.status==='PAID'&&p.transactionType==='DEPOSIT'&&row.booking_status!=='booked',detail:{retning:p.transactionType==='DEPOSIT'?'Til banken':'Fra banken'}};
 if(row.provider==='viabill')return {id:row.id,provider:row.provider,label:'ViaBill',date:row.date,amount:p.amountMinor/100,currency:p.currency,status:p.reconciled===false?'Beløbsdifference':'Afregnet',booking:'not_enabled',canBook:false,detail:p};
 return {id:row.id,provider:'flatpay',label:'Flatpay',date:row.date,amount:p.payoutAmount,currency:p.currency,status:'Udbetalt',booking:'test',canBook:false,detail:p};
}
