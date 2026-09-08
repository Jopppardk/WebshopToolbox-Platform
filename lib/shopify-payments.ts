import { danishDate, defaultHistory, historyWindow, type HistoryPolicy } from './history-policy';
export type BalancePayment = {
  id: string;
  type: string;
  test: boolean;
  transactionDate: string;
  amount: { amount: string; currencyCode: string };
  fee: { amount: string; currencyCode: string };
  net: { amount: string; currencyCode: string };
  associatedOrder: { id: string; name: string } | null;
  associatedPayout: { id: string | null; status: string } | null;
  sourceOrderTransactionId: string | null;
};

export type PaymentView = BalancePayment & { bookingStatus: string };
export type PaymentSummary = { currency: string; count: number; gross: number; fees: number; net: number };

// Shopify money is a decimal string. Store exact minor units, never float products.
export function minorUnits(amount: string, currency: string) {
  const digits = new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions().maximumFractionDigits!;
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(amount);
  if (!match || /[1-9]/.test((match[3] || '').slice(digits))) throw new Error('Ugyldigt beløb fra Shopify Payments');
  const value = Number(match[2]) * 10 ** digits + Number((match[3] || '').padEnd(digits, '0').slice(0, digits));
  if (!Number.isSafeInteger(value)) throw new Error('Beløbet er for stort');
  return match[1] ? -value : value;
}

export function paymentPeriod(from: unknown, to: unknown, policy: HistoryPolicy = defaultHistory) {
  if (typeof from !== 'string' || typeof to !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) throw new Error('Vælg en gyldig fra- og til-dato');
  const start = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  // Compare calendar dates in Denmark: UTC midnight is still in the future
  // during the first one or two hours of the Danish day.
  const now = new Date();
  if (!Number.isFinite(+start) || !Number.isFinite(+end) || start.toISOString().slice(0, 10) !== from || end.toISOString().slice(0, 10) !== to || start > end || to > danishDate(now)) throw new Error('Vælg en gyldig periode frem til i dag');
  // Calendar dates are interpreted in Denmark, including daylight saving time.
  const midnight = (date: Date) => {
    const hour = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Copenhagen', hour: '2-digit', hourCycle: 'h23' }).format(date));
    return new Date(+date - hour * 3600000).toISOString();
  };
  end.setUTCDate(end.getUTCDate() + 1);
  const cutoff = historyWindow(policy, now).cutoff;
  return { start: midnight(start) > cutoff ? midnight(start) : cutoff, end: midnight(end) };
}

export const paymentsQuery = `query Payments($after: String, $query: String!) {
  shopifyPaymentsAccount {
    balanceTransactions(first: 50, after: $after, query: $query, sortKey: PROCESSED_AT, reverse: true) {
      nodes { id type test transactionDate amount { amount currencyCode } fee { amount currencyCode } net { amount currencyCode } associatedOrder { id name } associatedPayout { id status } sourceOrderTransactionId }
      pageInfo { hasNextPage endCursor }
    }
  }
}`;
