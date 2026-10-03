// Refunds per Shopify order, whatever the payment gateway. Shopify records every refund on the order
// (items, shipping, regulations and the money transactions with their gateway), so one read path covers
// Shopify Payments, MobilePay, Flatpay, ViaBill and any other gateway, partial as well as full refunds.
// Read-only: refunds are stored in order_refunds and booked by the order_refund booking kind.
import { orderQuery, shopAccess } from './invoice-source';
import { minorUnits } from './money';
import { HttpError, type PlatformEnv } from './types';

type Access = { shop: string; accessToken: string };
type Money = { amount?: string; currencyCode?: string } | undefined;
export type RefundLine = { kind: 'goods' | 'shipping' | 'services'; title: string; quantity: number; net: number; tax: number };
export type OrderRefund = {
  id: string; orderId: string; orderName: string; processedAt: string; currency: string;
  /** Money returned to the customer, in minor units of the shop currency. */
  gross: number; full: boolean; sequence: number; note: string | null;
  gateways: Array<{ gateway: string; name: string; amount: number }>;
  lines: RefundLine[];
  /** Why the refund cannot be booked automatically (it is still listed). */
  problem: string | null;
};

const money = '{shopMoney{amount currencyCode}}';
const refundQuery = `query ToolboxOrderRefunds($id:ID!){order(id:$id){id name taxesIncluded totalPriceSet${money} refunds{id createdAt processedAt note
 refundLineItems(first:100){nodes{quantity lineItem{name} subtotalSet${money} totalTaxSet${money}} pageInfo{hasNextPage}}
 refundShippingLines(first:20){nodes{shippingLine{title} subtotalAmountSet${money} taxAmountSet${money}} pageInfo{hasNextPage}}
 orderAdjustments(first:20){nodes{reason amountSet${money} taxAmountSet${money}} pageInfo{hasNextPage}}
 transactions(first:20){nodes{id kind status test gateway formattedGateway amountSet${money}} pageInfo{hasNextPage}}}}}`;

class RefundProblem extends Error {}
const problem = (message: string): never => { throw new RefundProblem(message); };
function amount(value: Money, currency: string) {
  if (!value || typeof value.amount !== 'string' || value.currencyCode !== currency) problem('Refunderingen har beløb i en anden valuta end butikkens.');
  try { return Math.abs(minorUnits(value!.amount!, currency)); } catch { return problem('Refunderingen har et ugyldigt beløb.'); }
}

/** One refund as booked: lines that add up exactly to the money returned, or the reason they do not. */
export function normalizeRefund(order: any, refund: any, sequence: number): OrderRefund | null {
  // Only money actually returned counts; a refund without a successful transaction (e.g. only a restock) is not booked.
  const transactions = Array.isArray(refund?.transactions?.nodes) ? refund.transactions.nodes.filter((t: any) => t?.kind === 'REFUND' && t.status === 'SUCCESS' && !t.test) : [];
  const currency = order.totalPriceSet?.shopMoney?.currencyCode;
  if (!transactions.length || typeof currency !== 'string') return null;
  const base = { id: String(refund.id), orderId: String(order.id), orderName: String(order.name), processedAt: String(refund.processedAt || refund.createdAt), currency, sequence, note: typeof refund.note === 'string' && refund.note.trim() ? refund.note.trim().slice(0, 500) : null };
  let gross = 0;
  const gateways: OrderRefund['gateways'] = [];
  try {
    for (const t of transactions) {
      const value = amount(t.amountSet?.shopMoney, currency), gateway = typeof t.gateway === 'string' ? t.gateway.slice(0, 80) : '';
      gross += value;
      const known = gateways.find(g => g.gateway === gateway);
      if (known) known.amount += value; else gateways.push({ gateway, name: typeof t.formattedGateway === 'string' && t.formattedGateway.trim() ? t.formattedGateway.trim().slice(0, 80) : gateway, amount: value });
    }
  } catch (error) { if (error instanceof RefundProblem) return { ...base, gross: 0, full: false, gateways, lines: [], problem: error.message }; throw error; }
  if (gross <= 0) return null;
  const full = gross === Math.abs(minorUnits(String(order.totalPriceSet.shopMoney.amount), currency));
  try {
    for (const field of ['refundLineItems', 'refundShippingLines', 'orderAdjustments', 'transactions']) if (!Array.isArray(refund[field]?.nodes) || refund[field].pageInfo?.hasNextPage !== false) problem('Refunderingen har flere linjer, end der kan læses på én gang.');
    // Shopify gives each line's subtotal and tax. Whether the subtotal includes the tax follows the shop's price
    // setting, so both readings are tried, the shop's own first; the lines must add up to the money returned.
    type Raw = { kind: RefundLine['kind']; title: string; quantity: number; subtotal: number; tax: number };
    const raw: Raw[] = [], regulations: Array<{ amount: number; tax: number }> = [];
    for (const x of refund.refundLineItems.nodes) raw.push({ kind: 'goods', title: String(x.lineItem?.name || 'Vare').slice(0, 300), quantity: Number.isSafeInteger(x.quantity) && x.quantity > 0 ? x.quantity : 1, subtotal: amount(x.subtotalSet?.shopMoney, currency), tax: amount(x.totalTaxSet?.shopMoney, currency) });
    for (const x of refund.refundShippingLines.nodes) raw.push({ kind: 'shipping', title: String(x.shippingLine?.title || 'Fragt').slice(0, 300), quantity: 1, subtotal: amount(x.subtotalAmountSet?.shopMoney, currency), tax: amount(x.taxAmountSet?.shopMoney, currency) });
    for (const x of refund.orderAdjustments.nodes) {
      // Older refunds return shipping as an adjustment; everything else is a regulation of the refunded amount.
      if (x.reason === 'SHIPPING_REFUND') raw.push({ kind: 'shipping', title: 'Fragt', quantity: 1, subtotal: amount(x.amountSet?.shopMoney, currency), tax: amount(x.taxAmountSet?.shopMoney, currency) });
      else regulations.push({ amount: amount(x.amountSet?.shopMoney, currency), tax: amount(x.taxAmountSet?.shopMoney, currency) });
    }
    const attempt = (included: boolean) => {
      const lines: RefundLine[] = raw.filter(r => r.subtotal || r.tax).map(r => ({ kind: r.kind, title: r.title, quantity: r.quantity, net: included ? r.subtotal - r.tax : r.subtotal, tax: r.tax }));
      if (lines.some(l => l.net < 0)) return null;
      const difference = gross - lines.reduce((sum, l) => sum + l.net + l.tax, 0);
      if (difference && !regulations.length) return null;
      if (difference) {
        // A regulation carries Danish VAT when Shopify taxed it; the tax is the VAT share of the gross difference.
        const tax = regulations.some(r => r.tax) ? Math.round(difference / 5) : 0;
        lines.push({ kind: 'services', title: 'Regulering af tilbagebetalingen', quantity: 1, net: difference - tax, tax });
      }
      return lines;
    };
    // A reading that adds up without a regulation wins over one that needs it.
    const readings = [attempt(order.taxesIncluded !== false), attempt(order.taxesIncluded === false)];
    const lines = readings.find(l => l && l.length === raw.filter(r => r.subtotal || r.tax).length) ?? readings.find(Boolean);
    if (!lines?.length) problem('Refunderingslinjerne stemmer ikke med det tilbagebetalte beløb.');
    return { ...base, gross, full, gateways, lines: lines!, problem: null };
  } catch (error) {
    if (error instanceof RefundProblem) return { ...base, gross, full, gateways, lines: [], problem: error.message };
    throw error;
  }
}

/** All refunds of an order, oldest first, numbered 1, 2, … among those that returned money. */
export async function readOrderRefunds(access: Access, orderId: string) {
  if (!/^gid:\/\/shopify\/Order\/\d{1,30}$/.test(orderId)) throw new HttpError(409, 'Ugyldigt ordre-ID.');
  const data = await orderQuery<{ order: any }>(access, refundQuery, { id: orderId }, 'Shopify kunne ikke hente ordrens tilbagebetalinger.');
  if (!data.order || data.order.id !== orderId || !Array.isArray(data.order.refunds)) throw new HttpError(409, 'Ordren kunne ikke findes i Shopify.');
  const sorted = [...data.order.refunds].sort((a, b) => String(a.processedAt || a.createdAt).localeCompare(String(b.processedAt || b.createdAt)) || String(a.id).localeCompare(String(b.id)));
  const refunds: OrderRefund[] = [];
  for (const refund of sorted) { const value = normalizeRefund(data.order, refund, refunds.length + 1); if (value) refunds.push(value); }
  return refunds;
}

/** Reads the refunds of orders whose refunded amount changed since they were last read, newest first. */
export async function syncOrderRefunds(env: PlatformEnv, company: string, shop: string, limit = 10) {
  const db = env.PLATFORM_DB;
  const orders = (await db.prepare(`SELECT s.external_id,json_extract(s.payload_json,'$.totalRefundedSet.shopMoney.amount') refunded FROM operation_snapshots s
 LEFT JOIN order_refund_checks c ON c.company_id=s.company_id AND c.webshop_id=s.webshop_id AND c.order_id=s.external_id
 WHERE s.company_id=? AND s.webshop_id=? AND s.module='orders' AND CAST(COALESCE(json_extract(s.payload_json,'$.totalRefundedSet.shopMoney.amount'),'0') AS REAL)>0
 AND (c.order_id IS NULL OR c.refunded<>json_extract(s.payload_json,'$.totalRefundedSet.shopMoney.amount'))
 ORDER BY s.occurred_at DESC LIMIT ?`).bind(company, shop, limit).all<{ external_id: string; refunded: string }>()).results;
  if (!orders.length) return { orders: 0, refunds: 0 };
  const access = await shopAccess(env, company, shop);
  let stored = 0;
  for (const order of orders) {
    const refunds = await readOrderRefunds(access, order.external_id);
    await db.batch([
      ...refunds.map(r => db.prepare(`INSERT INTO order_refunds(company_id,webshop_id,external_id,order_id,occurred_at,payload_json) VALUES(?,?,?,?,?,?)
 ON CONFLICT(company_id,webshop_id,external_id) DO UPDATE SET occurred_at=excluded.occurred_at,payload_json=excluded.payload_json,imported_at=CURRENT_TIMESTAMP WHERE order_refunds.payload_json<>excluded.payload_json`)
        .bind(company, shop, r.id, r.orderId, r.processedAt, JSON.stringify(r))),
      db.prepare('INSERT INTO order_refund_checks(company_id,webshop_id,order_id,refunded) VALUES(?,?,?,?) ON CONFLICT(company_id,webshop_id,order_id) DO UPDATE SET refunded=excluded.refunded,checked_at=CURRENT_TIMESTAMP').bind(company, shop, order.external_id, String(order.refunded)),
    ]);
    stored += refunds.length;
  }
  return { orders: orders.length, refunds: stored };
}

/** The refund's sale is in Dinero (booked or drafted here, or reconciled), so the clearing account it credits holds the sale. */
export const saleBookedSql = "(EXISTS(SELECT 1 FROM production_receipts b WHERE b.company_id=s.company_id AND b.webshop_id=s.webshop_id AND b.provider='shopify' AND b.module='orders' AND b.external_id=s.order_id AND b.phase IN ('draft','booking','booked')) OR EXISTS(SELECT 1 FROM accounting_reconciliations b WHERE b.company_id=s.company_id AND b.webshop_id=s.webshop_id AND b.provider='shopify' AND b.module='orders' AND b.external_id=s.order_id))";
/** A refund already booked by the earlier Shopify Payments refund flow, so it is never booked twice. */
export const legacyRefundSql = "EXISTS(SELECT 1 FROM production_receipts l WHERE l.company_id=s.company_id AND l.webshop_id=s.webshop_id AND l.provider='shopify' AND l.module='refunds' AND l.phase<>'prepared' AND json_extract(l.payload_json,'$.source.refund.id')=s.external_id)";
