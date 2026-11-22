// Trafikkilder: visitors and orders per source for one webshop, read from Shopify Analytics (ShopifyQL).
// Read-only: the same read_reports access as Performance, no orders, customers or bookkeeping are touched.
import { requireCompany, requireWebshop } from './auth';
import { shopAccess, orderQuery } from './invoice-source';
import { dataStartDate } from './tier1-history';
import { danishDate } from './tier1/src/lib/history-policy';
import { cachedRead, type ReadCache } from './performance-source';
import {
  describeCampaign,
  describeChannel,
  describeCountry,
  describeDevice,
  describeLandingPage,
  describeReferrer,
  mergeTraffic,
  parseTrafficTable,
  trafficRange,
  type Describe,
  type Side,
} from './traffic-calculations';
import { HttpError, reply, type Actor, type PlatformEnv } from './types';
import {
  trafficPeriods,
  type TrafficPeriod,
  type TrafficReport,
  type TrafficTotals,
} from './tier1/src/lib/traffic';

const reportAccess =
  'Shopify kunne ikke hente rapporten. Giv appen read_reports og den nødvendige adgang til beskyttede kundedata i Shopify, og forbind igen under Integrationer.';
const safeError = (error: unknown) =>
  error instanceof Error && /^(Shopify|Forbind|Vælg)/.test(error.message)
    ? error.message
    : 'Trafikkilderne kunne ikke hentes. Prøv igen senere.';
const trafficCache: ReadCache = {
  prefix: 'traffic:v1:',
  busy: 'Trafikkilderne hentes allerede. Prøv igen om lidt.',
  safe: safeError,
};
const sessionMetrics = ['sessions', 'sessions_that_completed_checkout'],
  orderMetrics = ['orders', 'total_sales', 'taxes'];
// Shopify returns the largest sources first; the rest is shown as "Øvrige" from the totals.
const LIMIT = 100;

type Breakdown = {
  name: keyof Omit<
    TrafficReport,
    | 'period'
    | 'from'
    | 'to'
    | 'limitedByHistory'
    | 'checkedAt'
    | 'startDate'
    | 'timezone'
    | 'currency'
    | 'totals'
  >;
  sessions: string[];
  orders: string[] | null;
  describe: Describe;
};
const breakdowns: Breakdown[] = [
  {
    name: 'channels',
    sessions: ['referrer_source'],
    orders: ['order_referrer_source'],
    describe: describeChannel,
  },
  {
    name: 'referrers',
    sessions: ['referrer_source', 'referrer_name'],
    orders: ['order_referrer_source', 'order_referrer_name'],
    describe: describeReferrer,
  },
  {
    name: 'campaigns',
    sessions: ['utm_source', 'utm_medium', 'utm_campaign'],
    orders: ['order_utm_source', 'order_utm_medium', 'order_utm_campaign'],
    describe: describeCampaign,
  },
  {
    name: 'countries',
    sessions: ['session_country_code'],
    orders: ['shipping_country_code'],
    describe: describeCountry,
  },
  {
    name: 'landingPages',
    sessions: ['landing_page_path'],
    orders: null,
    describe: describeLandingPage,
  },
  {
    name: 'devices',
    sessions: ['session_device_type'],
    orders: null,
    describe: describeDevice,
  },
];

// A few reports at a time, so one page load does not drain the store's GraphQL cost bucket.
async function pool<T>(tasks: Array<() => Promise<T>>, size = 3) {
  const results: T[] = [];
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(size, tasks.length) }, async () => {
      while (next < tasks.length) {
        const i = next++;
        results[i] = await tasks[i]();
      }
    }),
  );
  return results;
}

export async function readTraffic(
  env: PlatformEnv,
  company: string,
  shop: string,
  period: TrafficPeriod,
  start: string,
): Promise<TrafficReport> {
  const access = await shopAccess(env, company, shop);
  const metadata = await orderQuery<{
    shop: { ianaTimezone: string; currencyCode: string };
  }>(access, 'query TrafficShop { shop { ianaTimezone currencyCode } }', {});
  const timezone = metadata.shop?.ianaTimezone,
    currency = metadata.shop?.currencyCode;
  if (typeof timezone !== 'string')
    throw Error('Shopify returnerede ikke butikkens tidszone.');
  if (!/^[A-Z]{3}$/.test(String(currency)))
    throw Error('Shopify oplyste ikke butikkens valuta.');
  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
  const range = trafficRange(period, today, start);
  const base = {
    period,
    ...range,
    checkedAt: new Date().toISOString(),
    startDate: start,
    timezone,
    currency: currency as string,
  };
  const query = async (
    source: 'sessions' | 'sales',
    dims: string[],
    metrics: string[],
  ): Promise<Side> => {
    if (range.from > range.to)
      return {
        error:
          'Perioden ligger før den valgte historikstart. Udvid historikken under Indstillinger.',
      };
    try {
      const shopifyql =
        `FROM ${source} SHOW ${metrics.join(', ')}` +
        (dims.length ? ` GROUP BY ${dims.join(', ')}` : '') +
        ` SINCE ${range.from} UNTIL ${range.to}` +
        (dims.length ? ` ORDER BY ${metrics[0]} DESC LIMIT ${LIMIT}` : '');
      const data = await orderQuery<{ shopifyqlQuery: unknown }>(
        access,
        'query TrafficReport($query: String!) { shopifyqlQuery(query: $query) { tableData { columns { name } rows } parseErrors } }',
        { query: shopifyql },
        reportAccess,
      );
      const rows = parseTrafficTable(data.shopifyqlQuery, dims, metrics);
      return { rows, complete: rows.length < LIMIT };
    } catch (error) {
      return { error: safeError(error) };
    }
  };
  // Separate reports: missing traffic access must not hide the orders, and one failed breakdown not the others.
  const tasks: Array<() => Promise<Side>> = [
    () => query('sessions', [], sessionMetrics),
    () => query('sales', [], orderMetrics),
    ...breakdowns.flatMap((b) => [
      () => query('sessions', b.sessions, sessionMetrics),
      ...(b.orders ? [() => query('sales', b.orders!, orderMetrics)] : []),
    ]),
  ];
  const results = await pool(tasks);
  const [sessionTotal, orderTotal] = results;
  const first = (side: Side) =>
    'rows' in side
      ? (side.rows[0]?.values ?? Object.create(null))
      : Object.create(null);
  const s = first(sessionTotal),
    o = first(orderTotal);
  const totals: TrafficTotals = {
    sessions: 'rows' in sessionTotal ? (s.sessions ?? 0) : null,
    checkouts:
      'rows' in sessionTotal ? (s.sessions_that_completed_checkout ?? 0) : null,
    orders: 'rows' in orderTotal ? (o.orders ?? 0) : null,
    sales: 'rows' in orderTotal ? (o.total_sales ?? 0) - (o.taxes ?? 0) : null,
    ...('error' in sessionTotal ? { sessionsError: sessionTotal.error } : {}),
    ...('error' in orderTotal ? { ordersError: orderTotal.error } : {}),
  };
  let i = 2;
  const tables = Object.fromEntries(
    breakdowns.map((b) => {
      const sessions = results[i++],
        orders = b.orders ? results[i++] : null;
      return [b.name, mergeTraffic(sessions, orders, b.describe, totals)];
    }),
  ) as Pick<TrafficReport, Breakdown['name']>;
  return { ...base, totals, ...tables };
}

const failed = (report: TrafficReport) =>
  Boolean(
    report.totals.sessionsError ||
    report.totals.ordersError ||
    breakdowns.some(
      (b) => report[b.name].sessionsError || report[b.name].ordersError,
    ),
  );

export async function handleTraffic(
  request: Request,
  env: PlatformEnv,
  actor: Actor,
  company: string,
  shop: string,
) {
  if (request.method !== 'GET')
    throw new HttpError(405, 'Trafikkilder understøtter kun læsning.');
  const url = new URL(request.url),
    rawPeriod = url.searchParams.get('days') || '30',
    period = Number(rawPeriod) as TrafficPeriod;
  if (!/^\d+$/.test(rawPeriod) || !trafficPeriods.includes(period))
    throw new HttpError(400, 'Vælg 7, 30, 90 eller 365 dage.');
  await requireCompany(env.PLATFORM_DB, actor, company);
  if (shop === 'none')
    throw new HttpError(409, 'Vælg en webshop for at se trafikkilderne.');
  await requireWebshop(env.PLATFORM_DB, actor, company, shop);
  const saved = await env.PLATFORM_DB.prepare(
    "SELECT shop_domain,credentials_encrypted FROM webshop_connections WHERE company_id=? AND webshop_id=? AND provider='shopify'",
  )
    .bind(company, shop)
    .first<{ shop_domain: string; credentials_encrypted: string }>();
  if (!saved)
    throw new HttpError(
      409,
      'Forbind webshoppen under Integrationer for at se trafikkilderne.',
    );
  const start = await dataStartDate(env, company, shop, 'shopify');
  return reply(
    await cachedRead(
      env,
      company,
      trafficCache,
      ['shopify-traffic', shop, period],
      [saved.shop_domain, saved.credentials_encrypted, start, danishDate()],
      () => readTraffic(env, company, shop, period, start),
      (data) => (failed(data) ? 30000 : 15 * 60000),
      url.searchParams.get('refresh') === '1',
    ),
  );
}
