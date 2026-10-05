import {checkInvoice,invoiceFingerprint} from './order-check';
import {shipmentDate} from '../lib/invoice-check';
import {shopAccess,loadCompleteOrder} from './invoice-source';
import {readDineroAccounts} from './dinero-read';
import {salesDraft} from './sales-preview';
import {voucherFor} from '../lib/dinero-sale';
import {handleProductionBooking,type BookingContext} from './production-booking';
import {bookingDate} from './production-policy';
import {foreignHold,isForeignOrder,orderMarketSettings} from './order-markets';
import {HttpError,type Actor,type PlatformEnv} from './types';
export {bookingDate,productionWrites} from './production-policy';
export async function handleProductionSale(request:Request,env:PlatformEnv,actor:Actor,company:string,shop:string){
 return handleProductionBooking(request,env,actor,company,shop,'sale','orders','shopify',/^gid:\/\/shopify\/Order\/\d{1,30}$/,prepareSale);
}
async function prepareSale({env,company,shop,id,credentials,mapping,prefs}:BookingContext){
 const db=env.PLATFORM_DB;
 if(await isForeignOrder(db,company,shop,id))throw new HttpError(409,foreignHold);
 const order=await loadCompleteOrder(id,await shopAccess(env,company,shop),checkInvoice),invoice=checkInvoice(order);
 const date=await bookingDate(env,company,shop,'shopify',shipmentDate(order));
 const automation=JSON.parse(prefs.preferences_json).automation,book=automation?.salesBookDinero===true;
 // Orders from an enabled market are booked in DKK (Shopify's shop currency) with Danish VAT, like Danish orders.
 const market=await orderMarketSettings(db,company,shop,id);
 const draft=salesDraft(invoice,JSON.parse(mapping.accounts_json),await readDineroAccounts(credentials),automation?.inventory===true,market?.countries??[]);
 const proposal=voucherFor(invoice,draft,date);
 proposal.voucher.ExternalReference=`wtb:${shop}:sale:${id.split('/').pop()}`;
 const fingerprint=await invoiceFingerprint(invoice);
 const pdf=await db.prepare("SELECT r2_key,fingerprint FROM platform_invoices WHERE company_id=? AND webshop_id=? AND external_id=? AND status='generated'").bind(company,shop,id).first<any>();
 if(!pdf||pdf.fingerprint!==fingerprint)throw new HttpError(409,'Generér en faktura-PDF, der svarer til den aktuelle ordre, først.');
 const file=await env.PLATFORM_DOCUMENTS.get(pdf.r2_key);if(!file||file.size>6000000)throw new HttpError(409,'Faktura-PDF mangler eller er for stor.');
 return {snapshot:{...proposal,fingerprint,pdfKey:pdf.r2_key,pdfEtag:file.etag,book,attach:automation?.attachments===true,number:invoice.number},file:automation?.attachments===true?file:undefined};
}
