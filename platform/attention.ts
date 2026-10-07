// "Kræver handling" on the dashboard: one list of what the customer has to look at, gathered from where it
// otherwise lies spread over Salg, Tilbagebetalinger, Udbetalinger, Lager and settings. Read-only.
// - failed: posts the automatic run tried and failed (production_attempts), unless they have been booked since,
// - uncertain: bookings, mails and stock regulations Dinero may or may not have received (receipt uncertain/held),
// - market: orders from the last 90 days that wait for a market (country/currency) to be set up, when sales are
//   booked or invoices mailed automatically,
// - waiting: refunds older than a day whose order sale is not in Dinero yet, when refunds are booked automatically.
// Each item says which page to open; at most `limit` items per kind, with the full count.
import { marketHold } from './order-markets';
import { saleBookedSql } from './order-refunds';
import { HttpError, reply, type Actor, type PlatformEnv } from './types';

export type AttentionKind = 'failed' | 'uncertain' | 'market' | 'waiting';
export type AttentionView =
  | 'orders'
  | 'refunds'
  | 'payouts'
  | 'inventory'
  | 'settings';
export type AttentionItem = {
  kind: AttentionKind;
  title: string;
  detail: string;
  view: AttentionView;
  externalId: string;
  at: string | null;
};

// Which page shows a post, and what to call it, by the receipt's or job's provider and module.
const place = (
  provider: string,
  module: string,
): { view: AttentionView; noun: string } =>
  provider === 'shopify' && module === 'orders'
    ? { view: 'orders', noun: 'Salg' }
    : provider === 'shopify' &&
        (module === 'order_refunds' || module === 'refunds')
      ? { view: 'refunds', noun: 'Tilbagebetaling' }
      : provider === 'shopify' && module === 'stocktake'
        ? { view: 'inventory', noun: 'Lagerregulering' }
        : provider === 'invoice' || provider === 'credit'
          ? {
              view: 'orders',
              noun: provider === 'credit' ? 'Kreditnotamail' : 'Fakturamail',
            }
          : { view: 'payouts', noun: 'Udbetaling' };
const jobs: Record<string, [string, string]> = {
  sales: ['shopify', 'orders'],
  order_refunds: ['shopify', 'order_refunds'],
  payouts: ['shopify', 'payouts'],
  flatpay: ['flatpay', 'payments'],
  invoice: ['invoice', 'orders'],
  credit: ['credit', 'order_refunds'],
};
const short = (id: string) => String(id).split(/[/:]/).pop() || id;

export async function attention(
  env: PlatformEnv,
  company: string,
  shop: string,
  limit = 20,
) {
  const db = env.PLATFORM_DB;
  const saved = await db
    .prepare(
      'SELECT preferences_json FROM tier1_preferences WHERE company_id=? AND webshop_id=?',
    )
    .bind(company, shop)
    .first<{ preferences_json: string }>();
  const automation =
    (saved ? JSON.parse(saved.preferences_json).automation : null) || {};
  const wantsMarkets = !!(automation.sales || automation.invoiceEmails),
    wantsRefunds = !!automation.refunds;
  // Names for orders and refunds, so the list says "Ordre #2701" rather than an ID.
  const orderName = `(SELECT json_extract(o.payload_json,'$.name') FROM operation_snapshots o WHERE o.company_id=a.company_id AND o.webshop_id=a.webshop_id AND o.module='orders' AND o.external_id=a.external_id)`;
  const refundOrder = `(SELECT json_extract(o.payload_json,'$.name') FROM order_refunds r JOIN operation_snapshots o ON o.company_id=r.company_id AND o.webshop_id=r.webshop_id AND o.module='orders' AND o.external_id=r.order_id WHERE r.company_id=a.company_id AND r.webshop_id=a.webshop_id AND r.external_id=a.external_id)`;
  const [failed, uncertain, marketRows, waiting] = await Promise.all([
    db
      .prepare(
        `SELECT a.job,a.external_id,a.failures,a.attempted_at,${orderName} order_name,${refundOrder} refund_order,
 (SELECT json_extract(e.details_json,'$.message') FROM record_events e WHERE e.company_id=a.company_id AND e.webshop_id=a.webshop_id AND e.external_id=a.external_id AND e.event='error' ORDER BY e.id DESC LIMIT 1) reason
 FROM production_attempts a WHERE a.company_id=? AND a.webshop_id=? AND a.failures>0 AND a.job IN (SELECT value FROM json_each(?))
 AND NOT EXISTS(SELECT 1 FROM production_receipts b WHERE b.company_id=a.company_id AND b.webshop_id=a.webshop_id AND b.external_id=a.external_id AND b.phase='booked'
  AND b.provider=json_extract(?,'$.'||a.job||'[0]') AND b.module=json_extract(?,'$.'||a.job||'[1]'))
 ORDER BY a.attempted_at DESC`,
      )
      .bind(
        company,
        shop,
        JSON.stringify(Object.keys(jobs)),
        JSON.stringify(jobs),
        JSON.stringify(jobs),
      )
      .all<{
        job: string;
        external_id: string;
        failures: number;
        attempted_at: number;
        order_name: string | null;
        refund_order: string | null;
        reason: string | null;
      }>(),
    db
      .prepare(
        `SELECT a.provider,a.module,a.external_id,a.phase,a.updated_at,${orderName} order_name,${refundOrder} refund_order
 FROM production_receipts a WHERE a.company_id=? AND a.webshop_id=? AND a.phase IN ('uncertain','held') ORDER BY a.updated_at DESC`,
      )
      .bind(company, shop)
      .all<{
        provider: string;
        module: string;
        external_id: string;
        phase: string;
        updated_at: string;
        order_name: string | null;
        refund_order: string | null;
      }>(),
    db
      .prepare(
        `SELECT s.external_id,s.occurred_at,json_extract(s.payload_json,'$.name') name,json_extract(s.payload_json,'$.currentTotalPriceSet.shopMoney.currencyCode') shop_currency,m.country,m.currency
 FROM operation_snapshots s JOIN order_markets m ON m.company_id=s.company_id AND m.webshop_id=s.webshop_id AND m.external_id=s.external_id
 WHERE s.company_id=? AND s.webshop_id=? AND s.module='orders' AND s.occurred_at>=strftime('%Y-%m-%dT%H:%M:%SZ','now','-90 days')
 AND json_extract(s.payload_json,'$.cancelledAt') IS NULL AND json_extract(s.payload_json,'$.test') IS NOT 1
 AND NOT EXISTS(SELECT 1 FROM production_receipts b WHERE b.company_id=s.company_id AND b.webshop_id=s.webshop_id AND b.provider='shopify' AND b.module='orders' AND b.external_id=s.external_id AND b.phase='booked')
 ORDER BY s.occurred_at DESC`,
      )
      .bind(company, shop)
      .all<{
        external_id: string;
        occurred_at: string;
        name: string | null;
        shop_currency: string | null;
        country: string | null;
        currency: string | null;
      }>(),
    db
      .prepare(
        `SELECT s.external_id,s.occurred_at,(SELECT json_extract(o.payload_json,'$.name') FROM operation_snapshots o WHERE o.company_id=s.company_id AND o.webshop_id=s.webshop_id AND o.module='orders' AND o.external_id=s.order_id) order_name
 FROM order_refunds s WHERE s.company_id=? AND s.webshop_id=? AND s.occurred_at<strftime('%Y-%m-%dT%H:%M:%SZ','now','-1 day')
 AND s.occurred_at>=strftime('%Y-%m-%dT%H:%M:%SZ','now','-90 days') AND NOT ${saleBookedSql}
 AND NOT EXISTS(SELECT 1 FROM production_receipts b WHERE b.company_id=s.company_id AND b.webshop_id=s.webshop_id AND b.provider='shopify' AND b.module='order_refunds' AND b.external_id=s.external_id AND b.phase='booked')
 ORDER BY s.occurred_at DESC`,
      )
      .bind(company, shop)
      .all<{
        external_id: string;
        occurred_at: string;
        order_name: string | null;
      }>(),
  ]);
  const name = (
    r: {
      order_name: string | null;
      refund_order: string | null;
      external_id: string;
    },
    noun: string,
  ) =>
    r.refund_order
      ? `${noun} på ordre ${r.refund_order}`
      : r.order_name
        ? `${noun} ${r.order_name}`
        : `${noun} ${short(r.external_id)}`;
  const held = await marketHold(db, company, shop);
  const items: AttentionItem[] = [
    ...failed.results.map((r) => {
      const [provider, module] = jobs[r.job];
      const where = place(provider, module);
      return {
        kind: 'failed' as const,
        title: name(r, where.noun === 'Salg' ? 'Ordre' : where.noun),
        detail: `${r.reason || 'Behandlingen fejlede.'} ${r.failures > 1 ? `Forsøgt ${r.failures} gange; prøves igen automatisk.` : 'Prøves igen automatisk.'}`,
        view: where.view,
        externalId: r.external_id,
        at: new Date(r.attempted_at).toISOString(),
      };
    }),
    ...uncertain.results.map((r) => {
      const where = place(r.provider, r.module);
      return {
        kind: 'uncertain' as const,
        title: name(r, where.noun === 'Salg' ? 'Ordre' : where.noun),
        detail:
          r.phase === 'held'
            ? 'Sat i bero. Kontrollér posten, før den behandles igen.'
            : 'Uafklaret: det er ikke sikkert, om Dinero modtog den. Kontrollér i Dinero, og afklar posten.',
        view: where.view,
        externalId: r.external_id,
        at: r.updated_at,
      };
    }),
    ...marketRows.results
      .filter(() => wantsMarkets)
      .filter((r) => held(r.country, r.currency, r.shop_currency))
      .map((r) => ({
        kind: 'market' as const,
        title: `Ordre ${r.name || short(r.external_id)}`,
        detail: `Venter på opsætning af markedet for ${r.country || 'ukendt land'}${r.currency ? ` (${r.currency})` : ''} under Indstillinger → Faktura-afsendelse.`,
        view: 'settings' as const,
        externalId: r.external_id,
        at: r.occurred_at,
      })),
    ...waiting.results
      .filter(() => wantsRefunds)
      .map((r) => ({
        kind: 'waiting' as const,
        title: `Tilbagebetaling på ordre ${r.order_name || short(r.external_id)}`,
        detail:
          'Venter på, at salget er bogført i Dinero. Den bogføres automatisk bagefter.',
        view: 'refunds' as const,
        externalId: r.external_id,
        at: r.occurred_at,
      })),
  ];
  const kinds: AttentionKind[] = ['failed', 'uncertain', 'market', 'waiting'];
  const counts = Object.fromEntries(
    kinds.map((k) => [k, items.filter((i) => i.kind === k).length]),
  ) as Record<AttentionKind, number>;
  return {
    total: items.length,
    counts,
    items: kinds.flatMap((k) =>
      items.filter((i) => i.kind === k).slice(0, limit),
    ),
  };
}

export async function handleAttention(
  request: Request,
  env: PlatformEnv,
  _actor: Actor,
  company: string,
  shop: string,
) {
  if (request.method !== 'GET') throw new HttpError(405, 'Brug Hent.');
  if (shop === 'none')
    return reply({
      total: 0,
      counts: { failed: 0, uncertain: 0, market: 0, waiting: 0 },
      items: [],
    });
  return reply(await attention(env, company, shop));
}
