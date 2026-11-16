// Kursdifferencer on Shopify Payments payouts. A foreign order (e.g. paid in SEK) is booked in DKK at Shopify's
// rate when the order was placed, but Shopify Payments converts the money at its own rate when the payment is
// captured. The payout takes the realized DKK amount off the clearing account, so the difference would stay there.
// With an account for exchange differences chosen, the payout voucher books each order's difference from the
// clearing account to that account (a gain or a loss), so the clearing account ends at zero for the order.
//
// Only charges are corrected: a refund is booked at the amount Shopify Payments refunds in DKK, so it already
// matches the payout.
import { minorUnits } from './money';
import type { PayoutTransaction } from './payout-source';

type Money = { amount?: string; currencyCode?: string } | null | undefined;
export type OrderTransactionDetail = {
  id: string;
  amountSet?: { shopMoney?: Money; presentmentMoney?: Money } | null;
  order?: {
    id?: string;
    name?: string;
    presentmentCurrencyCode?: string;
    totalPriceSet?: { shopMoney?: Money; presentmentMoney?: Money } | null;
  } | null;
};
export type ExchangeDifference = {
  orderId: string;
  orderName: string;
  /** DKK in øre that the sale put on the clearing account for these payments (at the order's rate). */
  booked: number;
  /** DKK in øre that Shopify Payments paid out for them. */
  realized: number;
  /** realized − booked: positive is a gain, negative a loss. */
  difference: number;
};

// A difference larger than this is not a normal exchange rate movement between order and capture, so it is left
// on the clearing account for a manual look rather than booked as an exchange difference.
const plausible = (booked: number, difference: number) =>
  Math.abs(difference) <= Math.max(100, Math.round(Math.abs(booked) * 0.05));

const minor = (money: Money, currency: string) => {
  if (
    !money ||
    money.currencyCode !== currency ||
    typeof money.amount !== 'string'
  )
    return null;
  try {
    return minorUnits(money.amount, currency);
  } catch {
    return null;
  }
};

/**
 * Per order, the difference between the DKK the sale booked for the payout's charges and the DKK Shopify Payments
 * paid out. Orders in DKK, transactions without a known order transaction, and implausible differences are left out.
 * `fromReceivables` names the order transactions (gid) of orders on payment terms: their sale is on Debitorer, and the
 * payment voucher already moved the payment's own DKK amount to the clearing account, so there is nothing to correct.
 */
export function exchangeDifferences(
  transactions: PayoutTransaction[],
  sources: Map<string, string>,
  details: Map<string, OrderTransactionDetail>,
  shopCurrency = 'DKK',
  fromReceivables: Set<string> = new Set(),
): ExchangeDifference[] {
  const orders = new Map<
    string,
    {
      orderId: string;
      orderName: string;
      paid: number;
      orderShop: number;
      orderForeign: number;
      realized: number;
    }
  >();
  for (const t of transactions) {
    if (t.type !== 'CHARGE' || t.amount.currencyCode !== shopCurrency) continue;
    const source = sources.get(t.id);
    const gid = source ? 'gid://shopify/OrderTransaction/' + source : '';
    const detail =
      gid && !fromReceivables.has(gid) ? details.get(gid) : undefined;
    const order = detail?.order;
    const foreign = order?.presentmentCurrencyCode;
    if (
      !order?.id ||
      !order.name ||
      !foreign ||
      !/^[A-Z]{3}$/.test(foreign) ||
      foreign === shopCurrency ||
      (t.orderId && order.id.split('/').pop() !== t.orderId)
    )
      continue;
    const paid = minor(detail!.amountSet?.presentmentMoney, foreign),
      orderShop = minor(order.totalPriceSet?.shopMoney, shopCurrency),
      orderForeign = minor(order.totalPriceSet?.presentmentMoney, foreign);
    if (paid === null || !orderShop || !orderForeign || paid <= 0) continue;
    const realized = minorUnits(t.amount.amount, shopCurrency);
    if (realized <= 0) continue;
    const known = orders.get(order.id) || {
      orderId: order.id,
      orderName: order.name,
      paid: 0,
      orderShop,
      orderForeign,
      realized: 0,
    };
    known.paid += paid;
    known.realized += realized;
    orders.set(order.id, known);
  }
  return (
    [...orders.values()]
      // The sale is booked at the order's own rate: its DKK total over its total in the customer's currency. The
      // order's payments in this payout are converted together and rounded once, so payments that add up to the
      // whole order give exactly the booked sale.
      .map((x) => {
        const booked = Math.round((x.paid * x.orderShop) / x.orderForeign);
        return {
          orderId: x.orderId,
          orderName: x.orderName,
          booked,
          realized: x.realized,
          difference: x.realized - booked,
        };
      })
      .filter(
        (x) =>
          Number.isSafeInteger(x.booked) &&
          x.difference !== 0 &&
          plausible(x.booked, x.difference),
      )
      .sort((a, b) => a.orderName.localeCompare(b.orderName, 'da'))
  );
}

/** Reads the order transactions behind the payout's charges (amount in the customer's currency and the order's totals). */
export async function readOrderTransactions(
  ids: string[],
  query: (
    gids: string[],
  ) => Promise<{ nodes?: Array<OrderTransactionDetail | null> }>,
) {
  const result = new Map<string, OrderTransactionDetail>();
  const unique = [...new Set(ids)].filter((id) => /^\d{1,30}$/.test(id));
  for (let offset = 0; offset < unique.length; offset += 100) {
    const data = await query(
      unique
        .slice(offset, offset + 100)
        .map((id) => 'gid://shopify/OrderTransaction/' + id),
    );
    if (!Array.isArray(data?.nodes))
      throw new Error('Shopify kunne ikke hente ordrebetalingerne.');
    for (const node of data.nodes) if (node?.id) result.set(node.id, node);
  }
  return result;
}

export const orderTransactionsQuery =
  'query ToolboxPayoutOrderTransactions($ids:[ID!]!){nodes(ids:$ids){... on OrderTransaction{id amountSet{shopMoney{amount currencyCode} presentmentMoney{amount currencyCode}} order{id name presentmentCurrencyCode totalPriceSet{shopMoney{amount currencyCode} presentmentMoney{amount currencyCode}}}}}}';

// Up to this many orders get a line each in Dinero; beyond it, one line holds the total, so the voucher stays small.
const maxLines = 40;

/** The voucher lines: from the clearing account to the account for exchange differences (negative for a loss). */
export function exchangeDifferenceMovements(
  differences: ExchangeDifference[],
  clearing: number,
  account: number,
) {
  const total = differences.reduce((sum, x) => sum + x.difference, 0);
  if (differences.length > maxLines)
    return total
      ? [
          {
            label: `Kursdifferencer, ${differences.length} ordrer`,
            amount: total,
            account: clearing,
            balancing: account,
          },
        ]
      : [];
  return differences.map((x) => ({
    label: `Kursdifference, ordre: ${x.orderName}`,
    amount: x.difference,
    account: clearing,
    balancing: account,
  }));
}
