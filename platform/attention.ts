// "Kræver handling" on the dashboard: one list of what the customer has to look at, gathered from where it
// otherwise lies spread over Salg, Tilbagebetalinger, Udbetalinger, Lager and settings. Read-only.
// - failed: posts the automatic run tried and failed (production_attempts), unless they have been booked since,
// - uncertain: bookings, mails and stock regulations Dinero may or may not have received (receipt uncertain/held),
// - market: orders from the last 90 days that wait for a market (country/currency) to be set up, when sales are
//   booked or invoices mailed automatically,
// - waiting: refunds older than a day whose order sale is not in Dinero yet, when refunds are booked automatically.
// Each item says which page to open; at most `limit` items per kind, with the full count.
import { marketHold } from './order-markets';
import { saleBookedSql, voidOrderSql } from './order-refunds';
import { requireCompany } from './auth';
import { productionWrites } from './production-policy';
import { jsonBody } from './invitations';
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
  /** The automatic job the post belongs to (uncertain: provider.module), for "Prøv igen nu" and "Afvis". */
  job: string;
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
// A failed attempt (production_attempts row `a`) that no longer needs anything: the post has been booked since
// (e.g. manually), or its order was cancelled and refunded before anything reached Dinero. Shared with the
// operations overview, so "venter på nyt forsøg" there counts the same posts as the customer's list.
export const settledFailureSql = (a: string) =>
  `(EXISTS(SELECT 1 FROM production_receipts b WHERE b.company_id=${a}.company_id AND b.webshop_id=${a}.webshop_id AND b.external_id=${a}.external_id AND b.phase='booked'
  AND b.provider=json_extract('${JSON.stringify(jobs)}','$.'||${a}.job||'[0]') AND b.module=json_extract('${JSON.stringify(jobs)}','$.'||${a}.job||'[1]'))
 OR (${a}.job IN ('sales','invoice') AND ${voidOrderSql(a, a + '.external_id')})
 OR (${a}.job IN ('order_refunds','credit') AND ${voidOrderSql(a, `(SELECT vf.order_id FROM order_refunds vf WHERE vf.company_id=${a}.company_id AND vf.webshop_id=${a}.webshop_id AND vf.external_id=${a}.external_id)`)}))`;
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
 AND NOT ${settledFailureSql('a')}
 ORDER BY a.attempted_at DESC`,
      )
      .bind(company, shop, JSON.stringify(Object.keys(jobs)))
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
 AND s.occurred_at>=strftime('%Y-%m-%dT%H:%M:%SZ','now','-90 days') AND NOT ${saleBookedSql} AND NOT ${voidOrderSql('s', 's.order_id')}
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
        job: r.job,
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
        job: r.provider + '.' + r.module,
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
        job: 'sales',
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
        job: 'order_refunds',
        title: `Tilbagebetaling på ordre ${r.order_name || short(r.external_id)}`,
        detail:
          'Venter på, at salget er bogført i Dinero. Den bogføres automatisk bagefter.',
        view: 'refunds' as const,
        externalId: r.external_id,
        at: r.occurred_at,
      })),
  ];
  const dismissed = new Set(
    (
      await db
        .prepare(
          'SELECT kind,job,external_id FROM attention_dismissals WHERE company_id=? AND webshop_id=?',
        )
        .bind(company, shop)
        .all<{ kind: string; job: string; external_id: string }>()
    ).results.map((d) => key(d.kind, d.job, d.external_id)),
  );
  const shown = items.filter(
    (i) => !dismissed.has(key(i.kind, i.job, i.externalId)),
  );
  const kinds: AttentionKind[] = ['failed', 'uncertain', 'market', 'waiting'];
  const counts = Object.fromEntries(
    kinds.map((k) => [k, shown.filter((i) => i.kind === k).length]),
  ) as Record<AttentionKind, number>;
  return {
    total: shown.length,
    counts,
    dismissed: dismissed.size,
    items: kinds.flatMap((k) =>
      shown.filter((i) => i.kind === k).slice(0, limit),
    ),
  };
}
const key = (kind: string, job: string, id: string) =>
  kind + '|' + job + '|' + id;

// "Afvis": the customer has checked the post and wants it off the list. Besides hiding it, its automatic attempts
// stop (next attempt set to neverRetry), so it cannot be booked later, e.g. after it was handled directly in Dinero;
// "Bogfør manuelt" still works. "Fortryd" removes the dismissal and queues the post again. Only posts on the list
// can be dismissed, and an uncertain post is never retried automatically anyway.
export const neverRetry = 32503680000000; // year 3000
const blockedJobs = (item: { kind: string; job: string }) =>
  item.kind === 'failed'
    ? [item.job]
    : item.kind === 'market'
      ? ['sales', 'invoice']
      : item.kind === 'waiting'
        ? ['order_refunds']
        : [];
type Picked = { kind: string; job: string; externalId: string };
const picked = (items: unknown): Picked[] => {
  if (!Array.isArray(items) || !items.length || items.length > 50)
    throw new HttpError(400, 'Vælg de poster, det gælder.');
  return items.map((i) => {
    const r = i && typeof i === 'object' ? (i as Record<string, unknown>) : {};
    if (
      typeof r.kind !== 'string' ||
      typeof r.job !== 'string' ||
      r.job.length > 60 ||
      typeof r.externalId !== 'string' ||
      !r.externalId ||
      r.externalId.length > 200
    )
      throw new HttpError(400, 'Vælg de poster, det gælder.');
    return { kind: r.kind, job: r.job, externalId: r.externalId };
  });
};
export async function dismissAttention(
  env: PlatformEnv,
  actor: Actor,
  company: string,
  shop: string,
  items: unknown,
) {
  const list = picked(items),
    db = env.PLATFORM_DB;
  const current = await attention(env, company, shop, Number.MAX_SAFE_INTEGER);
  const found = list.map((p) =>
    current.items.find(
      (i) =>
        i.kind === p.kind && i.job === p.job && i.externalId === p.externalId,
    ),
  );
  if (found.some((i) => !i))
    throw new HttpError(
      409,
      'Posten er ikke længere på listen. Opdatér siden.',
    );
  const now = Date.now();
  await db.batch(
    (found as AttentionItem[]).flatMap((i) => [
      db
        .prepare(
          'INSERT OR IGNORE INTO attention_dismissals(company_id,webshop_id,kind,job,external_id,title,dismissed_by) VALUES(?,?,?,?,?,?,?)',
        )
        .bind(company, shop, i.kind, i.job, i.externalId, i.title, actor.id),
      ...blockedJobs(i).map((job) =>
        db
          .prepare(
            'INSERT INTO production_attempts(company_id,webshop_id,job,external_id,attempted_at,next_attempt_at,failures) VALUES(?,?,?,?,?,?,0) ON CONFLICT(company_id,webshop_id,job,external_id) DO UPDATE SET next_attempt_at=excluded.next_attempt_at',
          )
          .bind(company, shop, job, i.externalId, now, neverRetry),
      ),
    ]),
  );
  return { dismissed: found.length };
}
export async function restoreAttention(
  env: PlatformEnv,
  company: string,
  shop: string,
  items: unknown,
) {
  const list = picked(items),
    db = env.PLATFORM_DB;
  // One delete per post, then the queueing of its blocked jobs; the deletes count the restored posts.
  const statements = list.map((i) => [
    db
      .prepare(
        'DELETE FROM attention_dismissals WHERE company_id=? AND webshop_id=? AND kind=? AND job=? AND external_id=?',
      )
      .bind(company, shop, i.kind, i.job, i.externalId),
    ...blockedJobs(i).map((job) =>
      db
        .prepare(
          'UPDATE production_attempts SET next_attempt_at=0 WHERE company_id=? AND webshop_id=? AND job=? AND external_id=? AND next_attempt_at=?',
        )
        .bind(company, shop, job, i.externalId, neverRetry),
    ),
  ]);
  const results = await db.batch(statements.flat());
  let at = 0,
    restored = 0;
  for (const group of statements) {
    restored += results[at].meta.changes ? 1 : 0;
    at += group.length;
  }
  return { restored };
}
export async function dismissedAttention(
  env: PlatformEnv,
  company: string,
  shop: string,
) {
  return (
    await env.PLATFORM_DB.prepare(
      'SELECT d.kind,d.job,d.external_id externalId,d.title,d.dismissed_at dismissedAt,COALESCE(u.full_name,u.email) dismissedBy FROM attention_dismissals d LEFT JOIN users u ON u.id=d.dismissed_by WHERE d.company_id=? AND d.webshop_id=? ORDER BY d.dismissed_at DESC LIMIT 100',
    )
      .bind(company, shop)
      .all()
  ).results;
}

// "Prøv igen nu" on failed posts: the post's wait is cleared and the webshop is put first for the next automatic
// run (every 5 minutes), which processes it with exactly its own checks and the customer's automation settings
// (book or draft). Nothing is booked here. Company administrators only; support cannot (GET only).
const automationFor: Record<string, (a: Record<string, unknown>) => boolean> = {
  sales: (a) => !!a.sales,
  order_refunds: (a) => !!a.refunds,
  payouts: (a) => !!a.payouts,
  flatpay: (a) => !!a.payouts,
  invoice: (a) => !!a.invoiceEmails,
  credit: (a) => !!a.invoiceEmails,
};
const retryItem = (i: unknown): i is { job: string; externalId: string } => {
  const r = i && typeof i === 'object' ? (i as Record<string, unknown>) : null;
  return (
    !!r &&
    typeof r.job === 'string' &&
    Object.hasOwn(automationFor, r.job) &&
    typeof r.externalId === 'string' &&
    r.externalId.length > 0 &&
    r.externalId.length <= 200
  );
};
export async function retryAttention(
  env: PlatformEnv,
  company: string,
  shop: string,
  items: unknown,
) {
  if (
    !Array.isArray(items) ||
    !items.length ||
    items.length > 50 ||
    items.some((i) => !retryItem(i))
  )
    throw new HttpError(400, 'Vælg de poster, der skal prøves igen.');
  if (!productionWrites(env))
    throw new HttpError(409, 'Automatiske kørsler er slået fra i dette miljø.');
  const db = env.PLATFORM_DB;
  const saved = await db
    .prepare(
      'SELECT preferences_json FROM tier1_preferences WHERE company_id=? AND webshop_id=?',
    )
    .bind(company, shop)
    .first<{ preferences_json: string }>();
  const automation =
    (saved ? JSON.parse(saved.preferences_json).automation : null) || {};
  const list = items as { job: string; externalId: string }[];
  const off = list.find((i) => !automationFor[i.job](automation));
  if (off)
    throw new HttpError(
      409,
      'Den automatiske behandling af denne type poster er slået fra under Indstillinger.',
    );
  const results = await db.batch([
    ...list.map((i) =>
      db
        .prepare(
          // A dismissed post is only queued again by Fortryd.
          'UPDATE production_attempts SET next_attempt_at=0 WHERE company_id=? AND webshop_id=? AND job=? AND external_id=? AND failures>0 AND NOT EXISTS(SELECT 1 FROM attention_dismissals d WHERE d.company_id=production_attempts.company_id AND d.webshop_id=production_attempts.webshop_id AND d.job=production_attempts.job AND d.external_id=production_attempts.external_id)',
        )
        .bind(company, shop, i.job, i.externalId),
    ),
    db
      .prepare(
        "UPDATE production_jobs SET next_run_at=0 WHERE company_id=? AND webshop_id=? AND job='runtime'",
      )
      .bind(company, shop),
  ]);
  const queued = results
    .slice(0, list.length)
    .reduce((n, r) => n + (r.meta.changes ?? 0), 0);
  return { queued, withinMinutes: 5 };
}

export async function handleAttention(
  request: Request,
  env: PlatformEnv,
  _actor: Actor,
  company: string,
  shop: string,
) {
  if (request.method === 'POST') {
    await requireCompany(env.PLATFORM_DB, _actor, company, true);
    if (shop === 'none') throw new HttpError(409, 'Forbind din webshop først.');
    const b = await jsonBody(request, 20000);
    if (b.action === 'dismiss')
      return reply(await dismissAttention(env, _actor, company, shop, b.items));
    if (b.action === 'restore')
      return reply(await restoreAttention(env, company, shop, b.items));
    if (b.action === 'retry')
      return reply(await retryAttention(env, company, shop, b.items));
    throw new HttpError(400, 'Ukendt handling.');
  }
  if (request.method !== 'GET') throw new HttpError(405, 'Brug Hent.');
  if (shop === 'none')
    return reply({
      total: 0,
      counts: { failed: 0, uncertain: 0, market: 0, waiting: 0 },
      items: [],
    });
  if (new URL(request.url).searchParams.get('dismissed') === '1')
    return reply({ dismissed: await dismissedAttention(env, company, shop) });
  return reply(await attention(env, company, shop));
}
