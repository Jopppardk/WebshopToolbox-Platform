import {commitStocktake,dineroInventory,assertNoPendingRegulation} from './production-stocktake';
import {unseal} from './connections';
import {productionWrites} from './production-policy';
import { requireCompany,requireWebshop } from './auth';
import { jsonBody } from './invitations';
import { readInventory } from './inventory-source';
import { validateStocktakeChanges } from './inventory-calculations';
import { HttpError,reply,type Actor,type PlatformEnv } from './types';
type Saved={id:string;version:string;phase:string;payload_json:string;created_at:string};
async function accounts(db:D1Database,company:string){
 const c=await db.prepare('SELECT organization_id,revision,chart_json FROM accounting_connections WHERE company_id=?').bind(company).first<{organization_id:string;revision:string;chart_json:string}>();
 const m=await db.prepare('SELECT accounts_json FROM accounting_mapping WHERE company_id=?').bind(company).first<{accounts_json:string}>();
 if(!c||!m)throw new HttpError(409,'Forbind Dinero og vælg lagerkonti først.');
 const mapping=JSON.parse(m.accounts_json),chart=JSON.parse(c.chart_json) as {number:string;kind:string;vatCode:string;hidden:boolean}[];
 const numbers=['inventory','inventoryAdjustment'].map(k=>String(mapping[k]||'').match(/^\d+/)?.[0]);
 if(!numbers[0]||numbers[0]===numbers[1]||numbers.some(n=>!chart.some(a=>a.number===n&&a.kind==='entry'&&!a.hidden&&!a.vatCode)))throw new HttpError(409,'Vælg to forskellige aktive finanskonti uden moms til lager og regulering.');
 return {organizationId:c.organization_id,revision:c.revision,mapping:m.accounts_json,inventory:Number(numbers[0]),adjustment:Number(numbers[1])};
}
export async function handleStocktake(request:Request,env:PlatformEnv,actor:Actor,company:string,shop:string){
 const db=env.PLATFORM_DB;await requireWebshop(db,actor,company,shop);
 if(request.method==='GET'){
  if(new URL(request.url).searchParams.has('history'))return reply({rows:(await db.prepare(`SELECT s.id,COALESCE(r.phase,s.phase) phase,COALESCE(r.payload_json,s.payload_json) payload_json,s.created_at FROM stocktakes s LEFT JOIN production_receipts r ON r.company_id=s.company_id AND r.webshop_id=s.webshop_id AND r.provider='shopify' AND r.module='stocktake' AND r.external_id=s.id AND r.destination=json_extract(s.payload_json,'$.account.organizationId') WHERE s.company_id=? AND s.webshop_id=? ORDER BY s.created_at DESC,s.id DESC LIMIT 100`).bind(company,shop).all()).results});
  // Webshop value beside the Dinero inventory account, so a difference can be regulated with a voucher.
  const [inventory,dinero]=await Promise.all([readInventory(env,company,shop),dineroInventory(env,company).then(d=>({account:d.account,valueMinor:d.balanceMinor,from:d.from,to:d.to}),(e:unknown)=>({error:e instanceof HttpError?e.message:'Lagerværdien kunne ikke hentes fra Dinero.'}))]);
  return reply({...inventory,dinero});
 }
 if(request.method!=='POST')throw new HttpError(405,'Ugyldig handling.');
 await requireCompany(db,actor,company,true);if(actor.support)throw new HttpError(403,'Afslut impersonering før lageroptælling.');
 const b=await jsonBody(request,40000);
 if(b.action==='prepare'){
  let changes:ReturnType<typeof validateStocktakeChanges>;try{changes=validateStocktakeChanges(b.changes);}catch{throw new HttpError(400,'Vælg mellem 1 og 100 gyldige ændrede lagerlinjer.');}
  const inventory=await readInventory(env,company,shop),account=await accounts(db,company),current=new Map(inventory.rows.map(r=>[JSON.stringify([r.inventoryItemId,r.locationId]),r]));
  const costed=changes.map(change=>{
   const row=current.get(JSON.stringify([change.inventoryItemId,change.locationId]));
   if(!row||row.quantity!==change.compareQuantity)throw new HttpError(409,'Lageret er ændret. Hent lagerstatus igen.');
   if(row.currency!=='DKK')throw new HttpError(409,'Lagerregulering kræver kostpriser i DKK.');
   return {...change,unitCostMinor:row.unitCostMinor,product:row.product};
  });
  const adjustmentMinor=costed.reduce((sum,r)=>sum+(r.quantity-r.compareQuantity)*r.unitCostMinor,0);
  if(!Number.isSafeInteger(adjustmentMinor))throw new HttpError(409,'Ugyldig reguleringsværdi.');
  const id=crypto.randomUUID(),version=crypto.randomUUID(),date=new Date().toISOString().slice(0,10);
  const voucher=adjustmentMinor===0?null:{VoucherDate:date,ExternalReference:`toolbox:${company}:${shop}:stocktake:${id}`,Lines:[{Description:`Lagerregulering · ${changes.length} lagerlinjer`,AccountNumber:account.adjustment,BalancingAccountNumber:account.inventory,Amount:-adjustmentMinor/100,AccountVatCode:'none',BalancingAccountVatCode:'none'}]};
  const payload={changes:costed,account,adjustmentMinor,voucher,expiresAt:Date.now()+600000};
  await db.prepare("INSERT INTO stocktakes(company_id,webshop_id,id,version,phase,payload_json,created_by) VALUES(?,?,?,?,'prepared',?,?)").bind(company,shop,id,version,JSON.stringify(payload),actor.id).run();
  return reply({id,version,...payload,mode:productionWrites(env)?'production':'simulation',externalWrites:productionWrites(env)?'enabled':'blocked'});
 }
 if(b.action==='prepare-reconcile'){
  const shown=[b.shopifyValueMinor,b.dineroValueMinor];if(!shown.every(Number.isSafeInteger))throw new HttpError(400,'Angiv de viste lagerværdier.');
  const account=await accounts(db,company),[inventory,dinero]=await Promise.all([readInventory(env,company,shop),dineroInventory(env,company)]);
  if(dinero.organizationId!==account.organizationId||dinero.account!==account.inventory)throw new HttpError(409,'Regnskabsopsætningen er ændret. Hent lagerstatus igen.');
  if(inventory.rows.some(r=>r.currency!=='DKK'))throw new HttpError(409,'Lagerregulering kræver kostpriser i DKK.');
  if(inventory.totalValueMinor!==shown[0]||dinero.balanceMinor!==shown[1])throw new HttpError(409,'Lagerværdierne er ændret siden visningen. Hent lagerstatus igen.');
  const adjustmentMinor=inventory.totalValueMinor-dinero.balanceMinor;
  if(adjustmentMinor===0)throw new HttpError(409,'Lagerværdien i Dinero svarer til webshoppen. Der er intet at regulere.');
  if(!Number.isSafeInteger(adjustmentMinor))throw new HttpError(409,'Ugyldig reguleringsværdi.');
  const saved=await db.prepare('SELECT organization_id,credentials_encrypted FROM accounting_connections WHERE company_id=?').bind(company).first<{organization_id:string;credentials_encrypted:string}>();
  if(saved?.organization_id!==account.organizationId)throw new HttpError(409,'Regnskabsopsætningen er ændret. Hent lagerstatus igen.');
  let credentials:Record<string,string>;try{credentials=await unseal(env,[company,'dinero',saved.organization_id],saved.credentials_encrypted);}catch{throw new HttpError(409,'Dinero-forbindelsen kunne ikke åbnes.');}
  await assertNoPendingRegulation(env,company,shop,account.organizationId,credentials);
  const id=crypto.randomUUID(),version=crypto.randomUUID(),date=dinero.to;
  const voucher={VoucherDate:date,ExternalReference:`toolbox:${company}:${shop}:stocktake:${id}`,Lines:[{Description:'Lagerafstemning mod webshoppens lagerværdi',AccountNumber:account.adjustment,BalancingAccountNumber:account.inventory,Amount:-adjustmentMinor/100,AccountVatCode:'none',BalancingAccountVatCode:'none'}]};
  const payload={kind:'reconcile',changes:[],account,adjustmentMinor,shopifyValueMinor:inventory.totalValueMinor,dineroValueMinor:dinero.balanceMinor,voucher,expiresAt:Date.now()+600000};
  await db.prepare("INSERT INTO stocktakes(company_id,webshop_id,id,version,phase,payload_json,created_by) VALUES(?,?,?,?,'prepared',?,?)").bind(company,shop,id,version,JSON.stringify(payload),actor.id).run();
  return reply({id,version,...payload,mode:productionWrites(env)?'production':'simulation',externalWrites:productionWrites(env)?'enabled':'blocked'});
 }
 if(b.action==='commit')return commitStocktake(env,actor,company,shop,b);
 if(!['simulate','cancel'].includes(String(b.action))||typeof b.id!=='string'||typeof b.version!=='string')throw new HttpError(400,'Ugyldig handling.');
 const state=await db.prepare('SELECT * FROM stocktakes WHERE company_id=? AND webshop_id=? AND id=?').bind(company,shop,b.id).first<Saved>();
 if(!state||state.version!==b.version||state.phase!=='prepared')throw new HttpError(409,'Forslaget er ændret eller allerede behandlet.');
 const receipt=await db.prepare("SELECT 1 FROM production_receipts WHERE company_id=? AND webshop_id=? AND provider='shopify' AND module='stocktake' AND external_id=?").bind(company,shop,b.id).first();if(receipt)throw new HttpError(409,'Lagerreguleringen er allerede behandlet eller afventer afklaring.');
 const value=JSON.parse(state.payload_json);
 if(b.action==='simulate'){
  if(b.confirmation!==true||value.expiresAt<Date.now())throw new HttpError(409,'Godkend et aktuelt forslag.');
  const account=await accounts(db,company);if(JSON.stringify(account)!==JSON.stringify(value.account))throw new HttpError(409,'Regnskabsopsætningen er ændret. Opret et nyt forslag.');
  const fresh=await readInventory(env,company,shop);
  if(value.kind==='reconcile'){
   if(fresh.totalValueMinor!==value.shopifyValueMinor||fresh.rows.some(r=>r.currency!=='DKK'))throw new HttpError(409,'Lagerværdien i webshoppen er ændret. Hent lagerstatus igen.');
   if((await dineroInventory(env,company)).balanceMinor!==value.dineroValueMinor)throw new HttpError(409,'Lagerværdien i Dinero er ændret. Hent lagerstatus igen.');
  }
  for(const change of value.changes){const row=fresh.rows.find(r=>r.inventoryItemId===change.inventoryItemId&&r.locationId===change.locationId);if(!row||row.quantity!==change.compareQuantity||row.unitCostMinor!==change.unitCostMinor||row.currency!=='DKK')throw new HttpError(409,'Lagerantal eller kostpris er ændret siden forslaget. Hent lagerstatus igen.');}
 }
 const phase=b.action==='simulate'?'simulated':'cancelled';
 const result=await db.batch([db.prepare('UPDATE stocktakes SET phase=?,version=? WHERE company_id=? AND webshop_id=? AND id=? AND version=? AND phase=\'prepared\'').bind(phase,crypto.randomUUID(),company,shop,b.id,b.version),db.prepare("INSERT INTO audit_events(id,company_id,actor_id,action,resource_id,details_json) SELECT ?,?,?,?,?,? WHERE changes()=1").bind(crypto.randomUUID(),company,actor.id,'stocktake.'+phase,b.id,JSON.stringify({shop,externalWrites:'blocked'}))]);
 if(result[0].meta.changes!==1)throw new HttpError(409,'Forslaget er allerede behandlet.');
 return reply({id:b.id,phase,externalWrites:'blocked'});
}
