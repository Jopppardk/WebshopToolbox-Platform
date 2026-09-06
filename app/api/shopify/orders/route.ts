import { recordFailure } from '@/db/errors';
import { NextRequest, NextResponse } from 'next/server';
import { loadHistory } from '@/db/history';
import { historyWindow, shiftMonths } from '@/lib/history-policy';
import { prepareDatabase } from '@/db/database';
import { getShopifyAccess } from '@/db/shopify';
import { createInvoicePdf, removeLegacyInvoices } from '@/lib/invoice-pdf';
import { completeOrder, orderFields, orderQuery } from '@/db/shopify-order';
import { units, type InvoiceSource } from '@/lib/invoice-check';

type ShopifyOrder = {
  id: string;
  name: string;
  createdAt: string;
  processedAt: string;
  displayFinancialStatus: string | null;
  displayFulfillmentStatus: string;
  customer: { displayName: string | null; firstName: string | null; lastName: string | null } | null;
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
    shipped: order.displayFulfillmentStatus === 'FULFILLED' ? 'Afsendt' : order.displayFulfillmentStatus === 'PARTIAL' ? 'Delvist afsendt' : 'Ikke afsendt',
    amount: new Intl.NumberFormat('da-DK', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(money.amount)),
    realized: order.displayFinancialStatus === 'PAID' ? new Intl.DateTimeFormat('da-DK', { dateStyle: 'medium', timeZone: 'Europe/Copenhagen' }).format(new Date(order.processedAt)) : '—',
    status: bookingStatus,
    externalId: order.id,
    createdAt: order.createdAt,
    currency: money.currencyCode,
    total: money.amount,
    customer: {
      ...(order.billingAddress || order.shippingAddress),
      name: order.customer?.displayName || [order.customer?.firstName, order.customer?.lastName].filter(Boolean).join(' ') || (order.billingAddress || order.shippingAddress)?.name || null,
    },
    lines: order.lineItems?.nodes || [],
    shippingLines: order.shippingLines?.nodes || [],
    subtotal: order.currentSubtotalPriceSet?.shopMoney.amount || money.amount,
    tax: order.currentTotalTaxSet?.shopMoney.amount,
    paymentStatus: order.displayFinancialStatus,
  };
}

async function storedOrders(offset = 0) {
  const db = await prepareDatabase();
  const { cutoff } = historyWindow(await loadHistory(db));
  const result = await db
    .prepare(`SELECT o.payload_json, COALESCE(json_extract(t.setting_value, '$.phase'), o.booking_status) AS booking_status FROM integration_records o LEFT JOIN app_settings t ON t.tenant = o.tenant AND t.setting_key = 'sales_transfer:' || o.external_id WHERE o.tenant = ? AND o.record_type = 'order' AND o.occurred_at >= ? ORDER BY o.occurred_at DESC, o.external_id DESC LIMIT 100 OFFSET ?`)
    .bind('sablen.dk', cutoff, offset)
    .all<{ payload_json: string; booking_status: string }>();
  const labels: Record<string, string> = { booked: 'Bogført', failed: 'Fejlet', draft: 'Kladde i Dinero', creating: 'Overfører…', booking: 'Bogfører…', uncertain: 'Kræver kontrol', archived: 'Arkiveret overførsel' };
  return result.results.map((row) => present(JSON.parse(row.payload_json), labels[row.booking_status] || 'Afventer'));
}

export async function GET(request: NextRequest) {
  try {
  const offset = Number(request.nextUrl.searchParams.get('offset') || 0);
  if (!Number.isSafeInteger(offset) || offset < 0) return NextResponse.json({ error: 'Ugyldigt sidetal' }, { status: 400 });
  const db = await prepareDatabase(); const { cutoff } = historyWindow(await loadHistory(db));
  const count = await db.prepare("SELECT COUNT(*) AS total FROM integration_records WHERE tenant = 'sablen.dk' AND record_type = 'order' AND occurred_at >= ?").bind(cutoff).first<{ total: number }>();
  return NextResponse.json({ orders: await storedOrders(offset), total: count?.total || 0 });

  } catch { await recordFailure('Salg'); return NextResponse.json({ error: 'Salg kunne ikke indlæses. Prøv igen.' }, { status: 503 }); }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({})) as { after?: string };
    if (body.after != null && (typeof body.after !== 'string' || body.after.length > 2048)) throw new Error('Ugyldig fortsættelse');
    const db = await prepareDatabase(); const policy = await loadHistory(db);
    const { cutoff } = historyWindow(policy);
    const access = await getShopifyAccess();
    const payload = await orderQuery<{ orders: { nodes: InvoiceSource[]; pageInfo: { hasNextPage: boolean; endCursor: string | null } } }>(access,
      `query SalesOrders($after:String,$query:String!) { orders(first:5,after:$after,query:$query,sortKey:CREATED_AT,reverse:true) { nodes { ${orderFields} } pageInfo { hasNextPage endCursor } } }`,
      { after: body.after || null, query: `created_at:>='${cutoff}'` });
    if (!Array.isArray(payload.orders?.nodes)) throw new Error('Shopify-ordrer kunne ikke hentes.');
    await removeLegacyInvoices(db);
    const orders = payload.orders.nodes.filter(order => order.createdAt >= cutoff);
    const pageInfo = payload.orders.pageInfo;
    const invoiceWarnings: string[] = [];
    const incomplete = new Set<string>();
    for (const order of orders) {
      try { await completeOrder(order, access); }
      catch { incomplete.add(order.id); invoiceWarnings.push(`${order.name}: Alle ordrelinjer kunne ikke hentes. Fakturaen er ikke oprettet; prøv Kontrollér igen.`); }
    }
    if (pageInfo.hasNextPage && (!pageInfo.endCursor || pageInfo.endCursor === body.after)) throw new Error('Shopify kunne ikke fortsætte hentningen');
    const statements = orders.map((order) => {
      const expires = shiftMonths(new Date(order.createdAt), policy.months);
      const money = order.currentTotalPriceSet.shopMoney;
      return db.prepare(`INSERT INTO integration_records (id, tenant, record_type, external_id, occurred_at, amount_minor, currency, booking_status, payload_json, expires_at) VALUES (?, ?, 'order', ?, ?, ?, ?, 'pending', ?, ?) ON CONFLICT(tenant, record_type, external_id) DO UPDATE SET occurred_at = excluded.occurred_at, amount_minor = excluded.amount_minor, currency = excluded.currency, payload_json = excluded.payload_json, expires_at = excluded.expires_at`).bind(order.id, 'sablen.dk', order.id, order.createdAt, units(order.currentTotalPriceSet, money.currencyCode), money.currencyCode, JSON.stringify(order), expires.toISOString());
    });
    if (statements.length) await db.batch(statements);
    let invoicesCreated = 0;
    for (const order of orders) {
      if (incomplete.has(order.id)) continue;
      if (order.displayFulfillmentStatus !== 'FULFILLED') continue;
      const expires = shiftMonths(new Date(order.createdAt), policy.months);
      try { if (await createInvoicePdf(db, order, expires.toISOString())) invoicesCreated++; }
      catch (error) { invoiceWarnings.push(`${order.name}: ${error instanceof Error ? error.message : 'Faktura kunne ikke genereres.'}`); }
    }
    if (invoiceWarnings.length) await db.prepare('INSERT INTO system_errors (tenant, source, message) VALUES (?, ?, ?)').bind('sablen.dk', 'Fakturakontrol', invoiceWarnings.join('\n').slice(0, 4000)).run();
    return NextResponse.json({ orders: await storedOrders(), synced: statements.length, invoicesCreated, invoiceWarnings, ...pageInfo });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Shopify-ordrer kunne ikke hentes';
    try {
      const db = await prepareDatabase();
      await db.prepare('INSERT INTO system_errors (tenant, source, message) VALUES (?, ?, ?)').bind('sablen.dk', 'Shopify', message).run();
    } catch {}
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
