// Salg: the order list, "Synkronisér nu", the sales preview, one order in one view and the logs.
// Part of the Tier 1 data API (tier1-data.ts); called for paths of a connected webshop.
import { orderPaymentIntegration, paymentProviders } from './catalog';
import { recordHistory } from './record-history';
import { bookingStatuses } from './booking-onboarding';
import { bookingStatusLabel } from './tier1/src/lib/booking-status';
import { requireCompany } from './auth';
import { handleOperations } from './operations';
import { runSalesNow } from './production-jobs';
import { dataCutoff } from './tier1-history';
import { orderPeriodWindow } from './tier1/src/lib/order-period';
import { formatDate } from './tier1/src/lib/format';
import { marketHold } from './order-markets';
import { orderDetail } from './order-detail';
import { labelsEnabled } from './shipmondo-labels';
import { HttpError, reply } from './types';
import { type DataContext, pageNumber } from './tier1-data-shared';

export async function orderData({ request, env, actor, company, shop, path, db, url, get }: DataContext): Promise<Response | null> {
 if(path==='/orders/detail'){if(!get)throw new HttpError(405,'Brug Hent.');return orderDetail(env,company,shop,url);}
 if(path==='/sales/preview'){
  const response=await handleOperations(request,env,actor,company,shop,'sales-preview');if(!response.ok)return response;const data=await response.json() as any;return reply({...data,notes:['Kontrollen opretter ingen bogføring.'],checkedAt:new Date().toISOString()});
 }
 // After Synkronisér nu: invoice, send and book fulfilled orders right away, as far as the automation switches allow.
 if(path==='/shopify/orders/process'){if(get)throw new HttpError(405,'Brug Synkronisér nu.');await requireCompany(env.PLATFORM_DB,actor,company,true);return reply(await runSalesNow(env,company,shop));}
 if(path==='/shopify/orders'){
  if(!get){const response=await handleOperations(request,env,actor,company,shop,'orders');if(!response.ok)return response;const data=await response.json() as any;return reply({...data,synced:data.count,invoicesCreated:0,orders:[]});}
  const offset=pageNumber(url.searchParams.get('offset'),0),limit=pageNumber(url.searchParams.get('limit'),50,100)||50;
  let period;try{period=orderPeriodWindow(url.searchParams.get('period')||'all',await dataCutoff(env,company,shop));}catch{throw new HttpError(400,'Vælg en gyldig periode.');}
  const countryFilter=url.searchParams.get('country')||'';
  if(countryFilter&&countryFilter!=='unknown'&&!/^[A-Z]{2}$/.test(countryFilter))throw new HttpError(400,'Vælg et gyldigt land.');
  const markets="FROM operation_snapshots s LEFT JOIN order_markets m ON m.company_id=s.company_id AND m.webshop_id=s.webshop_id AND m.external_id=s.external_id WHERE s.company_id=? AND s.webshop_id=? AND s.module='orders' AND s.occurred_at>=? AND s.occurred_at<? AND (?='' OR (?='unknown' AND m.country IS NULL) OR m.country=?)";
  const total=await db.prepare('SELECT count(*) AS n '+markets).bind(company,shop,period.from,period.until,countryFilter,countryFilter,countryFilter).first<{n:number}>();
  const countries=(await db.prepare("SELECT m.country,count(*) n FROM operation_snapshots s JOIN order_markets m ON m.company_id=s.company_id AND m.webshop_id=s.webshop_id AND m.external_id=s.external_id WHERE s.company_id=? AND s.webshop_id=? AND s.module='orders' AND m.country IS NOT NULL GROUP BY m.country ORDER BY n DESC").bind(company,shop).all<{country:string;n:number}>()).results;
  const rows=(await db.prepare('SELECT s.payload_json,m.country,m.currency market_currency,m.presentment_total,m.order_total,m.net_payment,(SELECT json_object(\'phase\',l.phase,\'printedAt\',l.printed_at,\'printCount\',l.print_count,\'message\',l.message) FROM shipping_labels l WHERE l.company_id=s.company_id AND l.webshop_id=s.webshop_id AND l.order_id=s.external_id) label '+markets+' ORDER BY s.occurred_at DESC,s.external_id LIMIT ? OFFSET ?').bind(company,shop,period.from,period.until,countryFilter,countryFilter,countryFilter,limit,offset).all<{payload_json:string;country:string|null;market_currency:string|null;presentment_total:string|null;order_total:string|null;net_payment:string|null;label:string|null}>()).results;
  // Statuses only for the orders on this page.
  const bookingStatus=await bookingStatuses(env,company,shop,rows.map(r=>String(JSON.parse(r.payload_json).id)));
  const held=await marketHold(db,company,shop);
  const connectedPayments=new Set((await db.prepare('SELECT provider FROM payment_connections WHERE company_id=? AND webshop_id=?').bind(company,shop).all<{provider:string}>()).results.map(r=>r.provider));
  const money=(amount:string,currency:string)=>new Intl.NumberFormat('da-DK',{style:'currency',currency}).format(Number(amount));
  const todayWindow=orderPeriodWindow('today',await dataCutoff(env,company,shop));
  const today=await db.prepare("SELECT count(*) AS n FROM operation_snapshots WHERE company_id=? AND webshop_id=? AND module='orders' AND occurred_at>=? AND occurred_at<?").bind(company,shop,todayWindow.from,todayWindow.until).first<{n:number}>();
  return reply({labels:await labelsEnabled(env,company,shop),total:total?.n||0,today:today?.n||0,countries:countries.map(c=>c.country),orders:rows.map(row=>{const o=JSON.parse(row.payload_json),m=o.currentTotalPriceSet.shopMoney;return {label:row.label?JSON.parse(row.label):null,country:row.country??null,customerCurrency:row.market_currency??null,customerTotal:row.presentment_total&&row.market_currency&&row.market_currency!==m.currencyCode?money(row.presentment_total,row.market_currency):null,id:o.name+(o.test?' (test)':''),externalId:o.id,date:formatDate(o.createdAt),createdAt:o.createdAt,shipped:o.cancelledAt?'Annulleret':o.displayFulfillmentStatus==='FULFILLED'?'Afsendt':'Ikke afsendt',amount:money(row.order_total??m.amount,m.currencyCode),realized:money(row.net_payment??String(Math.max(0,Number(m.amount)-Number(o.totalRefundedSet?.shopMoney.amount||0))),m.currencyCode),status:held(row.country??null,row.market_currency??null,m.currencyCode)?'Afventer · marked ikke sat op':bookingStatusLabel(bookingStatus('shopify','orders',o.id,o.createdAt,row.payload_json)),currency:m.currencyCode,total:m.amount,paymentStatus:o.displayFinancialStatus,paymentProvider:orderPaymentIntegration(o.paymentGatewayNames,connectedPayments)};})});
 }
 if(['/sales/log','/payouts/log','/refunds/log'].includes(path)){
  if(!get)throw new HttpError(405,'Brug Hent log.');
  const provider=url.searchParams.get('provider')||'shopify',normalized=provider==='shopify_payments'?'shopify':provider;
  if(!['shopify',...paymentProviders].includes(normalized)||path==='/sales/log'&&normalized!=='shopify')throw new HttpError(400,'Vælg en gyldig udbyder.');
  const module=path==='/sales/log'?'orders':path==='/refunds/log'?(normalized==='flatpay'?'transactions':(url.searchParams.get('externalId')||'').startsWith('gid://shopify/Refund/')?'order_refunds':'refunds'):normalized==='flatpay'?'payments':normalized==='viabill'?'payout':normalized==='pensopay'?'settlements':'payouts';
  return recordHistory(env,company,shop,normalized,module,url.searchParams.get('externalId')||'',pageNumber(url.searchParams.get('offset'),0));
 }
 return null;
}
