import {requireCompany,requireWebshop} from './auth';
import {shopAccess} from './invoice-source';
import {readInventory} from './inventory-source';
import {unseal} from './connections';
import {readDineroAccounts} from './dinero-read';
import {dineroClient} from './dinero-write';
import {verifyVoucher} from '../lib/dinero-sale';
import {productionWrites,bookingDate} from './production-policy';
import {readReceipt,saveReceipt,uncertainReceipt,type ReceiptKey} from './production-receipts';
import {HttpError,reply,type Actor,type PlatformEnv} from './types';
export async function commitStocktake(env:PlatformEnv,actor:Actor,company:string,shop:string,input:Record<string,unknown>){
 await requireCompany(env.PLATFORM_DB,actor,company,true);await requireWebshop(env.PLATFORM_DB,actor,company,shop);
 if(!productionWrites(env)||actor.support||actor.platformAdmin)throw new HttpError(403,'Lagerændringer er ikke aktiveret her.');
 const db=env.PLATFORM_DB,id=String(input.id||'');
 if(!/^[a-f0-9-]{36}$/.test(id)||input.confirmation!==true)throw new HttpError(400,'Godkend en gyldig lageroptælling.');
 const state=await db.prepare('SELECT * FROM stocktakes WHERE company_id=? AND webshop_id=? AND id=?').bind(company,shop,id).first<any>();
 if(!state||state.version!==input.version||state.phase!=='prepared')throw new HttpError(409,'Forslaget er ændret eller behandlet.');
 const value=JSON.parse(state.payload_json),receiptKey:ReceiptKey={company,shop,provider:'shopify',module:'stocktake',externalId:id,destination:value.account.organizationId};
 const prior=await readReceipt(env,receiptKey);if(prior){if(['booked','draft'].includes(prior.phase))return reply({...prior.payload,phase:prior.phase,message:'Den eksisterende lagerregulering er bevaret.'});throw new HttpError(409,'Lagerreguleringen afventer afklaring. Den gentages ikke.');}
 if(value.expiresAt<Date.now())throw new HttpError(409,'Forslaget er udløbet.');
 await bookingDate(env,company,shop,'shopify',value.voucher?.VoucherDate||new Date().toISOString());
 const connection=await db.prepare('SELECT * FROM accounting_connections WHERE company_id=?').bind(company).first<any>(),mapping=await db.prepare('SELECT accounts_json FROM accounting_mapping WHERE company_id=?').bind(company).first<any>(),prefs=await db.prepare('SELECT * FROM tier1_preferences WHERE company_id=? AND webshop_id=?').bind(company,shop).first<any>();
 if(connection?.organization_id!==value.account.organizationId||connection?.revision!==value.account.revision||mapping?.accounts_json!==value.account.mapping||!prefs)throw new HttpError(409,'Opsætningen er ændret.');
 const credentials=await unseal(env,[company,'dinero',connection.organization_id],connection.credentials_encrypted),chart=await readDineroAccounts(credentials);
 if([value.account.inventory,value.account.adjustment].some(n=>!chart.some(a=>Number(a.number)===n&&!a.hidden&&!a.vatCode)))throw new HttpError(409,'Lagerkontiene er ikke længere gyldige.');
 const fresh=await readInventory(env,company,shop);
 for(const c of value.changes){const row=fresh.rows.find(r=>r.inventoryItemId===c.inventoryItemId&&r.locationId===c.locationId);if(!row||row.quantity!==c.compareQuantity||row.unitCostMinor!==c.unitCostMinor||row.currency!=='DKK')throw new HttpError(409,'Lagerantal eller kostpris er ændret. Hent et nyt forslag.');}
 const access=await shopAccess(env,company,shop),client=await dineroClient(credentials),book=JSON.parse(prefs.preferences_json).automation?.inventoryBookDinero===true;
 let claim=await saveReceipt(env,receiptKey,null,'prepared',{...value,stocktakeVersion:state.version,connectionRevision:connection.revision,preferencesRevision:prefs.revision,mappingJson:mapping.accounts_json,approvedBy:actor.id,book});
 claim=await saveReceipt(env,receiptKey,claim,'creating',claim.payload);
 try{
  const query='mutation SetStocktake($input:InventorySetQuantitiesInput!,$key:String!) { inventorySetQuantities(input:$input) @idempotent(key:$key) { inventoryAdjustmentGroup { createdAt } userErrors { message } } }';
  const quantities=value.changes.map((c:any)=>({inventoryItemId:c.inventoryItemId,locationId:c.locationId,quantity:c.quantity,changeFromQuantity:c.compareQuantity}));
  const response=await fetch(`https://${access.shop}/admin/api/2026-07/graphql.json`,{method:'POST',redirect:'manual',signal:AbortSignal.timeout(25000),headers:{'Content-Type':'application/json','X-Shopify-Access-Token':access.accessToken},body:JSON.stringify({query,variables:{key:id,input:{name:'on_hand',reason:'correction',referenceDocumentUri:`logistics://webshoptoolbox.dk/${shop}/stocktake/${id}`,quantities}}})});
  const result=await response.json() as any,r=result.data?.inventorySetQuantities;
  if(!response.ok||result.errors?.length||!r?.inventoryAdjustmentGroup||!Array.isArray(r.userErrors)||r.userErrors.length)throw new Error('Shopify did not confirm');
  claim=await saveReceipt(env,receiptKey,claim,'creating',{...claim.payload,shopifyUpdated:true});
  if(!value.voucher){claim=await saveReceipt(env,receiptKey,claim,'booked',claim.payload);return reply({phase:'booked',message:'Lagerantal opdateret. Værdien er uændret; intet finansbilag oprettet.'});}
  const expected=[{net:-value.adjustmentMinor,tax:0,gross:-value.adjustmentMinor}],created=await client('vouchers/manuel','POST',value.voucher) as any;
  if(!/^[\da-f]{8}(-[\da-f]{4}){3}-[\da-f]{12}$/i.test(created?.Guid||''))throw new Error('Missing GUID');
  claim=await saveReceipt(env,receiptKey,claim,'creating',{...claim.payload,guid:created.Guid,expected});
  let remote=verifyVoucher(await client(`vouchers/manuel/${created.Guid}`,'GET'),value.voucher,expected);
  if(remote.Guid.toLowerCase()!==created.Guid.toLowerCase()||remote.Status!=='Draft')throw new Error('Unverified draft');
  claim=await saveReceipt(env,receiptKey,claim,'draft',claim.payload);
  if(book){claim=await saveReceipt(env,receiptKey,claim,'booking',claim.payload);await client(`vouchers/manuel/${created.Guid}/book`,'POST',{Timestamp:remote.Timestamp});remote=verifyVoucher(await client(`vouchers/manuel/${created.Guid}`,'GET'),value.voucher,expected);if(remote.Status!=='Booked'||remote.Guid.toLowerCase()!==created.Guid.toLowerCase())throw new Error('Unverified booking');claim=await saveReceipt(env,receiptKey,claim,'booked',{...claim.payload,voucherNumber:remote.VoucherNumber});}
  return reply({phase:claim.phase,voucherNumber:remote.VoucherNumber,message:book?'Lageret er opdateret, og reguleringen er bogført i Dinero.':'Lageret er opdateret, og reguleringen er oprettet som kladde i Dinero.'});
 }catch{await uncertainReceipt(env,receiptKey,claim);throw new HttpError(409,'Lagerreguleringen er uafklaret. Kontrollér Shopify og Dinero; handlingen gentages ikke automatisk.');}
}
