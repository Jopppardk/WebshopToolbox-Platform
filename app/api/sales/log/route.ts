import { NextRequest, NextResponse } from 'next/server';
import { prepareDatabase } from '@/db/database';
import { loadHistory } from '@/db/history';
import { historyWindow } from '@/lib/history-policy';
import { orderLog, type LogRecord, type LogDelivery } from '@/lib/order-log';
export async function GET(request: NextRequest) {
  const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
  const id = request.nextUrl.searchParams.get('externalId');
  if (!id || !/^gid:\/\/shopify\/Order\/\d+$/.test(id)) return json({ error: 'Ugyldigt ordre-ID.' }, 400);
  try {
    const db = await prepareDatabase();
    const { cutoff } = historyWindow(await loadHistory(db, 'shopify'));
    const order = await db.prepare("SELECT payload_json,created_at,booking_status FROM integration_records WHERE tenant=? AND record_type='order' AND external_id=? AND occurred_at>=?").bind('sablen.dk', id, cutoff).first<LogRecord>();
    if (!order) return json({ error: 'Ordren findes ikke i den valgte historik.' }, 404);
    const [invoice, transfer, deliveries] = await Promise.all([
      db.prepare("SELECT payload_json,created_at,booking_status FROM integration_records WHERE tenant=? AND record_type='invoice' AND external_id=?").bind('sablen.dk', id).first<LogRecord>(),
      db.prepare('SELECT setting_value FROM app_settings WHERE tenant=? AND setting_key=?').bind('sablen.dk', 'sales_transfer:' + id).first<{ setting_value: string }>(),
      db.prepare('SELECT delivery_mode,status,updated_at FROM invoice_email_deliveries WHERE tenant=? AND external_id=? ORDER BY updated_at').bind('sablen.dk', id).all<LogDelivery>(),
    ]);
    return json(orderLog(order, invoice, transfer?.setting_value || null, deliveries.results));
  } catch { return json({ error: 'Ordreloggen kunne ikke hentes. Prøv igen.' }, 503); }
}
