import {recordFailure} from './record-history';
import {PDFDocument} from 'pdf-lib';
import {invoiceDesign,exampleInvoice} from './invoice-design';
import { historyPolicy } from './tier1-history';
import { requireCompany, requireWebshop } from './auth';
import { HttpError, reply, type Actor, type PlatformEnv } from './types';
import { jsonBody } from './invitations';
import { handleMail, sendCustomerInvoice } from './mail';
import { buildInvoicePdf } from './invoice-pdf';
import { shopAccess, listInvoiceOrders, loadCompleteOrder } from './invoice-source';
import { checkInvoice, invoiceFingerprint, type InvoiceSource } from './order-check';

type Settings={name:string;address:string;cvr:string;contact:string;subject:string;body:string;months:number;logo_key:string|null;design_json?:string;revision?:number};
const template={subject:'Faktura {{fakturanummer}} fra {{virksomhedsnavn}}',body:'Hej {{kundenavn}}\n\nTak for din ordre hos {{virksomhedsnavn}}.\n\nVedhæftet finder du faktura {{fakturanummer}} for ordre {{ordrenummer}}.\n\nVenlig hilsen\n{{virksomhedsnavn}}'};
async function settings(env:PlatformEnv,company:string):Promise<Settings>{
 return await env.PLATFORM_DB.prepare('SELECT * FROM invoice_settings WHERE company_id=?').bind(company).first<Settings>() || {name:(await env.PLATFORM_DB.prepare('SELECT name FROM companies WHERE id=?').bind(company).first<{name:string}>)!.name,address:'',cvr:'',contact:'',...template,months:3,logo_key:null};
}
function text(value:unknown,max:number){if(typeof value!=='string'||!value.trim()||value.length>max||/[\x00-\x08\x0b-\x1f]/.test(value))throw new HttpError(400,'Udfyld fakturaoplysningerne korrekt.');return value.trim();}
function cutoff(s:Settings){const d=new Date();d.setUTCMonth(d.getUTCMonth()-s.months);return d.toISOString();}
function ready(s:Settings){if(!s.address||!s.cvr||!s.contact)throw new HttpError(409,'Udfyld virksomhedens fakturaoplysninger under Indstillinger → Fakturaer først.');}
export function invoiceText(s:Settings,order:InvoiceSource){const i=checkInvoice(order),values:Record<string,string>={kundenavn:i.customer.name,fakturanummer:i.number.replace(/^#/,''),ordrenummer:i.number,virksomhedsnavn:s.name};const apply=(v:string)=>v.replace(/{{\s*([a-zæøå]+)\s*}}/gi,(all,k)=>values[k.toLowerCase()]??all);return {subject:apply(s.subject),text:apply(s.body)};}
function audit(env:PlatformEnv,actor:Actor,company:string,action:string,id:string){return env.PLATFORM_DB.prepare('INSERT INTO audit_events(id,company_id,actor_id,action,resource_id,details_json) VALUES(?,?,?,?,?,?)').bind(crypto.randomUUID(),company,actor.support?.adminId||actor.id,action,id,JSON.stringify(actor.support?{impersonatedUser:actor.id,supportSession:actor.support.sessionId}:{}));}
async function invoices(request:Request,env:PlatformEnv,actor:Actor,company:string,action=''):Promise<Response>{
 const url=new URL(request.url),db=env.PLATFORM_DB;
 await requireCompany(db,actor,company,request.method!=='GET');
 const s=await settings(env,company);s.months=(await historyPolicy(env,company)).months;
 if(action==='test-latest'&&request.method==='POST'){
  if(actor.support)throw new HttpError(403,'Afslut supportadgang før testmail.');
  const b=await jsonBody(request);
  const latest=await db.prepare("SELECT i.webshop_id,i.external_id FROM platform_invoices i JOIN webshops w ON w.company_id=i.company_id AND w.id=i.webshop_id WHERE i.company_id=? AND i.status='generated' AND w.status='active' ORDER BY i.created_at DESC,i.id DESC LIMIT 1").bind(company).first<{webshop_id:string;external_id:string}>();
  if(!latest)throw new HttpError(409,'Generér først en PDF under Fakturaer.');
  return handleInvoices(new Request(request.url,{method:'POST',headers:request.headers,body:JSON.stringify({requestId:b.requestId,mode:b.mode,webshopId:latest.webshop_id,externalId:latest.external_id})}),env,actor,company,'test');
 }

 if(action==='preview'&&request.method==='GET'||action==='example-test'&&request.method==='POST'){
  const input=action==='example-test'?await jsonBody(request):{};
  if(action==='example-test'&&actor.support)throw new HttpError(403,'Afslut supportadgang før testmail.');
  const shop=String(input.webshopId||url.searchParams.get('webshopId')||'');await requireWebshop(db,actor,company,shop);
  const webshop=await db.prepare('SELECT name FROM webshops WHERE company_id=? AND id=?').bind(company,shop).first<{name:string}>();
  let logo:ArrayBuffer|undefined;if(s.logo_key){const f=await env.PLATFORM_DOCUMENTS.get(s.logo_key);if(!f)throw new HttpError(409,'Logoet mangler. Upload det igen.');logo=await f.arrayBuffer();}
  const bytes=await buildInvoicePdf(exampleInvoice(),{...s,address:s.address||'Eksempelvej 1, 1000 København',cvr:s.cvr||'00000000',contact:s.contact||'faktura@example.dk',webshopName:webshop!.name,design:invoiceDesign(JSON.parse(s.design_json||'{}')),example:true},logo);
  if(action==='example-test'){
   const sender=await db.prepare('SELECT custom_from,revision,verified_revision FROM company_mail WHERE company_id=?').bind(company).first<{custom_from:string;revision:string;verified_revision:string|null}>();
   const rendered=invoiceText(s,exampleInvoice());
   const mailRequest=new Request(request.url,{method:'POST',headers:request.headers,body:JSON.stringify({recipient:input.recipient,requestId:input.requestId,mode:sender?.custom_from?'custom':'standard'})});
   return handleMail(mailRequest,env,actor,company,'test',{subject:'[TEST · DEMO] '+rendered.subject,text:rendered.text+'\n\nDEMO – Eksempelfaktura med fiktive data. Ingen rigtig ordre, faktura eller bogføring er oprettet.',allowAnyRecipient:true,attachment:{content:bytes.slice().buffer as ArrayBuffer,filename:'eksempelfaktura.pdf',type:'application/pdf',disposition:'attachment'}});
  }
  return new Response(bytes.slice().buffer as ArrayBuffer,{headers:{'Content-Type':'application/pdf','Content-Disposition':'inline; filename="eksempelfaktura.pdf"','Cache-Control':'no-store'}});
 }
 if(action==='settings'){
  if(request.method==='GET')return reply({...s,logo_key:undefined,design_json:undefined,design:invoiceDesign(JSON.parse(s.design_json||'{}')),revision:s.revision||0,hasLogo:!!s.logo_key});
  if(actor.support)throw new HttpError(403,'Afslut supportadgang før fakturaopsætning.');
  const b=await jsonBody(request,12000);
  if(request.method!=='PUT')throw new HttpError(405,'Brug Gem.');
  const v={name:text(b.name,120),address:text(b.address,180),cvr:text(b.cvr,30),contact:text(b.contact,100),subject:text(b.subject,200),body:text(b.body,4000),months:Number(b.months)};
  if(/[\r\n]/.test(v.name+v.address+v.cvr+v.contact+v.subject)||!Number.isInteger(v.months)||v.months<1||v.months>120)throw new HttpError(400,'Kontrollér fakturaoplysninger og historik.');
  const design=invoiceDesign(b.design??JSON.parse(s.design_json||'{}'));if(b.revision!==undefined&&b.revision!==(s.revision||0))throw new HttpError(409,'Fakturaindstillingerne er ændret. Genindlæs.');
  const result=await db.batch([db.prepare(`INSERT INTO invoice_settings(company_id,name,address,cvr,contact,subject,body,months,design_json) VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(company_id) DO UPDATE SET name=excluded.name,address=excluded.address,cvr=excluded.cvr,contact=excluded.contact,subject=excluded.subject,body=excluded.body,months=excluded.months,design_json=excluded.design_json,revision=invoice_settings.revision+1 WHERE invoice_settings.revision=?`).bind(company,v.name,v.address,v.cvr,v.contact,v.subject,v.body,v.months,JSON.stringify(design),s.revision||0),audit(env,actor,company,'invoice.settings.saved',company)]);
  if(result[0].meta.changes!==1)throw new HttpError(409,'Fakturaindstillingerne er ændret. Genindlæs.');return reply({ok:true});
 }
 if(action==='logo'){
  if(request.method==='GET'){if(!s.logo_key)throw new HttpError(404,'Intet logo gemt.');const file=await env.PLATFORM_DOCUMENTS.get(s.logo_key);if(!file)throw new HttpError(404,'Logo mangler.');return new Response(file.body,{headers:{'Content-Type':'image/png','Cache-Control':'no-store'}});}
  if(request.method==='DELETE'&&!actor.support){await db.batch([db.prepare('UPDATE invoice_settings SET logo_key=NULL,revision=revision+1 WHERE company_id=?').bind(company),audit(env,actor,company,'invoice.logo.removed',company)]);return reply({ok:true});}
  if(request.method!=='PUT'||actor.support||request.headers.get('origin')!==url.origin||request.headers.get('content-type')!=='image/png')throw new HttpError(403,'Upload et PNG-logo fra fakturaindstillingerne.');
  const bytes=await request.arrayBuffer();
  if(bytes.byteLength>300000||bytes.byteLength<24||Array.from(new Uint8Array(bytes).slice(0,8)).join(',')!=='137,80,78,71,13,10,26,10')throw new HttpError(400,'Logoet skal være en PNG-fil på højst 300 KB.');
  const view=new DataView(bytes);if(view.getUint32(16)<1||view.getUint32(20)<1||view.getUint32(16)>2048||view.getUint32(20)>2048)throw new HttpError(400,'Logoet må højst være 2048 × 2048 pixels.');
  try{const document=await PDFDocument.create();await document.embedPng(bytes);}catch{throw new HttpError(400,'Filen er ikke et gyldigt PNG-billede.');}
  const key=`companies/${company}/invoice-logos/${crypto.randomUUID()}.png`;await env.PLATFORM_DOCUMENTS.put(key,bytes,{httpMetadata:{contentType:'image/png'}});
  await db.batch([db.prepare('INSERT INTO invoice_settings(company_id,name,address,cvr,contact,subject,body,months,logo_key) VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(company_id) DO UPDATE SET logo_key=excluded.logo_key,revision=invoice_settings.revision+1').bind(company,s.name,s.address,s.cvr,s.contact,s.subject,s.body,s.months,key),audit(env,actor,company,'invoice.logo.saved',company)]);return reply({ok:true});
 }
 if(request.method==='GET'&&!action){
  const offset=Number(url.searchParams.get('offset')||0);if(!Number.isSafeInteger(offset)||offset<0)throw new HttpError(400,'Ugyldigt sidetal.');
  const rows=await db.prepare(`SELECT o.webshop_id,o.external_id,o.name,o.created_at,w.name webshop_name,i.id invoice_id,i.status FROM invoice_orders o JOIN webshops w ON w.company_id=o.company_id AND w.id=o.webshop_id LEFT JOIN platform_invoices i ON i.company_id=o.company_id AND i.webshop_id=o.webshop_id AND i.external_id=o.external_id WHERE o.company_id=? AND o.created_at>=? AND (?=1 OR (w.status='active' AND EXISTS(SELECT 1 FROM company_memberships m WHERE m.company_id=o.company_id AND m.user_id=? AND (m.role='admin' OR EXISTS(SELECT 1 FROM webshop_memberships wm WHERE wm.company_id=o.company_id AND wm.webshop_id=o.webshop_id AND wm.user_id=m.user_id))))) ORDER BY o.created_at DESC,o.webshop_id,o.external_id LIMIT 101 OFFSET ?`).bind(company,cutoff(s),actor.platformAdmin?1:0,actor.id,offset).all();
  return reply({orders:rows.results.slice(0,100),hasMore:rows.results.length>100,offset,ready:!!(s.address&&s.cvr&&s.contact),months:s.months});
 }
 const input=request.method==='GET'?Object.fromEntries(url.searchParams):await jsonBody(request);
 const shop=typeof input.webshopId==='string'?input.webshopId:'';
 await requireWebshop(db,actor,company,shop);
 if(actor.support&&['sync','generate','test','send'].includes(action))throw new HttpError(403,'Afslut supportadgang før import, generering eller testmail.');
 if(action==='sync'&&request.method==='POST'){
  const after=typeof input.after==='string'?input.after:null;if(after&&after.length>2048)throw new HttpError(400,'Ugyldig fortsættelse.');
  const access=await shopAccess(env,company,shop),data=await listInvoiceOrders(access,after,cutoff(s));
  const statements=data.nodes.map(o=>{
   if(!/^gid:\/\/shopify\/Order\/\d+$/.test(o.id)||!o.name||!Number.isFinite(Date.parse(o.createdAt)))throw new HttpError(503,'Shopify returnerede en ugyldig ordre.');
   return db.prepare(`INSERT INTO invoice_orders(company_id,webshop_id,external_id,name,created_at,payload_json) VALUES(?,?,?,?,?,?) ON CONFLICT(company_id,webshop_id,external_id) DO UPDATE SET name=excluded.name,created_at=excluded.created_at,payload_json=excluded.payload_json`).bind(company,shop,o.id,o.name,o.createdAt,JSON.stringify(o));
  });if(statements.length)await db.batch([...statements,audit(env,actor,company,'invoice.orders.imported',shop)]);
  return reply({count:data.nodes.length,...data.pageInfo});
 }
 const id=typeof input.externalId==='string'?input.externalId:'';if(!/^gid:\/\/shopify\/Order\/\d+$/.test(id))throw new HttpError(400,'Vælg en gyldig ordre.');
 const saved=await db.prepare('SELECT * FROM platform_invoices WHERE company_id=? AND webshop_id=? AND external_id=?').bind(company,shop,id).first<{id:string;status:string;fingerprint:string;r2_key:string;source_json:string;issuer_json:string}>();
 if(action==='pdf'&&request.method==='GET'){
  if(saved?.status!=='generated')throw new HttpError(404,'PDF findes ikke.');
  const object=await env.PLATFORM_DOCUMENTS.get(saved.r2_key);if(!object)throw new HttpError(404,'Den gemte PDF mangler. Den genoprettes ikke automatisk.');
  return new Response(object.body,{headers:{'Content-Type':'application/pdf','Content-Disposition':'attachment; filename="faktura-'+id.split('/').pop()+'.pdf"'}});
 }
 if(!['generate','check','test','send'].includes(action)||request.method!=='POST')throw new HttpError(404,'Fakturafunktionen findes ikke.');
 const source=await db.prepare('SELECT external_id FROM invoice_orders WHERE company_id=? AND webshop_id=? AND external_id=? AND created_at>=?').bind(company,shop,id,cutoff(s)).first();
 if(!source)throw new HttpError(404,'Hent ordren fra Shopify først; den skal ligge inden for din historik.');
 const order=await loadCompleteOrder(id,await shopAccess(env,company,shop),checkInvoice);
 if(order.createdAt<cutoff(s))throw new HttpError(409,'Ordren ligger uden for historikken.');
 const checked=checkInvoice(order),fingerprint=await invoiceFingerprint(checked);
 if(action==='check')return reply({invoice:checked});
 if(saved&&saved.fingerprint!==fingerprint)throw new HttpError(409,'Ordren er ændret siden faktureringen. Den eksisterende PDF bevares; afklar en rettelse eller kreditnota.');
 if(action==='generate'){
  if(saved){if(saved.status!=='generated')throw new HttpError(409,'Genereringen er i gang eller kræver kontrol. Den genstartes ikke automatisk.');return reply({id:saved.id,existing:true});}
  ready(s);let logo:ArrayBuffer|undefined;
  if(s.logo_key){const file=await env.PLATFORM_DOCUMENTS.get(s.logo_key);if(!file)throw new HttpError(409,'Virksomhedens logo mangler.');logo=await file.arrayBuffer();}
  const webshop=await db.prepare('SELECT name FROM webshops WHERE company_id=? AND id=?').bind(company,shop).first<{name:string}>();
  const issuer={...s,webshopName:webshop!.name,design:invoiceDesign(JSON.parse(s.design_json||'{}'))};
  const bytes=await buildInvoicePdf(order,issuer,logo),doc=crypto.randomUUID(),key=`companies/${company}/webshops/${shop}/invoices/${doc}.pdf`;
  const claim=await db.prepare(`INSERT INTO platform_invoices(company_id,webshop_id,external_id,id,fingerprint,status,r2_key,issuer_json,source_json) VALUES(?,?,?,?,?,'generating',?,?,?) ON CONFLICT DO NOTHING`).bind(company,shop,id,doc,fingerprint,key,JSON.stringify(issuer),JSON.stringify(order)).run();
  if(claim.meta.changes!==1)throw new HttpError(409,'Fakturaen er allerede genereret eller under generering.');
  await env.PLATFORM_DOCUMENTS.put(key,bytes,{httpMetadata:{contentType:'application/pdf'}});
  await db.batch([db.prepare("UPDATE platform_invoices SET status='generated' WHERE id=? AND status='generating'").bind(doc),audit(env,actor,company,'invoice.generated',doc)]);
  return reply({id:doc});
 }
 if(saved?.status!=='generated')throw new HttpError(409,'Generér PDF-fakturaen først.');
 const file=await env.PLATFORM_DOCUMENTS.get(saved.r2_key);if(!file)throw new HttpError(409,'PDF-fakturaen mangler.');
 const bytes=await file.arrayBuffer();if(bytes.byteLength>3500000)throw new HttpError(413,'PDF er for stor til testmail.');
 const rendered=invoiceText(s,order);
 if(action==='send')return sendCustomerInvoice(env,actor,company,shop,saved.id,order.email||'',rendered.subject,rendered.text,{content:bytes,filename:'faktura-'+id.split('/').pop()+'.pdf',type:'application/pdf',disposition:'attachment'});
 const mailRequest=new Request(request.url,{method:'POST',headers:request.headers,body:JSON.stringify({requestId:input.requestId,mode:input.mode})});
 return handleMail(mailRequest,env,actor,company,'test',{subject:'[TEST] '+rendered.subject,text:rendered.text+'\n\nTESTMAIL – sendt til din loginadresse, ikke til kunden.',attachment:{content:bytes,filename:'faktura-'+id.split('/').pop()+'.pdf',type:'application/pdf',disposition:'attachment'}});
}

export async function handleInvoices(request:Request,env:PlatformEnv,actor:Actor,company:string,action=''):Promise<Response>{
 const copy=request.clone();try{return await invoices(request,env,actor,company,action);}catch(error){
 if(request.method==='POST'&&['check','generate','send'].includes(action))try{const body=await copy.json() as any;await requireWebshop(env.PLATFORM_DB,actor,company,body.webshopId);await recordFailure(env,company,body.webshopId,'shopify','orders',body.externalId,'Faktura: '+action,error);}catch{/* Preserve the original failure and any durable write claim. */}
 throw error;
 }
}
