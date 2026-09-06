import { NextRequest, NextResponse } from 'next/server';
import { prepareDatabase } from '@/db/database';
import { saveCredentials } from '@/db/credentials';
import { recordFailure } from '@/db/errors';
import { accounts, keys, object, ViaBillError, publicError } from '@/lib/viabill';

const reply = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
export async function GET() {
  try {
    const db = await prepareDatabase();
    const row = await db.prepare(`SELECT json_extract(setting_value, '$.displayName') AS name,
      json_extract(setting_value, '$.verifiedAt') AS verifiedAt FROM app_settings
      WHERE tenant = ? AND setting_key = 'viabill_credentials'`).bind('sablen.dk').first<{ name: string; verifiedAt: string }>();
    return reply({ connected: Boolean(row), name: row?.name, verifiedAt: row?.verifiedAt });
  } catch { return reply({ error: 'ViaBills forbindelsesstatus kunne ikke hentes.' }, 503); }
}
export async function POST(request: NextRequest) {
  try {
    if (request.headers.get('origin') && request.headers.get('origin') !== request.nextUrl.origin) return reply({ error: 'Ugyldig forespørgsel.' }, 403);
    const body = object(await request.json()); const credentials = keys(body);
    if (body.action !== 'discover' && body.action !== 'connect') throw new ViaBillError('Vælg test eller forbindelse.');
    const available = await accounts(credentials);
    if (!available.length) throw new ViaBillError('Nøglerne giver ikke adgang til nogen ViaBill-konti.');
    if (body.action === 'discover') return reply({ accounts: available });
    const selected = available.find(account => account.id === body.accountId);
    if (!selected) throw new ViaBillError('Vælg en konto fra den hentede ViaBill-kontoliste.');
    await saveCredentials('viabill', { ...credentials, accountId: selected.id }, `${selected.name} (${selected.id})`);
    return reply({ connected: true, name: `${selected.name} (${selected.id})` });
  } catch (error) { await recordFailure('ViaBill-forbindelse'); return reply({ error: publicError(error) }, 400); }
}
