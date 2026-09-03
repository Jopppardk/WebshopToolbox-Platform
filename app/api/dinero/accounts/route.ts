import { NextResponse } from 'next/server';

export async function GET() {
  const token = process.env.DINERO_ACCESS_TOKEN;
  const organizationId = process.env.DINERO_ORGANIZATION_ID;
  if (!token || !organizationId) return NextResponse.json({ error: 'Dinero er endnu ikke forbundet' }, { status: 503 });
  const response = await fetch(`https://api.dinero.dk/v1/${organizationId}/accounts?pageSize=1000`, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' }, cache: 'no-store' });
  if (!response.ok) return NextResponse.json({ error: 'Kontoplanen kunne ikke hentes fra Dinero' }, { status: response.status });
  const payload = await response.json();
  const collection = Array.isArray(payload) ? payload : payload.collection ?? payload.Collection ?? [];
  const accounts = collection.map((account: Record<string, unknown>) => ({ number: String(account.number ?? account.Number ?? ''), name: String(account.name ?? account.Name ?? ''), vatCode: String(account.vatCode ?? account.VatCode ?? '') })).filter((account: { number: string }) => account.number);
  return NextResponse.json({ accounts, fetchedAt: new Date().toISOString() });
}
