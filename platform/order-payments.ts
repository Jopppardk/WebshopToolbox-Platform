// Orders sold on payment terms (B2B invoices in Shopify: "Betalingsbetingelser", e.g. net 30 days). No payout settles
// them, so when a receivables account (Debitorer) is chosen, the sale is booked on it instead of the clearing account,
// and every payment Shopify records on the order is booked from Debitorer: to the bank when it is a manual payment
// (e.g. a bank transfer marked as paid), otherwise to the clearing account, which the gateway's payout clears.
// Read-only towards Shopify: payments are stored in order_payments and booked by the order_payment booking kind.
import { rejectTransfer, type Expected, type Voucher } from './dinero-sale';
import { orderQuery, shopAccess, type Access } from './invoice-source';
import { minorUnits } from './money';
import { HttpError, type PlatformEnv } from './types';

export type PaymentTerms = {
  name: string;
  type: string;
  dueInDays: number | null;
  /** The first open payment's due date (ISO), or null when Shopify has none yet (e.g. due on fulfilment). */
  dueAt: string | null;
};
/** The sale of an order on payment terms, as kept on the sale's receipt. */
export type Receivable = {
  account: string;
  terms: string;
  dueAt: string | null;
};
export type OrderPayment = {
  id: string;
  orderId: string;
  orderName: string;
  processedAt: string;
  currency: string;
  /** The payment in minor units of the shop currency. */
  amount: number;
  gateway: string;
  name: string;
  /** A manual payment method (bank transfer, cash on delivery …): the money is in the bank, not with a gateway. */
  manual: boolean;
  /** Why the payment cannot be booked automatically (it is still listed). */
  problem: string | null;
};

// What Shopify answers, as far as it is read here (every field may be missing).
type RawSchedule = { dueAt?: unknown; completedAt?: unknown };
type RawTerms = {
  paymentTermsName?: unknown;
  translatedName?: unknown;
  paymentTermsType?: unknown;
  dueInDays?: unknown;
  paymentSchedules?: { nodes?: RawSchedule[] };
};
type RawTransaction = {
  id?: unknown;
  kind?: unknown;
  status?: unknown;
  test?: unknown;
  gateway?: unknown;
  formattedGateway?: unknown;
  manualPaymentGateway?: unknown;
  processedAt?: unknown;
  createdAt?: unknown;
  amountSet?: { shopMoney?: { amount?: unknown; currencyCode?: unknown } };
};
type RawOrder = {
  id?: unknown;
  name?: unknown;
  paymentTerms?: RawTerms | null;
  transactions?: RawTransaction[];
};
const termsQuery = `query ToolboxPaymentTerms($id:ID!){order(id:$id){id paymentTerms{paymentTermsName translatedName paymentTermsType dueInDays paymentSchedules(first:10){nodes{dueAt completedAt}}}}}`;
const paymentsQuery = `query ToolboxOrderPayments($id:ID!){order(id:$id){id name transactions(first:100){id kind status test gateway formattedGateway manualPaymentGateway processedAt createdAt amountSet{shopMoney{amount currencyCode}}}}}`;
const scopeMissing =
  'Shopify-appen mangler adgangen read_payment_terms, så det kan ikke ses, om ordren er solgt på betalingsbetingelser. Giv appen read_payment_terms i Shopify, og forbind igen under Integrationer.';

/** The order's payment terms, null without any, or undefined when the Shopify app may not read them (read_payment_terms). */
export async function readPaymentTerms(
  access: Access,
  orderId: string,
): Promise<PaymentTerms | null | undefined> {
  if (!/^gid:\/\/shopify\/Order\/\d{1,30}$/.test(orderId))
    throw new HttpError(409, 'Ugyldigt ordre-ID.');
  let data: { order: RawOrder | null };
  try {
    data = await orderQuery<{ order: RawOrder | null }>(
      access,
      termsQuery,
      { id: orderId },
      'Shopify kunne ikke hente ordrens betalingsbetingelser.',
    );
  } catch (error) {
    if (error instanceof HttpError && /ACCESS_DENIED/.test(error.message))
      return undefined;
    throw error;
  }
  if (!data.order || data.order.id !== orderId)
    throw new HttpError(409, 'Ordren kunne ikke findes i Shopify.');
  return paymentTermsOf(data.order.paymentTerms);
}
export function paymentTermsOf(
  raw: RawTerms | null | undefined,
): PaymentTerms | null {
  if (!raw || typeof raw !== 'object') return null;
  const schedules = Array.isArray(raw.paymentSchedules?.nodes)
    ? raw.paymentSchedules.nodes
    : [];
  const due = (s: RawSchedule) =>
    typeof s?.dueAt === 'string' && Number.isFinite(Date.parse(s.dueAt))
      ? s.dueAt
      : '';
  const open = schedules.filter((s) => !s?.completedAt && due(s));
  const dueAt =
    (open.length ? open : schedules.filter(due))
      .map(due)
      .sort((a, b) => a.localeCompare(b))
      .at(0) || null;
  const text = (value: unknown) =>
    typeof value === 'string' ? value.trim().slice(0, 80) : '';
  return {
    name: text(raw.translatedName) || text(raw.paymentTermsName),
    type: text(raw.paymentTermsType) || 'UNKNOWN',
    dueInDays: Number.isSafeInteger(raw.dueInDays)
      ? (raw.dueInDays as number)
      : null,
    dueAt,
  };
}
/**
 * The accounts a sale is booked with: on payment terms and with a receivables account chosen, the receivables account
 * takes the clearing account's place. Without a receivables account nothing changes (and Shopify is not asked).
 */
export async function saleAccounts(
  access: Access,
  orderId: string,
  accounts: Record<string, string>,
): Promise<{
  accounts: Record<string, string>;
  receivable: Receivable | null;
}> {
  if (!accounts.receivables) return { accounts, receivable: null };
  const terms = await readPaymentTerms(access, orderId);
  if (terms === undefined) throw new HttpError(409, scopeMissing);
  if (!terms) return { accounts, receivable: null };
  return {
    accounts: { ...accounts, clearing: accounts.receivables },
    receivable: {
      account: accounts.receivables,
      terms: terms.name,
      dueAt: terms.dueAt,
    },
  };
}

/** One payment as booked, or the reason it cannot be; null for a transaction that is not a received payment. */
export function normalizePayment(
  order: RawOrder,
  t: RawTransaction,
): OrderPayment | null {
  if (
    !t ||
    !['SALE', 'CAPTURE'].includes(String(t.kind)) ||
    t.status !== 'SUCCESS' ||
    t.test
  )
    return null;
  const money = t.amountSet?.shopMoney,
    gateway = typeof t.gateway === 'string' ? t.gateway.slice(0, 80) : '';
  const base = {
    id: String(t.id),
    orderId: String(order.id),
    orderName: String(order.name),
    processedAt: String(t.processedAt || t.createdAt),
    currency: typeof money?.currencyCode === 'string' ? money.currencyCode : '',
    gateway,
    name:
      typeof t.formattedGateway === 'string' && t.formattedGateway.trim()
        ? t.formattedGateway.trim().slice(0, 80)
        : gateway,
    manual: t.manualPaymentGateway === true,
  };
  let amount = 0;
  try {
    amount = minorUnits(
      typeof money?.amount === 'string' ? money.amount : '',
      base.currency || 'DKK',
    );
  } catch {
    return { ...base, amount: 0, problem: 'Betalingen har et ugyldigt beløb.' };
  }
  const problem =
    amount <= 0
      ? 'Betalingen har et ugyldigt beløb.'
      : base.currency !== 'DKK'
        ? 'Betalinger i andre valutaer end DKK bogføres ikke automatisk.'
        : gateway === 'gift_card'
          ? 'Betaling med gavekort bogføres ikke automatisk.'
          : null;
  return { ...base, amount, problem };
}
/** All payments received on an order, oldest first. */
export async function readOrderPayments(access: Access, orderId: string) {
  if (!/^gid:\/\/shopify\/Order\/\d{1,30}$/.test(orderId))
    throw new HttpError(409, 'Ugyldigt ordre-ID.');
  const data = await orderQuery<{ order: RawOrder | null }>(
    access,
    paymentsQuery,
    { id: orderId },
    'Shopify kunne ikke hente ordrens betalinger.',
  );
  if (
    !data.order ||
    data.order.id !== orderId ||
    !Array.isArray(data.order.transactions)
  )
    throw new HttpError(409, 'Ordren kunne ikke findes i Shopify.');
  if (data.order.transactions.length >= 100)
    throw new HttpError(
      409,
      'Ordren har for mange betalinger til at blive læst automatisk.',
    );
  const order = data.order;
  return order
    .transactions!.map((t) => normalizePayment(order, t))
    .filter((p): p is OrderPayment => !!p)
    .sort(
      (a, b) =>
        a.processedAt.localeCompare(b.processedAt) || a.id.localeCompare(b.id),
    );
}

/** The sale of the order (alias `s`, column `s.order_id` or given) was booked on the receivables account here. */
export const receivableSaleSql = (order = 's.order_id') =>
  `EXISTS(SELECT 1 FROM production_receipts rs WHERE rs.company_id=s.company_id AND rs.webshop_id=s.webshop_id AND rs.provider='shopify' AND rs.module='orders' AND rs.external_id=${order} AND rs.phase IN ('draft','booking','booked') AND json_extract(rs.payload_json,'$.receivable.account') IS NOT NULL)`;

/**
 * Reads the payments of orders sold on payment terms whose payment status changed since they were last read, and
 * of orders not yet paid in full every 6 hours (a second instalment can leave the status at PARTIALLY_PAID).
 */
export async function syncOrderPayments(
  env: PlatformEnv,
  company: string,
  shop: string,
  limit = 10,
) {
  const db = env.PLATFORM_DB;
  const orders = (
    await db
      .prepare(`SELECT s.external_id,COALESCE(json_extract(s.payload_json,'$.displayFinancialStatus'),'') status FROM operation_snapshots s
 LEFT JOIN order_payment_checks c ON c.company_id=s.company_id AND c.webshop_id=s.webshop_id AND c.order_id=s.external_id
 WHERE s.company_id=? AND s.webshop_id=? AND s.module='orders' AND ${receivableSaleSql('s.external_id')}
 AND (c.order_id IS NULL OR c.financial_status<>COALESCE(json_extract(s.payload_json,'$.displayFinancialStatus'),'')
  OR (c.financial_status<>'PAID' AND c.checked_at<datetime('now','-6 hours')))
 ORDER BY (c.order_id IS NULL OR c.financial_status<>COALESCE(json_extract(s.payload_json,'$.displayFinancialStatus'),'')) DESC,c.checked_at,s.occurred_at DESC LIMIT ?`)
      .bind(company, shop, limit)
      .all<{ external_id: string; status: string }>()
  ).results;
  if (!orders.length) return { orders: 0, payments: 0 };
  const access = await shopAccess(env, company, shop);
  let stored = 0;
  for (const order of orders) {
    const payments = await readOrderPayments(access, order.external_id);
    await db.batch([
      ...payments.map((p) =>
        db
          .prepare(`INSERT INTO order_payments(company_id,webshop_id,external_id,order_id,occurred_at,payload_json) VALUES(?,?,?,?,?,?)
 ON CONFLICT(company_id,webshop_id,external_id) DO UPDATE SET occurred_at=excluded.occurred_at,payload_json=excluded.payload_json,imported_at=CURRENT_TIMESTAMP WHERE order_payments.payload_json<>excluded.payload_json`)
          .bind(
            company,
            shop,
            p.id,
            p.orderId,
            p.processedAt,
            JSON.stringify(p),
          ),
      ),
      db
        .prepare(
          'INSERT INTO order_payment_checks(company_id,webshop_id,order_id,financial_status) VALUES(?,?,?,?) ON CONFLICT(company_id,webshop_id,order_id) DO UPDATE SET financial_status=excluded.financial_status,checked_at=CURRENT_TIMESTAMP',
        )
        .bind(company, shop, order.external_id, order.status),
    ]);
    stored += payments.length;
  }
  return { orders: orders.length, payments: stored };
}
const accountNumber = (value: string | undefined, what: string) => {
  const n = Number(String(value || '').match(/^\d+/)?.[0]);
  if (!Number.isSafeInteger(n) || n <= 0)
    rejectTransfer(`Vælg ${what} under Indstillinger.`);
  return n;
};
/** Debit the bank (manual payment) or the clearing account (gateway), credit the receivables account the sale debited. */
export function paymentVoucher(
  payment: OrderPayment,
  date: string,
  receivables: string,
  accounts: Record<string, string>,
): { voucher: Voucher; expected: Expected; accounts: number[] } {
  if (
    !/^gid:\/\/shopify\/OrderTransaction\/\d{1,30}$/.test(payment.id) ||
    !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
    !Number.isSafeInteger(payment.amount) ||
    payment.amount <= 0 ||
    payment.currency !== 'DKK'
  )
    rejectTransfer('Betalingen indeholder ugyldige kontroldata.');
  if (payment.problem) rejectTransfer(payment.problem);
  const credit = accountNumber(receivables, 'en debitorkonto'),
    debit = payment.manual
      ? accountNumber(accounts.bank, 'en bankkonto')
      : accountNumber(accounts.clearing, 'en mellemregningskonto');
  if (debit === credit)
    rejectTransfer(
      'Debitorkontoen må ikke være den samme som bank- eller mellemregningskontoen.',
    );
  return {
    voucher: {
      VoucherDate: date,
      ExternalReference: `wtb:orderpayment:${payment.id.split('/').pop()}`,
      Lines: [
        {
          Description: `Indbetaling, ordre: ${payment.orderName}`,
          AccountNumber: debit,
          BalancingAccountNumber: credit,
          Amount: payment.amount / 100,
          AccountVatCode: 'none',
          BalancingAccountVatCode: 'none',
        },
      ],
    },
    expected: [{ net: payment.amount, tax: 0, gross: payment.amount }],
    accounts: [debit, credit],
  };
}
