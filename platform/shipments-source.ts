import { enrichShipmondo } from './shipmondo';
import { requireCompany, requireWebshop } from './auth';
import { shopAccess, orderQuery } from './invoice-source';
import { dataStartDate } from './tier1-history';
import { cachedRead } from './performance-source';
import { danishDate } from './tier1/src/lib/history-policy';
import { orderShipments, shipmentDays, type RawOrder, type Shipment, type ShipmentList } from './tier1/src/lib/shipments';
import { HttpError, reply, type Actor, type PlatformEnv } from './types';

// Forsendelser is read-only: Shopify fulfillments and their tracking, never an order, booking or receipt write.
const fulfillmentFields = (first: number) => `fulfillments(first:${first}){id createdAt status displayStatus inTransitAt deliveredAt trackingInfo(first:2){company number url} events(first:20,sortKey:HAPPENED_AT,reverse:true){nodes{status happenedAt message}}}`;
const orderFields = 'id name test cancelledAt shippingAddress{name city countryCodeV2} billingAddress{name city} shippingLine{title code source carrierIdentifier}';
// A shipment updates the order, so orders updated in the period include every order shipped in it, also orders created earlier.
const query = `query ShipmentOrders($after:String,$query:String!){orders(first:10,after:$after,query:$query,sortKey:UPDATED_AT,reverse:true){nodes{${orderFields} ${fulfillmentFields(3)}} pageInfo{hasNextPage endCursor}}}`;
// Orders with more partial deliveries than the list query returns are read again on their own (Shopify's fulfillments is a plain list).
const moreFulfillments = 30;
const orderQueryAll = `query ShipmentOrder($id:ID!){order(id:$id){${orderFields} ${fulfillmentFields(moreFulfillments)}}}`;
const maxPages = 30;
const safe = (error: unknown) => error instanceof Error && error.message.startsWith('Shopify') ? error.message : 'Forsendelserne kunne ikke hentes fra Shopify. Prøv igen senere.';
const cache = { prefix: 'shipments:v1:', busy: 'Forsendelserne hentes allerede. Prøv igen om lidt.', safe };
const copenhagenDay = (value: string) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Copenhagen', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(value));
const addDays = (date: string, days: number) => { const d = new Date(date + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10); };

export async function readShipments(env: PlatformEnv, company: string, shop: string, days: number, start: string): Promise<ShipmentList> {
  const access = await shopAccess(env, company, shop);
  const window = addDays(danishDate(), -days), since = window > start ? window : start;
  const shipments: Shipment[] = [], seen = new Set<string>();
  let after: string | null = null, truncated = false;
  for (let page = 0; ; page++) {
    if (page >= maxPages) { truncated = true; break; }
    const data: { orders?: { nodes?: RawOrder[]; pageInfo?: { hasNextPage?: boolean; endCursor?: string | null } } } = await orderQuery(access, query,
      { after, query: `updated_at:>=${since} (fulfillment_status:shipped OR fulfillment_status:partial)` }, 'Shopify kunne ikke hente forsendelserne. Kontrollér read_orders-adgangen og prøv igen.');
    const nodes = data.orders?.nodes, info = data.orders?.pageInfo;
    if (!Array.isArray(nodes) || typeof info?.hasNextPage !== 'boolean') throw Error('Shopify returnerede en ufuldstændig forsendelsesliste.');
    for (const order of nodes) {
      if (typeof order?.id !== 'string' || seen.has(order.id)) throw Error('Shopify returnerede en ugyldig forsendelsesliste.');
      seen.add(order.id);
      let full = order;
      if ((order.fulfillments?.length || 0) >= 3) {
        const one = await orderQuery<{ order: RawOrder | null }>(access, orderQueryAll, { id: order.id }, 'Shopify kunne ikke hente alle delleveringer. Prøv igen.');
        if (!one.order || one.order.id !== order.id || !Array.isArray(one.order.fulfillments)) throw Error('Shopify returnerede en ufuldstændig ordre.');
        if (one.order.fulfillments.length >= moreFulfillments) throw Error(`Shopify-ordre ${order.name} har for mange delleveringer til oversigten.`);
        full = one.order;
      }
      shipments.push(...orderShipments(full).filter(s => copenhagenDay(s.shippedAt) >= since));
    }
    if (!info.hasNextPage) break;
    if (!info.endCursor || info.endCursor === after) throw Error('Shopify kunne ikke fortsætte forsendelseslisten.');
    after = info.endCursor;
  }
  shipments.sort((a, b) => Date.parse(b.shippedAt) - Date.parse(a.shippedAt));
  return { checkedAt: new Date().toISOString(), days, since, truncated, shipments };
}

export async function handleShipments(request: Request, env: PlatformEnv, actor: Actor, company: string, shop: string, path: string) {
  if (request.method !== 'GET') throw new HttpError(405, 'Forsendelser understøtter kun læsning.');
  if (path !== '/shipments') throw new HttpError(404, 'Funktionen findes ikke.');
  const url = new URL(request.url), days = Number(url.searchParams.get('days') || 30), force = url.searchParams.get('refresh') === '1';
  if (!(shipmentDays as readonly number[]).includes(days)) throw new HttpError(400, 'Vælg 14, 30 eller 60 dage.');
  await requireCompany(env.PLATFORM_DB, actor, company);
  if (shop === 'none') throw new HttpError(409, 'Vælg en webshop for at se forsendelser.');
  await requireWebshop(env.PLATFORM_DB, actor, company, shop);
  const saved = await env.PLATFORM_DB.prepare("SELECT shop_domain,credentials_encrypted FROM webshop_connections WHERE company_id=? AND webshop_id=? AND provider='shopify'").bind(company, shop).first<{ shop_domain: string; credentials_encrypted: string }>();
  if (!saved) throw new HttpError(409, 'Forbind webshoppen under Integrationer for at se forsendelser.');
  const start = await dataStartDate(env, company, shop, 'shopify');
  // Tracking changes during the day, so the list is reused for five minutes; Opdatér fetches again after a minute.
  const list = await cachedRead(env, company, cache, ['shopify', shop, days], [saved.shop_domain, saved.credentials_encrypted, start, danishDate()],
    () => readShipments(env, company, shop, days, start), () => 5 * 60000, force);
  return reply(await enrichShipmondo(env,company,shop,list));
}
