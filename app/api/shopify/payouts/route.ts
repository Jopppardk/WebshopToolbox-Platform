import { shopifyFetch, shopifyFailure } from '@/lib/shopify-request';
import { recordFailure } from '@/db/errors';
import { NextRequest, NextResponse } from 'next/server';
import { prepareDatabase } from '@/db/database';
import { getShopifyAccess } from '@/db/shopify';
import { loadHistory } from '@/db/history';
import { historyWindow, shiftMonths } from '@/lib/history-policy';
import { minorUnits } from '@/lib/shopify-payments';
import { payoutSummaryFields, type PayoutSummary } from '@/lib/shopify-payout';
import { ensurePayoutReport } from '@/lib/payout-report';

type Payout = { id: string; issuedAt: string; status: string; transactionType: string; net: { amount: string; currencyCode: string }; summary: PayoutSummary };
const moneyFields = payoutSummaryFields.map(field => `${field} { amount currencyCode }`).join(' ');
const reply = (data: unknown, status = 200) => NextResponse.json(data, { status, headers: { 'Cache-Control': 'no-store' } });
export async function GET(request: NextRequest) {
  try {
    const offset = Number(request.nextUrl.searchParams.get('offset') || 0);
    if (!Number.isSafeInteger(offset) || offset < 0) throw new Error('Ugyldigt sidetal');
    const db = await prepareDatabase();
    const { cutoff } = historyWindow(await loadHistory(db));
    const where = "tenant = 'sablen.dk' AND record_type = 'payout' AND json_extract(payload_json, '$.provider') = 'shopify_payments' AND occurred_at >= ?";
    const rows = await db.prepare(`SELECT payload_json, booking_status FROM integration_records WHERE ${where} ORDER BY occurred_at DESC, external_id DESC LIMIT 50 OFFSET ?`).bind(cutoff, offset).all<{ payload_json: string; booking_status: string }>();
    const count = await db.prepare(`SELECT COUNT(*) AS total FROM integration_records WHERE ${where}`).bind(cutoff).first<{ total: number }>();
    return reply({ payouts: rows.results.map(row => ({ ...JSON.parse(row.payload_json), bookingStatus: row.booking_status })), total: count?.total || 0 });
  } catch (error) {
    await recordFailure('Udbetalinger', { category: 'shopify', cause: shopifyFailure(error, 'Udbetalinger: indlæsning eller datakontrol mislykkedes.'), action: 'Se jobhistorikken. Kontrollér Shopify-adgang ved adgangsfejl; afvent næste kørsel ved midlertidige fejl.' }); return reply({ error: error instanceof Error ? error.message : 'Udbetalingerne kunne ikke læses' }, 400); }
}
export async function POST(request: NextRequest) {
  try {
    const { after } = await request.json() as { after?: string | null };
    if (after != null && (typeof after !== 'string' || after.length > 2048)) throw new Error('Ugyldig fortsættelse');
    const db = await prepareDatabase(); const policy = await loadHistory(db);
    const cutoff = new Date(historyWindow(policy).cutoff);
    const { shop, accessToken } = await getShopifyAccess();
    const response = await shopifyFetch(`https://${shop}/admin/api/2026-07/graphql.json`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': accessToken }, signal: AbortSignal.timeout(25000),
      body: JSON.stringify({ query: `query Payouts($after: String, $query: String!) { shopifyPaymentsAccount { payouts(first: 50, after: $after, query: $query, sortKey: ISSUED_AT, reverse: true) { nodes { id issuedAt status transactionType net { amount currencyCode } summary { ${moneyFields} } } pageInfo { hasNextPage endCursor } } } }`, variables: { after: after || null, query: `issued_at:>='${cutoff.toISOString()}'` } }),
    });
    const payload = await response.json() as { data?: { shopifyPaymentsAccount?: { payouts: { nodes: Payout[]; pageInfo: { hasNextPage: boolean; endCursor: string | null } } } }; errors?: Array<{ message: string; extensions?: { code?: string } }> };
    if (!response.ok || payload.errors?.length) {
      if (response.status === 403 || payload.errors?.some(e => e.extensions?.code === 'ACCESS_DENIED')) throw new Error('Shopify-appen mangler adgang til udbetalinger. Aktivér read_shopify_payments_payouts og read_shopify_payments_accounts i appen.');
      throw new Error(payload.errors?.[0]?.message || `Shopify kunne ikke hente udbetalinger (HTTP ${response.status})`);
    }
    const connection = payload.data?.shopifyPaymentsAccount?.payouts;
    if (!connection) throw new Error('Ingen tilgængelig Shopify Payments-konto');
    if (connection.pageInfo.hasNextPage && (!connection.pageInfo.endCursor || connection.pageInfo.endCursor === after)) throw new Error('Shopify returnerede en ugyldig fortsættelse');
    const payouts = connection.nodes.filter(item => new Date(item.issuedAt) >= cutoff);
    const statements = payouts.map(item => {
      const expires = shiftMonths(new Date(item.issuedAt), policy.months);
      return db.prepare(`INSERT INTO integration_records (id, tenant, record_type, external_id, occurred_at, amount_minor, currency, booking_status, payload_json, expires_at) VALUES (?, 'sablen.dk', 'payout', ?, ?, ?, ?, 'pending', ?, ?) ON CONFLICT(tenant, record_type, external_id) DO UPDATE SET occurred_at = excluded.occurred_at, amount_minor = excluded.amount_minor, currency = excluded.currency, payload_json = CASE WHEN json_extract(integration_records.payload_json,'$.reportKey') IS NULL THEN excluded.payload_json ELSE json_set(excluded.payload_json,'$.reportKey',json_extract(integration_records.payload_json,'$.reportKey'),'$.reportFingerprint',json_extract(integration_records.payload_json,'$.reportFingerprint'),'$.reportEtag',json_extract(integration_records.payload_json,'$.reportEtag'),'$.reportVersion',json_extract(integration_records.payload_json,'$.reportVersion'),'$.transactions',json_extract(integration_records.payload_json,'$.transactions')) END, expires_at = excluded.expires_at`).bind(`shopify-payout:${item.id}`, item.id, item.issuedAt, minorUnits(item.net.amount, item.net.currencyCode), item.net.currencyCode, JSON.stringify({ ...item, provider: 'shopify_payments' }), expires.toISOString());
    });
    if (statements.length) await db.batch(statements);
    const reportWarnings: string[] = [];
    // Generate in bounded batches to stay safely within one Worker's resource limits.
    const missingReports = await db.prepare("SELECT external_id FROM integration_records WHERE tenant='sablen.dk' AND record_type='payout' AND json_extract(payload_json,'$.provider')='shopify_payments' AND json_extract(payload_json,'$.status')='PAID' AND json_extract(payload_json,'$.transactionType')='DEPOSIT' AND (json_extract(payload_json,'$.reportKey') IS NULL OR COALESCE(json_extract(payload_json,'$.reportVersion'),0)<2) ORDER BY occurred_at DESC LIMIT 5").all<{ external_id: string }>();
    for (const item of missingReports.results) {
      try { await ensurePayoutReport(db, item.external_id); }
      catch (error) { reportWarnings.push(`${item.external_id.split('/').pop()}: ${error instanceof Error ? error.message : 'Rapporten kunne ikke dannes.'}`); }
    }
    if (reportWarnings.length) await db.prepare("INSERT INTO system_errors (tenant,source,message) VALUES ('sablen.dk','Udbetalingsrapporter',?)").bind(reportWarnings.join('\n').slice(0, 4000)).run();
    else await db.prepare("UPDATE system_errors SET resolved_at=CURRENT_TIMESTAMP WHERE tenant='sablen.dk' AND source='Udbetalingsrapporter' AND resolved_at IS NULL").run();
    return reply({ synced: payouts.length, reportWarnings, ...connection.pageInfo });
  } catch (error) {
    await recordFailure('Udbetalinger', { category: 'shopify', cause: shopifyFailure(error, 'Udbetalinger: indlæsning eller datakontrol mislykkedes.'), action: 'Se jobhistorikken. Kontrollér Shopify-adgang ved adgangsfejl; afvent næste kørsel ved midlertidige fejl.' }); return reply({ error: error instanceof Error ? error.message : 'Udbetalingerne kunne ikke hentes' }, 400); }
}
