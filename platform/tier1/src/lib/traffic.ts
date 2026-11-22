// Trafikkilder: where a webshop's visitors (Shopify sessions) and orders (Shopify sales) come from.
// Shared by the Worker and the customer portal, so the labels and the merge of sources are the same in both.

export const trafficPeriods = [7, 30, 90, 365] as const;
export type TrafficPeriod = (typeof trafficPeriods)[number];

/** One source in a breakdown. Numbers are null when the report behind them failed or does not cover the source. */
export type TrafficRow = {
  key: string;
  label: string;
  /** Extra context, such as the channel of a referrer or "source / medium" of a campaign. */
  detail?: string;
  sessions: number | null;
  /** Sessions that completed checkout; the conversion rate is checkouts / sessions. */
  checkouts: number | null;
  orders: number | null;
  /** Sales excl. VAT in the store's currency, minor units (after discounts and returns). */
  sales: number | null;
};
export type TrafficTable = {
  rows: TrafficRow[];
  /** What the shown rows do not cover (Shopify returns the largest sources only). */
  other: TrafficRow | null;
  sessionsError?: string;
  ordersError?: string;
};
export type TrafficTotals = {
  sessions: number | null;
  checkouts: number | null;
  orders: number | null;
  sales: number | null;
  sessionsError?: string;
  ordersError?: string;
};
export type TrafficReport = {
  period: TrafficPeriod;
  from: string;
  to: string;
  /** True when the saved history start cuts the period short. */
  limitedByHistory: boolean;
  checkedAt: string;
  startDate: string;
  timezone: string;
  currency: string;
  totals: TrafficTotals;
  channels: TrafficTable;
  referrers: TrafficTable;
  campaigns: TrafficTable;
  countries: TrafficTable;
  landingPages: TrafficTable;
  devices: TrafficTable;
};

const channelNames: Record<string, string> = {
  direct: 'Direkte / ukendt',
  search: 'Søgning',
  social: 'Sociale medier',
  email: 'E-mail',
  paid: 'Betalt annoncering',
  referral: 'Henvisning fra andre sider',
};
/** Shopify's sessions say "direct" or "unknown" where an order has no source at all; they are one channel here. */
export const channelKey = (source: string) => {
  const value = source.trim().toLowerCase();
  return !value || value === 'unknown' ? 'direct' : value;
};
export const channelLabel = (key: string) =>
  channelNames[key] ||
  (key ? key[0].toLocaleUpperCase('da') + key.slice(1) : 'Ukendt');

const deviceNames: Record<string, string> = {
  mobile: 'Mobil',
  desktop: 'Computer',
  tablet: 'Tablet',
  other: 'Andet',
};
export const deviceLabel = (key: string) =>
  deviceNames[key] || (key ? key : 'Ukendt');

export const conversionRate = (row: {
  sessions: number | null;
  checkouts: number | null;
}) =>
  row.sessions && row.checkouts !== null ? row.checkouts / row.sessions : null;
