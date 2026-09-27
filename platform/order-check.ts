import {checkInvoice as originalCheck,InvoiceCheckError,units,type InvoiceSource,type MoneyBag} from '../lib/invoice-check';
export {InvoiceCheckError,invoiceFingerprint} from '../lib/invoice-check';
export type {InvoiceSource} from '../lib/invoice-check';

// Platform-only current-order validation. The legacy/Sablen validator is unchanged.
export function checkInvoice(source:InvoiceSource){
 if(!source?.edited)return originalCheck(source);
 const order=structuredClone(source),currency=order.currentTotalPriceSet?.shopMoney?.currencyCode;
 if(!currency)return originalCheck(source);
 if(units(order.totalRefundedSet,currency)!==0||['REFUNDED','PARTIALLY_REFUNDED'].includes(order.displayFinancialStatus||''))return originalCheck(source);
 if(!Array.isArray(order.lineItems?.nodes)||!Array.isArray(order.shippingLines?.nodes)||order.lineItems.pageInfo?.hasNextPage!==false||order.shippingLines.pageInfo?.hasNextPage!==false)return originalCheck(source);
 const bag=(minor:number):MoneyBag=>{
  if(!Number.isSafeInteger(minor)||minor<0)throw new InvoiceCheckError('De aktuelle ordrebeløb kunne ikke afstemmes.');
  const digits=new Intl.NumberFormat('en',{style:'currency',currency}).resolvedOptions().maximumFractionDigits!;
  return {shopMoney:{amount:(minor/10**digits).toFixed(digits),currencyCode:currency}};
 };
 // Retain all duplicate-ID checks even for removed rows.
 const seen=new Set<string>();
 for(const item of [...order.lineItems.nodes,...order.shippingLines.nodes]){
  if(!item.id||seen.has(item.id))throw new InvoiceCheckError('En vare-/fragtlinje mangler ID eller forekommer flere gange.');seen.add(item.id);
 }
 order.lineItems.nodes=order.lineItems.nodes.filter(item=>{
  if(!Number.isSafeInteger(item.currentQuantity)||item.currentQuantity<0||!Number.isSafeInteger(item.quantity)||item.quantity<=0||item.currentQuantity>item.quantity)throw new InvoiceCheckError('Ordren har et ugyldigt aktuelt antal.');
  return item.currentQuantity>0;
 }).map(item=>{
  const current=item as typeof item & {priceAfterAllDiscountsBeforeTaxesSet?:MoneyBag;originalUnitPriceSet?:MoneyBag};
  if(!current.priceAfterAllDiscountsBeforeTaxesSet||!current.originalUnitPriceSet)throw new InvoiceCheckError('Shopify mangler aktuelle beløb for den redigerede ordre. Hent ordren igen.');
  const net=units(current.priceAfterAllDiscountsBeforeTaxesSet,currency);
  // Shopify taxLines include removed quantities. Prorate their exact reported tax;
  // the complete result must still reconcile exactly with current order tax/total.
  if(!Array.isArray(item.taxLines))throw new InvoiceCheckError('Shopify mangler momsoplysninger.');
  const taxLines=item.taxLines.map(t=>({...t,priceSet:bag(Math.round(units(t.priceSet,currency)*item.currentQuantity/item.quantity))}));
  const tax=taxLines.reduce((s,t)=>s+units(t.priceSet,currency),0);
  const original=units(current.originalUnitPriceSet,currency)*item.currentQuantity;
  const discount=original-net-(order.taxesIncluded?tax:0);
  return {...item,quantity:item.currentQuantity,originalTotalSet:bag(net+discount),discountAllocations:[{allocatedAmountSet:bag(discount)}],taxLines};
 });
 order.shippingLines.nodes=order.shippingLines.nodes.filter(s=>s.isRemoved!==true).map(s=>{
  if(!order.taxesIncluded)return s;
  if(!Array.isArray(s.taxLines))throw new InvoiceCheckError('Shopify mangler fragtmoms.');
  const tax=s.taxLines.reduce((total,t)=>total+units(t.priceSet,currency),0);
  return {...s,originalPriceSet:bag(units(s.originalPriceSet,currency)-tax),discountedPriceSet:bag(units(s.discountedPriceSet,currency)-tax)};
 });
 const goodsTax=order.lineItems.nodes.reduce((s,l)=>s+l.taxLines.reduce((a,t)=>a+units(t.priceSet,currency),0),0);
 // Validate the actual current subtotal, not a reconstructed balancing amount.
 if(source.taxesIncluded)order.currentSubtotalPriceSet=bag(units(source.currentSubtotalPriceSet,currency)-goodsTax);
 order.edited=false;order.taxesIncluded=false;
 order.totalPriceSet=order.currentTotalPriceSet;order.totalTaxSet=order.currentTotalTaxSet;
 const checked=originalCheck(order);
 return {...checked,taxesIncluded:source.taxesIncluded};
}
