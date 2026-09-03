import { NextRequest, NextResponse } from 'next/server';
import { env } from 'cloudflare:workers';
import { keyFor } from '@/lib/invoice-pdf';

export async function GET(request: NextRequest) {
  const externalId = request.nextUrl.searchParams.get('externalId');
  if (!externalId) return NextResponse.json({ error: 'Der mangler et ordre-id' }, { status: 400 });
  const object = await (env as unknown as { INVOICES: R2Bucket }).INVOICES.get(keyFor(externalId));
  if (!object) return NextResponse.json({ error: 'PDF-fakturaen blev ikke fundet' }, { status: 404 });
  return new NextResponse(object.body, { headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': object.httpMetadata?.contentDisposition || 'inline', 'Cache-Control': 'private, no-store' } });
}
