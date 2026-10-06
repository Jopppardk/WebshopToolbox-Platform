import { minorUnits } from './money';

type Money = { amount: string; currencyCode: string };
export type PayoutTransaction = {
  id: string;
  type: string;
  processedAt: string;
  amount: Money;
  fee: Money;
  net: Money;
  sourceType: string;
  orderId: string | null;
  orderName: string | null;
  adjustmentReason: string | null;
};

type RawTransaction = {
  id?: number | string;
  type?: string;
  test?: boolean;
  payout_id?: number | string;
  currency?: string;
  amount?: string;
  fee?: string;
  net?: string;
  source_type?: string;
  source_order_id?: number | string | null;
  processed_at?: string;
  adjustment_reason?: string | null;
  adjustment_order_transactions?: Array<{
    order?: { id?: number | string; name?: string };
  }>;
};

const apiVersion = '2026-07';
const validDecimal = (value: unknown): value is string =>
  typeof value === 'string' && /^-?\d+(\.\d+)?$/.test(value);

function nextLink(header: string | null) {
  if (!header) return null;
  for (const part of header.split(',')) {
    const match = part.match(/<([^>]+)>;\s*rel="next"/);
    if (match) return match[1];
  }
  return null;
}

async function orderNames(shop: string, accessToken: string, ids: string[]) {
  const result = new Map<string, string>();
  for (let offset = 0; offset < ids.length; offset += 100) {
    const batch = ids.slice(offset, offset + 100);
    const response = await fetch(
      `https://${shop}/admin/api/${apiVersion}/graphql.json`,
      {
        method: 'POST',
        redirect: 'manual',
        signal: AbortSignal.timeout(25000),
        headers: {
          'Content-Type': 'application/json',
          'X-Shopify-Access-Token': accessToken,
        },
        body: JSON.stringify({
          query:
            'query PayoutOrderNames($ids:[ID!]!){nodes(ids:$ids){... on Order{id name}}}',
          variables: { ids: batch.map((id) => `gid://shopify/Order/${id}`) },
        }),
      },
    );
    const payload = (await response.json()) as {
      data?: { nodes?: Array<{ id?: string; name?: string } | null> };
      errors?: unknown[];
    };
    if (
      !response.ok ||
      payload.errors?.length ||
      !Array.isArray(payload.data?.nodes)
    )
      throw new Error(
        'Shopify kunne ikke knytte udbetalingen til ordrenumrene.',
      );
    for (const node of payload.data.nodes)
      if (node?.id && node.name)
        result.set(node.id.split('/').pop()!, node.name);
  }
  return result;
}

export function validatePayoutTransactions(
  raw: RawTransaction[],
  payoutId: string,
  currency: string,
  expectedNet: number,
  names = new Map<string, string>(),
) {
  if (!Array.isArray(raw) || raw.length > 5000)
    throw new Error('Shopify returnerede for mange udbetalingstransaktioner.');
  const seen = new Set<string>();
  const transactions = raw
    .filter(
      (item) =>
        !['payout', 'payout_failure', 'payout_cancellation'].includes(
          String(item.type || '').toLowerCase(),
        ) && String(item.source_type || '').toLowerCase() !== 'payout',
    )
    .map((item): PayoutTransaction => {
      const id = String(item.id ?? ''),
        itemPayout = String(item.payout_id ?? '');
      if (!/^\d+$/.test(id) || seen.has(id) || itemPayout !== payoutId)
        throw new Error(
          'Shopify returnerede en ugyldig eller dubleret udbetalingstransaktion.',
        );
      seen.add(id);
      if (
        item.test !== false ||
        !item.type ||
        !item.source_type ||
        !Number.isFinite(Date.parse(item.processed_at || ''))
      )
        throw new Error(
          'Shopify returnerede en ufuldstændig udbetalingstransaktion.',
        );
      if (
        !validDecimal(item.amount) ||
        !validDecimal(item.fee) ||
        !validDecimal(item.net) ||
        !/^[A-Z]{3}$/.test(item.currency || '') ||
        item.currency !== currency
      )
        throw new Error('Shopify returnerede ugyldige beløb i udbetalingen.');
      const order = item.adjustment_order_transactions?.find(
        (value) => value.order?.id && value.order?.name,
      )?.order;
      const orderId = String(item.source_order_id ?? order?.id ?? '') || null;
      return {
        id,
        type: item.type.toUpperCase(),
        processedAt: item.processed_at!,
        amount: { amount: item.amount, currencyCode: currency },
        fee: { amount: item.fee, currencyCode: currency },
        net: { amount: item.net, currencyCode: currency },
        sourceType: item.source_type.toUpperCase(),
        orderId,
        orderName: order?.name || (orderId ? names.get(orderId) || null : null),
        adjustmentReason: item.adjustment_reason || null,
      };
    });
  if (
    !transactions.length ||
    transactions.reduce(
      (sum, item) => sum + minorUnits(item.net.amount, currency),
      0,
    ) !== expectedNet
  )
    throw new Error(
      'Shopifys transaktioner stemmer ikke med nettoudbetalingen.',
    );
  return transactions.sort(
    (a, b) =>
      Date.parse(a.processedAt) - Date.parse(b.processedAt) ||
      a.id.localeCompare(b.id),
  );
}

export async function fetchPayoutTransactions(
  payoutGid: string,
  currency: string,
  expectedNet: number,
  access: { shop: string; accessToken: string },
) {
  const payoutId = payoutGid.split('/').pop() || '';
  if (!/^\d+$/.test(payoutId)) throw new Error('Ugyldigt udbetalings-ID.');
  const { shop, accessToken } = access;
  const path = `/admin/api/${apiVersion}/shopify_payments/balance/transactions.json`;
  let url: string | null =
    `https://${shop}${path}?limit=250&payout_id=${encodeURIComponent(payoutId)}`;
  const all: RawTransaction[] = [];
  for (let page = 0; url; page++) {
    if (page >= 20)
      throw new Error('Udbetalingen indeholder for mange transaktionssider.');
    const parsed: URL = new URL(url);
    if (
      parsed.protocol !== 'https:' ||
      parsed.hostname !== shop ||
      parsed.port ||
      parsed.username ||
      parsed.password ||
      parsed.pathname !== path ||
      parsed.searchParams.get('payout_id') !== payoutId
    )
      throw new Error(
        'Shopify returnerede en ugyldig fortsættelse til udbetalingstransaktionerne.',
      );
    const response: Response = await fetch(parsed.toString(), {
      method: 'GET',
      redirect: 'manual',
      signal: AbortSignal.timeout(25000),
      headers: { 'X-Shopify-Access-Token': accessToken },
    });
    const payload = (await response.json()) as {
      transactions?: RawTransaction[];
    };
    if (!response.ok || !Array.isArray(payload.transactions))
      throw new Error(
        `Shopify kunne ikke hente udbetalingens transaktioner (HTTP ${response.status}).`,
      );
    all.push(...payload.transactions);
    url = nextLink(response.headers.get('link'));
  }
  const ids = [
    ...new Set(
      all.flatMap((item) =>
        [
          item.source_order_id,
          ...(item.adjustment_order_transactions || []).map(
            (value) => value.order?.id,
          ),
        ]
          .filter(Boolean)
          .map(String),
      ),
    ),
  ];
  const names = await orderNames(shop, accessToken, ids);
  return validatePayoutTransactions(
    all,
    payoutId,
    currency,
    expectedNet,
    names,
  );
}
