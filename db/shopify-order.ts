import { getShopifyAccess } from './shopify';
import type { InvoiceSource, Connection } from '@/lib/invoice-check';
const money = '{ shopMoney { amount currencyCode } }';
const taxes = `taxLines { rate channelLiable priceSet ${money} } discountAllocations { allocatedAmountSet ${money} }`;
const itemFields = `id name quantity currentQuantity requiresShipping isGiftCard variant { inventoryItem { id unitCost { amount currencyCode } } } originalTotalSet ${money} discountedTotalSet ${money} ${taxes}`;
const shippingFields = `id title isRemoved originalPriceSet ${money} discountedPriceSet ${money} ${taxes}`;
const page = 'pageInfo { hasNextPage endCursor }';
export const orderFields = `id name email createdAt updatedAt processedAt test edited cancelledAt taxesIncluded displayFinancialStatus displayFulfillmentStatus
  fulfillments { createdAt status }
  customer { displayName firstName lastName }
  billingAddress { name address1 address2 zip city country countryCodeV2 }
  shippingAddress { name address1 address2 zip city country countryCodeV2 }
  currentTotalPriceSet ${money} currentSubtotalPriceSet ${money} currentTotalTaxSet ${money} totalRefundedSet ${money} totalPriceSet ${money} totalTaxSet ${money}
  lineItems(first:100) { nodes { ${itemFields} } ${page} }
  shippingLines(first:25) { nodes { ${shippingFields} } ${page} }`;
type Access = Awaited<ReturnType<typeof getShopifyAccess>>;
export async function orderQuery<T>(access: Access, query: string, variables: Record<string, unknown>, errorMessage = 'Shopify kunne ikke hente komplette ordredata. Kontrollér read_orders-adgangen og prøv igen.'): Promise<T> {
  const response = await fetch(`https://${access.shop}/admin/api/2026-07/graphql.json`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': access.accessToken }, body: JSON.stringify({ query, variables }), signal: AbortSignal.timeout(25000), redirect: 'manual' });
  const payload = await response.json() as { data?: T; errors?: unknown[] };
  if (!response.ok || payload.errors?.length || !payload.data) throw new Error(errorMessage);
  return payload.data;
}
export async function completeOrder(order: InvoiceSource, access: Access): Promise<InvoiceSource> {
  let pages = 0;
  for (const key of ['lineItems', 'shippingLines'] as const) {
    const connection = order[key] as Connection<{ id: string }>;
    if (!Array.isArray(connection?.nodes) || typeof connection.pageInfo?.hasNextPage !== 'boolean') throw new Error('Shopify returnerede ufuldstændige ordrelinjer.');
    const seen = new Set(connection.nodes.map(n => n.id));
    if (seen.size !== connection.nodes.length) throw new Error('Shopify returnerede dublerede linjer.');
    while (connection.pageInfo.hasNextPage) {
      if (++pages > 20) throw new Error('Ordren er for stor til én kontrol. Ingen ufuldstændig faktura oprettes.');
      const after = connection.pageInfo.endCursor;
      if (!after) throw new Error('Shopify mangler en fortsættelse til ordrelinjerne.');
      const data = await orderQuery<{ order: InvoiceSource | null }>(access, `query MoreInvoiceLines($id:ID!,$after:String!) { order(id:$id) { id updatedAt ${key}(first:100,after:$after) { nodes { ${key === 'lineItems' ? itemFields : shippingFields} } ${page} } } }`, { id: order.id, after });
      if (!data.order || data.order.id !== order.id || data.order.updatedAt !== order.updatedAt) throw new Error('Ordren blev ændret under kontrollen. Prøv igen.');
      const next = data.order[key];
      if (!next?.nodes?.length || typeof next.pageInfo?.hasNextPage !== 'boolean' || next.pageInfo.hasNextPage && (!next.pageInfo.endCursor || next.pageInfo.endCursor === after)) throw new Error('Shopify kunne ikke fortsætte linjehentningen.');
      for (const item of next.nodes) { if (seen.has(item.id)) throw new Error('Shopify gentog en ordrelinje.'); seen.add(item.id); }
      connection.nodes.push(...next.nodes); connection.pageInfo = next.pageInfo;
    }
  }
  if (pages) { const fresh = await orderQuery<{ order: { updatedAt: string } | null }>(access, 'query InvoiceRevision($id:ID!) { order(id:$id) { updatedAt } }', { id: order.id }); if (fresh.order?.updatedAt !== order.updatedAt) throw new Error('Ordren blev ændret under kontrollen. Prøv igen.'); }
  return order;
}
export async function loadCompleteOrder(id: string) {
  if (!/^gid:\/\/shopify\/Order\/\d+$/.test(id)) throw new Error('Ugyldigt ordre-ID.');
  const access = await getShopifyAccess(true);
  const data = await orderQuery<{ order: InvoiceSource | null }>(access, `query InvoiceOrder($id:ID!) { order(id:$id) { ${orderFields} } }`, { id });
  if (!data.order || data.order.id !== id) throw new Error('Ordren kunne ikke findes i Shopify.');
  return completeOrder(data.order, access);
}
