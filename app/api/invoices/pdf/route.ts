import { recordFailure } from '@/db/errors';
import { NextRequest, NextResponse } from 'next/server';
import { env } from 'cloudflare:workers';
import { keyFor } from '@/lib/invoice-pdf';
import { prepareDatabase } from '@/db/database';
import { loadHistory } from '@/db/history';
import { historyWindow } from '@/lib/history-policy';

export async function GET(request: NextRequest) {
  try {
  const externalId = request.nextUrl.searchParams.get('externalId');
  if (!externalId) return NextResponse.json({ error: 'Der mangler et ordre-id' }, { status: 400 });
  const db = await prepareDatabase(); const { cutoff } = historyWindow(await loadHistory(db));
  const record = await db.prepare("SELECT id FROM integration_records WHERE tenant = 'sablen.dk' AND record_type = 'invoice' AND external_id = ? AND occurred_at >= ?").bind(externalId, cutoff).first();
  if (!record) return NextResponse.json({ error: 'Fakturaen ligger uden for den gemte historik eller findes ikke' }, { status: 404 });
  const object = await (env as unknown as { INVOICES: R2Bucket }).INVOICES.get(keyFor(externalId));
  if (!object) return NextResponse.json({ error: 'PDF-fakturaen blev ikke fundet' }, { status: 404 });
  return new NextResponse(object.body, { headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': object.httpMetadata?.contentDisposition || 'inline', 'Cache-Control': 'private, no-store' } });

  } catch { await recordFailure('Faktura-PDF'); return NextResponse.json({ error: 'Faktura-PDF kunne ikke indlæses. Prøv igen.' }, { status: 503 }); }
}
