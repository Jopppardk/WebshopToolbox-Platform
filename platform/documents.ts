import { requireCompany,requireWebshop } from './auth';
import { jsonBody } from './invitations';
import { shopAccess } from './invoice-source';
import { payoutBreakdown } from './payout-calculations';
import { fetchPayoutTransactions } from './payout-source';
import { buildPayoutReport } from './payout-pdf';
import { buildFlatpayReport } from './flatpay-report';
import { readFlatpayPayout } from './flatpay-payout';
import { HttpError,reply,type Actor,type PlatformEnv } from './types';
export async function handleDocuments(request:Request,env:PlatformEnv,actor:Actor,company:string,shop:string){
 const db=env.PLATFORM_DB,url=new URL(request.url);await requireWebshop(db,actor,company,shop);
 const id=url.searchParams.get('id');
 if(request.method==='GET'&&!id){const rows=await db.prepare('SELECT external_id,id,status,created_at FROM platform_payout_documents WHERE company_id=? AND webshop_id=? ORDER BY created_at DESC LIMIT 100').bind(company,shop).all();return reply({documents:rows.results});}
 if(request.method==='GET'){
  const doc=await db.prepare("SELECT r2_key FROM platform_payout_documents WHERE company_id=? AND webshop_id=? AND id=? AND status='generated'").bind(company,shop,id).first<{r2_key:string}>();
  if(!doc)throw new HttpError(404,'Rapporten findes ikke.');const file=await env.PLATFORM_DOCUMENTS.get(doc.r2_key);if(!file)throw new HttpError(404,'Den gemte rapport mangler. Den genoprettes ikke automatisk.');
  return new Response(file.body,{headers:{'Content-Type':'application/pdf','Content-Disposition':'attachment; filename="udbetalingsrapport.pdf"'}});
 }
 if(request.method!=='POST')throw new HttpError(405,'Brug Generér rapport.');await requireCompany(db,actor,company,true);if(actor.support)throw new HttpError(403,'Afslut impersonering før rapportgenerering.');
 const b=await jsonBody(request);
 // Shopify Payments payouts use their GID; Flatpay payouts are stored as flatpay:<paymentID>.
 const flatpay=typeof b.externalId==='string'?/^flatpay:(\d{1,30})$/.exec(b.externalId):null;
 if(typeof b.externalId!=='string'||!flatpay&&!/^gid:\/\/shopify\/ShopifyPaymentsPayout\/\d+$/.test(b.externalId))throw new HttpError(400,'Vælg en udbetaling.');
 const existing=await db.prepare('SELECT id,status FROM platform_payout_documents WHERE company_id=? AND webshop_id=? AND external_id=?').bind(company,shop,b.externalId).first<{id:string;status:string}>();
 if(existing){if(existing.status!=='generated')throw new HttpError(409,'Rapportgenereringen kræver kontrol og genstartes ikke automatisk.');return reply({id:existing.id,existing:true});}
 const companyRow=await db.prepare('SELECT name FROM companies WHERE id=?').bind(company).first<{name:string}>();
 let bytes:Uint8Array,source:any;
 if(flatpay){
  const record=await db.prepare("SELECT payload_json FROM payment_records WHERE company_id=? AND webshop_id=? AND provider='flatpay' AND kind='payments' AND external_id=? AND paid=1").bind(company,shop,flatpay[1]).first<{payload_json:string}>();
  if(!record)throw new HttpError(404,'Hent Flatpay-udbetalingen først. Kun gennemførte udbetalinger har en rapport.');
  try{source=(await readFlatpayPayout(env,company,shop,flatpay[1],JSON.parse(record.payload_json).settlements)).source;bytes=await buildFlatpayReport(source,undefined,companyRow!.name);}
  catch(error){if(error instanceof HttpError)throw error;throw new HttpError(409,'Flatpay-rapporten kunne ikke kontrolleres. Hent udbetalingen igen, og kontrollér Flatpay-forbindelsen. Ingen delvis rapport gemmes.');}
 }else{
 const record=await db.prepare("SELECT payload_json FROM operation_snapshots WHERE company_id=? AND webshop_id=? AND module='payouts' AND external_id=?").bind(company,shop,b.externalId).first<{payload_json:string}>();
 if(!record)throw new HttpError(404,'Hent udbetalingen først.');
 source=JSON.parse(record.payload_json);source.provider='shopify_payments';
 try{
  const breakdown=payoutBreakdown(source.summary,source.net);
  source.transactions=await fetchPayoutTransactions(source.id,breakdown.currency,breakdown.net,await shopAccess(env,company,shop));
  bytes=await buildPayoutReport(source,companyRow!.name);
 }catch{throw new HttpError(409,'Rapporten kunne ikke kontrolleres. Hent udbetalingen igen, og kontrollér Shopify Payments-adgang, status og afstemning. Ingen delvis rapport gemmes.');}
 }
 const doc=crypto.randomUUID(),key=`companies/${company}/webshops/${shop}/payout-reports/${doc}.pdf`;
 const claim=await db.prepare("INSERT INTO platform_payout_documents(company_id,webshop_id,external_id,id,status,r2_key,source_json) VALUES(?,?,?,?,'generating',?,?) ON CONFLICT DO NOTHING").bind(company,shop,b.externalId,doc,key,JSON.stringify(source)).run();
 if(!claim.meta.changes)throw new HttpError(409,'Rapporten er allerede under generering.');
 await env.PLATFORM_DOCUMENTS.put(key,bytes,{httpMetadata:{contentType:'application/pdf'}});
 await db.prepare("UPDATE platform_payout_documents SET status='generated' WHERE id=? AND status='generating'").bind(doc).run();return reply({id:doc});
}
