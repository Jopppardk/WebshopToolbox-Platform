import { database, prepareDatabase } from './database';

const tenant = 'sablen.dk';

function bytesToBase64(bytes: Uint8Array) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64ToBytes(value: string) {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function encryptionKey() {
  const encoded = process.env.CREDENTIALS_ENCRYPTION_KEY;
  if (!encoded) throw new Error('Krypteringsnøglen er ikke konfigureret');
  return crypto.subtle.importKey(
    'raw',
    base64ToBytes(encoded),
    { name: 'AES-GCM' },
    false,
    ['encrypt', 'decrypt'],
  );
}

export async function saveCredentials(
  provider: 'shopify' | 'dinero' | 'viabill' | 'emballage',
  credentials: Record<string, string>,
  displayName: string,
) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plaintext = new TextEncoder().encode(JSON.stringify(credentials));
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    await encryptionKey(),
    plaintext,
  );
  const db = await prepareDatabase();
  // The legacy credentials table only permits Shopify/Dinero. Keep the new
  // provider's encrypted envelope in the existing server-only settings store.
  if (provider === 'viabill' || provider === 'emballage') {
    await db.prepare(`INSERT INTO app_settings (tenant, setting_key, setting_value)
      VALUES (?, ?, ?) ON CONFLICT(tenant, setting_key)
      DO UPDATE SET setting_value = excluded.setting_value, updated_at = CURRENT_TIMESTAMP`)
      .bind(tenant, provider+'_credentials', JSON.stringify({ ciphertext: bytesToBase64(new Uint8Array(ciphertext)), iv: bytesToBase64(iv), displayName, verifiedAt: new Date().toISOString() })).run();
    return;
  }
  await db
    .prepare(
      `INSERT INTO integration_credentials
       (tenant, provider, ciphertext, iv, display_name, verified_at, updated_at)
       VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
       ON CONFLICT(tenant, provider) DO UPDATE SET
         ciphertext = excluded.ciphertext,
         iv = excluded.iv,
         display_name = excluded.display_name,
         verified_at = CURRENT_TIMESTAMP,
         updated_at = CURRENT_TIMESTAMP`,
    )
    .bind(
      tenant,
      provider,
      bytesToBase64(new Uint8Array(ciphertext)),
      bytesToBase64(iv),
      displayName,
    )
    .run();
}

export async function loadCredentials(provider: 'shopify' | 'dinero' | 'viabill' | 'emballage', readOnly = false) {
  const db = readOnly ? database() : await prepareDatabase();
  const envelope = (provider === 'viabill' || provider === 'emballage') ? await db.prepare("SELECT setting_value FROM app_settings WHERE tenant = ? AND setting_key = ?").bind(tenant, provider+'_credentials').first<{ setting_value: string }>() : null;
  const row = (provider === 'viabill' || provider === 'emballage') ? (envelope ? JSON.parse(envelope.setting_value) as { ciphertext: string; iv: string } : null) : await db
    .prepare(
      'SELECT ciphertext, iv FROM integration_credentials WHERE tenant = ? AND provider = ?',
    )
    .bind(tenant, provider)
    .first<{ ciphertext: string; iv: string }>();
  if (!row) return null;
  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: base64ToBytes(row.iv) },
    await encryptionKey(),
    base64ToBytes(row.ciphertext),
  );
  return JSON.parse(new TextDecoder().decode(plaintext)) as Record<string, string>;
}

