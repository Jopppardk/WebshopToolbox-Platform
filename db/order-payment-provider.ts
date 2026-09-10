import {getShopifyAccess} from '@/db/shopify';
import {orderQuery} from '@/db/shopify-order';
// Enrich only the displayed cached orders; never resync invoices or accounting.
export async function enrichOrderPaymentProviders(db:D1Database,rows:{payload_json:string}[]){
 const missing=rows.filter(r=>!Array.isArray(JSON.parse(r.payload_json).paymentGatewayNames));
 const ids=[...new Set(missing.map(r=>String(JSON.parse(r.payload_json).id)).filter(id=>/^gid:\/\/shopify\/Order\/\d+$/.test(id)))].slice(0,100);
 if(!ids.length)return;
 try{
  const data=await orderQuery<{nodes:({id:string;paymentGatewayNames:string[]}|null)[]}>(await getShopifyAccess(),'query OrderPaymentProviders($ids:[ID!]!){nodes(ids:$ids){... on Order{id paymentGatewayNames}}}',{ids});
  for(const node of data.nodes||[]){
   if(!node||!ids.includes(node.id)||!Array.isArray(node.paymentGatewayNames)||node.paymentGatewayNames.some(n=>typeof n!=='string'))continue;
   for(const row of missing.filter(r=>JSON.parse(r.payload_json).id===node.id)){
    const updated=JSON.stringify({...JSON.parse(row.payload_json),paymentGatewayNames:node.paymentGatewayNames});
    await db.prepare("UPDATE integration_records SET payload_json=? WHERE tenant='sablen.dk' AND record_type='order' AND external_id=? AND payload_json=?").bind(updated,node.id,row.payload_json).run();
    row.payload_json=updated;
   }
  }
 }catch{ /* Keep cached sales visible during a temporary Shopify outage. */ }
}

