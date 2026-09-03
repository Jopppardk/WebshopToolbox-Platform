import { NextResponse } from 'next/server';
import { prepareDatabase } from '@/db/database';
import { loadCredentials } from '@/db/credentials';

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
  const credentials = await loadCredentials('dinero');
  if (!credentials) {
    const message = 'Dinero er endnu ikke forbundet';
    await recordError(message);
    return NextResponse.json({ error: message }, { status: 503 });
  }
  const tokenResponse = await fetch('https://authz.dinero.dk/dineroapi/oauth/token', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${btoa(`${credentials.clientId}:${credentials.clientSecret}`)}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      grant_type: 'password',
      scope: 'read',
      username: credentials.apiKey,
      password: credentials.apiKey,
    }),
  });
  const tokenPayload = (await tokenResponse.json()) as { access_token?: string };
  if (!tokenResponse.ok || !tokenPayload.access_token) {
    const message = 'Dinero-adgangen kunne ikke fornyes';
    await recordError(message);
    return NextResponse.json({ error: message }, { status: 401 });
  }
  const response = await fetch(`https://api.dinero.dk/v1/${credentials.organizationId}/accounts?pageSize=1000`, { headers: { Authorization: `Bearer ${tokenPayload.access_token}`, Accept: 'application/json' }, cache: 'no-store' });
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
