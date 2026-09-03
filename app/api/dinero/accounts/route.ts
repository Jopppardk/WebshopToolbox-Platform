import { NextResponse } from 'next/server';
import { prepareDatabase } from '@/db/database';

async function recordError(message: string) {
  try {
    const db = await prepareDatabase();
    await db
      .prepare(
        'INSERT INTO system_errors (tenant, source, message) VALUES (?, ?, ?)',
      )
      .bind('sablen.dk', 'Dinero', message)
      .run();
  } catch {
    // The original integration error remains the response if logging is unavailable.
  }
}

export async function GET() {
  const token = process.env.DINERO_ACCESS_TOKEN;
  const organizationId = process.env.DINERO_ORGANIZATION_ID;
  if (!token || !organizationId) {
    const message = 'Dinero er endnu ikke forbundet';
    await recordError(message);
    return NextResponse.json({ error: message }, { status: 503 });
  }
  const response = await fetch(`https://api.dinero.dk/v1/${organizationId}/accounts?pageSize=1000`, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' }, cache: 'no-store' });
  if (!response.ok) {
    const message = 'Kontoplanen kunne ikke hentes fra Dinero';
    await recordError(message);
    return NextResponse.json({ error: message }, { status: response.status });
  }
  const payload = await response.json();
  const collection = Array.isArray(payload) ? payload : payload.collection ?? payload.Collection ?? [];
  const accounts = collection.map((account: Record<string, unknown>) => ({ number: String(account.number ?? account.Number ?? ''), name: String(account.name ?? account.Name ?? ''), vatCode: String(account.vatCode ?? account.VatCode ?? '') })).filter((account: { number: string }) => account.number);
  return NextResponse.json({ accounts, fetchedAt: new Date().toISOString() });
}
