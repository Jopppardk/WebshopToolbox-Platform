// Country and currency per order (Shopify Markets). Read in a separate, read-only step after the order
// import, so missing access to protected address data can only affect the flag, never the order sync, and
// the stored order snapshots (and with them the bookkeeping status) stay unchanged.
import { orderQuery, shopAccess } from './invoice-source';
import type { PlatformEnv } from './types';

type MarketNode = { id: string; presentmentCurrencyCode?: string; shipping?: { countryCodeV2?: string } | null; billing?: { countryCodeV2?: string } | null; total?: { presentmentMoney?: { amount?: string; currencyCode?: string } } | null } | null;
const code = (value: unknown, length: number) => typeof value === 'string' && new RegExp(`^[A-Z]{${length}}$`).test(value) ? value : null;

/** The market of an order: shipping country (where the goods go), else billing country, and the currency the customer paid in. */
export function orderMarket(node: NonNullable<MarketNode>) {
  const total = node.total?.presentmentMoney;
  return {
    country: code(node.shipping?.countryCodeV2, 2) ?? code(node.billing?.countryCodeV2, 2),
    currency: code(node.presentmentCurrencyCode, 3) ?? code(total?.currencyCode, 3),
    total: typeof total?.amount === 'string' && /^-?\d+(\.\d{1,2})?$/.test(total.amount) ? total.amount : null,
  };
}

/** Fills the market of up to 250 orders that do not have one yet, newest first. Returns how many were stored. */
export async function fillOrderMarkets(env: PlatformEnv, company: string, shop: string, limit = 250) {
  const db = env.PLATFORM_DB;
  const ids = (await db.prepare(`SELECT s.external_id FROM operation_snapshots s LEFT JOIN order_markets m ON m.company_id=s.company_id AND m.webshop_id=s.webshop_id AND m.external_id=s.external_id
    WHERE s.company_id=? AND s.webshop_id=? AND s.module='orders' AND m.external_id IS NULL ORDER BY s.occurred_at DESC LIMIT ?`).bind(company, shop, limit).all<{ external_id: string }>()).results.map(r => r.external_id);
  if (!ids.length) return 0;
  const access = await shopAccess(env, company, shop);
  let stored = 0;
  for (let i = 0; i < ids.length; i += 50) {
    const batch = ids.slice(i, i + 50);
    const data = await orderQuery<{ nodes: MarketNode[] }>(access,
      'query OrderMarkets($ids:[ID!]!){nodes(ids:$ids){... on Order{id presentmentCurrencyCode shipping:shippingAddress{countryCodeV2} billing:billingAddress{countryCodeV2} total:currentTotalPriceSet{presentmentMoney{amount currencyCode}}}}}',
      { ids: batch }, 'Shopify kunne ikke hente ordrernes land og valuta.');
    if (!Array.isArray(data.nodes) || data.nodes.length !== batch.length) throw new Error('Shopify returnerede en ufuldstændig ordreliste.');
    // An order Shopify no longer returns is stored without market, so it is not asked for again.
    await db.batch(batch.map((id, index) => {
      const node = data.nodes[index], market = node && node.id === id ? orderMarket(node) : { country: null, currency: null, total: null };
      return db.prepare('INSERT INTO order_markets(company_id,webshop_id,external_id,country,currency,presentment_total) VALUES(?,?,?,?,?,?) ON CONFLICT(company_id,webshop_id,external_id) DO UPDATE SET country=excluded.country,currency=excluded.currency,presentment_total=excluded.presentment_total,updated_at=CURRENT_TIMESTAMP')
        .bind(company, shop, id, market.country, market.currency, market.total);
    }));
    stored += batch.length;
  }
  return stored;
}
