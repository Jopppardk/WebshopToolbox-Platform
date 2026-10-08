import { InvoiceCheckError } from './order-check';
import { unseal } from './connections';
import { HttpError, type PlatformEnv } from './types';

import type { InvoiceSource, Connection } from './invoice-check';
// Presentment amounts are what the customer paid in their own currency (e.g. SEK); invoices for other markets use them.
const money =
  '{ shopMoney { amount currencyCode } presentmentMoney { amount currencyCode } }';
const taxes = `taxLines { rate channelLiable priceSet ${money} } discountAllocations { allocatedAmountSet ${money} }`;
const itemFields = `id name quantity currentQuantity requiresShipping isGiftCard variant { inventoryItem { id unitCost { amount currencyCode } } } originalUnitPriceSet ${money} priceAfterAllDiscountsBeforeTaxesSet ${money} originalTotalSet ${money} discountedTotalSet ${money} ${taxes}`;
const shippingFields = `id title isRemoved originalPriceSet ${money} discountedPriceSet ${money} ${taxes}`;
const page = 'pageInfo { hasNextPage endCursor }';
export const orderFields = `id name email createdAt updatedAt processedAt test edited cancelledAt taxesIncluded presentmentCurrencyCode paymentGatewayNames displayFinancialStatus displayFulfillmentStatus
  fulfillments { createdAt status }
  customer { displayName firstName lastName }
  billingAddress { name address1 address2 zip city country countryCodeV2 }
  shippingAddress { name address1 address2 zip city country countryCodeV2 }
  currentTotalPriceSet ${money} currentSubtotalPriceSet ${money} currentTotalTaxSet ${money} totalRefundedSet ${money} totalPriceSet ${money} totalTaxSet ${money} subtotalPriceSet ${money}
  lineItems(first:100) { nodes { ${itemFields} } ${page} }
  shippingLines(first:25) { nodes { ${shippingFields} } ${page} }`;
type Access = { shop: string; accessToken: string };
export async function orderQuery<T>(
  access: Access,
  query: string,
  variables: Record<string, unknown>,
  errorMessage = 'Shopify kunne ikke hente komplette ordredata. Kontrollér read_orders-adgangen og prøv igen.',
): Promise<T> {
  if (!/^\s*query\b/.test(query))
    throw new HttpError(403, 'Shopify-ændringer er blokeret i denne adapter.');
  // Shopify's GraphQL cost bucket drains on long history reads. A THROTTLED answer is retried after the
  // wait Shopify's throttle status implies (at most 4 times, 2-10 s each); any other error fails at once.
  for (let attempt = 0; ; attempt++) {
    const response = await fetch(
      `https://${access.shop}/admin/api/2026-07/graphql.json`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Shopify-Access-Token': access.accessToken,
        },
        body: JSON.stringify({ query, variables }),
        signal: AbortSignal.timeout(25000),
        redirect: 'manual',
      },
    );
    const payload = (await response.json().catch(() => ({}))) as {
      data?: T;
      errors?: Array<{ extensions?: { code?: string } }>;
      extensions?: {
        cost?: {
          requestedQueryCost?: number;
          throttleStatus?: {
            currentlyAvailable?: number;
            restoreRate?: number;
          };
        };
      };
    };
    const code =
      response.status === 429
        ? 'THROTTLED'
        : payload.errors?.find((e) => typeof e?.extensions?.code === 'string')
            ?.extensions?.code;
    if (code === 'THROTTLED' && attempt < 4) {
      const cost = payload.extensions?.cost,
        missing =
          (cost?.requestedQueryCost ?? 100) -
          (cost?.throttleStatus?.currentlyAvailable ?? 0);
      await new Promise((resolve) =>
        setTimeout(
          resolve,
          Math.min(
            10000,
            Math.max(
              2000,
              (1000 * missing) / (cost?.throttleStatus?.restoreRate || 50),
            ),
          ),
        ),
      );
      continue;
    }
    // The error code (never the payload) is added so the cause is visible, e.g. THROTTLED or ACCESS_DENIED.
    if (!response.ok || payload.errors?.length || !payload.data)
      throw new HttpError(
        409,
        errorMessage +
          (code && /^[A-Z_]{3,40}$/.test(code)
            ? ` (Shopify: ${code})`
            : response.ok
              ? ''
              : ` (Shopify: HTTP ${response.status})`),
      );
    return payload.data;
  }
}
class OrderChangedError extends HttpError {
  constructor() {
    super(409, 'Ordren blev ændret under kontrollen. Prøv igen om lidt.');
  }
}
export async function completeOrder(
  order: InvoiceSource,
  access: Access,
): Promise<InvoiceSource> {
  let pages = 0;
  for (const key of ['lineItems', 'shippingLines'] as const) {
    const connection = order[key] as Connection<{ id: string }>;
    if (
      !Array.isArray(connection?.nodes) ||
      typeof connection.pageInfo?.hasNextPage !== 'boolean'
    )
      throw new HttpError(
        409,
        'Shopify returnerede ufuldstændige ordrelinjer.',
      );
    const seen = new Set(connection.nodes.map((n) => n.id));
    if (seen.size !== connection.nodes.length)
      throw new HttpError(409, 'Shopify returnerede dublerede linjer.');
    while (connection.pageInfo.hasNextPage) {
      if (++pages > 20)
        throw new HttpError(
          409,
          'Ordren er for stor til én kontrol. Ingen ufuldstændig faktura oprettes.',
        );
      const after = connection.pageInfo.endCursor;
      if (!after)
        throw new HttpError(
          409,
          'Shopify mangler en fortsættelse til ordrelinjerne.',
        );
      const data = await orderQuery<{ order: InvoiceSource | null }>(
        access,
        `query MoreInvoiceLines($id:ID!,$after:String!) { order(id:$id) { id updatedAt ${key}(first:100,after:$after) { nodes { ${key === 'lineItems' ? itemFields : shippingFields} } ${page} } } }`,
        { id: order.id, after },
      );
      if (
        !data.order ||
        data.order.id !== order.id ||
        data.order.updatedAt !== order.updatedAt
      )
        throw new OrderChangedError();
      const next = data.order[key];
      if (
        !next?.nodes?.length ||
        typeof next.pageInfo?.hasNextPage !== 'boolean' ||
        (next.pageInfo.hasNextPage &&
          (!next.pageInfo.endCursor || next.pageInfo.endCursor === after))
      )
        throw new HttpError(
          409,
          'Shopify kunne ikke fortsætte linjehentningen.',
        );
      for (const item of next.nodes) {
        if (seen.has(item.id))
          throw new HttpError(409, 'Shopify gentog en ordrelinje.');
        seen.add(item.id);
      }
      connection.nodes.push(...next.nodes);
      connection.pageInfo = next.pageInfo;
    }
  }
  if (pages) {
    const fresh = await orderQuery<{ order: { updatedAt: string } | null }>(
      access,
      'query InvoiceRevision($id:ID!) { order(id:$id) { updatedAt } }',
      { id: order.id },
    );
    if (fresh.order?.updatedAt !== order.updatedAt)
      throw new OrderChangedError();
  }
  return order;
}
export async function loadCompleteOrder(
  id: string,
  access: Access,
  validate?: (order: InvoiceSource) => unknown,
) {
  if (!/^gid:\/\/shopify\/Order\/\d+$/.test(id))
    throw new HttpError(409, 'Ugyldigt ordre-ID.');
  // Only repeat reads, before any durable invoice claim or external write.
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const data = await orderQuery<{ order: InvoiceSource | null }>(
        access,
        `query InvoiceOrder($id:ID!) { order(id:$id) { ${orderFields} } }`,
        { id },
      );
      if (!data.order || data.order.id !== id)
        throw new HttpError(409, 'Ordren kunne ikke findes i Shopify.');
      const order = await completeOrder(data.order, access);
      validate?.(order);
      return order;
    } catch (error) {
      if (
        attempt === 2 ||
        !(
          error instanceof OrderChangedError ||
          error instanceof InvoiceCheckError
        )
      )
        throw error;
    }
  }
  throw new HttpError(409, 'Ordren kunne ikke kontrolleres.');
}

export async function shopAccess(
  env: PlatformEnv,
  company: string,
  shop: string,
): Promise<Access> {
  const saved = await env.PLATFORM_DB.prepare(
    "SELECT shop_domain,credentials_encrypted FROM webshop_connections WHERE company_id=? AND webshop_id=? AND provider='shopify'",
  )
    .bind(company, shop)
    .first<{ shop_domain: string; credentials_encrypted: string }>();
  if (!saved || !/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(saved.shop_domain))
    throw new HttpError(409, 'Forbind Shopify under Integrationer først.');
  const creds = await unseal(
    env,
    [company, shop, 'shopify', saved.shop_domain],
    saved.credentials_encrypted,
  );
  return credentialAccess(
    saved.shop_domain,
    creds.clientId,
    creds.clientSecret,
  );
}
// A Shopify access token from the client credentials grant is valid for hours. It is kept in the Worker's memory
// for at most 20 minutes (never past Shopify's own expiry), so a page or a run does not ask for a new token on
// every call. The key holds the full credentials, so changed credentials always get a new token.
const tokens = new Map<string, { token: string; until: number }>();
const tokenMinutes = 20;
export async function credentialAccess(
  domain: string,
  clientId: string,
  clientSecret: string,
): Promise<Access> {
  if (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(domain))
    throw new HttpError(400, 'Ugyldigt Shopify-domæne.');
  const key = domain + '\n' + clientId + '\n' + clientSecret,
    kept = tokens.get(key);
  if (kept && kept.until > Date.now())
    return { shop: domain, accessToken: kept.token };
  const response = await fetch(
    'https://' + domain + '/admin/oauth/access_token',
    {
      method: 'POST',
      redirect: 'manual',
      signal: AbortSignal.timeout(15000),
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: clientId,
        client_secret: clientSecret,
      }),
    },
  );
  const token = (await response.json()) as {
    access_token?: string;
    expires_in?: number;
  };
  if (!response.ok || !token.access_token)
    throw new HttpError(
      409,
      'Shopify-adgangen kunne ikke godkendes. App og butik skal tilhøre kundens Shopify-organisation og have read_orders-adgang.',
    );
  const seconds =
    typeof token.expires_in === 'number' && token.expires_in > 120
      ? Math.min(tokenMinutes * 60, token.expires_in - 60)
      : 0;
  if (seconds > 0) {
    if (tokens.size > 200) tokens.clear();
    tokens.set(key, {
      token: token.access_token,
      until: Date.now() + seconds * 1000,
    });
  }
  return { shop: domain, accessToken: token.access_token };
}
export async function listInvoiceOrders(
  access: Access,
  after: string | null,
  cutoff: string,
) {
  const data = await orderQuery<{
    orders: {
      nodes: Pick<InvoiceSource, 'id' | 'name' | 'createdAt'>[];
      pageInfo: { hasNextPage: boolean; endCursor: string | null };
    };
  }>(
    access,
    `query InvoiceOrders($after:String,$query:String!){orders(first:25,after:$after,sortKey:CREATED_AT,query:$query){nodes{id name createdAt} ${page}}}`,
    { after, query: 'created_at:>=' + cutoff },
  );
  if (
    !Array.isArray(data.orders?.nodes) ||
    typeof data.orders.pageInfo?.hasNextPage !== 'boolean' ||
    (data.orders.pageInfo.hasNextPage &&
      (!data.orders.pageInfo.endCursor ||
        data.orders.pageInfo.endCursor === after))
  )
    throw new HttpError(
      503,
      'Shopify returnerede ikke et fuldstændigt ordresvar.',
    );
  return data.orders;
}
