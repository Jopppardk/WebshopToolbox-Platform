export function orderPaymentProvider(names:unknown){
 if(!Array.isArray(names))return 'Afventer opdatering';
 const labels:Record<string,string>={shopify_payments:'Shopify Payments',shopify_payments_gateway:'Shopify Payments',paypal:'PayPal',viabill:'ViaBill',flatpay:'Flatpay',manual:'Manuel betaling',gift_card:'Gavekort'};
 const values=names.filter((v):v is string=>typeof v==='string').map(v=>v.trim()).filter(Boolean).map(v=>labels[v.toLowerCase()]||v);
 return [...new Set(values)].join(', ')||'Ikke oplyst';
}
