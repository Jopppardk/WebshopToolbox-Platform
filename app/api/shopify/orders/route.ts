import { NextResponse } from 'next/server';
import { prepareDatabase } from '@/db/database';
import { getShopifyAccess } from '@/db/shopify';

type ShopifyOrder = {
  id: string;
  name: string;
  createdAt: string;
  processedAt: string;
  displayFinancialStatus: string | null;
  displayFulfillmentStatus: string;
  currentTotalPriceSet: { shopMoney: { amount: string; currencyCode: string } };
  currentSubtotalPriceSet: { shopMoney: { amount: string; currencyCode: string } };
  currentTotalTaxSet: { shopMoney: { amount: string; currencyCode: string } } | null;
  billingAddress: ShopifyAddress | null;
  shippingAddress: ShopifyAddress | null;
  lineItems: { nodes: Array<{ name: string; quantity: number; discountedTotalSet: { shopMoney: { amount: string; currencyCode: string } } }> };
  shippingLines: { nodes: Array<{ title: string; discountedPriceSet: { shopMoney: { amount: string; currencyCode: string } } }> };
};

type ShopifyAddress = { name: string | null; address1: string | null; address2: string | null; zip: string | null; city: string | null; country: string | null };

function present(order: ShopifyOrder, bookingStatus = 'Afventer') {
  const money = order.currentTotalPriceSet.shopMoney;
  return {
    id: order.name,
    date: new Intl.DateTimeFormat('da-DK', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Europe/Copenhagen' }).format(new Date(order.createdAt)),
    shipped: ['FULFILLED', 'PARTIAL'].includes(order.displayFulfillmentStatus) ? 'Afsendt' : 'Ikke afsendt',
    amount: new Intl.NumberFormat('da-DK', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(money.amount)),
    realized: order.displayFinancialStatus === 'PAID' ? new Intl.DateTimeFormat('da-DK', { dateStyle: 'medium', timeZone: 'Europe/Copenhagen' }).format(new Date(order.processedAt)) : '—',
    status: bookingStatus,
    externalId: order.id,
    createdAt: order.createdAt,
    currency: money.currencyCode,
    customer: order.billingAddress || order.shippingAddress,
    lines: order.lineItems?.nodes || [],
    shippingLines: order.shippingLines?.nodes || [],
    subtotal: order.currentSubtotalPriceSet?.shopMoney.amount || money.amount,
    tax: order.currentTotalTaxSet?.shopMoney.amount || '0',
  };
}

async function storedOrders() {
  const db = await prepareDatabase();
  const result = await db
    .prepare(`SELECT payload_json, booking_status FROM integration_records WHERE tenant = ? AND record_type = 'order' ORDER BY occurred_at DESC LIMIT 100`)
    .bind('sablen.dk')
    .all<{ payload_json: string; booking_status: string }>();
  return result.results.map((row) => present(JSON.parse(row.payload_json), row.booking_status === 'booked' ? 'Bogført' : row.booking_status === 'failed' ? 'Fejlet' : 'Afventer'));
}

export async function GET() {
  return NextResponse.json({ orders: await storedOrders() });
}

export async function POST() {
  try {
    const { shop, accessToken } = await getShopifyAccess();
    const response = await fetch(`https://${shop}/admin/api/2026-07/graphql.json`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': accessToken },
      body: JSON.stringify({ query: `query SalesOrders { orders(first: 100, sortKey: CREATED_AT, reverse: true) { nodes { id name createdAt processedAt displayFinancialStatus displayFulfillmentStatus billingAddress { name address1 address2 zip city country } shippingAddress { name address1 address2 zip city country } currentTotalPriceSet { shopMoney { amount currencyCode } } currentSubtotalPriceSet { shopMoney { amount currencyCode } } currentTotalTaxSet { shopMoney { amount currencyCode } } lineItems(first: 50) { nodes { name quantity discountedTotalSet { shopMoney { amount currencyCode } } } } shippingLines(first: 10) { nodes { title discountedPriceSet { shopMoney { amount currencyCode } } } } } } }` }),
    });
    const payload = (await response.json()) as { data?: { orders?: { nodes?: ShopifyOrder[] } }; errors?: Array<{ message?: string }> };
    if (!response.ok || payload.errors?.length || !payload.data?.orders?.nodes)
      throw new Error(payload.errors?.[0]?.message || 'Shopify-ordrer kunne ikke hentes. Kontrollér at appen har read_orders-adgang.');
    const db = await prepareDatabase();
    const statements = payload.data.orders.nodes.map((order) => {
      const expires = new Date(order.createdAt);
      expires.setUTCMonth(expires.getUTCMonth() + 24);
      const money = order.currentTotalPriceSet.shopMoney;
      return db.prepare(`INSERT INTO integration_records (id, tenant, record_type, external_id, occurred_at, amount_minor, currency, booking_status, payload_json, expires_at) VALUES (?, ?, 'order', ?, ?, ?, ?, 'pending', ?, ?) ON CONFLICT(tenant, record_type, external_id) DO UPDATE SET occurred_at = excluded.occurred_at, amount_minor = excluded.amount_minor, currency = excluded.currency, payload_json = excluded.payload_json, expires_at = excluded.expires_at`).bind(order.id, 'sablen.dk', order.id, order.createdAt, Math.round(Number(money.amount) * 100), money.currencyCode, JSON.stringify(order), expires.toISOString());
    });
    if (statements.length) await db.batch(statements);
    return NextResponse.json({ orders: await storedOrders(), synced: statements.length });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Shopify-ordrer kunne ikke hentes';
    try {
      const db = await prepareDatabase();
      await db.prepare('INSERT INTO system_errors (tenant, source, message) VALUES (?, ?, ?)').bind('sablen.dk', 'Shopify', message).run();
    } catch {}
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
