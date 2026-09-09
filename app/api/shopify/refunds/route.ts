import { shopifyFetch, shopifyFailure } from '@/lib/shopify-request';
import { recordFailure } from '@/db/errors';
import { NextRequest, NextResponse } from 'next/server';
import { prepareDatabase } from '@/db/database';
import { getShopifyAccess } from '@/db/shopify';
import { loadHistory } from '@/db/history';
import { shiftMonths } from '@/lib/history-policy';
import { minorUnits, paymentPeriod, paymentsQuery, type BalancePayment } from '@/lib/shopify-payments';

const tenant = 'sablen.dk';
const reply = (data: unknown, status = 200) => NextResponse.json(data, { status, headers: { 'Cache-Control': 'no-store' } });

export async function GET(request: NextRequest) {
  try {
    const params = request.nextUrl.searchParams;
    const db = await prepareDatabase();
    const { start, end } = paymentPeriod(params.get('from'), params.get('to'), await loadHistory(db));
    const offset = Number(params.get('offset') || 0);
    if (!Number.isSafeInteger(offset) || offset < 0) throw new Error('Ugyldigt sidetal');
    const search = (params.get('search') || '').trim().slice(0, 100);
    const where = `tenant = ? AND record_type = 'refund' AND json_extract(payload_json, '$.provider') = 'shopify_payments' AND occurred_at >= ? AND occurred_at < ? AND (? = '' OR instr(lower(COALESCE(json_extract(payload_json, '$.associatedOrder.name'), '') || ' ' || external_id), lower(?)) > 0)`;
    const bindings = [tenant, start, end, search, search];
    const [rows, summary] = await Promise.all([
      db.prepare(`SELECT payload_json, booking_status FROM integration_records WHERE ${where} ORDER BY occurred_at DESC, external_id DESC LIMIT 50 OFFSET ?`).bind(...bindings, offset).all<{ payload_json: string; booking_status: string }>(),
      db.prepare(`SELECT currency, COUNT(*) AS count, SUM(amount_minor) AS gross, SUM(json_extract(payload_json, '$.feeMinor')) AS fees, SUM(json_extract(payload_json, '$.netMinor')) AS net FROM integration_records WHERE ${where} GROUP BY currency ORDER BY currency`).bind(...bindings).all(),
    ]);
    return reply({ payments: rows.results.map(row => ({ ...JSON.parse(row.payload_json), bookingStatus: row.booking_status })), summary: summary.results });
  } catch (error) {
    await recordFailure('Tilbagebetalinger', { category: 'shopify', cause: shopifyFailure(error, 'Tilbagebetalinger: indlæsning eller datakontrol mislykkedes.'), action: 'Se jobhistorikken. Kontrollér Shopify-adgang ved adgangsfejl; afvent næste kørsel ved midlertidige fejl.' });
    return reply({ error: error instanceof Error ? error.message : 'Tilbagebetalingerne kunne ikke indlæses' }, 400);
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as { from?: string; to?: string; after?: string | null };
    const db = await prepareDatabase(); const policy = await loadHistory(db);
    const defaultStart = new Date(Math.max(+new Date(policy.startDate ? `${policy.startDate}T00:00:00Z` : '1970-01-01T00:00:00Z'), +new Date(shiftMonths(new Date(), -policy.months)))).toISOString().slice(0, 10);
    const defaultEnd = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Copenhagen' }).format(new Date());
    const { start, end } = paymentPeriod(body.from || defaultStart, body.to || defaultEnd, policy);
    if (start >= end) return reply({ synced: 0, hasNextPage: false, endCursor: null });
    if (body.after != null && (typeof body.after !== 'string' || body.after.length > 2048)) throw new Error('Ugyldig fortsættelse');
    const { shop, accessToken } = await getShopifyAccess();
    const response = await shopifyFetch(`https://${shop}/admin/api/2026-07/graphql.json`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': accessToken },
      body: JSON.stringify({ query: paymentsQuery, variables: { after: body.after || null, query: `transaction_type:refund processed_at:>='${start}' processed_at:<'${end}'` } }),
      signal: AbortSignal.timeout(25000),
    });
    const payload = await response.json() as { data?: { shopifyPaymentsAccount: { balanceTransactions: { nodes: BalancePayment[]; pageInfo: { hasNextPage: boolean; endCursor: string | null } } } | null }; errors?: Array<{ message: string; extensions?: { code?: string } }> };
    if (!response.ok || payload.errors?.length) {
      const denied = response.status === 403 || payload.errors?.some(e => e.extensions?.code === 'ACCESS_DENIED' || /access denied/i.test(e.message));
      if (denied) throw new Error('Shopify-appen mangler adgang til Shopify Payments. Tilføj read_shopify_payments_accounts og read_shopify_payments_payouts i Shopify-appens adgangsrettigheder, og udgiv den opdaterede appversion.');
      throw new Error(response.status === 429 || payload.errors?.some(e => e.extensions?.code === 'THROTTLED') ? 'Shopify har midlertidigt begrænset hentningen. Prøv igen om lidt.' : payload.errors?.[0]?.message || 'Shopify Payments kunne ikke hentes');
    }
    const connection = payload.data?.shopifyPaymentsAccount?.balanceTransactions;
    if (!connection) throw new Error('Butikken har ikke en tilgængelig Shopify Payments-konto');
    if (connection.pageInfo.hasNextPage && (!connection.pageInfo.endCursor || connection.pageInfo.endCursor === body.after)) throw new Error('Shopify kunne ikke fortsætte hentningen. Prøv igen.');
    const payments = connection.nodes.filter(item => item.type === 'REFUND' && !item.test && +new Date(item.transactionDate) >= +new Date(start) && +new Date(item.transactionDate) < +new Date(end));
    const statements = payments.map(item => {
      if (item.amount.currencyCode !== item.fee.currencyCode || item.amount.currencyCode !== item.net.currencyCode) throw new Error('Shopify returnerede forskellige valutaer for samme tilbagebetaling');
      const amount = minorUnits(item.amount.amount, item.amount.currencyCode);
      const feeMinor = minorUnits(item.fee.amount, item.fee.currencyCode);
      const netMinor = minorUnits(item.net.amount, item.net.currencyCode);
      const expires = shiftMonths(new Date(item.transactionDate), policy.months);
      return db.prepare(`INSERT INTO integration_records (id, tenant, record_type, external_id, occurred_at, amount_minor, currency, booking_status, payload_json, expires_at) VALUES (?, ?, 'refund', ?, ?, ?, ?, 'pending', ?, ?) ON CONFLICT(tenant, record_type, external_id) DO UPDATE SET occurred_at = excluded.occurred_at, amount_minor = excluded.amount_minor, currency = excluded.currency, payload_json = excluded.payload_json, expires_at = excluded.expires_at`).bind(`shopify-refund:${item.id}`, tenant, item.id, new Date(item.transactionDate).toISOString(), amount, item.amount.currencyCode, JSON.stringify({ ...item, provider: 'shopify_payments', feeMinor, netMinor }), expires.toISOString());
    });
    if (statements.length) await db.batch(statements);
    return reply({ synced: payments.length, ...connection.pageInfo });
  } catch (error) {
    await recordFailure('Tilbagebetalinger', { category: 'shopify', cause: shopifyFailure(error, 'Tilbagebetalinger: indlæsning eller datakontrol mislykkedes.'), action: 'Se jobhistorikken. Kontrollér Shopify-adgang ved adgangsfejl; afvent næste kørsel ved midlertidige fejl.' });
    return reply({ error: error instanceof Error ? error.message : 'Shopify Payments kunne ikke hentes' }, 400);
  }
}
