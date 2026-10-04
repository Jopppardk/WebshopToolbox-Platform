import {checkInvoice as originalCheck,InvoiceCheckError,units,type InvoiceSource,type MoneyBag} from '../lib/invoice-check';
export {InvoiceCheckError,invoiceFingerprint} from '../lib/invoice-check';
export type {InvoiceSource} from '../lib/invoice-check';

/** An order refunded (not edited) after purchase as it was sold: the invoice is for the original order and each
 * refund gets its own credit note. Shopify keeps the original amounts in totalPriceSet/subtotalPriceSet. */
export function originalOrder(source:InvoiceSource):InvoiceSource|null{
 const currency=source?.currentTotalPriceSet?.shopMoney?.currencyCode;
 if(!source||source.edited||!currency||!source.subtotalPriceSet)return null;
 if(units(source.totalRefundedSet,currency)===0&&!['REFUNDED','PARTIALLY_REFUNDED'].includes(source.displayFinancialStatus||''))return null;
 if(!Array.isArray(source.lineItems?.nodes))return null;
 const order=structuredClone(source),zero={...structuredClone(source.totalRefundedSet),shopMoney:{amount:'0.00',currencyCode:currency}};
 if((zero as any).presentmentMoney)(zero as any).presentmentMoney={amount:'0.00',currencyCode:(zero as any).presentmentMoney.currencyCode};
 order.lineItems.nodes=order.lineItems.nodes.map(item=>({...item,currentQuantity:item.quantity}));
 order.currentTotalPriceSet=order.totalPriceSet;order.currentTotalTaxSet=order.totalTaxSet;order.currentSubtotalPriceSet=order.subtotalPriceSet!;
 order.totalRefundedSet=zero;order.displayFinancialStatus='PAID';
 return order;
}
// Platform-only current-order validation. The legacy/Sablen validator is unchanged.
export function checkInvoice(source:InvoiceSource){
 const original=originalOrder(source);
 if(original)return originalCheck(original);
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

/** The order in the customer's currency (presentment money), e.g. SEK for a Swedish order: every amount is
 * replaced by the amount the customer paid. Booking keeps using the shop currency. */
export function inPresentment(source:InvoiceSource):InvoiceSource{
 const swap=(value:unknown):unknown=>{
  if(Array.isArray(value))return value.map(swap);
  if(!value||typeof value!=='object')return value;
  const o=value as Record<string,unknown>;
  if('shopMoney' in o&&'presentmentMoney' in o){
   if(!o.presentmentMoney)throw new InvoiceCheckError('Shopify mangler beløb i kundens valuta.');
   return {shopMoney:o.presentmentMoney};
  }
  return Object.fromEntries(Object.entries(o).map(([k,v])=>[k,swap(v)]));
 };
 return swap(source) as InvoiceSource;
}
