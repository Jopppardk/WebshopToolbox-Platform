// Dashboard → Økonomi: a card per webshop with revenue month and year to date against the same days last year,
// and the inventory value. Revenue comes from Shopify Analytics (ShopifyQL), inventory from Shopify's cost
// prices; both are read-only and cached per webshop. The company total stays the booked figures from Dinero.
import { requireCompany, requireWebshop } from './auth';
import { orderQuery, shopAccess } from './invoice-source';
import { readInventory } from './inventory-source';
import { cachedRead, type ReadCache } from './performance-source';
import { dataStartDate } from './tier1-history';
import {
  financePeriods,
  type ShopFinance,
  type ShopRevenue,
} from './tier1/src/lib/dashboard-finance';
import { danishDate } from './tier1/src/lib/history-policy';
import { HttpError, reply, type Actor, type PlatformEnv } from './types';

const reportAccess =
  'Shopify kunne ikke hente omsætningen. Giv appen read_reports og den nødvendige adgang til beskyttede kundedata i Shopify, og forbind igen under Integrationer.';
const safe = (error: unknown) =>
  error instanceof Error &&
  /^(Shopify|Forbind|Lager|Ugyldig)/.test(error.message)
    ? error.message
    : 'Tallene for webshoppen kunne ikke hentes. Prøv igen senere.';
const cache: ReadCache = {
  prefix: 'dashboard-shop:v1:',
  busy: 'Tallene for webshoppen hentes allerede. Prøv igen om lidt.',
  safe,
};

const amount = (raw: unknown) =>
  typeof raw === 'number'
    ? raw
    : typeof raw === 'string' && /^-?\d+(\.\d+)?$/.test(raw)
      ? Number(raw)
      : NaN;
/** Revenue excl. tax in minor units: total_sales (incl. shipping, duties and fees) less taxes, as Dinero books it. */
export function parseSalesTotal(payload: unknown) {
  const result = payload as {
    parseErrors?: unknown[];
    tableData?: {
      columns?: Array<{ name: string }>;
      rows?: Array<Record<string, unknown>>;
    };
  } | null;
  if (
    !Array.isArray(result?.parseErrors) ||
    result.parseErrors.length ||
    !Array.isArray(result.tableData?.rows) ||
    !['total_sales', 'taxes'].every((name) =>
      result.tableData!.columns?.some((c) => c.name === name),
    )
  )
    throw Error(
      'Shopify kunne ikke levere omsætningen. Kontrollér rapportadgang under Integrationer.',
    );
  // An aggregate without TIMESERIES is one row; none means no sales in the period.
  const rows = result.tableData.rows;
  if (!rows.length) return 0;
  const total = amount(rows[0].total_sales),
    taxes = amount(rows[0].taxes),
    minor = Math.round((total - taxes) * 100);
  if (rows.length !== 1 || !Number.isSafeInteger(minor))
    throw Error('Shopify returnerede en ugyldig omsætning.');
  return minor;
}

export async function readShopRevenue(
  env: PlatformEnv,
  company: string,
  shop: string,
  start: string,
  now = new Date(),
): Promise<ShopRevenue> {
  const p = financePeriods(now),
    access = await shopAccess(env, company, shop);
  // A period before the data start date is unknown (—), as on Performance, never a partial sum.
  const sum = async (from: string, to: string) =>
    from < start
      ? null
      : parseSalesTotal(
          (
            await orderQuery<{ shopifyqlQuery: unknown }>(
              access,
              'query DashboardSales($query: String!) { shopifyqlQuery(query: $query) { tableData { columns { name } rows } parseErrors } }',
              {
                query: `FROM sales SHOW total_sales, taxes SINCE ${from} UNTIL ${to}`,
              },
              reportAccess,
            )
          ).shopifyqlQuery,
        );
  const [revenueMtd, revenueYtd, previousMtd, previousYtd] = await Promise.all([
    sum(p.monthStart, p.today),
    sum(p.yearStart, p.today),
    sum(p.priorMonthStart, p.previous),
    sum(p.priorYearStart, p.previous),
  ]);
  return { revenueMtd, revenueYtd, previousMtd, previousYtd };
}

export async function readShopFinance(
  env: PlatformEnv,
  company: string,
  shop: string,
  start: string,
  now = new Date(),
): Promise<ShopFinance> {
  // Separate parts: missing report access must not hide the inventory value, and vice versa.
  const [revenue, inventory, currency] = await Promise.all([
    readShopRevenue(env, company, shop, start, now).then(
      (value) => ({ value }),
      (error) => ({ error: safe(error) }),
    ),
    readInventory(env, company, shop).then(
      (value) => {
        const currencies = new Set(value.rows.map((r) => r.currency));
        if (currencies.size > 1)
          return { error: 'Lagerets kostpriser har flere valutaer.' };
        return {
          value: {
            valueMinor: value.totalValueMinor,
            incomplete: value.incomplete.length,
            // Cost prices carry their own currency; with no stocked items the value is 0 in any currency.
            currency: [...currencies][0] ?? null,
          },
        };
      },
      (error) => ({ error: safe(error) }),
    ),
    shopAccess(env, company, shop)
      .then((access) =>
        orderQuery<{ shop: { currencyCode: string } }>(
          access,
          'query DashboardShop { shop { currencyCode } }',
          {},
        ),
      )
      .then(
        (data) =>
          /^[A-Z]{3}$/.test(String(data.shop?.currencyCode))
            ? data.shop.currencyCode
            : null,
        () => null,
      ),
  ]);
  // Revenue is in the store's currency; without it the amounts are not shown rather than shown as DKK.
  const revenueError =
    'error' in revenue
      ? revenue.error
      : currency
        ? undefined
        : 'Shopify oplyste ikke butikkens valuta, så omsætningen vises ikke.';
  return {
    periods: financePeriods(now),
    startDate: start,
    currency,
    revenue: 'value' in revenue && !revenueError ? revenue.value : null,
    ...(revenueError ? { revenueError } : {}),
    inventory: 'value' in inventory ? inventory.value! : null,
    ...('error' in inventory ? { inventoryError: inventory.error } : {}),
    checkedAt: now.toISOString(),
  };
}

export async function handleShopFinance(
  request: Request,
  env: PlatformEnv,
  actor: Actor,
  company: string,
  shop: string,
) {
  if (request.method !== 'GET')
    throw new HttpError(405, 'Økonomien kan kun læses.');
  await requireCompany(env.PLATFORM_DB, actor, company);
  if (shop === 'none') throw new HttpError(409, 'Forbind en webshop først.');
  await requireWebshop(env.PLATFORM_DB, actor, company, shop);
  const saved = await env.PLATFORM_DB.prepare(
    "SELECT shop_domain,credentials_encrypted FROM webshop_connections WHERE company_id=? AND webshop_id=? AND provider='shopify'",
  )
    .bind(company, shop)
    .first<{ shop_domain: string; credentials_encrypted: string }>();
  if (!saved)
    throw new HttpError(409, 'Forbind Shopify under Integrationer først.');
  const start = await dataStartDate(env, company, shop, 'shopify'),
    force = new URL(request.url).searchParams.get('refresh') === '1';
  return reply(
    await cachedRead(
      env,
      company,
      cache,
      ['shopify', shop],
      [saved.shop_domain, saved.credentials_encrypted, start, danishDate()],
      () => readShopFinance(env, company, shop, start),
      // A part that failed is tried again sooner than complete numbers.
      (data) =>
        data.revenueError || data.inventoryError ? 2 * 60000 : 15 * 60000,
      force,
    ),
  );
}
