import { optionalIntegrations, paymentProviderPattern } from './catalog';
import { dataStartDate } from './tier1-history';
import { requireCompany } from './auth';
import { handleAccounting } from './accounting';
import { seal, website } from './connections';
import { credentialAccess, orderQuery } from './invoice-source';
import { handlePayments } from './payments';
import { jsonBody } from './invitations';
import { HttpError, reply, type Actor, type PlatformEnv } from './types';

function forwarded(request:Request,body:unknown,method='PUT') {
  return new Request(request.url,{method,headers:request.headers,body:JSON.stringify(body)});
}
export async function handleTier1Connections(request:Request,env:PlatformEnv,actor:Actor,company:string,shop:string,path:string) {
  const db=env.PLATFORM_DB;
  const audit=(action:string,resource:string)=>db.prepare('INSERT INTO audit_events(id,company_id,actor_id,action,resource_id,details_json) VALUES(?,?,?,?,?,?)').bind(crypto.randomUUID(),company,actor.id,action,resource,'{}');
  // Reads are scoped by the gateway; only company administrators may change connections.
  if(request.method!=='GET')await requireCompany(db,actor,company,true);
  const connected=async()=>{
    const shipping=shop==='none'?[]:(await db.prepare('SELECT provider FROM shipping_connections WHERE company_id=? AND webshop_id=?').bind(company,shop).all<{provider:string}>()).results;
    const accounting=await db.prepare('SELECT organization_id FROM accounting_connections WHERE company_id=?').bind(company).first<{organization_id:string}>();
    const webshop=shop==='none'?null:await db.prepare('SELECT shop_domain FROM webshop_connections WHERE company_id=? AND webshop_id=? AND verified_at IS NOT NULL').bind(company,shop).first<{shop_domain:string}>();
    const payments=shop==='none'?[]:(await db.prepare('SELECT provider FROM payment_connections WHERE company_id=? AND webshop_id=?').bind(company,shop).all<{provider:string}>()).results;
    const packaging=shop==='none'?null:await db.prepare('SELECT identity FROM emballage_connections WHERE company_id=? AND webshop_id=?').bind(company,shop).first();
    return [...shipping.map(p=>({provider:p.provider,display_name:'Shipmondo'})),...(packaging?[{provider:'emballage',display_name:'Emballage Indberetning'}]:[]),...(accounting?[{provider:'dinero',display_name:accounting.organization_id}]:[]),...(webshop?[{provider:'shopify',display_name:webshop.shop_domain}]:[]),...payments.map(p=>({provider:p.provider,display_name:p.provider}))];
  };
  if(path==='/integrations/selection'){
    if(request.method==='POST'){
      const b=await jsonBody(request);
      if(!optionalIntegrations.includes(String(b.provider)) || !['add','remove'].includes(String(b.action)))throw new HttpError(400,'Vælg en tilgængelig integration. Shopify og Dinero er altid tilgængelige.');
      if(b.action==='remove' && await db.prepare('SELECT 1 AS found FROM payment_connections WHERE company_id=? AND provider=? LIMIT 1').bind(company,b.provider).first())throw new HttpError(409,'Integrationen har en gemt forbindelse og kan ikke fjernes.');
      if(b.action==='remove' && b.provider==='emballage' && await db.prepare('SELECT 1 FROM emballage_connections WHERE company_id=? LIMIT 1').bind(company).first())throw new HttpError(409,'Integrationen har en gemt forbindelse.');
      if(b.action==='remove' && b.provider==='shipmondo' && await db.prepare('SELECT 1 FROM shipping_connections WHERE company_id=? LIMIT 1').bind(company).first())throw new HttpError(409,'Afbryd Shipmondo på virksomhedens webshops først.');
      await db.batch([db.prepare(b.action==='add'?'INSERT OR IGNORE INTO company_integrations(company_id,integration_id) VALUES(?,?)':'DELETE FROM company_integrations WHERE company_id=? AND integration_id=?').bind(company,b.provider),audit('integration.'+b.action,String(b.provider))]);
    }else if(request.method!=='GET')throw new HttpError(405,'Ugyldig handling.');
    const rows=await db.prepare('SELECT integration_id FROM company_integrations WHERE company_id=?').bind(company).all<{integration_id:string}>();
    return reply({selected:['shopify','dinero',...rows.results.map(r=>r.integration_id)],connected:(await connected()).map(r=>r.provider)});
  }
  const payment=path.match(new RegExp(`^/(${paymentProviderPattern})/connection$`));
  if(payment){
    if(shop==='none')throw new HttpError(409,'Forbind din webshop først.');
    const provider=payment[1];
    if(request.method==='GET'){
      const response=await handlePayments(request,env,actor,company,shop,provider,'connection');
      const data=await response.json() as {connection:Record<string,unknown>|null};
      return reply({connected:!!data.connection,...data.connection});
    }
    if(request.method!=='POST')throw new HttpError(405,'Brug Gem.');
    const b=await jsonBody(request);
    if(!['validate','discover','connect','save'].includes(String(b.action)))throw new HttpError(400,'Genindtast adgangsoplysninger for at ændre forbindelsen og startdatoen.');
    const discovery=b.action==='validate'||b.action==='discover';
    const response=await handlePayments(forwarded(request,{...b,...(!discovery&&provider==='flatpay'&&b.startDate===undefined?{startDate:await dataStartDate(env,company,shop,provider)}:{}),action:discovery?'discover':'connect',name:b.accountName}),env,actor,company,shop,provider,'connection');
    if(!response.ok)return response;
    const data=await response.json() as {accounts?:unknown[]};
    return reply(discovery?(provider==='flatpay'?{agreements:data.accounts}:{accounts:data.accounts}):{connected:true,name:typeof b.accountName==='string'?b.accountName:provider});
  }
  if(request.method==='GET')return reply({integrations:await connected()});
  if(request.method!=='POST')throw new HttpError(405,'Brug Test og forbind.');
  const b=await jsonBody(request,14000);
  if(b.provider==='dinero'){
    const response=await handleAccounting(forwarded(request,b),env,actor,company,'connection');
    if(!response.ok)return response;
    return reply({provider:'dinero',name:'Dinero '+b.organizationId});
  }
  if(b.provider!=='shopify')throw new HttpError(400,'Vælg Shopify eller Dinero.');
  const domain=website(b.shop,true),clientId=typeof b.clientId==='string'?b.clientId.trim():'',clientSecret=typeof b.clientSecret==='string'?b.clientSecret.trim():'';
  if(!clientId||clientId.length>256||!clientSecret||clientSecret.length>2048||/[\s\x00-\x1f]/.test(clientId+clientSecret))throw new HttpError(400,'Udfyld Client ID og Client secret.');
  const saved=shop==='none'?null:await db.prepare('SELECT shop_domain,credentials_encrypted FROM webshop_connections WHERE company_id=? AND webshop_id=?').bind(company,shop).first<{shop_domain:string;credentials_encrypted:string}>();
  if(saved && saved.shop_domain!==domain)throw new HttpError(409,'En eksisterende forbindelse kan ikke skiftes til en anden butik. Tilføj en ny webshop i stedet.');
  if(await db.prepare('SELECT 1 AS found FROM webshop_connections WHERE company_id=? AND shop_domain=? AND webshop_id<>?').bind(company,domain,shop).first())throw new HttpError(409,'Butikken er allerede tilknyttet virksomheden. Vælg den eksisterende webshop.');
  const id=shop==='none'?crypto.randomUUID():shop;
  // Validate storage before contacting Shopify; persist only after a successful read.
  const encrypted=await seal(env,[company,id,'shopify',domain],{clientId,clientSecret});
  let name:string;
  try{
    const access=await credentialAccess(domain,clientId,clientSecret);
    const data=await orderQuery<{shop:{name:string}}>(access,'query ToolboxConnection { shop { name } }',{});
    if(typeof data.shop?.name!=='string'||!data.shop.name.trim())throw new Error('Missing shop');
    name=data.shop.name.trim().slice(0,120);
  }catch{throw new HttpError(409,'Shopify kunne ikke godkende forbindelsen. Kontrollér butiksadresse og appoplysninger. Tidligere oplysninger er bevaret.');}
  const write=db.prepare(`INSERT INTO webshop_connections(company_id,webshop_id,provider,shop_domain,credentials_encrypted,verified_at) VALUES(?,?,'shopify',?,?,CURRENT_TIMESTAMP)
    ON CONFLICT(company_id,webshop_id) DO UPDATE SET credentials_encrypted=excluded.credentials_encrypted,verified_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE webshop_connections.credentials_encrypted=? AND webshop_connections.shop_domain=excluded.shop_domain`).bind(company,id,domain,encrypted,saved?.credentials_encrypted||'');
  const statements=[...(shop==='none'?[db.prepare('INSERT INTO webshops(id,company_id,name,domain) VALUES(?,?,?,?)').bind(id,company,name,domain)]:[]),write,
    db.prepare("INSERT INTO audit_events(id,company_id,actor_id,action,resource_id,details_json) SELECT ?,?,?,'webshop.connected',?,'{}' WHERE changes()=1").bind(crypto.randomUUID(),company,actor.id,id)];
  let results;
  try{results=await db.batch(statements);}catch{throw new HttpError(409,'Forbindelsen kunne ikke gemmes. Kontrollér, om butikken allerede findes, og genindlæs.');}
  if(results[shop==='none'?1:0].meta.changes!==1)throw new HttpError(409,'Forbindelsen blev ændret under kontrollen. Genindlæs før du gemmer igen.');
  return reply({provider:'shopify',name,webshopId:id,created:shop==='none'});
}
