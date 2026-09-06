import { recordFailure } from '@/db/errors';
import { NextRequest, NextResponse } from 'next/server';
import { prepareDatabase } from '@/db/database';
import { loadHistory } from '@/db/history';
import { historyWindow, shiftMonths } from '@/lib/history-policy';
import { createInvoicePdf, removeLegacyInvoices } from '@/lib/invoice-pdf';
import { loadCompleteOrder } from '@/db/shopify-order';

const tenant = 'sablen.dk';

async function statuses() {
  const db = await prepareDatabase();
  await removeLegacyInvoices(db);
  const { cutoff } = historyWindow(await loadHistory(db));
  const result = await db.prepare(`SELECT external_id, booking_status FROM integration_records WHERE tenant = ? AND record_type = 'invoice' AND occurred_at >= ?`).bind(tenant, cutoff).all<{ external_id: string; booking_status: string }>();
  return Object.fromEntries(result.results.map((row) => [row.external_id, row.booking_status === 'failed' ? 'Fejlet' : 'Genereret']));
}

export async function GET() {
  try {
  return NextResponse.json({ statuses: await statuses() });

  } catch { await recordFailure('Fakturaer'); return NextResponse.json({ error: 'Fakturaer kunne ikke indlæses. Prøv igen.' }, { status: 503 }); }
}

export async function POST(request: NextRequest) {
  try {
    const { externalId, all, regenerate, offset = 0 } = (await request.json()) as { externalId?: string; all?: boolean; regenerate?: boolean; offset?: number };
    if (!Number.isSafeInteger(offset) || offset < 0) throw new Error('Ugyldigt sidetal');
    if (!all && !externalId) throw new Error('Der mangler et ordrenummer');
    const db = await prepareDatabase();
    const policy = await loadHistory(db); const { cutoff } = historyWindow(policy);
    await removeLegacyInvoices(db);
    const query = all
      ? db.prepare(`SELECT id, external_id, occurred_at, amount_minor, currency, payload_json, expires_at FROM integration_records WHERE tenant = ? AND record_type = 'order' AND occurred_at >= ? ORDER BY external_id LIMIT 5 OFFSET ?`).bind(tenant, cutoff, offset)
      : db.prepare(`SELECT id, external_id, occurred_at, amount_minor, currency, payload_json, expires_at FROM integration_records WHERE tenant = ? AND record_type = 'order' AND external_id = ? AND occurred_at >= ?`).bind(tenant, externalId, cutoff);
    const result = await query.all<{ id: string; external_id: string; occurred_at: string; amount_minor: number; currency: string; payload_json: string; expires_at: string }>();
    if (!result.results.length && !all) throw new Error('Ordren blev ikke fundet. Synkronisér Shopify først.');
    let generated = 0;
    const warnings: string[] = [];
    for (const order of result.results) {
      try {
        const fresh = await loadCompleteOrder(order.external_id);
        if (all && fresh.displayFulfillmentStatus !== 'FULFILLED') continue;
        if (fresh.createdAt < cutoff) throw new Error('Ordren ligger uden for den valgte historik.');
        if (await createInvoicePdf(db, fresh, shiftMonths(new Date(fresh.createdAt), policy.months).toISOString(), Boolean(regenerate))) generated++;
      } catch (error) {
        if (!all) throw error;
        warnings.push(`${JSON.parse(order.payload_json).name}: ${error instanceof Error ? error.message : 'Fakturaen kunne ikke genereres.'}`);
      }
    }
    if (warnings.length) await db.prepare('INSERT INTO system_errors (tenant, source, message) VALUES (?, ?, ?)').bind(tenant, 'Fakturakontrol', warnings.join('\n').slice(0, 4000)).run();
    return NextResponse.json({ statuses: await statuses(), generated, warnings, hasMore: Boolean(all && result.results.length === 5), nextOffset: offset + result.results.length });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Fakturaen kunne ikke genereres';
    try { const db = await prepareDatabase(); await db.prepare('INSERT INTO system_errors (tenant, source, message) VALUES (?, ?, ?)').bind(tenant, 'Fakturaer', message).run(); } catch {}
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
