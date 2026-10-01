import { orderQuery,shopAccess } from './invoice-source';
import { normalizeReportable,type PackagingRow } from './packaging-calculations';
import { HttpError,type PlatformEnv } from './types';
const day=(d:Date)=>new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Copenhagen',year:'numeric',month:'2-digit',day:'2-digit'}).format(d);
// Compares what a sync would store, ignoring when it was stored.
const stable=(r:PackagingRow)=>JSON.stringify(Object.entries({...r,date:'',snapshottedAt:'',refreshedAt:''}).sort(([a],[b])=>a.localeCompare(b)));
const same=(a:PackagingRow,b:PackagingRow)=>stable(a)===stable(b);
const orderAudience=(o:any):'commercial'|'household'=>o.billingAddress?.company?.trim()||o.shippingAddress?.company?.trim()?'commercial':'household';
async function completeFulfillmentLines(access:Awaited<ReturnType<typeof shopAccess>>,fulfillment:any){
 const connection=fulfillment.fulfillmentLineItems;if(!Array.isArray(connection?.nodes)||typeof connection.pageInfo?.hasNextPage!=='boolean')throw new HttpError(409,'Leveringslinjerne er ufuldstændige.');const nodes=[...connection.nodes];let after=connection.pageInfo?.endCursor||null;
 for(let page=0;connection.pageInfo?.hasNextPage;page++){
  if(!after||page>=99)throw new Error('En levering har for mange linjer til én sikker synkronisering.');
  const d:any=await orderQuery<any>(access,`query PackagingFulfillmentLines($id:ID!,$after:String){node(id:$id){... on Fulfillment{fulfillmentLineItems(first:100,after:$after){nodes{id quantity lineItem{title variant{id title product{id title}}}}pageInfo{hasNextPage endCursor}}}}}`,{id:fulfillment.id,after},'Shopify kunne ikke hente alle leveringslinjer til emballageregistreringen.');
  const next=d.node?.fulfillmentLineItems;if(!Array.isArray(next?.nodes)||typeof next.pageInfo?.hasNextPage!=='boolean')throw new Error('Shopify returnerede ikke alle leveringslinjer til emballageregistreringen.');
  nodes.push(...(next.nodes||[]));const cursor=next.pageInfo?.endCursor||null;
  if(next.pageInfo?.hasNextPage&&(!cursor||cursor===after))throw new Error('Shopify stoppede under hentning af leveringslinjer.');
  connection.pageInfo=next.pageInfo;after=cursor;
 }
 return nodes;
}
export async function syncPackaging(env:PlatformEnv,company:string,shop:string,start:string,end:string){const db=env.PLATFORM_DB;
 const saved=(await db.prepare('SELECT event_id,payload_json FROM packaging_snapshots WHERE company_id=? AND webshop_id=?').bind(company,shop).all<{event_id:string;payload_json:string}>()).results;
 const queryStart=start;
 const access=await shopAccess(env,company,shop),query=`status:any updated_at:>='${queryStart+'T00:00:00Z'}'`,source:any[]=[];let after:null|string=null;const cursors=new Set<string>();
 if(start<day(new Date(Date.now()-59*86400000))){const scopes=await orderQuery<{currentAppInstallation:{accessScopes:Array<{handle:string}>}}>(access,'query PackagingHistoryAccess{currentAppInstallation{accessScopes{handle}}}',{});if(!scopes.currentAppInstallation?.accessScopes.some(s=>s.handle==='read_all_orders'))throw Error('Shopify-integrationen skal have read_all_orders-adgang for at hente hele kvartalshistorikken.');}
 // Keep nested connections deliberately small. Shopify rejects a single Admin API query above 1,000 cost points.
 for(let p=0;p<100;p++){const d:any=await orderQuery<any>(access,`query PackagingOrders($after:String,$query:String!){orders(first:25,after:$after,query:$query,sortKey:UPDATED_AT){nodes{id name test billingAddress{company} shippingAddress{company} fulfillments{ id createdAt status fulfillmentLineItems(first:25){nodes{id quantity lineItem{title variant{id title product{id title}}}} pageInfo{hasNextPage endCursor}}}}pageInfo{hasNextPage endCursor}}}`,{after,query},'Shopify kunne ikke hente emballageordrer.');
  if(!Array.isArray(d.orders?.nodes)||typeof d.orders.pageInfo?.hasNextPage!=='boolean')throw new HttpError(409,'Ordrehistorikken er ufuldstændig.');
  for(const o of d.orders.nodes)for(const f of o.fulfillments||[])if(f.status==='SUCCESS'){const date=day(new Date(f.createdAt));if(date<start||date>end)continue;for(const x of await completeFulfillmentLines(access,f))source.push({o,f,x});}
  if(!d.orders.pageInfo.hasNextPage)break;after=d.orders.pageInfo.endCursor;if(!after||cursors.has(after)||p===99)throw new Error('Emballagehistorikken er for stor til én sikker synkronisering.');cursors.add(after);}
 if(source.length>10000)throw new HttpError(409,'Vælg en kortere periode.');
 const productIds=[...new Set(source.map(({x})=>x.lineItem?.variant?.product?.id).filter(Boolean))] as string[],products=new Map<string,any>();
 for(let i=0;i<productIds.length;i+=100){const ids=productIds.slice(i,i+100),d:any=await orderQuery<any>(access,`query PackagingProducts($ids:[ID!]!){nodes(ids:$ids){... on Product{id title packagingReportable:metafield(namespace:"custom",key:"emballage_indberetning"){value} packagingWeight:metafield(namespace:"custom",key:"emballage_vaegt_gram"){value} packagingSupplier:metafield(namespace:"custom",key:"emballage_leverandor"){value} packagingSupplierCountry:metafield(namespace:"custom",key:"emballage_leverandorland"){value} packagingSupplierCvr:metafield(namespace:"custom",key:"emballage_leverandor_cvr"){value}}}}`,{ids},'Shopify kunne ikke hente produkternes emballagefelter.');for(const product of d.nodes||[])if(product?.id)products.set(product.id,product);}
 const rows:PackagingRow[]=source.map(({o,f,x})=>{const v=x.lineItem?.variant,base=v?.product,pd=products.get(base?.id)||base,w=pd?.packagingWeight?.value,weight=w===null||w===undefined||w===''?null:Number(w);if(weight!==null&&(!Number.isSafeInteger(weight)||weight<0))throw new Error(`Ugyldig emballagevægt på ${pd?.title||x.lineItem.title}.`);return {test:Boolean(o.test),audience:orderAudience(o),eventId:x.id,fulfillmentId:f.id,fulfilledAt:f.createdAt,date:day(new Date(f.createdAt)),orderId:o.id,orderName:o.name,productId:pd?.id||null,product:pd?.title||x.lineItem.title,variantId:v?.id||null,variant:v?.title||'',quantity:x.quantity,weightGrams:weight,reportable:normalizeReportable(pd?.packagingReportable?.value),supplier:pd?.packagingSupplier?.value||'',supplierCountry:pd?.packagingSupplierCountry?.value||'',supplierCvr:pd?.packagingSupplierCvr?.value||'',snapshottedAt:new Date().toISOString()};});
 const old=new Map(saved.map(x=>[x.event_id,JSON.parse(x.payload_json) as PackagingRow])),writes:Array<{key:string;value:PackagingRow}>=[];
 for(const row of rows){const before=old.get(row.eventId);if(before&&before.reportable!=='unknown'&&before.weightGrams!==null){if(before.audience!==row.audience||before.test!==row.test)writes.push({key:row.eventId,value:{...before,audience:row.audience,test:row.test}});continue;}if(before&&same(before,row))continue;const next=before?{...row,date:before.date,snapshottedAt:before.snapshottedAt,refreshedAt:new Date().toISOString()}:row;writes.push({key:row.eventId,value:next});}

 const seen=new Set<string>();for(const row of rows){if(!/^gid:\/\/shopify\/FulfillmentLineItem\/\d+$/.test(row.eventId)||seen.has(row.eventId)||!Number.isSafeInteger(row.quantity)||row.quantity<0)throw new HttpError(409,'Leveringslinjerne er ugyldige eller gentagne.');seen.add(row.eventId);}
 const upserts=writes.map(w=>db.prepare(`INSERT INTO packaging_snapshots(company_id,webshop_id,event_id,payload_json) VALUES(?,?,?,?) ON CONFLICT(company_id,webshop_id,event_id) DO UPDATE SET payload_json=CASE WHEN json_extract(packaging_snapshots.payload_json,'$.reportable')='unknown' OR json_extract(packaging_snapshots.payload_json,'$.weightGrams') IS NULL THEN excluded.payload_json ELSE json_set(packaging_snapshots.payload_json,'$.audience',json_extract(excluded.payload_json,'$.audience'),'$.test',json(json_extract(excluded.payload_json,'$.test'))) END`).bind(company,shop,w.key,JSON.stringify(w.value)));
 for(let i=0;i<upserts.length;i+=100)await db.batch(upserts.slice(i,i+100));
 // A sync widens the covered period when it overlaps or touches it; a shorter or separate sync never shrinks it.
 await db.batch([ db.prepare('INSERT INTO packaging_sync(company_id,webshop_id,coverage_start,coverage_end) VALUES(?,?,?,?) ON CONFLICT(company_id,webshop_id) DO UPDATE SET coverage_start=CASE WHEN joins THEN min(packaging_sync.coverage_start,excluded.coverage_start) ELSE packaging_sync.coverage_start END,coverage_end=CASE WHEN joins THEN max(packaging_sync.coverage_end,excluded.coverage_end) ELSE packaging_sync.coverage_end END,synced_at=CURRENT_TIMESTAMP'.replaceAll('joins',"excluded.coverage_start<=date(packaging_sync.coverage_end,'+1 day') AND excluded.coverage_end>=date(packaging_sync.coverage_start,'-1 day')")).bind(company,shop,start,end)]);
 return {count:rows.length,stored:writes.length};
}
