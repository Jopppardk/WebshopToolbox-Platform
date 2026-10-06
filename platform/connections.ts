import { HttpError, type PlatformEnv } from './types';

const encoder = new TextEncoder();
async function key(env: PlatformEnv) {
  if (!/^[a-f0-9]{64}$/.test(env.PLATFORM_CREDENTIALS_KEY || ''))
    throw new HttpError(
      503,
      'Sikker lagring af adgangsoplysninger er ikke konfigureret.',
    );
  return crypto.subtle.importKey(
    'raw',
    Uint8Array.from(env.PLATFORM_CREDENTIALS_KEY!.match(/../g)!, (v) =>
      parseInt(v, 16),
    ),
    { name: 'AES-GCM' },
    false,
    ['encrypt', 'decrypt'],
  );
}
const base64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const bytes = (value: string) =>
  Uint8Array.from(atob(value), (v) => v.charCodeAt(0));
export async function seal(env: PlatformEnv, scope: string[], value: unknown) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = await crypto.subtle.encrypt(
    {
      name: 'AES-GCM',
      iv,
      additionalData: encoder.encode(
        JSON.stringify([env.PLATFORM_ENV, ...scope]),
      ),
    },
    await key(env),
    encoder.encode(JSON.stringify(value)),
  );
  return JSON.stringify({
    v: 1,
    iv: base64(iv),
    data: base64(new Uint8Array(data)),
  });
}
// Internal adapter helper; never exposed through an HTTP route.
export async function unseal(env: PlatformEnv, scope: string[], value: string) {
  const payload = JSON.parse(value);
  if (payload.v !== 1) throw new Error('Unsupported credentials version');
  return JSON.parse(
    new TextDecoder().decode(
      await crypto.subtle.decrypt(
        {
          name: 'AES-GCM',
          iv: bytes(payload.iv),
          additionalData: encoder.encode(
            JSON.stringify([env.PLATFORM_ENV, ...scope]),
          ),
        },
        await key(env),
        bytes(payload.data),
      ),
    ),
  );
}
export function website(value: unknown, shopify = false) {
  if (typeof value !== 'string' || value.length > 300 || !value.trim())
    throw new HttpError(400, 'Angiv en gyldig webadresse.');
  let url: URL;
  try {
    url = new URL(
      value.includes('://') ? value.trim() : 'https://' + value.trim(),
    );
  } catch {
    throw new HttpError(400, 'Angiv en gyldig webadresse.');
  }
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.port ||
    url.search ||
    url.hash ||
    url.pathname !== '/' ||
    !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(
      url.hostname,
    ) ||
    (shopify && !/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(url.hostname))
  )
    throw new HttpError(
      400,
      shopify
        ? 'Angiv butikkens eget navn.myshopify.com-domæne.'
        : 'Angiv kun webshoppens domæne, uden sti eller loginoplysninger.',
    );
  return url.hostname;
}
export async function connectionStatement(
  env: PlatformEnv,
  company: string,
  shop: string,
  input: Record<string, unknown>,
) {
  if (input.provider !== 'shopify')
    throw new HttpError(400, 'Vælg en understøttet webshopplatform.');
  const domain = website(input.shopDomain, true);
  const clientId =
    typeof input.clientId === 'string' ? input.clientId.trim() : '';
  const secret =
    typeof input.clientSecret === 'string' ? input.clientSecret.trim() : '';
  if (
    !clientId ||
    clientId.length > 256 ||
    !secret ||
    secret.length > 2048 ||
    /[\s\x00-\x1f]/.test(clientId + secret)
  )
    throw new HttpError(
      400,
      'Udfyld Client ID og Client secret. Begge skal indtastes ved udskiftning.',
    );
  const encrypted = await seal(env, [company, shop, 'shopify', domain], {
    clientId,
    clientSecret: secret,
  });
  return env.PLATFORM_DB.prepare(`INSERT INTO webshop_connections(company_id,webshop_id,provider,shop_domain,credentials_encrypted) VALUES(?,?,'shopify',?,?)
    ON CONFLICT(company_id,webshop_id) DO UPDATE SET provider=excluded.provider,shop_domain=excluded.shop_domain,credentials_encrypted=excluded.credentials_encrypted,updated_at=CURRENT_TIMESTAMP,verified_at=NULL`).bind(
    company,
    shop,
    domain,
    encrypted,
  );
}
