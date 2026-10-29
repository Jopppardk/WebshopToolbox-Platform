import { recordFailure, shopifyTable } from './record-history';
import { logUnexpected } from './error-log';
import { collapseRepeat } from './run-cleanup';
import { normalizeSyncInterval } from './tier1/src/lib/sync-schedule';
import { syncPackaging } from './packaging-source';
import { handleOperations } from './operations';
import { handleInvoices } from './invoices';
import { handlePayments } from './payments';
import { handleProductionSale } from './production-sales';
import { handleProductionOther } from './production-proposals';
import { generatePayoutReport } from './documents';
import {
  domesticOrderOfSql,
  domesticOrderSql,
  fillOrderMarkets,
} from './order-markets';
import {
  legacyRefundSql,
  saleBookedSql,
  voidOrderSql,
  syncOrderRefunds,
} from './order-refunds';
import { sendCreditNote } from './credit-notes';
import { receivableSaleSql, syncOrderPayments } from './order-payments';
import { productionWrites, bookingDate } from './production-policy';
import { dataStartDate, historyPolicy, providerStart } from './tier1-history';
import { InvoiceCheckError } from './order-check';
import { HttpError, type Actor, type PlatformEnv, type ShopJob } from './types';
import { danishDate } from './tier1/src/lib/history-policy';
// The reason shown in the bell: our own explanations (also the invoice check's), never raw internal errors.
// Unexpected errors are logged, and their ID is shown with the reason so the run can be found in Workers Logs.
const reason = (error: unknown, context: Record<string, string>) =>
  error instanceof HttpError || error instanceof InvoiceCheckError
    ? error.message
    : `Integrationen kunne ikke behandles. Kontrollér forbindelse og postens detaljer. Fejl-ID: ${logUnexpected(context, error)}`;
const request = (body: unknown) =>
  new Request('https://portal.webshoptoolbox.dk/internal-job', {
    method: 'POST',
    headers: {
      origin: 'https://portal.webshoptoolbox.dk',
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });
const plusDay = (value: string, days: number) =>
  new Date(Date.parse(value + 'T12:00:00Z') + days * 86400000)
    .toISOString()
    .slice(0, 10);
// On the payout date Shopify may report a payout as PAID before all its transactions are linked, and
// Flatpay can lag too, so it cannot be reconciled yet. For 2 days after the payout date a failure only
// means "not ready": it waits as Afventer and retries every 2 hours without ringing the bell.
const payoutGraceMs = 2 * 86400000,
  notReadyRetryMs = 2 * 3600000;
const payoutNotReady = (date: string) =>
  Date.now() - Date.parse(date.length === 10 ? date + 'T23:59:59Z' : date) <
  payoutGraceMs;
async function responseValue(response: Response) {
  const value = (await response.json()) as any;
  if (!response.ok)
    throw new HttpError(
      response.status,
      value.error || 'Jobbet kunne ikke gennemføres.',
    );
  return value;
}
type Mode = 'scheduled' | 'sales';
type QueueResult = { rows: number; failed: number };
export async function runProductionJobs(env: PlatformEnv) {
  if (!productionWrites(env)) return { status: 'disabled', processed: 0 };
  const deadline = Date.now() + 240000;
  // A live company administrator is selected server-side. No client supplied tenant
  // or identity is used, and all adapters recheck company and webshop permissions.
  const shops = await shopRows(env);
  let processed = 0;
  for (const shop of shops) {
    if (Date.now() > deadline) break;
    if (await runShop(env, shop, deadline, 'scheduled')) processed++;
  }
  return { status: 'completed', processed };
}

// With Cloudflare Queues the scheduler only finds the webshops that are due and not running, and sends one message
// per webshop; each message runs in its own invocation (runQueuedShop), so one slow webshop no longer holds up the
// others or the whole run. Messages carry IDs only: the webshop, its actor and its trial are checked again when run,
// and the lease in runShop keeps a webshop from running twice if a message arrives twice.
export async function queueDueShops(env: PlatformEnv, queue: Queue<ShopJob>) {
  if (!productionWrites(env)) return { status: 'disabled', queued: 0 };
  const now = Date.now();
  const due = (
    await env.PLATFORM_DB.prepare(`SELECT w.company_id,w.id FROM webshops w JOIN companies c ON c.id=w.company_id AND c.status='active' AND c.demo=0
 LEFT JOIN production_jobs j ON j.company_id=w.company_id AND j.webshop_id=w.id AND j.job='runtime'
 WHERE w.status='active' AND ${jobActorSql} IS NOT NULL AND NOT ${trialEndedSql} AND COALESCE(j.next_run_at,0)<=? AND COALESCE(j.lease_until,0)<?
 ORDER BY COALESCE(j.next_run_at,0),w.id LIMIT 1000`)
      .bind(now, now)
      .all<{ company_id: string; id: string }>()
  ).results;
  for (let i = 0; i < due.length; i += 100)
    await queue.sendBatch(
      due.slice(i, i + 100).map((row) => ({
        body: { kind: 'shop', company: row.company_id, webshop: row.id },
      })),
    );
  return { status: 'queued', queued: due.length };
}
export async function runQueuedShop(env: PlatformEnv, job: ShopJob) {
  if (!productionWrites(env)) return false;
  const [row] = await shopRows(env, {
    company: job.company,
    shop: job.webshop,
  });
  if (!row) return false;
  return !!(await runShop(env, row, Date.now() + 240000, 'scheduled'));
}

// Which webshops the scheduler runs (w = webshops of active, non-demo companies): those with a live company
// administrator to act as, and not on an ended trial. Shared with the operations overview (ops-monitor.ts).
export const jobActorSql = `(SELECT m.user_id FROM company_memberships m JOIN users a ON a.id=m.user_id
 WHERE m.company_id=w.company_id AND m.role='admin' AND a.status='active'
 AND NOT EXISTS(SELECT 1 FROM platform_admins pa WHERE pa.user_id=a.id) ORDER BY m.user_id LIMIT 1)`;
export const trialEndedSql = `EXISTS(SELECT 1 FROM public_signups ps WHERE ps.company_id=w.company_id AND ps.trial_ends_at<=unixepoch())`;
// A live company administrator is selected server-side. No client supplied tenant
// or identity is used, and all adapters recheck company and webshop permissions.
async function shopRows(
  env: PlatformEnv,
  only?: { company: string; shop: string },
) {
  return (
    await env.PLATFORM_DB.prepare(`SELECT w.company_id,w.id,COALESCE(p.preferences_json,'{}') preferences_json,p.revision,u.id actor_id,u.email,EXISTS(SELECT 1 FROM webshop_connections k WHERE k.company_id=w.company_id AND k.webshop_id=w.id AND k.provider='shopify' AND k.verified_at IS NOT NULL) shopify
 FROM webshops w JOIN companies c ON c.id=w.company_id AND c.status='active' AND c.demo=0
 LEFT JOIN tier1_preferences p ON p.company_id=w.company_id AND p.webshop_id=w.id
 JOIN users u ON u.id=${jobActorSql}
 LEFT JOIN production_jobs j ON j.company_id=w.company_id AND j.webshop_id=w.id AND j.job='runtime'
 WHERE w.status='active' AND (? IS NULL OR (w.company_id=? AND w.id=?)) AND NOT ${trialEndedSql} ORDER BY COALESCE(j.next_run_at,0),w.id LIMIT 10`)
      .bind(only?.company ?? null, only?.company ?? null, only?.shop ?? null)
      .all<any>()
  ).results;
}

async function runShop(
  env: PlatformEnv,
  shop: any,
  deadline: number,
  mode: Mode,
): Promise<false | { sales?: QueueResult; invoices?: QueueResult }> {
  const db = env.PLATFORM_DB;
  const company = shop.company_id,
    id = shop.id,
    actor: Actor = {
      id: shop.actor_id,
      email: shop.email,
      platformAdmin: false,
    };
  const owner = crypto.randomUUID(),
    now = Date.now(),
    prefs = JSON.parse(shop.preferences_json),
    automation = prefs.automation || {};
  // Same choices as the settings page (5, 15, 30, 60); anything else stored earlier runs as 15.
  const interval = normalizeSyncInterval(prefs.syncIntervalMinutes) * 60000;
  const claim = await db
    .prepare(`INSERT INTO production_jobs(company_id,webshop_id,job,lease_owner,lease_until) VALUES(?,?,'runtime',?,?)
 ON CONFLICT(company_id,webshop_id,job) DO UPDATE SET lease_owner=excluded.lease_owner,lease_until=excluded.lease_until
 WHERE production_jobs.lease_until<? AND (?='sales' OR production_jobs.next_run_at<=?)`)
    .bind(company, id, owner, now + 300000, now, mode, now)
    .run();
  if (claim.meta.changes !== 1) return false;
  const summary: { sales?: QueueResult; invoices?: QueueResult } = {};
  const owns = async () => {
    if (Date.now() > deadline)
      throw new HttpError(409, 'Jobbet fortsætter ved næste kørsel.');
    const active = await db
      .prepare(
        "SELECT 1 FROM production_jobs WHERE company_id=? AND webshop_id=? AND job='runtime' AND lease_owner=? AND lease_until>? AND (CASE WHEN ? IS NULL THEN NOT EXISTS(SELECT 1 FROM tier1_preferences p WHERE p.company_id=production_jobs.company_id AND p.webshop_id=production_jobs.webshop_id) ELSE EXISTS(SELECT 1 FROM tier1_preferences p WHERE p.company_id=production_jobs.company_id AND p.webshop_id=production_jobs.webshop_id AND p.revision=?) END) AND NOT EXISTS(SELECT 1 FROM public_signups ps WHERE ps.company_id=production_jobs.company_id AND ps.trial_ends_at<=unixepoch())",
      )
      .bind(company, id, owner, Date.now(), shop.revision, shop.revision)
      .first();
    if (!active) throw new HttpError(409, 'Joblåsen er udløbet.');
  };
  const run = async (name: string, work: () => Promise<unknown>) => {
    const runId = crypto.randomUUID();
    await db
      .prepare(
        "INSERT INTO operation_runs(id,company_id,webshop_id,module,status) VALUES(?,?,?,?,'running')",
      )
      .bind(runId, company, id, name)
      .run();
    try {
      await owns();
      await work();
      await db
        .prepare(
          "UPDATE operation_runs SET status='success',finished_at=CURRENT_TIMESTAMP WHERE id=?",
        )
        .bind(runId)
        .run();
    } catch (error) {
      const message = reason(error, { job: name, company, webshop: id });
      await db
        .prepare(
          "UPDATE operation_runs SET status='failed',message=?,finished_at=CURRENT_TIMESTAMP WHERE id=?",
        )
        .bind(message.slice(0, 600), runId)
        .run();
      return;
    }
    // A quiet repeat of the previous run is merged into it; this never fails the run itself.
    await collapseRepeat(db, runId).catch(() => false);
  };
  const cursor = async (job: string) => {
    const row = await db
      .prepare(
        'SELECT cursor_json FROM production_jobs WHERE company_id=? AND webshop_id=? AND job=?',
      )
      .bind(company, id, job)
      .first<{ cursor_json: string }>();
    return row ? JSON.parse(row.cursor_json) : {};
  };
  const saveCursor = async (job: string, value: unknown) => {
    await owns();
    await db
      .prepare(
        'INSERT INTO production_jobs(company_id,webshop_id,job,cursor_json) VALUES(?,?,?,?) ON CONFLICT(company_id,webshop_id,job) DO UPDATE SET cursor_json=excluded.cursor_json',
      )
      .bind(company, id, job, JSON.stringify(value))
      .run();
  };
  try {
    const policy = await historyPolicy(env, company),
      start = await providerStart(env, company, id, 'shopify'),
      scope = JSON.stringify([policy, start]);
    // Imports are read-only and run whenever Shopify is connected; automation switches only
    // control bookkeeping. Inventory is a full item list and stays behind its own switch.
    // Cadence: orders and refunds follow the chosen interval. Payouts (Shopify Payments and the payment
    // providers) are read every hour, or every 15 minutes while a payout is due today or overdue; inventory
    // every 4 hours; packaging history once a day (below). Synkronisér nu on a page always reads at once.
    const lastRun = async (group: string) =>
        Number((await cursor('pace.' + group)).lastAt) || 0,
      today = danishDate();
    const expecting = !!(await db
      .prepare(
        "SELECT 1 FROM operation_snapshots WHERE company_id=? AND webshop_id=? AND module='payouts' AND json_extract(payload_json,'$.status') IN ('SCHEDULED','IN_TRANSIT') AND substr(occurred_at,1,10)<=? UNION ALL SELECT 1 FROM payment_records WHERE company_id=? AND webshop_id=? AND provider='flatpay' AND external_id LIKE 'upcoming:%' AND substr(occurred_at,1,10)<=? LIMIT 1",
      )
      .bind(company, id, today, company, id, today)
      .first());
    const payoutsDue =
      mode === 'scheduled' &&
      Date.now() - (await lastRun('payouts')) >= (expecting ? 15 : 60) * 60000;
    const inventoryDue =
      mode === 'scheduled' &&
      !!automation.inventory &&
      Date.now() - (await lastRun('inventory')) >= 4 * 3600000;
    const imports =
      mode === 'scheduled' && shop.shopify
        ? [
            'orders',
            'refunds',
            ...(payoutsDue ? ['payments', 'payouts'] : []),
            ...(inventoryDue ? ['inventory'] : []),
          ]
        : [];
    const importModule = (module: string, body: Record<string, unknown>) =>
      handleOperations(request(body), env, actor, company, id, module).then(
        responseValue,
      );
    for (const module of imports) {
      await run('auto.import.' + module, async () => {
        const state = await cursor('import.' + module),
          current = state.scope === scope ? state : {};
        if (module === 'orders') {
          // Orders sync by change time from a watermark, oldest change first, so new orders and later
          // changes (fulfilment, cancellation) arrive every run however long the history is. The first
          // sync walks the whole history in bounded portions; a 10-minute overlap covers late writes.
          // Shops already synced by the earlier backwards walk resume 30 days back instead of from scratch.
          const migrated =
            !current.since && state.scope === scope && 'after' in state
              ? new Date(Date.now() - 30 * 86400000).toISOString()
              : null;
          let since: string =
              current.since || migrated || '2000-01-01T00:00:00Z',
            after: string | null = current.since ? current.after || null : null,
            newest: string | null = current.since
              ? current.newest || null
              : null;
          for (let page = 0; page < 20; page++) {
            const result = await importModule('orders', { after, since });
            if (
              result.maxUpdatedAt &&
              (!newest || result.maxUpdatedAt > newest)
            )
              newest = result.maxUpdatedAt;
            if (result.hasNextPage) {
              after = result.endCursor;
              await saveCursor('import.orders', {
                scope,
                since,
                after,
                newest,
              });
              continue;
            }
            if (newest)
              since = new Date(Date.parse(newest) - 600000).toISOString();
            await saveCursor('import.orders', {
              scope,
              since,
              after: null,
              newest: null,
            });
            return;
          }
          return;
        }
        // Newest page every run (new items and recent status changes), then one page of history
        // until the history has been walked once.
        const head = await importModule(module, { after: null });
        if (current.done || !head.hasNextPage) {
          await saveCursor('import.' + module, {
            scope,
            done: current.done || !head.hasNextPage,
          });
          return;
        }
        const next = await importModule(module, {
          after: current.after || head.endCursor,
        });
        await saveCursor(
          'import.' + module,
          next.hasNextPage
            ? { scope, after: next.endCursor }
            : { scope, done: true },
        );
      });
    }
    const connections =
      mode !== 'scheduled'
        ? []
        : (
            await db
              .prepare(
                'SELECT provider,start_date,revision FROM payment_connections WHERE company_id=? AND webshop_id=?',
              )
              .bind(company, id)
              .all<any>()
          ).results;
    // Payment provider imports are read-only and run for every connection; switches only control bookkeeping.
    for (const connection of payoutsDue ? connections : []) {
      const provider = connection.provider;
      // ViaBill rate-limits its API and fetches every payout separately, so it is read at most every
      // 30 minutes whatever the sync interval, and backs off (1 h doubling to 12 h) when it answers 429.
      // A 429 is expected throttling, not a failure: it waits quietly instead of ringing the bell.
      const paced = provider === 'viabill',
        pace = paced ? await cursor('viabill.pace') : {};
      if (paced && Number(pace.nextAt) > Date.now()) continue;
      let throttled = false;
      for (const kind of provider === 'flatpay'
        ? ['payments', 'settlements', 'transactions']
        : provider === 'pensopay'
          ? ['payments', 'settlements']
          : ['payment', 'payout']) {
        if (throttled) break;
        await run('auto.import.' + provider + '.' + kind, async () => {
          const job = provider + '.' + kind,
            stored = await cursor(job),
            today = danishDate(),
            boundary = [
              connection.start_date,
              await dataStartDate(env, company, id, provider),
            ]
              .sort()
              .at(-1)!;
          const signature = JSON.stringify([connection.revision, boundary]),
            state = stored.scope === signature ? stored : {};
          const from = state.start || boundary,
            end = [plusDay(from, 30), today].sort()[0];
          if (from > today) return;
          let result;
          try {
            result = await responseValue(
              await handlePayments(
                request({
                  kind,
                  start: from,
                  end,
                  cursor: state.cursor,
                  includeUpcoming: true,
                }),
                env,
                actor,
                company,
                id,
                provider,
                'sync',
              ),
            );
          } catch (error) {
            if (
              paced &&
              error instanceof HttpError &&
              /HTTP 429/.test(error.message)
            ) {
              throttled = true;
              return;
            }
            throw error;
          }
          const next = result.next || null;
          await saveCursor(job, {
            scope: signature,
            start: next ? from : end < today ? plusDay(end, 1) : boundary,
            cursor: next,
          });
        });
      }
      if (paced) {
        const wait = throttled
          ? Math.min(
              12 * 3600000,
              Math.max(3600000, 2 * (Number(pace.wait) || 0)),
            )
          : 0;
        await saveCursor('viabill.pace', {
          nextAt: Date.now() + (throttled ? wait : 30 * 60000),
          wait,
        });
      }
    }
    const packaging = await db
      .prepare(
        'SELECT config_json FROM emballage_connections WHERE company_id=? AND webshop_id=?',
      )
      .bind(company, id)
      .first<{ config_json: string }>();
    if (payoutsDue) await saveCursor('pace.payouts', { lastAt: Date.now() });
    if (inventoryDue)
      await saveCursor('pace.inventory', { lastAt: Date.now() });
    if (packaging && mode === 'scheduled') {
      const config = JSON.parse(packaging.config_json),
        today = danishDate(),
        state = await cursor('packaging.history');
      if (config.startDate && state.day !== today)
        await run('auto.packaging.history', async () => {
          await syncPackaging(
            env,
            company,
            id,
            [config.startDate, await dataStartDate(env, company, id)].sort()[1],
            today,
          );
          await saveCursor('packaging.history', { day: today });
        });
    }
    // Payout reports for every paid payout, whether or not bookkeeping is on. Newest first, a few per
    // run; a failed report waits six hours before the next attempt instead of blocking the others.
    if (mode === 'scheduled')
      await run('auto.reports', async () => {
        const pending = (
          await db
            .prepare(`SELECT external_id,occurred_at FROM (
 SELECT s.external_id,s.occurred_at FROM operation_snapshots s WHERE s.company_id=? AND s.webshop_id=? AND s.module='payouts' AND json_extract(s.payload_json,'$.status')='PAID' AND json_extract(s.payload_json,'$.transactionType')='DEPOSIT'
 UNION ALL SELECT 'flatpay:'||p.external_id,p.occurred_at FROM payment_records p WHERE p.company_id=? AND p.webshop_id=? AND p.provider='flatpay' AND p.kind='payments' AND p.paid=1) c
 WHERE NOT EXISTS(SELECT 1 FROM platform_payout_documents d WHERE d.company_id=? AND d.webshop_id=? AND d.external_id=c.external_id)
 AND NOT EXISTS(SELECT 1 FROM production_attempts a WHERE a.company_id=? AND a.webshop_id=? AND a.job='reports' AND a.external_id=c.external_id AND a.next_attempt_at>?)
 ORDER BY c.occurred_at DESC LIMIT 5`)
            .bind(
              company,
              id,
              company,
              id,
              company,
              id,
              company,
              id,
              Date.now(),
            )
            .all<{ external_id: string; occurred_at: string }>()
        ).results;
        // Each payout is reported once in the bell; retries back off from 6 hours to at most a week.
        const failed: string[] = [];
        for (const row of pending) {
          await owns();
          try {
            await generatePayoutReport(env, company, id, row.external_id);
          } catch (error) {
            if (payoutNotReady(row.occurred_at)) {
              await db
                .prepare(
                  "INSERT INTO production_attempts(company_id,webshop_id,job,external_id,attempted_at,next_attempt_at,failures) VALUES(?,?,'reports',?,?,?,0) ON CONFLICT(company_id,webshop_id,job,external_id) DO UPDATE SET attempted_at=excluded.attempted_at,next_attempt_at=excluded.next_attempt_at",
                )
                .bind(
                  company,
                  id,
                  row.external_id,
                  Date.now(),
                  Date.now() + notReadyRetryMs,
                )
                .run();
              continue;
            }
            const attempt = await db
              .prepare(
                "INSERT INTO production_attempts(company_id,webshop_id,job,external_id,attempted_at,next_attempt_at,failures) VALUES(?,?,'reports',?,?,?,1) ON CONFLICT(company_id,webshop_id,job,external_id) DO UPDATE SET attempted_at=excluded.attempted_at,next_attempt_at=excluded.attempted_at+min(604800000,21600000*(production_attempts.failures+1)),failures=production_attempts.failures+1 RETURNING failures",
              )
              .bind(
                company,
                id,
                row.external_id,
                Date.now(),
                Date.now() + 6 * 3600000,
              )
              .first<{ failures: number }>();
            if ((attempt?.failures ?? 1) === 1) {
              const provider = row.external_id.startsWith('flatpay:')
                  ? 'Flatpay'
                  : 'Shopify Payments',
                number = row.external_id.split(/[/:]/).pop();
              failed.push(
                `Udbetaling ${number} (${provider}): ${error instanceof HttpError ? error.message : 'Rapporten kunne ikke dannes.'}`,
              );
            }
          }
        }
        if (failed.length)
          throw new HttpError(
            409,
            (failed.length === 1
              ? 'En udbetalingsrapport kunne ikke dannes automatisk. '
              : `${failed.length} udbetalingsrapporter kunne ikke dannes automatisk. `) +
              failed.join(' ') +
              ' Prøv Generér rapport under Udbetalingsrapporter, når årsagen er rettet.',
          );
      });
    const processRows = async (
      job: string,
      provider: string,
      module: string,
      kind: string,
      book: boolean,
      email = false,
      custom?: (externalId: string) => Promise<unknown>,
    ): Promise<QueueResult> => {
      const result: QueueResult = { rows: 0, failed: 0 };
      const dates = (
        await db
          .prepare(
            'SELECT provider,start_date FROM booking_start_dates WHERE company_id=? AND webshop_id=?',
          )
          .bind(company, id)
          .all<{ provider: string; start_date: string }>()
      ).results;
      const sourceDate = dates.find((d) => d.provider === provider)?.start_date,
        dineroDate = dates.find((d) => d.provider === 'dinero')?.start_date;
      if (!sourceDate || !dineroDate)
        throw new HttpError(
          409,
          'Gem bogføringsstart for integrationen og Dinero.',
        );
      const boundary = [sourceDate, dineroDate].sort()[1];
      const table =
          provider === 'shopify' ? shopifyTable(module) : 'payment_records',
        filter =
          provider === 'shopify' ? 's.module=?' : 's.kind=? AND s.provider=?';
      // Orders wait until their market is known, and only domestic ones are invoiced, mailed or booked (see order-markets.ts).
      // An order that is already finished for this job is not checked again: a later refund or edit makes the
      // invoice check refuse it, although its invoice was sent and its sale booked before.
      const finished =
        job === 'sales'
          ? " AND NOT EXISTS(SELECT 1 FROM production_receipts r WHERE r.company_id=s.company_id AND r.webshop_id=s.webshop_id AND r.provider='shopify' AND r.module='orders' AND r.external_id=s.external_id AND (r.phase='booked' OR (r.phase='draft' AND ?=0))) AND NOT EXISTS(SELECT 1 FROM accounting_reconciliations r WHERE r.company_id=s.company_id AND r.webshop_id=s.webshop_id AND r.provider='shopify' AND r.module='orders' AND r.external_id=s.external_id)"
          : job === 'invoice'
            ? " AND NOT EXISTS(SELECT 1 FROM platform_invoices i JOIN production_receipts r ON r.company_id=i.company_id AND r.webshop_id=i.webshop_id AND r.provider='invoice' AND r.module='email' AND r.external_id=i.id AND r.phase='accepted' WHERE i.company_id=s.company_id AND i.webshop_id=s.webshop_id AND i.external_id=s.external_id)" +
              // A refunded order can be invoiced (the original order, plus a credit note per refund), but its invoice is only
              // mailed when it was shipped within the last 14 days, so customers never get an old invoice out of the blue.
              " AND (COALESCE(json_extract(s.payload_json,'$.displayFinancialStatus'),'') NOT IN ('REFUNDED','PARTIALLY_REFUNDED') OR (SELECT max(json_extract(f.value,'$.createdAt')) FROM json_each(s.payload_json,'$.fulfillments') f WHERE json_extract(f.value,'$.status')='SUCCESS')>=strftime('%Y-%m-%dT%H:%M:%SZ','now','-14 days'))"
            : '';
      const eligible =
        (module === 'orders' ? finished : '') +
        (module === 'orders'
          ? ' AND ' +
            domesticOrderSql +
            " AND COALESCE(json_extract(s.payload_json,'$.test'),0)=0 AND json_extract(s.payload_json,'$.cancelledAt') IS NULL AND json_extract(s.payload_json,'$.displayFulfillmentStatus')='FULFILLED' AND substr((SELECT max(json_extract(f.value,'$.createdAt')) FROM json_each(s.payload_json,'$.fulfillments') f WHERE json_extract(f.value,'$.status')='SUCCESS'),1,10)>=?"
          : // Payouts are only booked once paid out; upcoming ones are skipped instead of counted as failures.
            // Refunds of domestic orders that add up (others are shown for control), never one the earlier flow booked;
            // credit notes are only mailed for refunds from the last 14 days, so customers never get an old one out of the blue.
            module === 'order_payments'
            ? // Payments of orders on payment terms, once their sale is in Dinero on the receivables account.
              ' AND ' +
              domesticOrderOfSql('s.order_id') +
              " AND json_extract(s.payload_json,'$.problem') IS NULL AND " +
              receivableSaleSql()
            : module === 'order_refunds'
              ? ' AND ' +
                domesticOrderOfSql('s.order_id') +
                ' AND NOT ' +
                legacyRefundSql +
                " AND json_extract(s.payload_json,'$.problem') IS NULL" +
                // Nothing is booked or mailed for an order cancelled and fully refunded before its sale was booked.
                ' AND NOT ' +
                voidOrderSql('s', 's.order_id') +
                (job === 'order_refunds' ? ' AND ' + saleBookedSql : '') +
                (job === 'credit'
                  ? " AND s.occurred_at>=strftime('%Y-%m-%dT%H:%M:%SZ','now','-14 days')"
                  : '')
              : module === 'payouts'
                ? " AND json_extract(s.payload_json,'$.status')='PAID'"
                : provider === 'flatpay' && module === 'payments'
                  ? " AND json_extract(s.payload_json,'$.paidDate') IS NOT NULL"
                  : '');
      const rows = (
        await db
          .prepare(`SELECT s.external_id,s.occurred_at,json_extract(s.payload_json,'$.name') name,json_extract(s.payload_json,'$.orderName') order_name FROM ${table} s
 LEFT JOIN production_attempts a ON a.company_id=s.company_id AND a.webshop_id=s.webshop_id AND a.job=? AND a.external_id=s.external_id
 WHERE s.company_id=? AND s.webshop_id=? AND ${filter}${eligible} AND substr(s.occurred_at,1,10)>=? AND COALESCE(a.next_attempt_at,0)<=?
 ORDER BY COALESCE(a.attempted_at,0),s.occurred_at,s.external_id LIMIT 10`)
          .bind(
            job,
            company,
            id,
            ...(provider === 'shopify' ? [module] : [module, provider]),
            ...(job === 'sales' ? [book ? 1 : 0] : []),
            ...(module === 'orders' ? [plusDay(boundary, -1)] : []),
            module === 'orders' ? '1970-01-01' : plusDay(boundary, -1),
            Date.now(),
          )
          .all<any>()
      ).results;
      for (const row of rows) {
        await owns();
        const externalId = row.external_id;
        result.rows++;
        // Which post failed, so the bell says e.g. "Ordre #2701" instead of only the job.
        const short = String(externalId).split(/[/:]/).pop();
        const item =
          module === 'orders'
            ? 'Ordre ' + (row.name || short)
            : module === 'order_refunds'
              ? 'Tilbagebetaling på ordre ' + (row.order_name || short)
              : module === 'order_payments'
                ? 'Indbetaling på ordre ' + (row.order_name || short)
                : provider === 'flatpay'
                  ? 'Flatpay-udbetaling ' + short
                  : 'Udbetaling ' + short;
        await run('auto.' + job, async () => {
          let succeeded = false,
            recorded = false;
          const waiting =
            (job === 'payouts' || job === 'flatpay') &&
            payoutNotReady(row.occurred_at);
          let notReady = false;
          try {
            if (kind === 'sale' || email) {
              const checked = await responseValue(
                await handleInvoices(
                  request({ webshopId: id, externalId }),
                  env,
                  actor,
                  company,
                  'check',
                ),
              );
              const day = new Intl.DateTimeFormat('en-CA', {
                timeZone: 'Europe/Copenhagen',
                year: 'numeric',
                month: '2-digit',
                day: '2-digit',
              }).format(new Date(checked.invoice.date));
              if (day < boundary) {
                succeeded = true;
                return;
              }
              await bookingDate(
                env,
                company,
                id,
                provider,
                checked.invoice.date,
              );
            } else
              await bookingDate(env, company, id, provider, row.occurred_at);
            if (custom) {
              await custom(externalId);
              succeeded = true;
              return;
            }
            if (kind === 'sale' || email)
              await responseValue(
                await handleInvoices(
                  request({ webshopId: id, externalId }),
                  env,
                  actor,
                  company,
                  'generate',
                ),
              );
            if (email) {
              await responseValue(
                await handleInvoices(
                  request({ webshopId: id, externalId }),
                  env,
                  actor,
                  company,
                  'send',
                ),
              );
            } else {
              const invoke = (body: unknown) =>
                kind === 'sale'
                  ? handleProductionSale(request(body), env, actor, company, id)
                  : handleProductionOther(
                      request(body),
                      env,
                      actor,
                      company,
                      id,
                      kind,
                    );
              const inspected = await responseValue(
                await invoke({ kind, externalId, action: 'inspect' }),
              );
              if (
                inspected.phase !== 'booked' &&
                !(inspected.phase === 'draft' && !book)
              )
                await responseValue(
                  await invoke({
                    kind,
                    externalId,
                    action: 'retry',
                    version: inspected.version,
                    confirmed: true,
                  }),
                );
            }
            succeeded = true;
          } catch (error) {
            if (waiting) {
              notReady = true;
              return;
            }
            result.failed++;
            try {
              await recordFailure(
                env,
                company,
                id,
                provider,
                module,
                externalId,
                'Automatisk behandling: ' + job,
                error,
              );
            } catch {
              /* Keep original error and durable claims. */
            }
            // A post that keeps failing is retried after 15 minutes, then 1, 4 and 16 hours and at most daily, and is
            // reported in the bell once, with its reason, until it succeeds. Repeats stay in the post's own log.
            const attempt = await db
              .prepare(
                'INSERT INTO production_attempts(company_id,webshop_id,job,external_id,attempted_at,next_attempt_at,failures) VALUES(?,?,?,?,?,?,1) ON CONFLICT(company_id,webshop_id,job,external_id) DO UPDATE SET attempted_at=excluded.attempted_at,next_attempt_at=excluded.attempted_at+min(86400000,900000*(1<<min(8,2*production_attempts.failures))),failures=production_attempts.failures+1 RETURNING failures',
              )
              .bind(
                company,
                id,
                job,
                externalId,
                Date.now(),
                Date.now() + 900000,
              )
              .first<{ failures: number }>();
            recorded = true;
            if ((attempt?.failures ?? 1) === 1)
              throw new HttpError(
                409,
                item +
                  ': ' +
                  reason(error, {
                    job,
                    company,
                    webshop: id,
                    post: externalId,
                  }),
              );
          } finally {
            // Failed sources get a bounded cooldown instead of starving later orders.
            if (!recorded)
              await db
                .prepare(
                  'INSERT INTO production_attempts(company_id,webshop_id,job,external_id,attempted_at,next_attempt_at,failures) VALUES(?,?,?,?,?,?,?) ON CONFLICT(company_id,webshop_id,job,external_id) DO UPDATE SET attempted_at=excluded.attempted_at,next_attempt_at=excluded.next_attempt_at,failures=CASE WHEN excluded.failures=0 THEN 0 ELSE production_attempts.failures+1 END',
                )
                .bind(
                  company,
                  id,
                  job,
                  externalId,
                  Date.now(),
                  Date.now() +
                    (succeeded
                      ? 86400000
                      : notReady
                        ? notReadyRetryMs
                        : 900000),
                  succeeded || notReady ? 0 : 1,
                )
                .run();
          }
        });
      }
      return result;
    };
    // Country and currency for new orders (and, in portions, older ones) right after they are imported.
    if (shop.shopify)
      await run('auto.import.markets', async () => {
        await fillOrderMarkets(env, company, id);
      });
    if (automation.sales)
      await run('auto.sales.queue', async () => {
        summary.sales = await processRows(
          'sales',
          'shopify',
          'orders',
          'sale',
          automation.salesBookDinero,
        );
      });
    // Refunds of every order whatever the gateway, read from the orders whose refunded amount changed.
    if (shop.shopify && mode === 'scheduled')
      await run('auto.import.order_refunds', async () => {
        await syncOrderRefunds(env, company, id);
      });
    if (automation.refunds && mode === 'scheduled')
      await run('auto.order_refunds.queue', () =>
        processRows(
          'order_refunds',
          'shopify',
          'order_refunds',
          'order_refund',
          automation.refundsBookDinero,
        ),
      );
    // Payments of orders sold on payment terms (B2B invoices), whose sale was booked on the receivables account.
    if (automation.sales && mode === 'scheduled') {
      if (shop.shopify)
        await run('auto.import.order_payments', async () => {
          await syncOrderPayments(env, company, id);
        });
      await run('auto.order_payments.queue', () =>
        processRows(
          'order_payments',
          'shopify',
          'order_payments',
          'order_payment',
          automation.salesBookDinero,
        ),
      );
    }
    if (automation.payouts && mode === 'scheduled') {
      await run('auto.payouts.queue', () =>
        processRows(
          'payouts',
          'shopify',
          'payouts',
          'payout',
          automation.payoutsBookDinero,
        ),
      );
      if (connections.some((c) => c.provider === 'flatpay'))
        await run('auto.flatpay.queue', () =>
          processRows(
            'flatpay',
            'flatpay',
            'payments',
            'flatpay',
            automation.payoutsBookDinero,
          ),
        );
    }
    if (automation.invoiceEmails && env.PLATFORM_CUSTOMER_EMAIL === 'enabled')
      await run('auto.invoice.queue', async () => {
        summary.invoices = await processRows(
          'invoice',
          'shopify',
          'orders',
          'sale',
          false,
          true,
        );
      });
    if (
      automation.invoiceEmails &&
      env.PLATFORM_CUSTOMER_EMAIL === 'enabled' &&
      mode === 'scheduled'
    )
      await run('auto.credit.queue', () =>
        processRows(
          'credit',
          'shopify',
          'order_refunds',
          'credit',
          false,
          false,
          (externalId) => sendCreditNote(env, actor, company, id, externalId),
        ),
      );
    return summary;
  } finally {
    // "Synkronisér nu" leaves the schedule as it was.
    if (mode === 'scheduled')
      await db
        .prepare(
          "UPDATE production_jobs SET lease_owner=NULL,lease_until=0,next_run_at=? WHERE company_id=? AND webshop_id=? AND job='runtime' AND lease_owner=?",
        )
        .bind(now + interval - 60000, company, id, owner)
        .run();
    else
      await db
        .prepare(
          "UPDATE production_jobs SET lease_owner=NULL,lease_until=0 WHERE company_id=? AND webshop_id=? AND job='runtime' AND lease_owner=?",
        )
        .bind(company, id, owner)
        .run();
  }
}

/** "Synkronisér nu" on Salg: after the orders are fetched, run the same sales and invoice steps the
 * schedule would, for this shop only and only as far as its automation switches allow. */
export async function runSalesNow(
  env: PlatformEnv,
  company: string,
  shop: string,
) {
  if (!productionWrites(env)) return { status: 'disabled' as const };
  const [row] = await shopRows(env, { company, shop });
  if (!row) return { status: 'unavailable' as const };
  const automation = JSON.parse(row.preferences_json || '{}').automation || {};
  if (
    !automation.sales &&
    !(automation.invoiceEmails && env.PLATFORM_CUSTOMER_EMAIL === 'enabled')
  )
    return { status: 'off' as const };
  // Report what actually changed, not how many orders were looked at.
  const counts = async () =>
    env.PLATFORM_DB.prepare(`SELECT
 (SELECT count(*) FROM platform_invoices WHERE company_id=?1 AND webshop_id=?2 AND status='generated') invoices,
 (SELECT count(*) FROM production_receipts WHERE company_id=?1 AND webshop_id=?2 AND provider='shopify' AND module='orders' AND phase='booked') booked,
 (SELECT count(*) FROM production_receipts WHERE company_id=?1 AND webshop_id=?2 AND provider='shopify' AND module='orders' AND phase='draft') drafts,
 (SELECT count(*) FROM production_receipts WHERE company_id=?1 AND webshop_id=?2 AND provider='invoice' AND module='email' AND phase='accepted') sent`)
      .bind(company, shop)
      .first<{
        invoices: number;
        booked: number;
        drafts: number;
        sent: number;
      }>();
  const before = await counts(),
    result = await runShop(env, row, Date.now() + 45000, 'sales');
  if (!result) return { status: 'busy' as const };
  const after = await counts();
  return {
    status: 'completed' as const,
    invoices: after!.invoices - before!.invoices,
    booked: after!.booked - before!.booked,
    drafts: Math.max(0, after!.drafts - before!.drafts),
    sent: after!.sent - before!.sent,
    failed: (result.sales?.failed || 0) + (result.invoices?.failed || 0),
  };
}
