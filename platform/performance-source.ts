import { requireCompany, requireWebshop } from './auth';
import { unseal } from './connections';
import { shopAccess, orderQuery } from './invoice-source';
import { dataStartDate } from './tier1-history';
import { danishDate } from './tier1/src/lib/history-policy';
import {
  aggregateFinance,
  dailyComparison,
  monthRange,
  parseDailySales,
  parsePerformanceEntries,
  parseShopifyMetric,
  validDate,
} from './performance-calculations';
import { HttpError, reply, type Actor, type PlatformEnv } from './types';
import type {
  PerformanceDaily,
  PerformanceFinance,
  PerformanceShop,
  PerformanceMetric,
} from './tier1/src/lib/performance';

const reportAccess =
  'Shopify kunne ikke hente rapporten. Giv appen read_reports og den nødvendige adgang til beskyttede kundedata i Shopify, og forbind igen under Integrationer.';
const safeError = (error: unknown) =>
  error instanceof Error &&
  /^(Dinero|Regnskab|Shopify|Forbind|Vælg|En bogført)/.test(error.message)
    ? error.message
    : 'Performance-data kunne ikke hentes. Prøv igen senere.';
async function digest(value: string) {
  return [
    ...new Uint8Array(
      await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)),
    ),
  ]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}
// Company-scoped, versioned read cache. No ledger, voucher, order or receipt writes.
// A forced refresh (Opdatér) skips cached numbers older than a minute, so repeated clicks cannot hammer Dinero or Shopify.
export type ReadCache = {
  prefix: string;
  busy: string;
  safe: (error: unknown) => string;
};
export async function cachedRead<T>(
  env: PlatformEnv,
  company: string,
  options: ReadCache,
  scope: unknown[],
  context: unknown[],
  read: () => Promise<T>,
  ttl: (data: T) => number = () => 15 * 60000,
  force = false,
): Promise<T> {
  const db = env.PLATFORM_DB,
    key =
      options.prefix +
      (await digest(JSON.stringify([env.PLATFORM_ENV, ...scope])));
  const revision = await digest(JSON.stringify(context));
  const row = await db
    .prepare(
      'SELECT setting_value FROM finance_state WHERE tenant=? AND setting_key=?',
    )
    .bind(company, key)
    .first<{ setting_value: string }>();
  const previous = row ? JSON.parse(row.setting_value) : null;
  if (
    previous?.revision === revision &&
    previous.expiresAt > Date.now() &&
    (!force || previous.error || previous.savedAt > Date.now() - 60000)
  ) {
    if (previous.error) throw new HttpError(409, previous.error);
    return previous.data;
  }
  if (previous?.leaseUntil > Date.now()) throw new HttpError(409, options.busy);
  const claim = JSON.stringify({
    leaseUntil: Date.now() + 3 * 60000,
    owner: crypto.randomUUID(),
  });
  const acquired = row
    ? await db
        .prepare(
          'UPDATE finance_state SET setting_value=? WHERE tenant=? AND setting_key=? AND setting_value=?',
        )
        .bind(claim, company, key, row.setting_value)
        .run()
    : await db
        .prepare(
          'INSERT INTO finance_state(tenant,setting_key,setting_value) VALUES(?,?,?) ON CONFLICT DO NOTHING',
        )
        .bind(company, key, claim)
        .run();
  if (acquired.meta.changes !== 1) throw new HttpError(409, options.busy);
  try {
    const data = await read();
    const saved = await db
      .prepare(
        'UPDATE finance_state SET setting_value=?,updated_at=CURRENT_TIMESTAMP WHERE tenant=? AND setting_key=? AND setting_value=?',
      )
      .bind(
        JSON.stringify({
          data,
          revision,
          savedAt: Date.now(),
          expiresAt: Date.now() + ttl(data),
        }),
        company,
        key,
        claim,
      )
      .run();
    if (saved.meta.changes !== 1) throw Error('Cache ownership changed');
    return data;
  } catch (error) {
    const message = options.safe(error);
    await db
      .prepare(
        'UPDATE finance_state SET setting_value=?,updated_at=CURRENT_TIMESTAMP WHERE tenant=? AND setting_key=? AND setting_value=?',
      )
      .bind(
        JSON.stringify({
          error: message,
          revision,
          expiresAt: Date.now() + 30000,
        }),
        company,
        key,
        claim,
      )
      .run();
    throw new HttpError(409, message);
  }
}
const performanceCache: ReadCache = {
  prefix: 'performance:v2:',
  busy: 'Performance-tallene hentes allerede. Prøv igen om lidt.',
  safe: safeError,
};
const cached = <T>(
  env: PlatformEnv,
  company: string,
  scope: unknown[],
  context: unknown[],
  read: () => Promise<T>,
  ttl?: (data: T) => number,
  force = false,
) =>
  cachedRead(env, company, performanceCache, scope, context, read, ttl, force);

export async function readPerformanceFinance(
  credentials: Record<string, string>,
  year: number,
  start: string,
  today = danishDate(),
): Promise<PerformanceFinance> {
  const tokenResponse = await fetch(
    'https://authz.dinero.dk/dineroapi/oauth/token',
    {
      method: 'POST',
      redirect: 'manual',
      signal: AbortSignal.timeout(15000),
      headers: {
        Authorization: `Basic ${btoa(credentials.clientId + ':' + credentials.clientSecret)}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        grant_type: 'password',
        scope: 'read write',
        username: credentials.apiKey,
        password: credentials.apiKey,
      }),
    },
  );
  if (!tokenResponse.ok) throw Error('Dinero-adgangen kunne ikke fornyes.');
  const token = (await tokenResponse.json()) as { access_token?: string };
  if (!token.access_token) throw Error('Dinero-adgangen kunne ikke fornyes.');
  const read = async (path: string, version = 'v1'): Promise<any> => {
    const response = await fetch(
      `https://api.dinero.dk/${version}/${encodeURIComponent(credentials.organizationId)}/${path}`,
      {
        method: 'GET',
        redirect: 'manual',
        cache: 'no-store',
        signal: AbortSignal.timeout(20000),
        headers: {
          Authorization: `Bearer ${token.access_token}`,
          Accept: 'application/json',
        },
      },
    );
    if (!response.ok)
      throw Error(
        `Dinero-regnskabstal kunne ikke hentes (HTTP ${response.status}). Prøv igen senere.`,
      );
    return response.json();
  };
  const years = await read('accountingyears');
  if (
    !Array.isArray(years) ||
    years.some(
      (y) =>
        !validDate(y.FromDate) || !validDate(y.ToDate) || y.FromDate > y.ToDate,
    )
  )
    throw Error('Dinero returnerede ugyldige regnskabsår.');
  const ranges = years.map((y) => ({
    from: y.FromDate as string,
    to: y.ToDate as string,
  }));
  const accounts = await read('accounts/entry?fields=AccountNumber,Category');
  if (
    !Array.isArray(accounts) ||
    accounts.some(
      (a) =>
        !Number.isInteger(a.AccountNumber) || typeof a.Category !== 'string',
    ) ||
    new Set(accounts.map((a) => a.AccountNumber)).size !== accounts.length
  )
    throw Error('Dinero returnerede en ugyldig kontoplan.');
  const categories = Object.fromEntries(
    accounts.map((a) => [a.AccountNumber, a.Category]),
  );
  const entries: ReturnType<typeof parsePerformanceEntries> = [];
  for (const selected of [year - 1, year]) {
    const from = start > `${selected}-01-01` ? start : `${selected}-01-01`,
      to = today < `${selected}-12-31` ? today : `${selected}-12-31`;
    if (from > to || !ranges.some((r) => r.from <= to && r.to >= from))
      continue;
    const rows = parsePerformanceEntries(
      await read(
        'entries?' +
          new URLSearchParams({
            fromDate: from,
            toDate: to,
            includePrimo: 'false',
          }),
      ),
    );
    if (rows.some((e) => e.date < from || e.date > to))
      throw Error(
        'Dinero returnerede posteringer uden for den valgte periode.',
      );
    entries.push(...rows);
  }
  const contacts = new Map<string, string>();
  if (entries.some((e) => e.contact)) {
    // v2 includes deleted contacts too: historical supplier names must survive deletion.
    let total: number | null = null;
    for (let page = 0; ; page++) {
      if (page >= 100)
        throw Error('Dinero-kontaktlisten er for stor til én hentning.');
      const payload = await read(
        'contacts?' +
          new URLSearchParams({
            fields: 'ContactGuid,Name',
            page: String(page),
            pageSize: '1000',
            deletedOnly: 'false',
          }),
        'v2',
      );
      const p = payload.Pagination,
        count = p?.ResultWithoutFilter,
        rows = payload.Collection ?? (count === 0 ? [] : null);
      if (
        !Number.isSafeInteger(count) ||
        count < 0 ||
        p.Page !== page ||
        p.PageSize !== 1000 ||
        !Array.isArray(rows) ||
        (total !== null && total !== count)
      )
        throw Error('Dinero returnerede en ufuldstændig leverandørliste.');
      total = count;
      for (const row of rows) {
        if (
          typeof row.ContactGuid !== 'string' ||
          !/^[\da-f]{8}(-[\da-f]{4}){3}-[\da-f]{12}$/i.test(row.ContactGuid) ||
          typeof row.Name !== 'string' ||
          !row.Name.trim() ||
          contacts.has(row.ContactGuid.toLowerCase())
        )
          throw Error('Dinero returnerede ugyldige leverandøroplysninger.');
        contacts.set(row.ContactGuid.toLowerCase(), row.Name.trim());
      }
      if ((page + 1) * 1000 >= count) break;
      if (rows.length !== 1000)
        throw Error('Dinero returnerede en ufuldstændig leverandørliste.');
    }
  }
  return {
    year,
    startDate: start,
    checkedAt: new Date().toISOString(),
    currency: 'DKK',
    ...aggregateFinance(
      entries,
      categories,
      ranges,
      year,
      today,
      start,
      contacts,
    ),
  };
}

export async function readPerformanceShop(
  env: PlatformEnv,
  company: string,
  shop: string,
  year: number,
  start: string,
): Promise<PerformanceShop> {
  const access = await shopAccess(env, company, shop);
  const metadata = await orderQuery<{ shop: { ianaTimezone: string } }>(
    access,
    'query PerformanceShop { shop { ianaTimezone } }',
    {},
  );
  const timezone = metadata.shop?.ianaTimezone;
  if (typeof timezone !== 'string')
    throw Error('Shopify returnerede ikke butikkens tidszone.');
  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
  const from = start > `${year - 1}-01-01` ? start : `${year - 1}-01-01`,
    to = today < `${year}-12-31` ? today : `${year}-12-31`;
  const metric = async (
    source: 'sessions' | 'sales',
    name: 'sessions' | 'orders',
  ): Promise<PerformanceMetric> => {
    if (from > to)
      return {
        months: [],
        error:
          'Perioden ligger før den valgte historikstart. Udvid historikken under Indstillinger.',
      };
    try {
      const data = await orderQuery<{ shopifyqlQuery: unknown }>(
        access,
        'query PerformanceMetric($query: String!) { shopifyqlQuery(query: $query) { tableData { columns { name } rows } parseErrors } }',
        {
          query: `FROM ${source} SHOW ${name} TIMESERIES month SINCE ${from} UNTIL ${to} ORDER BY month ASC`,
        },
        reportAccess,
      );
      return parseShopifyMetric(data.shopifyqlQuery, name, year, today, start);
    } catch (error) {
      return { months: [], error: safeError(error) };
    }
  };
  // Separate responses: lack of traffic access must not hide a successful orders report.
  const [visits, orders] = await Promise.all([
    metric('sessions', 'sessions'),
    metric('sales', 'orders'),
  ]);
  return {
    year,
    startDate: start,
    checkedAt: new Date().toISOString(),
    timezone,
    visits,
    orders,
  };
}

export async function readPerformanceDaily(
  env: PlatformEnv,
  company: string,
  shop: string,
  year: number,
  month: number,
  start: string,
): Promise<PerformanceDaily> {
  const access = await shopAccess(env, company, shop);
  const metadata = await orderQuery<{
    shop: { ianaTimezone: string; currencyCode: string };
  }>(
    access,
    'query PerformanceDailyShop { shop { ianaTimezone currencyCode } }',
    {},
  );
  const timezone = metadata.shop?.ianaTimezone,
    currency = metadata.shop?.currencyCode;
  if (typeof timezone !== 'string')
    throw Error('Shopify returnerede ikke butikkens tidszone.');
  // Sales are in the store's currency; without it the amounts are not shown rather than shown as DKK.
  if (!/^[A-Z]{3}$/.test(String(currency)))
    throw Error('Shopify oplyste ikke butikkens valuta, så salget vises ikke.');
  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
  const sales = async (y: number) => {
    const range = monthRange(y, month),
      from = start > range.from ? start : range.from,
      to = today < range.to ? today : range.to;
    if (from > to) return new Map<string, number>();
    const data = await orderQuery<{ shopifyqlQuery: unknown }>(
      access,
      'query PerformanceDaily($query: String!) { shopifyqlQuery(query: $query) { tableData { columns { name } rows } parseErrors } }',
      {
        query: `FROM sales SHOW total_sales, taxes TIMESERIES day SINCE ${from} UNTIL ${to} ORDER BY day ASC`,
      },
      reportAccess,
    );
    return parseDailySales(data.shopifyqlQuery, from, to);
  };
  const [current, previous] = await Promise.all([sales(year), sales(year - 1)]);
  return {
    year,
    month,
    startDate: start,
    checkedAt: new Date().toISOString(),
    timezone,
    currency: currency as string,
    days: dailyComparison(year, month, today, start, current, previous),
  };
}

export async function handlePerformance(
  request: Request,
  env: PlatformEnv,
  actor: Actor,
  company: string,
  shop: string,
  path: string,
) {
  if (request.method !== 'GET')
    throw new HttpError(405, 'Performance understøtter kun læsning.');
  if (
    ![
      '/performance/finance',
      '/performance/shop',
      '/performance/daily',
    ].includes(path)
  )
    throw new HttpError(404, 'Rapporten findes ikke.');
  const rawYear = new URL(request.url).searchParams.get('year'),
    current = Number(danishDate().slice(0, 4));
  if (
    !rawYear ||
    !/^\d{4}$/.test(rawYear) ||
    Number(rawYear) < current - 9 ||
    Number(rawYear) > current
  )
    throw new HttpError(400, 'Vælg et af de seneste ti kalenderår.');
  const year = Number(rawYear),
    force = new URL(request.url).searchParams.get('refresh') === '1';
  const rawMonth = new URL(request.url).searchParams.get('month'),
    month = Number(rawMonth);
  if (
    path === '/performance/daily' &&
    (!rawMonth ||
      !/^\d{1,2}$/.test(rawMonth) ||
      month < 1 ||
      month > 12 ||
      `${year}-${String(month).padStart(2, '0')}` > danishDate().slice(0, 7))
  )
    throw new HttpError(400, 'Vælg en måned, der er begyndt.');
  await requireCompany(
    env.PLATFORM_DB,
    actor,
    company,
    path === '/performance/finance',
  );
  if (shop !== 'none')
    await requireWebshop(env.PLATFORM_DB, actor, company, shop);
  if (path === '/performance/finance') {
    const saved = await env.PLATFORM_DB.prepare(
      'SELECT organization_id,credentials_encrypted FROM accounting_connections WHERE company_id=?',
    )
      .bind(company)
      .first<{ organization_id: string; credentials_encrypted: string }>();
    if (!saved)
      throw new HttpError(
        409,
        'Forbind regnskabsprogrammet under Integrationer for at se omsætning og omkostninger.',
      );
    const start = await dataStartDate(env, company, 'none', 'dinero');
    return reply(
      await cached(
        env,
        company,
        ['dinero', saved.organization_id, year],
        [saved.credentials_encrypted, start, danishDate()],
        async () => {
          const credentials = await unseal(
            env,
            [company, 'dinero', saved.organization_id],
            saved.credentials_encrypted,
          );
          // The server's saved organization is authoritative, never the request or decrypted payload alone.
          return readPerformanceFinance(
            { ...credentials, organizationId: saved.organization_id },
            year,
            start,
          );
        },
        undefined,
        force,
      ),
    );
  }
  if (shop === 'none')
    throw new HttpError(
      409,
      'Vælg en webshop for at se salg, besøg og ordrer.',
    );
  const saved = await env.PLATFORM_DB.prepare(
    "SELECT shop_domain,credentials_encrypted FROM webshop_connections WHERE company_id=? AND webshop_id=? AND provider='shopify'",
  )
    .bind(company, shop)
    .first<{ shop_domain: string; credentials_encrypted: string }>();
  if (!saved)
    throw new HttpError(
      409,
      'Forbind webshoppen under Integrationer for at se salg, besøg og ordrer.',
    );
  const start = await dataStartDate(env, company, shop, 'shopify');
  if (path === '/performance/daily')
    return reply(
      await cached(
        env,
        company,
        ['shopify-daily', shop, year, month],
        [saved.shop_domain, saved.credentials_encrypted, start, danishDate()],
        () => readPerformanceDaily(env, company, shop, year, month, start),
        undefined,
        force,
      ),
    );
  return reply(
    await cached(
      env,
      company,
      ['shopify', shop, year],
      [saved.shop_domain, saved.credentials_encrypted, start, danishDate()],
      () => readPerformanceShop(env, company, shop, year, start),
      (data) => (data.visits.error || data.orders.error ? 30000 : 15 * 60000),
      force,
    ),
  );
}
