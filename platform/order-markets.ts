// Country and currency per order (Shopify Markets). Read in a separate, read-only step after the order
// import, so missing access to protected address data can only affect the flag, never the order sync, and
// the stored order snapshots (and with them the bookkeeping status) stay unchanged.
import { orderQuery, shopAccess } from './invoice-source';
import type { PlatformEnv } from './types';

type MarketNode = {
  id: string;
  presentmentCurrencyCode?: string;
  original?: { shopMoney?: { amount?: string } } | null;
  net?: { shopMoney?: { amount?: string } } | null;
  shipping?: { countryCodeV2?: string } | null;
  billing?: { countryCodeV2?: string } | null;
  total?: {
    presentmentMoney?: { amount?: string; currencyCode?: string };
  } | null;
} | null;
const amount = (value: unknown) =>
  typeof value === 'string' && /^-?\d+(\.\d{1,2})?$/.test(value) ? value : null;
const code = (value: unknown, length: number) =>
  typeof value === 'string' && new RegExp(`^[A-Z]{${length}}$`).test(value)
    ? value
    : null;

/** The market of an order: shipping country (where the goods go), else billing country, and the currency the customer paid in. */
export function orderMarket(node: NonNullable<MarketNode>) {
  const total = node.total?.presentmentMoney;
  return {
    country:
      code(node.shipping?.countryCodeV2, 2) ??
      code(node.billing?.countryCodeV2, 2),
    currency:
      code(node.presentmentCurrencyCode, 3) ?? code(total?.currencyCode, 3),
    total:
      typeof total?.amount === 'string' &&
      /^-?\d+(\.\d{1,2})?$/.test(total.amount)
        ? total.amount
        : null,
    // In the shop's currency: the order total before returns, and Shopify's net payment (received minus refunded).
    orderTotal: amount(node.original?.shopMoney?.amount),
    netPayment: amount(node.net?.shopMoney?.amount),
  };
}

/** Fills the market of up to 250 orders without one, and refreshes orders changed since (e.g. refunded), newest first. */
export async function fillOrderMarkets(
  env: PlatformEnv,
  company: string,
  shop: string,
  limit = 250,
) {
  const db = env.PLATFORM_DB;
  const ids = (
    await db
      .prepare(`SELECT s.external_id FROM operation_snapshots s LEFT JOIN order_markets m ON m.company_id=s.company_id AND m.webshop_id=s.webshop_id AND m.external_id=s.external_id
    WHERE s.company_id=? AND s.webshop_id=? AND s.module='orders' AND (m.external_id IS NULL OR s.imported_at>m.updated_at) ORDER BY m.external_id IS NOT NULL,s.occurred_at DESC LIMIT ?`)
      .bind(company, shop, limit)
      .all<{ external_id: string }>()
  ).results.map((r) => r.external_id);
  if (!ids.length) return 0;
  const access = await shopAccess(env, company, shop);
  let stored = 0;
  for (let i = 0; i < ids.length; i += 50) {
    const batch = ids.slice(i, i + 50);
    const data = await orderQuery<{ nodes: MarketNode[] }>(
      access,
      'query OrderMarkets($ids:[ID!]!){nodes(ids:$ids){... on Order{id presentmentCurrencyCode shipping:shippingAddress{countryCodeV2} billing:billingAddress{countryCodeV2} total:currentTotalPriceSet{presentmentMoney{amount currencyCode}} original:totalPriceSet{shopMoney{amount}} net:netPaymentSet{shopMoney{amount}}}}}',
      { ids: batch },
      'Shopify kunne ikke hente ordrernes land og valuta.',
    );
    if (!Array.isArray(data.nodes) || data.nodes.length !== batch.length)
      throw new Error('Shopify returnerede en ufuldstændig ordreliste.');
    // An order Shopify no longer returns is stored without market, so it is not asked for again.
    await db.batch(
      batch.map((id, index) => {
        const node = data.nodes[index],
          market =
            node && node.id === id
              ? orderMarket(node)
              : {
                  country: null,
                  currency: null,
                  total: null,
                  orderTotal: null,
                  netPayment: null,
                };
        return db
          .prepare(
            'INSERT INTO order_markets(company_id,webshop_id,external_id,country,currency,presentment_total,order_total,net_payment) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(company_id,webshop_id,external_id) DO UPDATE SET country=excluded.country,currency=excluded.currency,presentment_total=excluded.presentment_total,order_total=excluded.order_total,net_payment=excluded.net_payment,updated_at=CURRENT_TIMESTAMP',
          )
          .bind(
            company,
            shop,
            id,
            market.country,
            market.currency,
            market.total,
            market.orderTotal,
            market.netPayment,
          );
      }),
    );
    stored += batch.length;
  }
  return stored;
}

// Orders are invoiced, mailed and booked in the home market (Denmark, in the shop's currency) and in the
// markets set up and enabled under Indstillinger → Markeder: in the market's currency (e.g. SEK), or in the
// shop's own currency when the customer was charged that (e.g. a Swedish order bought in the Danish store or
// paid with a method without SEK; its invoice has the market's texts with the amounts in DKK as paid).
// Orders to any other country or currency stay on hold. The platform books in DKK in Dinero.
export const HOME_COUNTRY = 'DK';
export const foreignHold =
  'Ordren går til et marked, der ikke er sat op til fakturering og bogføring. Slå markedet til under Indstillinger → Markeder.';
// The home market: Denmark (or no known country) in the shop's currency (or no known currency).
const homeSql = (shopCurrency: string) =>
  "(m.country IS NULL OR m.country='" +
  HOME_COUNTRY +
  "') AND (m.currency IS NULL OR " +
  shopCurrency +
  ' IS NULL OR m.currency=' +
  shopCurrency +
  ')';
// An enabled market that sells to the order's country, in the market's currency or the shop's own.
const marketSql = (shopCurrency: string) =>
  "(m.country IS NOT NULL AND m.country<>'" +
  HOME_COUNTRY +
  "' AND m.currency IS NOT NULL AND EXISTS(SELECT 1 FROM webshop_markets wm,json_each(wm.countries_json) c WHERE wm.company_id=m.company_id AND wm.webshop_id=m.webshop_id AND wm.enabled=1 AND c.value=m.country AND (wm.currency=m.currency OR m.currency=" +
  shopCurrency +
  ')))';
/** SQL condition on an operation_snapshots row aliased s: the order's market is known and is home or an enabled market. */
export const domesticOrderSql =
  'EXISTS(SELECT 1 FROM order_markets m WHERE m.company_id=s.company_id AND m.webshop_id=s.webshop_id AND m.external_id=s.external_id AND ((' +
  homeSql(
    "json_extract(s.payload_json,'$.currentTotalPriceSet.shopMoney.currencyCode')",
  ) +
  ') OR ' +
  marketSql(
    "json_extract(s.payload_json,'$.currentTotalPriceSet.shopMoney.currencyCode')",
  ) +
  '))';
/** The same condition for a row aliased s that belongs to an order (e.g. a refund), given the SQL of its order ID. */
export const domesticOrderOfSql = (orderId: string) =>
  "EXISTS(SELECT 1 FROM order_markets m LEFT JOIN operation_snapshots o ON o.company_id=m.company_id AND o.webshop_id=m.webshop_id AND o.module='orders' AND o.external_id=m.external_id WHERE m.company_id=s.company_id AND m.webshop_id=s.webshop_id AND m.external_id=" +
  orderId +
  ' AND ((' +
  homeSql(
    "json_extract(o.payload_json,'$.currentTotalPriceSet.shopMoney.currencyCode')",
  ) +
  ') OR ' +
  marketSql(
    "json_extract(o.payload_json,'$.currentTotalPriceSet.shopMoney.currencyCode')",
  ) +
  '))';
/** Whether an order is held: its market is known and is neither home nor an enabled market. */
export async function isForeignOrder(
  db: D1Database,
  company: string,
  shop: string,
  externalId: string,
) {
  const row = await db
    .prepare(
      "SELECT 1 FROM order_markets m LEFT JOIN operation_snapshots s ON s.company_id=m.company_id AND s.webshop_id=m.webshop_id AND s.external_id=m.external_id AND s.module='orders' WHERE m.company_id=? AND m.webshop_id=? AND m.external_id=?",
    )
    .bind(company, shop, externalId)
    .first();
  if (!row) return false;
  const allowed = await db
    .prepare(
      "SELECT 1 FROM order_markets m LEFT JOIN operation_snapshots s ON s.company_id=m.company_id AND s.webshop_id=m.webshop_id AND s.external_id=m.external_id AND s.module='orders' WHERE m.company_id=? AND m.webshop_id=? AND m.external_id=? AND ((" +
        homeSql(
          "json_extract(s.payload_json,'$.currentTotalPriceSet.shopMoney.currencyCode')",
        ) +
        ') OR ' +
        marketSql(
          "json_extract(s.payload_json,'$.currentTotalPriceSet.shopMoney.currencyCode')",
        ) +
        ')',
    )
    .bind(company, shop, externalId)
    .first();
  return !allowed;
}
export type WebshopMarket = {
  market_id: string;
  name: string;
  countries: string[];
  currency: string;
  locale: 'da' | 'sv' | 'en';
  store_name: string;
  contact: string | null;
  footer: string | null;
  invoice_subject: string;
  invoice_body: string;
};
/** The enabled market an order belongs to (outside the home market), or null for home-market orders. */
export async function orderMarketSettings(
  db: D1Database,
  company: string,
  shop: string,
  orderId: string,
): Promise<WebshopMarket | null> {
  const row = await db
    .prepare(
      // The market's own currency first; an order paid in the shop's currency belongs to the market as well.
      "SELECT wm.* FROM order_markets m LEFT JOIN operation_snapshots s ON s.company_id=m.company_id AND s.webshop_id=m.webshop_id AND s.module='orders' AND s.external_id=m.external_id JOIN webshop_markets wm ON wm.company_id=m.company_id AND wm.webshop_id=m.webshop_id AND wm.enabled=1 AND (wm.currency=m.currency OR m.currency=json_extract(s.payload_json,'$.currentTotalPriceSet.shopMoney.currencyCode')) AND EXISTS(SELECT 1 FROM json_each(wm.countries_json) c WHERE c.value=m.country) WHERE m.company_id=? AND m.webshop_id=? AND m.external_id=? AND m.country<>'" +
        HOME_COUNTRY +
        "' ORDER BY wm.currency=m.currency DESC LIMIT 1",
    )
    .bind(company, shop, orderId)
    .first<Omit<WebshopMarket, 'countries'> & { countries_json: string }>();
  return row ? { ...row, countries: JSON.parse(row.countries_json) } : null;
}
// Whether an order waits because its market is not set up: the same rule as order-markets.ts, for list views.
export async function marketHold(
  db: D1Database,
  company: string,
  shop: string,
) {
  const enabled = (
    await db
      .prepare(
        'SELECT countries_json,currency FROM webshop_markets WHERE company_id=? AND webshop_id=? AND enabled=1',
      )
      .bind(company, shop)
      .all<{ countries_json: string; currency: string }>()
  ).results.map((r) => ({
    countries: JSON.parse(r.countries_json) as string[],
    currency: r.currency,
  }));
  const held = (
    country: string | null,
    currency: string | null,
    shopCurrency: string | null,
  ) => {
    if (!country || country === HOME_COUNTRY)
      return !!currency && !!shopCurrency && currency !== shopCurrency;
    return (
      !currency ||
      !enabled.some(
        (m) =>
          m.countries.includes(country) &&
          (m.currency === currency || currency === shopCurrency),
      )
    );
  };
  // Why an order waits, for Salg and the order view: a market in another currency than the order was paid in
  // (e.g. a Swedish order paid in DKK while Sverige uses SEK) or no active market for the country.
  const reason = (
    country: string | null,
    currency: string | null,
    shopCurrency: string | null,
  ) => {
    if (!held(country, currency, shopCurrency)) return null;
    const market = country
      ? enabled.find((m) => m.countries.includes(country))
      : undefined;
    return market && currency && market.currency !== currency
      ? `Afventer · betalt i ${currency}, markedet bruger ${market.currency}`
      : 'Afventer · marked ikke sat op';
  };
  return Object.assign(held, { reason });
}
