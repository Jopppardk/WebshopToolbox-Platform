import { NextRequest, NextResponse } from 'next/server';
import { runTransfer } from '@/db/sales-transfer';
import { TransferError } from '@/lib/dinero-sale';
import { InvoiceCheckError } from '@/lib/invoice-check';
import { recordFailure } from '@/db/errors';

export async function POST(request: NextRequest) {
  const reply = (data: unknown, status = 200) => NextResponse.json(data, { status, headers: { 'Cache-Control': 'no-store' } });
  const origin = request.headers.get('origin');
  if (!origin || origin !== new URL(request.url).origin || !request.headers.get('content-type')?.startsWith('application/json')) return reply({ error: 'Handlingen skal startes fra integrationssiden.' }, 403);
  const actor = request.headers.get('cf-access-authenticated-user-email')?.trim().toLowerCase();
  if (process.env.NODE_ENV === 'production' && actor !== 'rene@sablen.dk') return reply({ error: 'Adgang afvist.' }, 403);
  try {
    const body = await request.json() as Parameters<typeof runTransfer>[0];
    if (!body || typeof body.externalId !== 'string' || !/^gid:\/\/shopify\/Order\/\d{1,30}$/.test(body.externalId) || !['status', 'prepare', 'create', 'book', 'reconcile'].includes(body.action)) return reply({ error: 'Ugyldig ordre eller handling.' }, 400);
    if (body.action === 'prepare' && (typeof body.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(body.date))) return reply({ error: 'Vælg en bogføringsdato.' }, 400);
    return reply(await runTransfer(body, actor || 'local-test'));
  } catch (error) {
    await recordFailure('Dinero · salgsoverførsel');
    return reply({ error: error instanceof TransferError || error instanceof InvoiceCheckError ? error.message : 'Kontrollen kunne ikke gennemføres. Hent status igen; gentag ikke overførslen blindt.' }, 422);
  }
}
