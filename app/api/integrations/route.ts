import { NextRequest, NextResponse } from 'next/server';
import { prepareDatabase } from '@/db/database';
import { saveCredentials } from '@/db/credentials';

const tenant = 'sablen.dk';

async function logError(source: string, message: string) {
  const db = await prepareDatabase();
  await db
    .prepare('INSERT INTO system_errors (tenant, source, message) VALUES (?, ?, ?)')
    .bind(tenant, source, message)
    .run();
}

export async function GET() {
  const db = await prepareDatabase();
  const result = await db
    .prepare(
      `SELECT provider, display_name, verified_at
       FROM integration_credentials WHERE tenant = ?`,
    )
    .bind(tenant)
    .all();
  return NextResponse.json({ integrations: result.results });
}

export async function POST(request: NextRequest) {
  const body = (await request.json()) as Record<string, string>;
  try {
    if (body.provider === 'shopify') {
      const shop = body.shop?.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/$/, '');
      if (!shop || !/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(shop))
        throw new Error('Indtast butikkens .myshopify.com-adresse');
      if (!body.clientId?.trim() || !body.clientSecret?.trim())
        throw new Error('Udfyld både Shopify Client ID og Client Secret');
      const tokenResponse = await fetch(`https://${shop}/admin/oauth/access_token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'client_credentials',
          client_id: body.clientId,
          client_secret: body.clientSecret,
        }),
      });
      const tokenPayload = (await tokenResponse.json()) as {
        access_token?: string;
        expires_in?: number;
      };
      if (!tokenResponse.ok || !tokenPayload.access_token)
        throw new Error('Shopify afviste Client ID eller Client Secret');
      const response = await fetch(`https://${shop}/admin/api/2026-07/graphql.json`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Shopify-Access-Token': tokenPayload.access_token,
        },
        body: JSON.stringify({ query: 'query ConnectionTest { shop { name myshopifyDomain } }' }),
      });
      const payload = (await response.json()) as { data?: { shop?: { name?: string } }; errors?: unknown };
      if (!response.ok || !payload.data?.shop?.name) throw new Error('Shopify afviste forbindelsen eller nøglen');
      await saveCredentials(
        'shopify',
        { shop, clientId: body.clientId, clientSecret: body.clientSecret },
        payload.data.shop.name,
      );
      return NextResponse.json({ provider: 'shopify', connected: true, name: payload.data.shop.name });
    }

    if (body.provider === 'dinero') {
      for (const key of ['clientId', 'clientSecret', 'apiKey', 'organizationId'])
        if (!body[key]?.trim()) throw new Error('Udfyld alle Dinero-felter');
      if (!/^[a-zA-Z0-9-]+$/.test(body.organizationId)) throw new Error('Dinero organisation-ID er ugyldigt');
      const tokenResponse = await fetch('https://authz.dinero.dk/dineroapi/oauth/token', {
        method: 'POST',
        headers: {
          Authorization: `Basic ${btoa(`${body.clientId}:${body.clientSecret}`)}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({ grant_type: 'password', scope: 'read', username: body.apiKey, password: body.apiKey }),
      });
      const tokenPayload = (await tokenResponse.json()) as { access_token?: string };
      if (!tokenResponse.ok || !tokenPayload.access_token) throw new Error('Dinero afviste adgangsoplysningerne');
      const accountResponse = await fetch(`https://api.dinero.dk/v1/${body.organizationId}/accounts?pageSize=1`, {
        headers: { Authorization: `Bearer ${tokenPayload.access_token}`, Accept: 'application/json' },
      });
      if (!accountResponse.ok) throw new Error('Dinero kunne ikke læse den valgte organisation');
      await saveCredentials('dinero', {
        clientId: body.clientId,
        clientSecret: body.clientSecret,
        apiKey: body.apiKey,
        organizationId: body.organizationId,
      }, `Organisation ${body.organizationId}`);
      return NextResponse.json({ provider: 'dinero', connected: true, name: `Organisation ${body.organizationId}` });
    }
    throw new Error('Ukendt integration');
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Forbindelsen kunne ikke oprettes';
    try { await logError(body.provider || 'Integration', message); } catch {}
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
