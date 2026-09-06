import { loadCredentials } from './credentials';

export async function getShopifyAccess(readOnly = false) {
  const credentials = await loadCredentials('shopify', readOnly);
  if (!credentials) throw new Error('Shopify er endnu ikke forbundet');
  const response = await fetch(
    `https://${credentials.shop}/admin/oauth/access_token`,
    {
      method: 'POST',
      redirect: 'manual',
      signal: AbortSignal.timeout(20000),
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: credentials.clientId,
        client_secret: credentials.clientSecret,
      }),
    },
  );
  const payload = (await response.json()) as { access_token?: string };
  if (!response.ok || !payload.access_token)
    throw new Error('Shopify-adgangen kunne ikke fornyes');
  return { shop: credentials.shop, accessToken: payload.access_token };
}
