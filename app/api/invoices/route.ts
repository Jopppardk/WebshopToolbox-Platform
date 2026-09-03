import { NextRequest, NextResponse } from 'next/server';
import { prepareDatabase } from '@/db/database';
import { createInvoicePdf } from '@/lib/invoice-pdf';

const tenant = 'sablen.dk';

async function statuses() {
  const db = await prepareDatabase();
  const result = await db.prepare(`SELECT external_id, booking_status FROM integration_records WHERE tenant = ? AND record_type = 'invoice'`).bind(tenant).all<{ external_id: string; booking_status: string }>();
  return Object.fromEntries(result.results.map((row) => [row.external_id, row.booking_status === 'failed' ? 'Fejlet' : 'Genereret']));
}

export async function GET() {
  return NextResponse.json({ statuses: await statuses() });
}

export async function POST(request: NextRequest) {
  try {
    const { externalId, all } = (await request.json()) as { externalId?: string; all?: boolean };
    if (!all && !externalId) throw new Error('Der mangler et ordrenummer');
    const db = await prepareDatabase();
    const query = all
      ? db.prepare(`SELECT id, external_id, occurred_at, amount_minor, currency, payload_json, expires_at FROM integration_records WHERE tenant = ? AND record_type = 'order'`).bind(tenant)
      : db.prepare(`SELECT id, external_id, occurred_at, amount_minor, currency, payload_json, expires_at FROM integration_records WHERE tenant = ? AND record_type = 'order' AND external_id = ?`).bind(tenant, externalId);
    const result = await query.all<{ id: string; external_id: string; occurred_at: string; amount_minor: number; currency: string; payload_json: string; expires_at: string }>();
    if (!result.results.length) throw new Error('Ordren blev ikke fundet. Synkronisér Shopify først.');
    let generated = 0;
    for (const order of result.results) if (await createInvoicePdf(db, JSON.parse(order.payload_json), order.expires_at)) generated++;
    return NextResponse.json({ statuses: await statuses(), generated });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Fakturaen kunne ikke genereres';
    try { const db = await prepareDatabase(); await db.prepare('INSERT INTO system_errors (tenant, source, message) VALUES (?, ?, ?)').bind(tenant, 'Fakturaer', message).run(); } catch {}
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
