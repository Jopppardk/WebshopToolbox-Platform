// Tilbagebetalinger: refunds per order across gateways, their credit notes and the sync.
// Part of the Tier 1 data API (tier1-data.ts); called for paths of a connected webshop.
import { orderPaymentIntegration } from './catalog';
import { bookingStatuses } from './booking-onboarding';
import { dataCutoff } from './tier1-history';
import { marketHold } from './order-markets';
import {
  legacyRefundSql,
  saleBookedSql,
  syncOrderRefunds,
  type OrderRefund,
} from './order-refunds';
import { ensureCreditNote } from './credit-notes';
import { HttpError, reply } from './types';
import { type DataContext, pageNumber } from './tier1-data-shared';

export async function orderRefundData({
  request,
  env,
  actor,
  company,
  shop,
  path,
  db,
  url,
  get,
}: DataContext): Promise<Response | null> {
  // Tilbagebetalinger: every refund of an order, whatever the gateway, with its credit note and booking.
  if (path === '/order-refunds/sync') {
    if (request.method !== 'POST') throw new HttpError(405, 'Brug Opdatér.');
    const result = await syncOrderRefunds(env, company, shop, 25);
    return reply({
      synced: result.refunds,
      orders: result.orders,
      more: result.orders === 25,
    });
  }
  if (path === '/order-refunds/credit-note') {
    if (!get) throw new HttpError(405, 'Brug Hent.');
    const id = url.searchParams.get('externalId') || '';
    if (!/^gid:\/\/shopify\/Refund\/\d{1,30}$/.test(id))
      throw new HttpError(400, 'Vælg en tilbagebetaling.');
    let note = await db
      .prepare(
        "SELECT number,r2_key FROM platform_credit_notes WHERE company_id=? AND webshop_id=? AND external_id=? AND status='generated'",
      )
      .bind(company, shop, id)
      .first<{ number: string; r2_key: string }>();
    if (!note && !actor.support) {
      // Made on first view when the order was invoiced here, exactly as booking or mailing would make it.
      const row = await db
        .prepare(
          'SELECT payload_json FROM order_refunds WHERE company_id=? AND webshop_id=? AND external_id=?',
        )
        .bind(company, shop, id)
        .first<{ payload_json: string }>();
      const made = row
        ? await ensureCreditNote(
            env,
            company,
            shop,
            JSON.parse(row.payload_json),
          )
        : null;
      if (made) note = { number: made.number, r2_key: made.key };
    }
    if (!note)
      throw new HttpError(
        404,
        'Der findes ingen kreditnota. Ordren er ikke faktureret i WebshopToolbox.',
      );
    const file = await env.PLATFORM_DOCUMENTS.get(note.r2_key);
    if (!file) throw new HttpError(404, 'Den gemte kreditnota mangler.');
    return new Response(file.body, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition':
          'inline; filename="kreditnota-' + note.number + '.pdf"',
        'Cache-Control': 'no-store',
      },
    });
  }
  if (path === '/order-refunds') {
    if (!get) throw new HttpError(405, 'Brug Hent.');
    const from = await dataCutoff(env, company, shop),
      held = await marketHold(db, company, shop);
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
    const rows = (
      await db
        .prepare(`SELECT s.external_id,s.occurred_at,s.payload_json,c.number credit_number,m.country,m.currency market_currency,
 EXISTS(SELECT 1 FROM platform_invoices i WHERE i.company_id=s.company_id AND i.webshop_id=s.webshop_id AND i.external_id=s.order_id AND i.status='generated') invoiced,${legacyRefundSql} legacy,${saleBookedSql} sale_booked,
 (SELECT r.phase FROM production_receipts r WHERE r.company_id=s.company_id AND r.webshop_id=s.webshop_id AND r.provider='invoice' AND r.module='credit_email' AND r.external_id=c.id) mail
 FROM order_refunds s LEFT JOIN platform_credit_notes c ON c.company_id=s.company_id AND c.webshop_id=s.webshop_id AND c.external_id=s.external_id AND c.status='generated'
 LEFT JOIN order_markets m ON m.company_id=s.company_id AND m.webshop_id=s.webshop_id AND m.external_id=s.order_id
 WHERE s.company_id=? AND s.webshop_id=? AND s.occurred_at>=? ORDER BY s.occurred_at DESC,s.external_id LIMIT 5001`)
        .bind(company, shop, from)
        .all<any>()
    ).results;
    if (rows.length > 5000)
      throw new HttpError(409, 'Vælg en kortere historik.');
    // Statuses only for the refunds read here, not for every order of the webshop.
    const status = await bookingStatuses(
      env,
      company,
      shop,
      rows.map((r) => r.external_id),
    );
    const fromDay = url.searchParams.get('from') || '',
      toDay = url.searchParams.get('to') || '',
      search = (url.searchParams.get('search') || '').trim().toLowerCase();
    const offset = pageNumber(url.searchParams.get('offset'), 0),
      limit = pageNumber(url.searchParams.get('limit'), 25, 100) || 25;
    const list = rows
      .map((row) => {
        const r = JSON.parse(row.payload_json) as OrderRefund,
          digits = new Intl.NumberFormat('en', {
            style: 'currency',
            currency: r.currency,
          }).resolvedOptions().maximumFractionDigits!;
        const foreign = held(
          row.country ?? null,
          row.market_currency ?? null,
          r.currency,
        );
        const booking = row.legacy
          ? 'booked'
          : status(
              'shopify',
              'order_refunds',
              r.id,
              r.processedAt,
              row.payload_json,
            );
        return {
          id: r.id,
          orderId: r.orderId,
          orderName: r.orderName,
          date: r.processedAt,
          currency: r.currency,
          amount: r.gross / 10 ** digits,
          full: r.full,
          gateways: r.gateways.map((g) => {
            const label = orderPaymentIntegration([g.gateway], connected);
            return label === 'Uden integration' ? g.name || label : label;
          }),
          lines: r.lines.map((l) => ({
            kind: l.kind,
            title: l.title,
            quantity: l.quantity,
            amount: (l.net + l.tax) / 10 ** digits,
          })),
          note: r.note,
          problem: r.problem,
          creditNote: row.credit_number || null,
          invoiced: !!row.invoiced,
          mailed: row.mail === 'accepted',
          legacy: !!row.legacy,
          foreign,
          booking:
            row.legacy ||
            [
              'booked',
              'draft',
              'booked_changed',
              'failed_manual',
              'failed_retry',
              'historical',
              'setup_required',
            ].includes(booking)
              ? booking
              : foreign
                ? 'foreign'
                : !row.sale_booked
                  ? 'sale_pending'
                  : booking,
        };
      })
      .filter(
        (r) =>
          (!fromDay || r.date.slice(0, 10) >= fromDay) &&
          (!toDay || r.date.slice(0, 10) <= toDay) &&
          (!search ||
            [r.orderName, r.id, r.creditNote || '', ...r.gateways]
              .join(' ')
              .toLowerCase()
              .includes(search)),
      );
    const totals: Record<
      string,
      { currency: string; count: number; amount: number }
    > = {};
    for (const r of list) {
      const t = (totals[r.currency] ??= {
        currency: r.currency,
        count: 0,
        amount: 0,
      });
      t.count++;
      t.amount = Math.round((t.amount + r.amount) * 100) / 100;
    }
    return reply({
      total: list.length,
      refunds: list.slice(offset, offset + limit),
      totals: Object.values(totals),
    });
  }
  return null;
}
