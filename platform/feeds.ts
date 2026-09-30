import {requireCompany,requireWebshop} from './auth';
import {jsonBody} from './invitations';
import {feedCatalog,generateFeed,type FeedConfig,type Selection} from './feed-source';
import {feedFileNamePattern,slugify} from './tier1/src/lib/feed-name';
import {demoFeed,isDemoCompany} from './demo';
import {HttpError,reply,type PlatformEnv,type Actor} from './types';

type Feed={id:string;company_id:string;webshop_id:string;name:string;file_name:string|null;service:string;config_json:string;enabled:number;public_token:string;revision:number;xml_key:string|null;item_count:number|null;generated_at:number|null;refresh_lock:string|null;lock_until:number;last_attempt:number;last_error:string|null};
const now=()=>Math.floor(Date.now()/1000);
const fileNamePattern=feedFileNamePattern;
function fileName(v:unknown){
 if(typeof v!=='string'||!fileNamePattern.test(v))throw new HttpError(400,'Filnavnet må kun indeholde små bogstaver, tal og bindestreger (højst 60 tegn).');
 return v;
}
// Each webshop has one feed folder, reserved the first time it is needed and kept after that.
async function folderFor(env:PlatformEnv,company:string,shop:string,create:boolean){
 const db=env.PLATFORM_DB,read=()=>db.prepare('SELECT slug FROM feed_folders WHERE company_id=? AND webshop_id=?').bind(company,shop).first<{slug:string}>();
 const existing=await read();if(existing||!create)return existing?.slug??null;
 const base=await proposedFolder(env,company,shop);
 for(let n=1;n<=50;n++){
  await db.prepare('INSERT OR IGNORE INTO feed_folders(company_id,webshop_id,slug) VALUES(?,?,?)').bind(company,shop,n===1?base:base+'-'+n).run();
  const slug=await read();if(slug)return slug.slug;
 }
 throw new HttpError(409,'Webshoppens feedmappe kunne ikke oprettes. Prøv igen.');
}
// The folder is the webshop's name in WebshopToolbox, as entered under Integrationer, e.g. "Sablen.dk" becomes sablendk.
async function proposedFolder(env:PlatformEnv,company:string,shop:string){
 const w=await env.PLATFORM_DB.prepare('SELECT name FROM webshops WHERE company_id=? AND id=?').bind(company,shop).first<{name:string}>();
 return slugify((w?.name||'').replaceAll('.',''),36)||'webshop';
}
async function fileNameTaken(env:PlatformEnv,company:string,shop:string,name:string,except:string|null){
 return !!await env.PLATFORM_DB.prepare('SELECT 1 FROM product_feeds WHERE company_id=? AND webshop_id=? AND file_name=? AND id IS NOT ?').bind(company,shop,name,except).first();
}
const taken=()=>new HttpError(409,'Filnavnet er allerede i brug i denne webshop. Vælg et andet navn.');
const unique=(error:unknown)=>/UNIQUE constraint failed/i.test(String((error as Error)?.message||error));
const token=()=>crypto.randomUUID().replaceAll('-','')+crypto.randomUUID().replaceAll('-','');
function text(v:unknown,max:number,optional=false){if(typeof v!=='string'||v.length>max||(!optional&&!v.trim())||/[\x00-\x1f]/.test(v))throw new HttpError(400,'Udfyld feedets navn og indstillinger korrekt.');return v.trim();}
function money(v:unknown){if(typeof v!=='string'||!/^\d{1,6}(\.\d{1,2})?$/.test(v))throw new HttpError(400,'Angiv fragtbeløb i DKK med højst to decimaler.');return Number(v).toFixed(2);}
function selection(v:unknown,kind:string):Selection[]{
 if(!Array.isArray(v)||v.length>100)throw new HttpError(400,'Vælg højst 100 kollektioner og 100 enkeltprodukter.');
 const result=v.map(x=>{if(!x||typeof x.id!=='string'||!new RegExp('^gid://shopify/'+kind+'/\\d+$').test(x.id))throw new HttpError(400,'Ugyldigt produkt- eller kollektionsvalg.');return {id:x.id,title:text(x.title,200)};});
 return [...new Map(result.map(x=>[x.id,x])).values()];
}
export function feedInput(b:any){
 if(b.service!=='partnerads'||typeof b.enabled!=='boolean'||typeof b.allProducts!=='boolean')throw new HttpError(400,'Vælg PartnerAds og en gyldig feedstatus.');
 const config:FeedConfig={allProducts:b.allProducts,collections:selection(b.collections,'Collection'),products:selection(b.products,'Product'),shippingCost:money(b.shippingCost),freeShippingFrom:b.freeShippingFrom===null?null:money(b.freeShippingFrom),deliveryTime:text(b.deliveryTime,100),category:text(b.category,200,true)};
 if(!config.allProducts&&!config.collections.length&&!config.products.length)throw new HttpError(400,'Vælg mindst én kollektion eller ét produkt.');
 if(config.allProducts){config.collections=[];config.products=[];}
 return {name:text(b.name,100),fileName:fileName(b.fileName),config,enabled:b.enabled?1:0};
}
async function find(env:PlatformEnv,company:string,shop:string,id:string){
 const f=await env.PLATFORM_DB.prepare('SELECT * FROM product_feeds WHERE company_id=? AND webshop_id=? AND id=?').bind(company,shop,id).first<Feed>();
 if(!f)throw new HttpError(404,'Feedet findes ikke.');return f;
}
function view(f:Feed,origin:string,folder:string|null){return {id:f.id,name:f.name,fileName:f.file_name,service:f.service,...JSON.parse(f.config_json),enabled:!!f.enabled,revision:f.revision,url:f.file_name&&folder?origin+'/feeds/'+folder+'/'+f.file_name+'.xml':origin+'/feeds/'+f.public_token+'.xml',itemCount:f.item_count,generatedAt:f.generated_at,lastError:f.last_error};}
function audit(env:PlatformEnv,actor:Actor,f:Feed,action:string){return env.PLATFORM_DB.prepare('INSERT INTO audit_events(id,company_id,actor_id,action,resource_id,details_json) VALUES(?,?,?,?,?,?)').bind(crypto.randomUUID(),f.company_id,actor.id,'feed.'+action,f.id,JSON.stringify({webshopId:f.webshop_id}));}
async function refresh(env:PlatformEnv,f:Feed){
 const db=env.PLATFORM_DB,lock=crypto.randomUUID(),at=now();
 const claim=await db.prepare('UPDATE product_feeds SET refresh_lock=?,lock_until=?,last_attempt=? WHERE id=? AND company_id=? AND webshop_id=? AND revision=? AND lock_until<=? AND last_attempt<=?').bind(lock,at+300,at,f.id,f.company_id,f.webshop_id,f.revision,at,at-30).run();
 if(claim.meta.changes!==1)throw new HttpError(409,'Feedet opdateres allerede eller er lige forsøgt. Vent 30 sekunder og prøv igen.');
 try{
  const result=await isDemoCompany(env,f.company_id)?demoFeed(JSON.parse(f.config_json)):await generateFeed(env,f.company_id,f.webshop_id,JSON.parse(f.config_json));
  const key=`${env.PLATFORM_ENV}/companies/${f.company_id}/webshops/${f.webshop_id}/feeds/${f.id}/${f.revision}-${lock}.xml`;
  await env.PLATFORM_DOCUMENTS.put(key,result.xml,{httpMetadata:{contentType:'application/xml; charset=utf-8'}});
  const update=await db.prepare('UPDATE product_feeds SET xml_key=?,item_count=?,generated_at=?,last_error=NULL,refresh_lock=NULL,lock_until=0 WHERE id=? AND revision=? AND refresh_lock=?').bind(key,result.count,now(),f.id,f.revision,lock).run();
  if(update.meta.changes!==1)throw new HttpError(409,'Feedet blev ændret under opdatering. Hent siden igen.');
  return await find(env,f.company_id,f.webshop_id,f.id);
 }catch(error){
  const message=error instanceof HttpError?error.message:'Feedet kunne ikke opdateres. Prøv igen senere.';
  await db.prepare('UPDATE product_feeds SET refresh_lock=NULL,lock_until=0,last_error=? WHERE id=? AND refresh_lock=?').bind(message,f.id,lock).run();
  throw new HttpError(error instanceof HttpError?error.status:503,message);
 }
}
async function xmlResponse(env:PlatformEnv,f:Feed,head=false){
 if(!f.xml_key)throw new HttpError(409,'Opdatér feedet først for at se XML.');
 const file=await env.PLATFORM_DOCUMENTS.get(f.xml_key);if(!file)throw new HttpError(503,'Feedfilen er midlertidigt utilgængelig.');
 return new Response(head?null:file.body,{headers:{'Content-Type':'application/xml; charset=utf-8','Content-Disposition':'inline; filename="partnerads.xml"','Cache-Control':'no-store','X-Feed-Updated-At':String(f.generated_at)}});
}
export async function publicFeed(request:Request,env:PlatformEnv){
 if(!['GET','HEAD'].includes(request.method))throw new HttpError(405,'Brug GET.');
 const path=new URL(request.url).pathname,match=path.match(/^\/feeds\/([a-f0-9]{64})\.xml$/),named=path.match(/^\/feeds\/([a-z0-9-]{1,40})\/([a-z0-9-]{1,60})\.xml$/);
 if(!match&&!named)throw new HttpError(404,'Feedet findes ikke.');
 const lookup=()=>env.PLATFORM_DB.prepare(`SELECT f.* FROM product_feeds f JOIN companies c ON c.id=f.company_id JOIN webshop_connections sc ON sc.company_id=f.company_id AND sc.webshop_id=f.webshop_id AND sc.provider='shopify' JOIN webshops w ON w.company_id=f.company_id AND w.id=f.webshop_id WHERE ${match?'f.public_token=?':'f.file_name=? AND EXISTS(SELECT 1 FROM feed_folders ff WHERE ff.company_id=f.company_id AND ff.webshop_id=f.webshop_id AND ff.slug=?)'} AND f.enabled=1 AND c.status='active' AND w.status='active'`).bind(...(match?[match[1]]:[named![2],named![1]])).first<Feed>();
 let f=await lookup();if(!f)throw new HttpError(404,'Feedet findes ikke eller er sat på pause.');
 if(!f.xml_key||!f.generated_at||f.generated_at<now()-900){
  if(request.method==='HEAD')return new Response(null,{status:503});
  const updated=await refresh(env,f),current=await lookup();
  if(!current||updated.revision!==current.revision||updated.xml_key!==current.xml_key)throw new HttpError(409,'Feedet er ændret. Prøv igen.');f=current;
 }
 return xmlResponse(env,f,request.method==='HEAD');
}
export async function handleFeeds(request:Request,env:PlatformEnv,actor:Actor,company:string,shop:string,path:string){
 if(shop==='none')throw new HttpError(409,'Forbind en webshop under Integrationer først.');
 await requireCompany(env.PLATFORM_DB,actor,company,true);await requireWebshop(env.PLATFORM_DB,actor,company,shop);
 if(actor.support||actor.platformAdmin)throw new HttpError(403,'Feeds administreres af virksomhedens administrator.');
 const db=env.PLATFORM_DB,url=new URL(request.url);
 if(path==='/feeds/catalog'&&request.method==='GET')return reply(await feedCatalog(env,company,shop,url));
 if(path==='/feeds'){
  // Named feeds always need their folder, also when it has not been reserved yet.
  const named=!!await db.prepare('SELECT 1 FROM product_feeds WHERE company_id=? AND webshop_id=? AND file_name IS NOT NULL').bind(company,shop).first();
  const folder=await folderFor(env,company,shop,request.method==='POST'||named);
  if(request.method==='GET')return reply({folderUrl:url.origin+'/feeds/'+(folder??await proposedFolder(env,company,shop))+'/',feeds:(await db.prepare('SELECT * FROM product_feeds WHERE company_id=? AND webshop_id=? ORDER BY created_at,id').bind(company,shop).all<Feed>()).results.map(f=>view(f,url.origin,folder))});
  if(request.method!=='POST')throw new HttpError(405,'Brug Opret feed.');
  const input=feedInput(await jsonBody(request,50000)),id=crypto.randomUUID();
  if(await fileNameTaken(env,company,shop,input.fileName,null))throw taken();
  const created=await db.prepare(`INSERT INTO product_feeds(id,company_id,webshop_id,name,file_name,service,config_json,enabled,public_token) SELECT ?,?,?,?,?,'partnerads',?,?,? WHERE (SELECT count(*) FROM product_feeds WHERE company_id=? AND webshop_id=?)<25`).bind(id,company,shop,input.name,input.fileName,JSON.stringify(input.config),input.enabled,token(),company,shop).run().catch(error=>{throw unique(error)?taken():error;});
  if(created.meta.changes!==1)throw new HttpError(409,'Der kan højst oprettes 25 feeds pr. webshop.');
  const f=await find(env,company,shop,id);await audit(env,actor,f,'created').run();return reply(view(f,url.origin,folder),201);
 }
 if(path==='/feeds/file-name'&&request.method==='GET'){
  const name=url.searchParams.get('name')||'',except=url.searchParams.get('feed');
  if(!fileNamePattern.test(name))return reply({available:false,reason:'Brug små bogstaver, tal og bindestreger (højst 60 tegn).'});
  return reply(await fileNameTaken(env,company,shop,name,except)?{available:false,reason:'Navnet er optaget i denne webshop.'}:{available:true});
 }
 const folder=await folderFor(env,company,shop,request.method==='PUT');
 const match=path.match(/^\/feeds\/([a-f0-9-]{36})(?:\/(refresh|preview|rotate))?$/);if(!match)throw new HttpError(404,'Funktionen findes ikke.');
 const f=await find(env,company,shop,match[1]);
 if(match[2]==='preview'&&request.method==='GET')return xmlResponse(env,f);
 const b=await jsonBody(request,50000);
 if(!Number.isInteger(b.revision)||b.revision!==f.revision)throw new HttpError(409,'Feedet er ændret i en anden fane. Hent siden igen.');
 if(match[2]==='refresh'&&request.method==='POST')return reply(view(await refresh(env,f),url.origin,folder));
 if(match[2]==='rotate'&&request.method==='POST'){
  const change=await db.prepare('UPDATE product_feeds SET public_token=?,revision=revision+1 WHERE id=? AND revision=?').bind(token(),f.id,f.revision).run();
  if(change.meta.changes!==1)throw new HttpError(409,'Feedet blev ændret.');
  await audit(env,actor,f,'link_rotated').run();return reply(view(await find(env,company,shop,f.id),url.origin,folder));
 }
 if(!match[2]&&request.method==='PUT'){
  const input=feedInput(b);
  if(await fileNameTaken(env,company,shop,input.fileName,f.id))throw taken();
  const change=await db.prepare('UPDATE product_feeds SET name=?,file_name=?,config_json=?,enabled=?,revision=revision+1,xml_key=NULL,item_count=NULL,generated_at=NULL,last_error=NULL WHERE id=? AND revision=?').bind(input.name,input.fileName,JSON.stringify(input.config),input.enabled,f.id,f.revision).run().catch(error=>{throw unique(error)?taken():error;});
  if(change.meta.changes!==1)throw new HttpError(409,'Feedet blev ændret.');
  await audit(env,actor,f,'updated').run();return reply(view(await find(env,company,shop,f.id),url.origin,folder));
 }
 if(!match[2]&&request.method==='DELETE'){
  const change=await db.prepare('DELETE FROM product_feeds WHERE id=? AND revision=?').bind(f.id,f.revision).run();
  if(change.meta.changes!==1)throw new HttpError(409,'Feedet blev ændret.');
  await audit(env,actor,f,'deleted').run();return reply({deleted:true});
 }
 throw new HttpError(405,'Handlingen understøttes ikke.');
}
