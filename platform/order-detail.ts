// One order in one view (Salg → click the order): the order, its invoice and invoice mail, the booking in Dinero,
// and every refund with its credit note, credit-note mail and booking. Read-only; the log is /sales/log.
import { orderPaymentIntegration } from './catalog';
import { bookingStatuses } from './booking-onboarding';
import { bookingStatusLabel } from './tier1/src/lib/booking-status';
import { marketHold, orderMarketSettings } from './order-markets';
import { legacyRefundSql, type OrderRefund } from './order-refunds';
import { HttpError, reply, type PlatformEnv } from './types';

type Receipt = {
  provider: string;
  module: string;
  external_id: string;
  phase: string;
  payload_json: string;
  updated_at: string;
  destination: string;
};
const at = (value: string | null | undefined) =>
  value ? (value.includes('T') ? value : value.replace(' ', 'T') + 'Z') : null;
const money = (minor: number, currency: string) =>
  minor /
  10 **
    new Intl.NumberFormat('en', {
      style: 'currency',
      currency,
    }).resolvedOptions().maximumFractionDigits!;

// A receipt as shown: its state, Dinero voucher and when it last changed. The mail receipts show recipient and sender.
function booking(r: Receipt | undefined) {
  if (!r) return null;
  const p = JSON.parse(r.payload_json);
  return {
    phase: r.phase,
    voucherNumber: p.voucherNumber ?? null,
    guid: p.guid ?? null,
    reference: p.voucher?.ExternalReference ?? null,
    organizationId: r.destination,
    at: at(r.updated_at),
    approvedAt: p.approvedAt ?? null,
  };
}
function mail(r: Receipt | undefined) {
  if (!r) return null;
  const p = JSON.parse(r.payload_json);
  return {
    phase: r.phase,
    recipient: p.recipient ?? null,
    from: p.from ?? null,
    at: at(r.updated_at),
  };
}

export async function orderDetail(
  env: PlatformEnv,
  company: string,
  shop: string,
  url: URL,
) {
  const db = env.PLATFORM_DB,
    id = url.searchParams.get('externalId') || '';
  if (!/^gid:\/\/shopify\/Order\/\d{1,30}$/.test(id))
    throw new HttpError(400, 'Vælg en ordre.');
  const row = await db
    .prepare(`SELECT s.payload_json,s.occurred_at,m.country,m.currency market_currency,m.presentment_total,m.order_total,m.net_payment FROM operation_snapshots s
 LEFT JOIN order_markets m ON m.company_id=s.company_id AND m.webshop_id=s.webshop_id AND m.external_id=s.external_id
 WHERE s.company_id=? AND s.webshop_id=? AND s.module='orders' AND s.external_id=?`)
    .bind(company, shop, id)
    .first<any>();
  if (!row) throw new HttpError(404, 'Ordren findes ikke i denne webshop.');
  const o = JSON.parse(row.payload_json),
    currency = o.currentTotalPriceSet?.shopMoney?.currencyCode || 'DKK';
  const connected = new Set(
    (
      await db
        .prepare(
          'SELECT provider FROM payment_connections WHERE company_id=? AND webshop_id=?',
        )
        .bind(company, shop)
        .all<{ provider: string }>()
    ).results.map((r) => r.provider),
  );
  const held = (await marketHold(db, company, shop))(
    row.country ?? null,
    row.market_currency ?? null,
    currency,
  );
  const market = await orderMarketSettings(db, company, shop, id);
  const status = await bookingStatuses(env, company, shop, [
    id,
    ...(
      await db
        .prepare(
          'SELECT external_id FROM order_refunds WHERE company_id=? AND webshop_id=? AND order_id=?',
        )
        .bind(company, shop, id)
        .all<{ external_id: string }>()
    ).results.map((r) => r.external_id),
  ]);
  const invoice = await db
    .prepare(
      'SELECT id,status,created_at,source_json FROM platform_invoices WHERE company_id=? AND webshop_id=? AND external_id=?',
    )
    .bind(company, shop, id)
    .first<{
      id: string;
      status: string;
      created_at: string;
      source_json: string;
    }>();
  const refunds = (
    await db
      .prepare(`SELECT s.external_id,s.occurred_at,s.payload_json,c.id credit_id,c.number credit_number,${legacyRefundSql} legacy FROM order_refunds s
 LEFT JOIN platform_credit_notes c ON c.company_id=s.company_id AND c.webshop_id=s.webshop_id AND c.external_id=s.external_id AND c.status='generated'
 WHERE s.company_id=? AND s.webshop_id=? AND s.order_id=? ORDER BY s.occurred_at`)
      .bind(company, shop, id)
      .all<any>()
  ).results;
  // Every receipt of this order: its sale, its invoice mail, its refunds and their credit-note mails.
  const keys = [
    id,
    invoice?.id || '',
    ...refunds.map((r) => r.external_id),
    ...refunds.map((r) => r.credit_id || ''),
  ].filter(Boolean);
  const receipts = (
    await db
      .prepare(
        `SELECT provider,module,external_id,phase,payload_json,updated_at,destination FROM production_receipts WHERE company_id=? AND webshop_id=? AND external_id IN (SELECT value FROM json_each(?))`,
      )
      .bind(company, shop, JSON.stringify(keys))
      .all<Receipt>()
  ).results;
  const find = (
    provider: string,
    module: string,
    externalId?: string | null,
  ) =>
    externalId
      ? receipts.find(
          (r) =>
            r.provider === provider &&
            r.module === module &&
            r.external_id === externalId,
        )
      : undefined;
  const reconciled = await db
    .prepare(
      "SELECT voucher_number,voucher_status,created_at FROM accounting_reconciliations WHERE company_id=? AND webshop_id=? AND provider='shopify' AND module='orders' AND external_id=?",
    )
    .bind(company, shop, id)
    .first<any>();
  const invoiced =
    invoice?.status === 'generated' ? JSON.parse(invoice.source_json) : null;
  return reply({
    order: {
      externalId: id,
      name: o.name,
      createdAt: o.createdAt,
      country: row.country ?? null,
      currency,
      customer:
        invoiced?.billingAddress?.name ||
        invoiced?.shippingAddress?.name ||
        null,
      amount: Number(
        row.order_total ?? o.currentTotalPriceSet?.shopMoney?.amount ?? 0,
      ),
      realized: row.net_payment != null ? Number(row.net_payment) : null,
      customerTotal:
        row.presentment_total &&
        row.market_currency &&
        row.market_currency !== currency
          ? {
              amount: Number(row.presentment_total),
              currency: row.market_currency,
            }
          : null,
      paymentProvider: orderPaymentIntegration(
        o.paymentGatewayNames,
        connected,
      ),
      financial: o.displayFinancialStatus ?? null,
      shipped: o.cancelledAt
        ? 'Annulleret'
        : o.displayFulfillmentStatus === 'FULFILLED'
          ? 'Afsendt'
          : 'Ikke afsendt',
      status: held
        ? 'Afventer · marked ikke sat op'
        : bookingStatusLabel(
            status('shopify', 'orders', id, o.createdAt, row.payload_json),
          ),
      market: market
        ? {
            name: market.name,
            storeName: market.store_name,
            currency: market.currency,
          }
        : null,
    },
    invoice: invoice
      ? {
          id: invoice.id,
          status: invoice.status,
          createdAt: at(invoice.created_at),
          currency:
            invoiced?.currentTotalPriceSet?.shopMoney?.currencyCode ?? currency,
          mail: mail(find('invoice', 'email', invoice.id)),
        }
      : null,
    booking:
      booking(find('shopify', 'orders', id)) ??
      (reconciled
        ? {
            phase: reconciled.voucher_status === 'Booked' ? 'booked' : 'draft',
            voucherNumber: reconciled.voucher_number,
            guid: null,
            reference: null,
            organizationId: null,
            at: at(reconciled.created_at),
            approvedAt: null,
            reconciled: true,
          }
        : null),
    refunds: refunds.map((r) => {
      const refund = JSON.parse(r.payload_json) as OrderRefund;
      return {
        id: r.external_id,
        date: refund.processedAt,
        amount: money(refund.gross, refund.currency),
        currency: refund.currency,
        full: refund.full,
        gateways: refund.gateways.map((g) => g.name || g.gateway),
        problem: refund.problem,
        creditNote: r.credit_number
          ? {
              number: r.credit_number,
              mail: mail(find('invoice', 'credit_email', r.credit_id)),
            }
          : null,
        booking: r.legacy
          ? {
              phase: 'booked',
              voucherNumber: null,
              guid: null,
              reference: null,
              organizationId: null,
              at: null,
              approvedAt: null,
              legacy: true,
            }
          : booking(find('shopify', 'order_refunds', r.external_id)),
        status: bookingStatusLabel(
          status(
            'shopify',
            'order_refunds',
            r.external_id,
            refund.processedAt,
            r.payload_json,
          ),
        ),
      };
    }),
  });
}
