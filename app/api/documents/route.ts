import { NextRequest, NextResponse } from 'next/server';
import { env } from 'cloudflare:workers';
import { prepareDatabase } from '@/db/database';
import { recordFailure } from '@/db/errors';
import { loadHistory } from '@/db/history';
import { historyWindow } from '@/lib/history-policy';

const reply = (value: unknown, status = 200) => NextResponse.json(value, { status, headers: { 'Cache-Control': 'no-store' } });
export async function GET(request: NextRequest) {
  try {
    const externalId = request.nextUrl.searchParams.get('externalId');
    const db = await prepareDatabase(), { cutoff } = historyWindow(await loadHistory(db));
    if (externalId) {
      if (!/^gid:\/\/shopify\/ShopifyPaymentsPayout\/\d+$/.test(externalId)) return reply({ error: 'Ugyldigt dokument-ID.' }, 400);
      const row = await db.prepare("SELECT payload_json FROM integration_records WHERE tenant='sablen.dk' AND record_type='payout' AND external_id=? AND occurred_at>=?").bind(externalId, cutoff).first<{ payload_json: string }>();
      const saved = row ? JSON.parse(row.payload_json) as { reportKey?: string } : null;
      if (!saved?.reportKey) return reply({ error: 'Udbetalingsrapporten findes ikke.' }, 404);
      const object = await (env as unknown as { INVOICES: R2Bucket }).INVOICES.get(saved.reportKey);
      if (!object) return reply({ error: 'Udbetalingsrapportens PDF mangler.' }, 404);
      return new NextResponse(object.body, { headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename="${externalId.split('/').pop()}.pdf"`, 'Cache-Control': 'private, no-store' } });
    }
    const rows = await db.prepare("SELECT external_id, occurred_at, payload_json FROM integration_records WHERE tenant='sablen.dk' AND record_type='payout' AND occurred_at>=? AND json_extract(payload_json,'$.reportKey') IS NOT NULL ORDER BY occurred_at DESC LIMIT 100").bind(cutoff).all<{ external_id: string; occurred_at: string; payload_json: string }>();
    return reply({ documents: rows.results.map(row => { const value = JSON.parse(row.payload_json); return { externalId: row.external_id, date: row.occurred_at, provider: value.provider, amount: value.net, filename: `${row.external_id.split('/').pop()}.pdf` }; }) });
  } catch { await recordFailure('Udbetalingsrapporter'); return reply({ error: 'Dokumenterne kunne ikke indlæses.' }, 503); }
}
