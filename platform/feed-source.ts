import { orderQuery, shopAccess } from './invoice-source';
import { HttpError, type PlatformEnv } from './types';
import { productXml, type Product, type Variant } from './feed-format';

export type Selection = { id: string; title: string };
/** The Shopify market a feed is for, as chosen when it was saved (name and currency are shown in the overview). */
export type FeedMarketChoice = {
  id: string;
  country: string;
  name: string;
  currency: string;
};
export type FeedConfig = {
  allProducts: boolean;
  collections: Selection[];
  products: Selection[];
  shippingCost: string;
  freeShippingFrom: string | null;
  deliveryTime: string;
  category: string;
  market?: FeedMarketChoice | null;
  refreshMinutes?: number;
};
/** How old a feed's data may be before the next fetch makes it again; feeds without a choice use 15 minutes. */
export const feedRefreshChoices = [15, 60, 360, 1440] as const;
export const feedRefreshMinutes = (
  config: Pick<FeedConfig, 'refreshMinutes'>,
) =>
  (feedRefreshChoices as readonly number[]).includes(
    Number(config.refreshMinutes),
  )
    ? Number(config.refreshMinutes)
    : 15;
/** An active Shopify market selling to countries: its currency, its storefront URL and language. */
export type FeedMarket = {
  id: string;
  name: string;
  countries: string[];
  currency: string;
  url: string;
  locale: string | null;
  primary: boolean;
};
type Page<T> = {
  nodes: T[];
  pageInfo: { hasNextPage: boolean; endCursor: string | null };
};
const page = 'pageInfo { hasNextPage endCursor }';
const variantFields =
  'id barcode title price compareAtPrice availableForSale inventoryQuantity selectedOptions { name value } image { url }';
const productFields = `id status title handle productType descriptionHtml vendor featuredImage { url } gender:metafield(namespace:"custom",key:"gender"){value} variants(first:50){nodes{${variantFields}} ${page}}`;
const problem = () =>
  new HttpError(
    409,
    'Produktdata kunne ikke hentes fuldstændigt. Kontrollér Shopify-adgangen read_products og dit udvalg.',
  );
function next<T>(p: Page<T>, seen: Set<string>): string | null {
  if (!Array.isArray(p?.nodes) || typeof p.pageInfo?.hasNextPage !== 'boolean')
    throw problem();
  if (!p.pageInfo.hasNextPage) return null;
  const cursor = p.pageInfo.endCursor;
  if (!cursor || seen.has(cursor) || !p.nodes.length) throw problem();
  seen.add(cursor);
  return cursor;
}
const marketsQuery =
  'query FeedMarkets{shop{primaryDomain{url} currencyCode billingAddress{countryCodeV2}} markets(first:50){nodes{id name status currencySettings{baseCurrency{currencyCode}} conditions{regionsCondition{regions(first:250){nodes{... on MarketRegionCountry{code}}}}} webPresences(first:5){nodes{defaultLocale{locale} rootUrls{locale url}}}}}}';
const marketsProblem =
  'Shopify-markederne kunne ikke hentes. Giv appen adgangen read_markets i Shopify og prøv igen.';
/** The markets that are active in Shopify, read live; draft markets and markets without countries are left out. */
export async function shopMarkets(
  env: PlatformEnv,
  company: string,
  shop: string,
): Promise<FeedMarket[]> {
  const data = await orderQuery<any>(
    await shopAccess(env, company, shop),
    marketsQuery,
    {},
    marketsProblem,
  );
  const primaryDomain = new URL(data.shop?.primaryDomain?.url || '');
  if (primaryDomain.protocol !== 'https:')
    throw new HttpError(409, marketsProblem);
  const home = data.shop?.billingAddress?.countryCodeV2;
  const markets: FeedMarket[] = [];
  for (const m of Array.isArray(data.markets?.nodes)
    ? data.markets.nodes
    : []) {
    const countries = (m?.conditions?.regionsCondition?.regions?.nodes || [])
      .map((r: any) => r?.code)
      .filter(
        (c: unknown): c is string =>
          typeof c === 'string' && /^[A-Z]{2}$/.test(c),
      )
      .sort();
    // Shopify gives no currency settings for a market that sells in the shop's own currency (typically the home market).
    const currency =
      m?.currencySettings?.baseCurrency?.currencyCode ??
      data.shop?.currencyCode;
    if (
      m?.status !== 'ACTIVE' ||
      !countries.length ||
      typeof currency !== 'string' ||
      !/^[A-Z]{3}$/.test(currency) ||
      !/^gid:\/\/shopify\/Market\/\d+$/.test(m.id)
    )
      continue;
    // A market with its own domain or subfolder is sold there in its default language; otherwise on the primary domain.
    const presence = m.webPresences?.nodes?.[0],
      locale =
        typeof presence?.defaultLocale?.locale === 'string'
          ? presence.defaultLocale.locale
          : null;
    const root = presence?.rootUrls?.find(
      (r: any) => r?.locale === locale,
    )?.url;
    let url = primaryDomain.origin;
    if (typeof root === 'string') {
      const parsed = new URL(root);
      if (parsed.protocol !== 'https:' || parsed.username || parsed.password)
        continue;
      url = (parsed.origin + parsed.pathname).replace(/\/$/, '');
    }
    markets.push({
      id: m.id,
      name: String(m.name).slice(0, 100),
      countries,
      currency,
      url,
      locale,
      primary:
        !!home &&
        countries.includes(home) &&
        currency === data.shop.currencyCode,
    });
  }
  // Never guess the primary market: without one, feeds made before markets show no market instead of a wrong one.
  return markets.sort(
    (a, b) =>
      Number(b.primary) - Number(a.primary) ||
      a.name.localeCompare(b.name, 'da'),
  );
}
export async function feedCatalog(
  env: PlatformEnv,
  company: string,
  shop: string,
  url: URL,
) {
  const kind =
    url.searchParams.get('kind') === 'collections' ? 'collections' : 'products';
  const after = url.searchParams.get('after') || null,
    q = (url.searchParams.get('q') || '').trim();
  if (q.length > 100 || (after?.length || 0) > 1024) throw problem();
  const access = await shopAccess(env, company, shop);
  // Only simple text terms enter Shopify's search syntax.
  const words = q
    .replace(/[^\p{L}\p{N} _-]/gu, '')
    .split(/\s+/)
    .filter(Boolean);
  const query = [
    ...(kind === 'products' ? ['status:active'] : []),
    ...words.map((w) => `title:${w}*`),
  ].join(' AND ');
  const result = await orderQuery<
    Record<string, Page<{ id: string; title: string }>>
  >(
    access,
    `query FeedCatalog($after:String,$query:String!){${kind}(first:50,after:$after,query:$query){nodes{id title} ${page}}}`,
    { after, query },
    problem().message,
  );
  const data = result[kind];
  next(data, new Set(after ? [after] : []));
  return {
    items: data.nodes,
    nextCursor: data.pageInfo.hasNextPage ? data.pageInfo.endCursor : null,
  };
}
export async function generateFeed(
  env: PlatformEnv,
  company: string,
  shop: string,
  config: FeedConfig,
) {
  const access = await shopAccess(env, company, shop);
  let calls = 0;
  const query = async <T>(text: string, vars: Record<string, unknown> = {}) => {
    if (++calls > 180)
      throw new HttpError(
        409,
        'Feedet er for stort til én opdatering. Vælg færre kollektioner eller produkter.',
      );
    return orderQuery<T>(access, text, vars, problem().message);
  };
  // A feed for a market uses that market's prices, currency, storefront and language; feeds made before
  // markets could be chosen keep the shop's primary domain and DKK.
  let market: FeedMarket | null = null,
    country = '';
  if (config.market) {
    market =
      (await shopMarkets(env, company, shop)).find(
        (m) => m.id === config.market!.id,
      ) || null;
    if (!market)
      throw new HttpError(
        409,
        `Markedet ${config.market.name} er ikke aktivt i Shopify længere. Vælg et andet marked for feedet.`,
      );
    country = market.countries.includes(config.market.country)
      ? config.market.country
      : market.countries[0];
  }
  const meta = await query<{
    shop: { primaryDomain: { url: string }; currencyCode: string };
  }>('query FeedShop {shop{primaryDomain{url} currencyCode}}');
  if (!market && meta.shop.currencyCode !== 'DKK')
    throw new HttpError(
      409,
      'PartnerAds-feedet understøtter i første omgang DKK.',
    );
  const domain = new URL(market ? market.url : meta.shop.primaryDomain.url);
  if (domain.protocol !== 'https:' || domain.username || domain.password)
    throw problem();
  const storefront = market ? market.url : domain.origin;
  const products = new Map<string, { product: Product; category: string }>();
  const add = (p: Product, category: string) => {
    if (!p || !/^gid:\/\/shopify\/Product\/\d+$/.test(p.id)) throw problem();
    if (!products.has(p.id)) products.set(p.id, { product: p, category });
    if (products.size > 2500)
      throw new HttpError(
        409,
        'Et feed må højst indeholde 2.500 produkter. Afgræns dit udvalg.',
      );
  };
  const collect = async (id: string | null) => {
    let after: string | null = null;
    const seen = new Set<string>(),
      productIds = new Set<string>();
    do {
      const response: any = await query(
        id
          ? `query FeedCollection($id:ID!,$after:String){collection(id:$id){title products(first:10,after:$after){nodes{${productFields}} ${page}}}}`
          : `query FeedProducts($after:String){products(first:10,after:$after,query:"status:active"){nodes{${productFields}} ${page}}}`,
        { id, after },
      );
      const connection: Page<Product> = id
        ? response.collection?.products
        : response.products;
      const cursor = next(connection, seen);
      for (const p of connection.nodes) {
        if (productIds.has(p.id)) throw problem();
        productIds.add(p.id);
        add(p, id ? response.collection.title : p.productType || '');
      }
      after = cursor;
    } while (after);
  };
  if (config.allProducts) await collect(null);
  else {
    for (const c of config.collections) await collect(c.id);
    for (let i = 0; i < config.products.length; i += 10) {
      const ids = config.products.slice(i, i + 10).map((p) => p.id);
      const data = await query<{ nodes: (Product | null)[] }>(
        `query FeedSelected($ids:[ID!]!){nodes(ids:$ids){... on Product{${productFields}}}}`,
        { ids },
      );
      if (
        !Array.isArray(data.nodes) ||
        data.nodes.length !== ids.length ||
        data.nodes.some((p, i) => !p || p.id !== ids[i])
      )
        throw problem();
      for (const p of data.nodes) add(p!, p!.productType || '');
    }
  }
  // Market feeds: is the product sold in the market, its price there and its texts in the market's language.
  type Local = {
    published: boolean;
    title?: string;
    description?: string;
    prices: Map<string, { price: string; compareAtPrice: string | null }>;
  };
  const local = new Map<string, Local>();
  if (market) {
    const translate = !market.primary && !!market.locale;
    const ids = [...products.keys()];
    for (let i = 0; i < ids.length; i += 10) {
      const batch = ids.slice(i, i + 10);
      const data = await orderQuery<{ nodes: any[] }>(
        access,
        `query FeedMarketProducts($ids:[ID!]!,$country:CountryCode!${translate ? ',$locale:String!' : ''}){nodes(ids:$ids){... on Product{id publishedInContext(context:{country:$country}) ${translate ? 'translations(locale:$locale){key value}' : ''} variants(first:100){nodes{id contextualPricing(context:{country:$country}){price{amount currencyCode} compareAtPrice{amount currencyCode}}} pageInfo{hasNextPage}}}}}`,
        {
          ids: batch,
          country,
          ...(translate ? { locale: market.locale } : {}),
        },
        'Markedspriser kunne ikke hentes. Giv appen adgangene read_products, read_publications' +
          (translate ? ' og read_translations' : '') +
          ' i Shopify og prøv igen.',
      );
      if (++calls > 180)
        throw new HttpError(
          409,
          'Feedet er for stort til én opdatering. Vælg færre kollektioner eller produkter.',
        );
      if (!Array.isArray(data.nodes) || data.nodes.length !== batch.length)
        throw problem();
      data.nodes.forEach((n, index) => {
        if (!n || n.id !== batch[index] || !Array.isArray(n.variants?.nodes))
          throw problem();
        if (n.variants.pageInfo?.hasNextPage)
          throw new HttpError(
            409,
            'Produkter med over 100 varianter kan ikke komme med i et markedsfeed endnu.',
          );
        const prices = new Map<
          string,
          { price: string; compareAtPrice: string | null }
        >();
        for (const v of n.variants.nodes) {
          const price = v?.contextualPricing?.price,
            compare = v?.contextualPricing?.compareAtPrice;
          if (!price) continue;
          if (
            price.currencyCode !== market!.currency ||
            (compare && compare.currencyCode !== market!.currency)
          )
            throw new HttpError(
              409,
              `Shopify gav priser i en anden valuta end markedets ${market!.currency}.`,
            );
          prices.set(v.id, {
            price: String(price.amount),
            compareAtPrice: compare ? String(compare.amount) : null,
          });
        }
        const text = (key: string) =>
          (Array.isArray(n.translations) ? n.translations : []).find(
            (t: any) =>
              t?.key === key && typeof t.value === 'string' && t.value.trim(),
          )?.value as string | undefined;
        local.set(n.id, {
          published: n.publishedInContext === true,
          title: text('title'),
          description: text('body_html'),
          prices,
        });
      });
    }
  }
  const entries: string[] = [];
  for (const { product: original, category } of products.values()) {
    if (original.status !== 'ACTIVE') continue;
    const here = market ? local.get(original.id) : null;
    if (market && !here?.published) continue;
    const p: Product = here
      ? {
          ...original,
          title: here.title || original.title,
          descriptionHtml: here.description || original.descriptionHtml,
        }
      : original;
    let connection = p.variants as Page<Variant>,
      after: string | null;
    const seen = new Set<string>(),
      ids = new Set<string>();
    do {
      after = next(connection, seen);
      for (const v of connection.nodes) {
        if (
          !/^gid:\/\/shopify\/ProductVariant\/\d+$/.test(v.id) ||
          ids.has(v.id)
        )
          throw problem();
        ids.add(v.id);
        if (!v.availableForSale) continue;
        if (here) {
          const price = here.prices.get(v.id);
          if (!price) continue;
          Object.assign(v, price);
        }
        if (
          !/^\d+(\.\d{1,2})?$/.test(v.price) ||
          !Number.isFinite(Number(v.price)) ||
          (v.compareAtPrice !== null &&
            !/^\d+(\.\d{1,2})?$/.test(v.compareAtPrice))
        )
          throw problem();
        entries.push(
          productXml(p, v, storefront, {
            SHOPIFY_COLLECTION_TITLE: config.category || category,
            SHIPPING_COST: config.shippingCost,
            FREE_SHIPPING_FROM:
              config.freeShippingFrom === null
                ? null
                : Number(config.freeShippingFrom),
            DELIVERY_TIME: config.deliveryTime,
            LOCALE: market?.locale,
          }),
        );
        if (entries.length > 10000)
          throw new HttpError(
            409,
            'Et feed må højst indeholde 10.000 varianter.',
          );
      }
      if (after) {
        const data = await query<{
          product: { variants: Page<Variant> } | null;
        }>(
          `query FeedVariants($id:ID!,$after:String!){product(id:$id){variants(first:100,after:$after){nodes{${variantFields}} ${page}}}}`,
          { id: p.id, after },
        );
        if (!data.product) throw problem();
        connection = data.product.variants;
      }
    } while (after);
  }
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<produkter>\n${entries.join('\n')}\n</produkter>\n`;
  if (new TextEncoder().encode(xml).length > 15_000_000)
    throw new HttpError(409, 'Feedet overstiger 15 MB. Afgræns dit udvalg.');
  return { xml, count: entries.length };
}
