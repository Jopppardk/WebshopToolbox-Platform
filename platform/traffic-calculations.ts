// Trafikkilder: parses Shopify's ShopifyQL tables and merges visitors (sessions) and orders (sales) per source.
// Pure functions, so the attribution rules are tested without Shopify.
import {
  channelKey,
  channelLabel,
  deviceLabel,
  type TrafficRow,
  type TrafficTable,
  type TrafficTotals,
} from './tier1/src/lib/traffic';

export type ParsedRow = { dims: string[]; values: Record<string, number> };
const moneyMetrics = new Set(['total_sales', 'taxes']);

/** Fails closed: a parse error, a missing column or a number that is not a number is never read as 0. */
export function parseTrafficTable(
  payload: unknown,
  dims: string[],
  metrics: string[],
): ParsedRow[] {
  const result = payload as {
    parseErrors?: unknown[];
    tableData?: {
      columns?: Array<{ name: string }>;
      rows?: Array<Record<string, unknown> | unknown[]>;
    };
  } | null;
  const columns = result?.tableData?.columns?.map((c) => c?.name);
  if (
    !Array.isArray(result?.parseErrors) ||
    result.parseErrors.length ||
    !Array.isArray(result.tableData?.rows) ||
    !Array.isArray(columns) ||
    ![...dims, ...metrics].every((name) => columns.includes(name))
  )
    throw Error(
      'Shopify kunne ikke levere rapporten over trafikkilder. Kontrollér rapportadgang under Integrationer.',
    );
  return result.tableData.rows.map((raw) => {
    // ShopifyQL rows come as objects keyed by column; arrays in column order are accepted too.
    const cell = (name: string) =>
      Array.isArray(raw)
        ? raw[columns.indexOf(name)]
        : (raw as Record<string, unknown>)?.[name];
    const values: Record<string, number> = {};
    for (const metric of metrics) {
      const value = cell(metric);
      const text = typeof value === 'number' ? String(value) : value;
      const number =
        typeof text !== 'string'
          ? NaN
          : moneyMetrics.has(metric)
            ? /^-?\d+(\.\d+)?$/.test(text)
              ? Math.round(Number(text) * 100)
              : NaN
            : /^\d+$/.test(text)
              ? Number(text)
              : NaN;
      if (!Number.isSafeInteger(number))
        throw Error('Shopify returnerede ugyldige tal for trafikkilderne.');
      values[metric] = number;
    }
    return {
      dims: dims.map((name) => {
        const value = cell(name);
        if (value !== null && value !== undefined && typeof value !== 'string')
          throw Error('Shopify returnerede ugyldige trafikkilder.');
        return (value ?? '').trim();
      }),
      values,
    };
  });
}

export type Side = { rows: ParsedRow[]; complete: boolean } | { error: string };
export type Describe = (dims: string[]) => {
  key: string;
  label: string;
  detail?: string;
};

const add = (a: number | null, b: number) => (a === null ? b : a + b);
/**
 * One row per source, with visitors from the sessions report and orders from the sales report.
 * A source missing on one side is 0 there when that side listed every source, otherwise unknown (null).
 */
export function mergeTraffic(
  sessions: Side,
  orders: Side | null,
  describe: Describe,
  totals: TrafficTotals,
): TrafficTable {
  const rows = new Map<string, TrafficRow>();
  const row = (dims: string[]) => {
    const d = describe(dims);
    let found = rows.get(d.key);
    if (!found) {
      found = {
        key: d.key,
        label: d.label,
        ...(d.detail ? { detail: d.detail } : {}),
        sessions: null,
        checkouts: null,
        orders: null,
        sales: null,
      };
      rows.set(d.key, found);
    } else if (
      d.detail &&
      (!found.detail || found.detail === 'Direkte / ukendt')
    )
      found.detail = d.detail;
    return found;
  };
  if ('rows' in sessions)
    for (const r of sessions.rows) {
      const target = row(r.dims);
      target.sessions = add(target.sessions, r.values.sessions);
      target.checkouts = add(
        target.checkouts,
        r.values.sessions_that_completed_checkout,
      );
    }
  if (orders && 'rows' in orders)
    for (const r of orders.rows) {
      const target = row(r.dims);
      target.orders = add(target.orders, r.values.orders);
      target.sales = add(target.sales, r.values.total_sales - r.values.taxes);
    }
  for (const target of rows.values()) {
    if ('rows' in sessions && sessions.complete) {
      target.sessions ??= 0;
      target.checkouts ??= 0;
    }
    if (orders && 'rows' in orders && orders.complete) {
      target.orders ??= 0;
      target.sales ??= 0;
    }
  }
  const list = [...rows.values()].sort(
    (a, b) =>
      (b.sessions ?? -1) - (a.sessions ?? -1) ||
      (b.orders ?? -1) - (a.orders ?? -1) ||
      a.label.localeCompare(b.label, 'da'),
  );
  const rest = (
    total: number | null,
    metric: 'sessions' | 'checkouts' | 'orders' | 'sales',
    side: Side | null,
  ) =>
    side && 'rows' in side && total !== null
      ? total - list.reduce((s, r) => s + (r[metric] ?? 0), 0)
      : null;
  const other: TrafficRow = {
    key: '(other)',
    label: 'Øvrige',
    sessions: rest(totals.sessions, 'sessions', sessions),
    checkouts: rest(totals.checkouts, 'checkouts', sessions),
    orders: rest(totals.orders, 'orders', orders),
    sales: rest(totals.sales, 'sales', orders),
  };
  // A return on a source Shopify left out has sales but no visits or orders; the row stays.
  const remaining =
    (other.sessions ?? 0) > 0 ||
    (other.orders ?? 0) > 0 ||
    (other.sales ?? 0) !== 0;
  return {
    rows: list,
    other: remaining
      ? {
          ...other,
          sessions:
            other.sessions === null ? null : Math.max(other.sessions, 0),
          checkouts:
            other.checkouts === null ? null : Math.max(other.checkouts, 0),
          orders: other.orders === null ? null : Math.max(other.orders, 0),
        }
      : null,
    ...('error' in sessions ? { sessionsError: sessions.error } : {}),
    ...(orders && 'error' in orders ? { ordersError: orders.error } : {}),
  };
}

const none = (value: string) => !value.trim();
export const describeChannel: Describe = ([source]) => {
  const key = channelKey(source);
  return { key, label: channelLabel(key) };
};
export const describeReferrer: Describe = ([source, name]) => ({
  key: none(name) ? '(none)' : name.toLowerCase(),
  label: none(name) ? 'Ingen henviser' : name,
  detail: channelLabel(channelKey(source)),
});
export const describeCampaign: Describe = ([source, medium, campaign]) =>
  [source, medium, campaign].every(none)
    ? { key: '(none)', label: 'Uden UTM-parametre' }
    : {
        key: [source, medium, campaign].join('|').toLowerCase(),
        label: campaign || '(intet kampagnenavn)',
        detail: [source || '(ingen kilde)', medium || '(intet medie)'].join(
          ' / ',
        ),
      };
export const describeCountry: Describe = ([code]) =>
  /^[A-Za-z]{2}$/.test(code)
    ? { key: code.toUpperCase(), label: code.toUpperCase() }
    : { key: '(none)', label: 'Ukendt land' };
export const describeLandingPage: Describe = ([path]) =>
  none(path)
    ? { key: '(none)', label: 'Ukendt side' }
    : { key: path, label: path };
export const describeDevice: Describe = ([type]) => {
  const key = type.toLowerCase();
  return { key: key || '(none)', label: deviceLabel(key) };
};

/** The last `days` days up to and including today, cut at the saved history start. */
export function trafficRange(days: number, today: string, start: string) {
  const from = new Date(Date.parse(today + 'T00:00:00Z') - (days - 1) * 864e5)
    .toISOString()
    .slice(0, 10);
  return {
    from: start > from ? start : from,
    to: today,
    limitedByHistory: start > from,
  };
}
