import type { PlatformEnv } from './types';
import type { Shipment, ShipmentList, ShipmentEvent, StepKey } from './tier1/src/lib/shipments';

const hour = 3600000;
const host = 'https://track.shipmondo.com';
const canonical = (carrier: string) => ({postnord:'pdk',post_nord:'pdk',gls_dk:'gls'} as Record<string,string>)[carrier] || carrier;
export type TrackingTarget = {url:string;carrier:string;number:string};
export type PublicTracking = {status:string;text:string;shipmentId:string;events:ShipmentEvent[]};
type Row = {company_id:string;webshop_id:string;parcel_key:string;source_key:string;url:string;carrier:string;tracking_number:string;shipped_at:string;data_json:string|null;checked_at:string|null;attempted_at:string|null;error:string|null;next_check:number;terminal:number;expires_at:number};
const clean = (x:unknown, max=400) => typeof x==='string' ? x.trim().slice(0,max) : '';
export const trackingSourceKey = async (value:string) => [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)))].map(x=>x.toString(16).padStart(2,'0')).join('');

// Never fetch a URL supplied by a customer or a carrier verbatim. Only this fixed HTTPS origin is used.
export function trackingTarget(s:Pick<Shipment,'trackingNumber'|'trackingUrl'|'carrier'>):TrackingTarget|null {
 const number=s.trackingNumber?.trim();
 if(!number || !/^[a-zA-Z0-9-]{5,100}$/.test(number))return null;
 let carrier:string|null=null;
 if(s.trackingUrl){try{
  const u=new URL(s.trackingUrl);
  if(u.hostname==='track.shipmondo.com'){
   if(u.protocol!=='https:'||u.port||u.username||u.password||u.search||u.hash)return null;
   const p=u.pathname.match(/^\/([a-z0-9_]{2,50})\/([a-zA-Z0-9-]{5,100})\/?$/);
   if(!p||p[2]!==number)return null;
   carrier=p[1];
   if(s.carrier && canonical(carrier)!==canonical(s.carrier))return null;
  }
 }catch{return null;}}
 carrier=carrier||s.carrier;
 if(!carrier)return null;
 carrier=canonical(carrier);
 return {url:`${host}/${carrier}/${number}`,carrier,number};
}

// The Danish public page supplies wall-clock timestamps, without an offset. Convert explicitly (including DST).
export function trackingTime(value:unknown):string {
 const m=typeof value==='string' && value.match(/^(\d{4})\/(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/);
 if(!m)throw Error('date');
 const target=`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}`, base=Date.parse(target+'Z');
 if(!Number.isFinite(base))throw Error('date');
 const fmt=new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Copenhagen',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'});
 // Denmark has UTC+1 or UTC+2. Reject impossible wall times; choose later occurrence at the autumn transition.
 for(const offset of [1,2]){const ms=base-offset*hour;if(fmt.format(new Date(ms)).replace(' ','T')===target && ms<=Date.now()+300000)return new Date(ms).toISOString();}
 throw Error('date');
}

export function parsePublicTracking(html:string,target:TrackingTarget,shippedAt:string):PublicTracking {
 if(html.length>512000)throw Error('size');
 const start=html.search(/window\.tracking\s*=/);
 if(start<0)throw Error('format');
 const tail=html.slice(start), assignment=tail.match(/^window\.tracking\s*=\s*/)!;
 const input=tail.slice(assignment[0].length);
 // Extract a single JSON object; never execute provider JavaScript.
 let depth=0, quoted=false, escaped=false, end=-1;
 if(input[0]!=='{')throw Error('format');
 for(let i=0;i<input.length;i++){const c=input[i];if(quoted){if(escaped)escaped=false;else if(c==='\\')escaped=true;else if(c==='"')quoted=false;}else if(c==='"')quoted=true;else if(c==='{')depth++;else if(c==='}'&&--depth===0){end=i+1;break;}}
 if(end<0||!/^\s*;/.test(input.slice(end)))throw Error('format');
 const data=JSON.parse(input.slice(0,end));
 if(data.tracking!==target.number||canonical(data.shipping_agent)!==target.carrier||!Array.isArray(data.events)||!data.events.length||data.events.length>300||!clean(data.status,80))throw Error('mismatch');
 const events:ShipmentEvent[]=data.events.map((e:any)=>{
  if(!e||!clean(e.status,80)||!clean(e.statusText))throw Error('event');
  return {status:clean(e.status,80),label:clean(e.statusText),message:null,at:trackingTime(e.datetime)};
 }).sort((a:ShipmentEvent,b:ShipmentEvent)=>a.at.localeCompare(b.at));
 if(Date.parse(events.at(-1)!.at)<Date.parse(shippedAt)-86400000)throw Error('old parcel');
 if(events.at(-1)!.status!==data.status)throw Error('inconsistent');
 return {status:clean(data.status,80),text:clean(data.statusText),shipmentId:/^\d+$/.test(String(data.shipment_id))?String(data.shipment_id):'',events};
}

export async function fetchPublicTracking(target:TrackingTarget,shippedAt:string):Promise<PublicTracking> {
 // Revalidate persisted targets too; redirects must not carry us outside the public tracking service.
 if(target.url!==`${host}/${target.carrier}/${target.number}`||!/^\w{2,50}$/.test(target.carrier)||!/^[a-zA-Z0-9-]{5,100}$/.test(target.number))throw Error('target');
 const response=await fetch(target.url,{method:'GET',redirect:'manual',signal:AbortSignal.timeout(8000),headers:{Accept:'text/html','Accept-Language':'da-DK,da;q=0.9'}});
 if(!response.ok||!response.headers.get('content-type')?.includes('text/html')){await response.body?.cancel();throw Error('response');}
 const reader=response.body?.getReader();if(!reader)throw Error('body');
 const decoder=new TextDecoder();let html='',bytes=0;
 while(true){const r=await reader.read();if(r.done)break;bytes+=r.value.byteLength;if(bytes>512000){await reader.cancel();throw Error('size');}html+=decoder.decode(r.value,{stream:true});}
 return parsePublicTracking(html+decoder.decode(),target,shippedAt);
}

const safeError='Tracking kunne ikke opdateres. Senest kendte oplysninger vises; prøv det originale trackinglink.';
async function refreshRow(env:PlatformEnv,row:Row){
 const db=env.PLATFORM_DB,owner=crypto.randomUUID(),now=Date.now();
 const claim=await db.prepare('UPDATE shipment_tracking_cache SET lease_owner=?,lease_until=? WHERE company_id=? AND webshop_id=? AND parcel_key=? AND source_key=? AND terminal=0 AND next_check<=? AND lease_until<=?').bind(owner,now+60000,row.company_id,row.webshop_id,row.parcel_key,row.source_key,now,now).run();
 if(claim.meta.changes!==1)return;
 const suffix=[row.company_id,row.webshop_id,row.parcel_key,row.source_key,owner];
 try{
  const data=await fetchPublicTracking({url:row.url,carrier:row.carrier,number:row.tracking_number},row.shipped_at);
  const previous=row.data_json?JSON.parse(row.data_json) as PublicTracking:null;
  if(previous && previous.events.at(-1)!.at>data.events.at(-1)!.at)throw Error('regression');
  await db.prepare('UPDATE shipment_tracking_cache SET data_json=?,checked_at=?,attempted_at=?,error=NULL,next_check=?,terminal=?,lease_until=0,lease_owner=NULL WHERE company_id=? AND webshop_id=? AND parcel_key=? AND source_key=? AND lease_owner=?')
   .bind(JSON.stringify(data),new Date().toISOString(),new Date().toISOString(),now+hour,data.status==='DELIVERED'?1:0,...suffix).run();
 }catch{
  // Keep the last good snapshot even when the source changes layout, rate-limits, times out or goes down.
  await db.prepare('UPDATE shipment_tracking_cache SET attempted_at=?,error=?,next_check=?,lease_until=0,lease_owner=NULL WHERE company_id=? AND webshop_id=? AND parcel_key=? AND source_key=? AND lease_owner=?').bind(new Date().toISOString(),safeError,now+hour,...suffix).run();
 }
}

export function applyPublicTracking(s:Shipment,row:Row|null):Shipment {
 const target=trackingTarget(s);
 if(!target)return {...s,publicTracking:{checkedAt:null,error:null,state:'unavailable',text:'Automatisk tracking er ikke tilgængelig for dette pakkenummer.'}};
 if(!row?.data_json)return {...s,trackingUrl:s.trackingUrl||target.url,publicTracking:{checkedAt:null,error:row?.error||null,state:row?.error?'error':'pending',text:'Afventer tracking fra Shipmondo.'}};
 const data=JSON.parse(row.data_json) as PublicTracking;
 const last=data.events.at(-1)!;
 // Only verified statuses are mapped. Unknown provider statuses remain visible as text.
 const mapped:Record<string,StepKey>={INFORMED:'printed',EN_ROUTE:'transit',READY_FOR_PICKUP:'ready',DELIVERED:'delivered'};
 const current=mapped[data.status]||'printed', ready=data.events.find(e=>e.status==='READY_FOR_PICKUP')?.at||null;
 const pickup=s.pickupPoint||Boolean(ready),delivered=data.status==='DELIVERED';
 const keys:StepKey[]=pickup?['printed','dropped','transit','ready','delivered']:['printed','dropped','transit','delivered'];
 const labels:Record<StepKey,string>={printed:'Registreret',dropped:'Indleveret til fragtfirmaet',transit:'Under transport',ready:'Klar i pakkeshop',delivered:pickup?'Afhentet af kunden':'Leveret hos kunden'};
 const times:Partial<Record<StepKey,string>>={};for(const e of data.events){const key=mapped[e.status];if(key&&!times[key])times[key]=e.at;}
 const index=keys.indexOf(current);
 return {...s,trackingUrl:s.trackingUrl||target.url,events:data.events,current,pickupPoint:pickup,readyAt:ready,delivered,deliveredAt:delivered?last.at:null,
  issue:mapped[data.status]?null:data.text||data.status,
  steps:keys.map((key,i)=>({key,label:labels[key],at:times[key]||null,reached:i<=index})),
  publicTracking:{checkedAt:row.checked_at,error:row.error,state:row.error?'error':'ok',text:data.text||data.status,shipmentId:data.shipmentId}};
}

export async function enrichPublicTracking(env:PlatformEnv,company:string,shop:string,list:ShipmentList,source:string){
 const db=env.PLATFORM_DB,sourceKey=await trackingSourceKey(source);
 await db.prepare('DELETE FROM shipment_tracking_cache WHERE company_id=? AND webshop_id=? AND source_key<>?').bind(company,shop,sourceKey).run();
 const keys=new Map<string,string>();const statements=[];
 for(const s of list.shipments){const t=trackingTarget(s);if(!t)continue;
  const key=await trackingSourceKey(JSON.stringify([s.id,s.shippedAt,t.url]));keys.set(s.id,key);
  statements.push(db.prepare('INSERT INTO shipment_tracking_cache(company_id,webshop_id,parcel_key,source_key,url,carrier,tracking_number,shipped_at,expires_at) VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT DO NOTHING').bind(company,shop,key,sourceKey,t.url,t.carrier,t.number,s.shippedAt,Date.parse(s.shippedAt)+90*86400000));
 }
 for(let i=0;i<statements.length;i+=50)await db.batch(statements.slice(i,i+50));
 let rows=(await db.prepare('SELECT * FROM shipment_tracking_cache WHERE company_id=? AND webshop_id=? AND source_key=?').bind(company,shop,sourceKey).all<Row>()).results;
 const needed=new Set(keys.values()),due=rows.filter(r=>needed.has(r.parcel_key)&&!r.terminal&&r.next_check<=Date.now()).sort((a,b)=>a.next_check-b.next_check).slice(0,8);
 // Bound foreground latency; remaining parcels are processed by the background schedule.
 for(let i=0;i<due.length;i+=4)await Promise.all(due.slice(i,i+4).map(r=>refreshRow(env,r)));
 if(due.length)rows=(await db.prepare('SELECT * FROM shipment_tracking_cache WHERE company_id=? AND webshop_id=? AND source_key=?').bind(company,shop,sourceKey).all<Row>()).results;
 const map=new Map(rows.map(r=>[r.parcel_key,r]));
 return {...list,shipmondo:undefined,shipments:list.shipments.map(s=>applyPublicTracking(s,map.get(keys.get(s.id)||'')||null))};
}

export async function refreshPublicTracking(env:PlatformEnv){
 const db=env.PLATFORM_DB,now=Date.now();
 await db.prepare('DELETE FROM shipment_tracking_cache WHERE expires_at<?').bind(now).run();
 const rows=(await db.prepare(`SELECT t.*,k.shop_domain,k.credentials_encrypted FROM shipment_tracking_cache t
 JOIN companies c ON c.id=t.company_id AND c.status='active' AND c.demo=0
 JOIN webshops w ON w.company_id=t.company_id AND w.id=t.webshop_id AND w.status='active'
 JOIN webshop_connections k ON k.company_id=t.company_id AND k.webshop_id=t.webshop_id AND k.provider='shopify'
 WHERE t.terminal=0 AND t.next_check<=? AND t.lease_until<=? AND NOT EXISTS(SELECT 1 FROM public_signups p WHERE p.company_id=t.company_id AND p.trial_ends_at<=unixepoch())
 ORDER BY t.next_check,t.company_id,t.webshop_id LIMIT 40`).bind(now,now).all<Row & {shop_domain:string;credentials_encrypted:string}>()).results;
 for(let i=0;i<rows.length;i+=4)await Promise.all(rows.slice(i,i+4).map(async r=>{
  if(r.source_key!==await trackingSourceKey(JSON.stringify([r.shop_domain,r.credentials_encrypted]))){await db.prepare('DELETE FROM shipment_tracking_cache WHERE company_id=? AND webshop_id=? AND parcel_key=? AND source_key=?').bind(r.company_id,r.webshop_id,r.parcel_key,r.source_key).run();return;}
  await refreshRow(env,r);
 }));
 return {processed:rows.length};
}
