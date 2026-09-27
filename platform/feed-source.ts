import {orderQuery,shopAccess} from './invoice-source';
import {HttpError,type PlatformEnv} from './types';
import {productXml,type Product,type Variant} from './feed-format';

export type Selection={id:string;title:string};
export type FeedConfig={allProducts:boolean;collections:Selection[];products:Selection[];shippingCost:string;freeShippingFrom:string|null;deliveryTime:string;category:string};
type Page<T>={nodes:T[];pageInfo:{hasNextPage:boolean;endCursor:string|null}};
const page='pageInfo { hasNextPage endCursor }';
const variantFields='id barcode title price compareAtPrice availableForSale inventoryQuantity selectedOptions { name value } image { url }';
const productFields=`id status title handle productType descriptionHtml vendor featuredImage { url } gender:metafield(namespace:"custom",key:"gender"){value} variants(first:50){nodes{${variantFields}} ${page}}`;
const problem=()=>new HttpError(409,'Produktdata kunne ikke hentes fuldstændigt. Kontrollér Shopify-adgangen read_products og dit udvalg.');
function next<T>(p:Page<T>,seen:Set<string>):string|null{
 if(!Array.isArray(p?.nodes)||typeof p.pageInfo?.hasNextPage!=='boolean')throw problem();
 if(!p.pageInfo.hasNextPage)return null;
 const cursor=p.pageInfo.endCursor;
 if(!cursor||seen.has(cursor)||!p.nodes.length)throw problem();
 seen.add(cursor);return cursor;
}
export async function feedCatalog(env:PlatformEnv,company:string,shop:string,url:URL){
 const kind=url.searchParams.get('kind')==='collections'?'collections':'products';
 const after=url.searchParams.get('after')||null,q=(url.searchParams.get('q')||'').trim();
 if(q.length>100||(after?.length||0)>1024)throw problem();
 const access=await shopAccess(env,company,shop);
 // Only simple text terms enter Shopify's search syntax.
 const words=q.replace(/[^\p{L}\p{N} _-]/gu,'').split(/\s+/).filter(Boolean);
 const query=[...(kind==='products'?['status:active']:[]),...words.map(w=>`title:${w}*`)].join(' AND ');
 const result=await orderQuery<Record<string,Page<{id:string;title:string}>>>(access,`query FeedCatalog($after:String,$query:String!){${kind}(first:50,after:$after,query:$query){nodes{id title} ${page}}}`,{after,query},problem().message);
 const data=result[kind];next(data,new Set(after?[after]:[]));
 return {items:data.nodes,nextCursor:data.pageInfo.hasNextPage?data.pageInfo.endCursor:null};
}
export async function generateFeed(env:PlatformEnv,company:string,shop:string,config:FeedConfig){
 const access=await shopAccess(env,company,shop);
 let calls=0;
 const query=async<T>(text:string,vars:Record<string,unknown>={})=>{
  if(++calls>180)throw new HttpError(409,'Feedet er for stort til én opdatering. Vælg færre kollektioner eller produkter.');
  return orderQuery<T>(access,text,vars,problem().message);
 };
 const meta=await query<{shop:{primaryDomain:{url:string};currencyCode:string}}>('query FeedShop {shop{primaryDomain{url} currencyCode}}');
 if(meta.shop.currencyCode!=='DKK')throw new HttpError(409,'PartnerAds-feedet understøtter i første omgang DKK.');
 const domain=new URL(meta.shop.primaryDomain.url);
 if(domain.protocol!=='https:'||domain.username||domain.password)throw problem();
 const products=new Map<string,{product:Product;category:string}>();
 const add=(p:Product,category:string)=>{
  if(!p||!/^gid:\/\/shopify\/Product\/\d+$/.test(p.id))throw problem();
  if(!products.has(p.id))products.set(p.id,{product:p,category});
  if(products.size>2500)throw new HttpError(409,'Et feed må højst indeholde 2.500 produkter. Afgræns dit udvalg.');
 };
 const collect=async(id:string|null)=>{
  let after:string|null=null;const seen=new Set<string>(),productIds=new Set<string>();
  do{
   const response:any=await query(id?`query FeedCollection($id:ID!,$after:String){collection(id:$id){title products(first:10,after:$after){nodes{${productFields}} ${page}}}}`:`query FeedProducts($after:String){products(first:10,after:$after,query:"status:active"){nodes{${productFields}} ${page}}}`,{id,after});
   const connection:Page<Product>=id?response.collection?.products:response.products;
   const cursor=next(connection,seen);
   for(const p of connection.nodes){if(productIds.has(p.id))throw problem();productIds.add(p.id);add(p,id?response.collection.title:p.productType||'');}
   after=cursor;
  }while(after);
 };
 if(config.allProducts)await collect(null);
 else{
  for(const c of config.collections)await collect(c.id);
  for(let i=0;i<config.products.length;i+=10){
   const ids=config.products.slice(i,i+10).map(p=>p.id);
   const data=await query<{nodes:(Product|null)[]}>(`query FeedSelected($ids:[ID!]!){nodes(ids:$ids){... on Product{${productFields}}}}`,{ids});
   if(!Array.isArray(data.nodes)||data.nodes.length!==ids.length||data.nodes.some((p,i)=>!p||p.id!==ids[i]))throw problem();
   for(const p of data.nodes)add(p!,p!.productType||'');
  }
 }
 const entries:string[]=[];
 for(const {product:p,category} of products.values()){
  if(p.status!=='ACTIVE')continue;
  let connection=p.variants as Page<Variant>,after:string|null;
  const seen=new Set<string>(),ids=new Set<string>();
  do{
   after=next(connection,seen);
   for(const v of connection.nodes){
    if(!/^gid:\/\/shopify\/ProductVariant\/\d+$/.test(v.id)||ids.has(v.id))throw problem();ids.add(v.id);
    if(!v.availableForSale)continue;
    if(!/^\d+(\.\d{1,2})?$/.test(v.price)||!Number.isFinite(Number(v.price))||(v.compareAtPrice!==null&&!/^\d+(\.\d{1,2})?$/.test(v.compareAtPrice)))throw problem();
    entries.push(productXml(p,v,domain.origin,{SHOPIFY_COLLECTION_TITLE:config.category||category,SHIPPING_COST:config.shippingCost,FREE_SHIPPING_FROM:config.freeShippingFrom===null?null:Number(config.freeShippingFrom),DELIVERY_TIME:config.deliveryTime}));
    if(entries.length>10000)throw new HttpError(409,'Et feed må højst indeholde 10.000 varianter.');
   }
   if(after){
    const data=await query<{product:{variants:Page<Variant>}|null}>(`query FeedVariants($id:ID!,$after:String!){product(id:$id){variants(first:100,after:$after){nodes{${variantFields}} ${page}}}}`,{id:p.id,after});
    if(!data.product)throw problem();connection=data.product.variants;
   }
  }while(after);
 }
 const xml=`<?xml version="1.0" encoding="UTF-8"?>\n<produkter>\n${entries.join('\n')}\n</produkter>\n`;
 if(new TextEncoder().encode(xml).length>15_000_000)throw new HttpError(409,'Feedet overstiger 15 MB. Afgræns dit udvalg.');
 return {xml,count:entries.length};
}
