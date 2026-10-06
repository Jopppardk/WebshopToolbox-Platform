import {recordFailure} from './record-history';
import {requireCompany,requireWebshop} from './auth';
import {unseal} from './connections';
import {jsonBody} from './invitations';
import {verifyVoucher} from './dinero-sale';
import {dineroClient} from './dinero-write';
import {readReceipt,saveReceipt,uncertainReceipt,type ReceiptKey} from './production-receipts';
import {HttpError,reply,type Actor,type PlatformEnv} from './types';
import {productionWrites} from './production-policy';
export type BookingContext={env:PlatformEnv;company:string;shop:string;id:string;connection:any;credentials:Record<string,string>;prefs:any;mapping:any;sourceRow:any};
export type PreparedBooking={snapshot:Record<string,any>;file?:R2ObjectBody|null};
async function productionBooking(request:Request,env:PlatformEnv,actor:Actor,company:string,shop:string,kind:string,module:string,provider:string,pattern:RegExp,prepare:(context:BookingContext)=>Promise<PreparedBooking>){
 await requireCompany(env.PLATFORM_DB,actor,company,true);await requireWebshop(env.PLATFORM_DB,actor,company,shop);
 if(actor.support||actor.platformAdmin)throw new HttpError(403,'Bogføring kræver en virksomhedsadministrator.');
 if(!productionWrites(env))throw new HttpError(403,'Bogføring er ikke aktiveret i dette miljø.');
 if(request.method!=='POST')throw new HttpError(405,'Brug POST.');
 const input=await jsonBody(request),id=String(input.externalId||'');
 if(input.kind!==kind||!pattern.test(id)||!['inspect','retry'].includes(String(input.action)))throw new HttpError(400,'Vælg en post og en gyldig handling.');
 const db=env.PLATFORM_DB;
 const connection=await db.prepare('SELECT * FROM accounting_connections WHERE company_id=?').bind(company).first<any>();
 if(!connection)throw new HttpError(409,'Forbind Dinero først.');
 const credentials=await unseal(env,[company,'dinero',connection.organization_id],connection.credentials_encrypted);
 if(credentials.organizationId!==connection.organization_id)throw new HttpError(409,'Regnskabsforbindelsen stemmer ikke.');
 const key:ReceiptKey={company,shop,provider,module,externalId:id,destination:connection.organization_id};
 const reconciled=await db.prepare('SELECT voucher_guid FROM accounting_reconciliations WHERE company_id=? AND webshop_id=? AND provider=? AND module=? AND external_id=? AND organization_id=?').bind(company,shop,provider,module,id,connection.organization_id).first();
 if(reconciled)throw new HttpError(409,'Posten er allerede afstemt med et eksisterende Dinero-bilag.');
 let current=await readReceipt(env,key);
 if(current?.phase==='booked')return reply({phase:'booked',guid:current.payload.guid,message:'Posten er allerede bogført. Kvitteringen er bevaret.'});
 if(current&&['creating','booking','uncertain'].includes(current.phase)){
  // Read-only recovery of a known GUID is allowed, never another create.
  if(!current.payload.guid)throw new HttpError(409,'Tidligere forsøg er uafklaret. Intet nyt bilag oprettes. Afklar bilaget i Dinero.');
  const client=await dineroClient(credentials),remote=verifyVoucher(await client(`vouchers/manuel/${current.payload.guid}`,'GET'),current.payload.voucher,current.payload.expected);
  if(remote.Guid.toLowerCase()!==current.payload.guid.toLowerCase())throw new HttpError(409,'Bilags-ID stemmer ikke.');
  // A concurrent in-flight book may still complete. Do not downgrade its claim to draft.
  if(remote.Status!=='Booked')throw new HttpError(409,'Bilaget er endnu ikke bekræftet bogført. Afklar den eksisterende kladde; den genoprettes ikke.');
  current=await saveReceipt(env,key,current,'booked',{...current.payload,voucherNumber:remote.VoucherNumber});
  return reply({phase:current.phase,guid:remote.Guid,message:'Eksisterende bogføring er verificeret i Dinero.'});
 }
 // Order refunds have their own table with the same shape (see migration 0038).
 const sourceRow=provider==='shopify'?await db.prepare(`SELECT payload_json,occurred_at FROM ${module==='order_refunds'?'order_refunds':'operation_snapshots'} WHERE company_id=? AND webshop_id=? AND module=? AND external_id=?`).bind(company,shop,module,id).first<any>():await db.prepare('SELECT payload_json,occurred_at FROM payment_records WHERE company_id=? AND webshop_id=? AND provider=? AND kind=? AND external_id=?').bind(company,shop,provider,module,id).first<any>();
 if(!sourceRow)throw new HttpError(404,'Hent posten fra integrationen først.');
 const mapping=await db.prepare('SELECT accounts_json FROM accounting_mapping WHERE company_id=?').bind(company).first<any>();
 const prefs=await db.prepare('SELECT preferences_json,revision FROM tier1_preferences WHERE company_id=? AND webshop_id=?').bind(company,shop).first<any>();
 if(!mapping||!prefs)throw new HttpError(409,'Gem kontoplan og indstillinger først.');
 const {snapshot:proposal,file}=await prepare({env,company,shop,id,connection,credentials,prefs,mapping,sourceRow});
 const dates=(await db.prepare('SELECT provider,start_date FROM booking_start_dates WHERE company_id=? AND webshop_id=? ORDER BY provider').bind(company,shop).all<{provider:string;start_date:string}>()).results;
 const snapshot:Record<string,any>={...proposal,bookingDates:dates,connectionRevision:connection.revision,preferencesRevision:prefs.revision,sourceJson:sourceRow.payload_json,mappingJson:mapping.accounts_json},book=snapshot.book===true;
 if(input.action==='inspect'){
  if(!current||current.phase==='prepared')current=await saveReceipt(env,key,current,'prepared',snapshot);
  return reply({version:current.version,phase:current.phase,guid:current.payload.guid,reference:current.payload.voucher.ExternalReference,organizationId:connection.organization_id,message:book?'Opret og bogfør det kontrollerede bilag.':'Opret kun kladde i Dinero.'});
 }
 if(!current||input.confirmed!==true||input.version!==current.version)throw new HttpError(409,'Kontrollér og godkend den aktuelle post først.');
 const original={...current.payload};delete original.guid;delete original.voucherNumber;delete original.approvedBy;delete original.approvedAt;original.voucher={...original.voucher};delete original.voucher.FileGuid;
 const compared={...snapshot};
 if(current.phase==='draft'){for(const key of ['book','preferencesRevision','connectionRevision']){delete original[key];delete compared[key];}}
 if(JSON.stringify(original)!==JSON.stringify(compared))throw new HttpError(409,'Ordren eller opsætningen er ændret. Kontrollér igen; en eksisterende kladde bevares.');
 // Recheck the connection at the boundary. Credentials are always scoped to the inspected organization.
 const still=await db.prepare('SELECT revision FROM accounting_connections WHERE company_id=?').bind(company).first<any>();
 if(still?.revision!==connection.revision)throw new HttpError(409,'Dinero-forbindelsen er ændret.');
 const client=await dineroClient(credentials);
 try{
  if(current.phase==='prepared'){
   current=await saveReceipt(env,key,current,'creating',{...current.payload,approvedBy:actor.id,approvedAt:new Date().toISOString()});
   if(file){
   const form=new FormData();form.append('file',new Blob([await file.arrayBuffer()],{type:'application/pdf'}),'faktura.pdf');
   const uploaded=await client('files','POST',form) as any;
   if(typeof uploaded?.FileGuid!=='string'||!/^[-\w]{10,128}$/.test(uploaded.FileGuid))throw new HttpError(409,'Dinero returnerede ikke et gyldigt fil-ID.');
   current=await saveReceipt(env,key,current,'creating',{...current.payload,voucher:{...current.payload.voucher,FileGuid:uploaded.FileGuid}});
   }
   const created=await client('vouchers/manuel','POST',current.payload.voucher) as any;
   if(!/^[\da-f]{8}(-[\da-f]{4}){3}-[\da-f]{12}$/i.test(created?.Guid||''))throw new HttpError(409,'Bilagsoprettelsen er uafklaret.');
   current=await saveReceipt(env,key,current,'creating',{...current.payload,guid:created.Guid});
   const remote=verifyVoucher(await client(`vouchers/manuel/${created.Guid}`,'GET'),current.payload.voucher,current.payload.expected);
   if(remote.Guid.toLowerCase()!==created.Guid.toLowerCase()||remote.Status!=='Draft')throw new HttpError(409,'Den oprettede kladde kræver kontrol.');
   current=await saveReceipt(env,key,current,'draft',current.payload);
  }
  if(current.phase==='draft'&&book){
   current=await saveReceipt(env,key,current,'booking',{...current.payload,connectionRevision:connection.revision,preferencesRevision:prefs.revision,book});
   const remote=verifyVoucher(await client(`vouchers/manuel/${current.payload.guid}`,'GET'),current.payload.voucher,current.payload.expected);
   if(remote.Guid.toLowerCase()!==current.payload.guid.toLowerCase())throw new HttpError(409,'Bilags-ID stemmer ikke.');
   if(remote.Status!=='Booked')await client(`vouchers/manuel/${remote.Guid}/book`,'POST',{Timestamp:remote.Timestamp});
   const booked=verifyVoucher(await client(`vouchers/manuel/${remote.Guid}`,'GET'),current.payload.voucher,current.payload.expected);
   if(booked.Status!=='Booked'||booked.Guid.toLowerCase()!==remote.Guid.toLowerCase())throw new HttpError(409,'Bogføringen er ikke bekræftet.');
   current=await saveReceipt(env,key,current,'booked',{...current.payload,voucherNumber:booked.VoucherNumber});
  }
 }catch{await uncertainReceipt(env,key,current);throw new HttpError(409,'Overførslen er uafklaret. Kontrollér status i Dinero; der oprettes ikke et nyt bilag automatisk.');}
 return reply({version:current.version,phase:current.phase,guid:current.payload.guid,message:current.phase==='booked'?'Bogføring bekræftet i Dinero.':'Kladden er oprettet i Dinero.'});
}

export async function handleProductionBooking(...args:Parameters<typeof productionBooking>){
 const [request,env,actor,company,shop,kind,module,provider]=args,copy=request.clone();
 try{return await productionBooking(...args);}catch(error){
 try{await requireWebshop(env.PLATFORM_DB,actor,company,shop);const body=await copy.json() as any;await recordFailure(env,company,shop,provider,module,body.externalId,'Bogføring: '+kind,error);}catch{/* Preserve the original error; never release an uncertain receipt. */}
 throw error;
 }
}
