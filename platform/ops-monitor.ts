// Operations monitoring for the platform admins (Tier 0). Every scheduled tick leaves a heartbeat and checks
// for problems the customers cannot fix themselves:
// - stalled: a webshop the scheduler should run is more than 30 minutes past its next run (stuck or a backlog),
// - failing: an import or queue (not a single post) failed its last 3 runs,
// - scheduler: the scheduled jobs themselves have failed for 30 minutes.
// Each problem is mailed to the active platform admins once when it starts and once when it is resolved, and a
// daily mail at 7 (Danish time) sums up the last day. Single posts that fail stay in the customer's bell.
// If the cron stops altogether nothing here runs: the daily mail then stays away, and GET /healthz/scheduler
// answers 503 for an external uptime monitor.
import { neverRetry, settledFailureSql } from './attention';
import { jobActorSql, trialEndedSql } from './production-jobs';
import { productionWrites } from './production-policy';
import { HttpError, type Actor, type PlatformEnv } from './types';

export const stallMinutes = 30,
  failingRuns = 3;
// Runs for a single post; their failures are the customer's (the bell), not an operations problem.
const postModules = [
  'auto.sales',
  'auto.order_refunds',
  'auto.order_payments',
  'auto.payouts',
  'auto.flatpay',
  'auto.invoice',
  'auto.credit',
];
const sender = 'no-reply@webshoptoolbox.dk';
const copenhagen = (date: Date, part: 'day' | 'hour') =>
  part === 'day'
    ? new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Europe/Copenhagen',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(date)
    : Number(
        new Intl.DateTimeFormat('en-GB', {
          timeZone: 'Europe/Copenhagen',
          hour: '2-digit',
          hourCycle: 'h23',
        }).format(date),
      );
const danishTime = (value: string | null) =>
  value
    ? new Intl.DateTimeFormat('da-DK', {
        timeZone: 'Europe/Copenhagen',
        dateStyle: 'short',
        timeStyle: 'short',
      }).format(
        new Date(value.includes('T') ? value : value.replace(' ', 'T') + 'Z'),
      )
    : 'aldrig';
const moduleName = (module: string) =>
  (
    ({
      'auto.import.orders': 'Import af ordrer',
      'auto.import.payouts': 'Import af udbetalinger',
      'auto.import.inventory': 'Import af lager',
      'auto.import.markets': 'Markeder på ordrer',
      'auto.import.order_refunds': 'Import af tilbagebetalinger',
      'auto.sales.queue': 'Salg til Dinero',
      'auto.order_refunds.queue': 'Tilbagebetalinger til Dinero',
      'auto.import.order_payments': 'Import af indbetalinger på fakturaer',
      'auto.order_payments.queue': 'Indbetalinger på fakturaer til Dinero',
      'auto.payouts.queue': 'Udbetalinger til Dinero',
      'auto.flatpay.queue': 'Flatpay til Dinero',
      'auto.invoice.queue': 'Fakturamails',
      'auto.credit.queue': 'Kreditnotamails',
      'auto.reports': 'Udbetalingsrapporter',
      'auto.packaging.history': 'Emballagehistorik',
    }) as Record<string, string>
  )[module] || module;

// Called around the scheduled jobs. 'start' only stamps the tick; 'ok' and 'error' close it.
export async function markTick(
  env: PlatformEnv,
  state: 'start' | 'ok' | 'error',
  error?: unknown,
) {
  const db = env.PLATFORM_DB;
  if (state === 'start')
    await db
      .prepare('UPDATE ops_state SET last_tick_at=CURRENT_TIMESTAMP WHERE id=1')
      .run();
  else if (state === 'ok')
    await db
      .prepare(
        "UPDATE ops_state SET last_tick_ok_at=CURRENT_TIMESTAMP,last_tick_error='' WHERE id=1",
      )
      .run();
  else
    await db
      .prepare('UPDATE ops_state SET last_tick_error=? WHERE id=1')
      .bind(
        String(error instanceof Error ? error.message : error).slice(0, 300),
      )
      .run();
}

type Problem = {
  key: string;
  kind: 'scheduler' | 'stalled' | 'failing';
  company: string | null;
  shop: string | null;
  message: string;
};
const shopsSql = `FROM webshops w JOIN companies c ON c.id=w.company_id AND c.status='active' AND c.demo=0
 LEFT JOIN production_jobs j ON j.company_id=w.company_id AND j.webshop_id=w.id AND j.job='runtime'
 WHERE w.status='active'`;

async function findProblems(env: PlatformEnv): Promise<Problem[]> {
  const db = env.PLATFORM_DB,
    problems: Problem[] = [];
  const state = await db
    .prepare(
      `SELECT last_tick_ok_at<datetime('now','-${stallMinutes} minutes') failing,last_tick_error FROM ops_state WHERE id=1 AND last_tick_ok_at IS NOT NULL`,
    )
    .first<{ failing: number; last_tick_error: string }>();
  if (state?.failing)
    problems.push({
      key: 'scheduler',
      kind: 'scheduler',
      company: null,
      shop: null,
      message: `De automatiske kørsler har fejlet i over ${stallMinutes} minutter: ${state.last_tick_error || 'ukendt fejl'}`,
    });
  const stalled = (
    await db
      .prepare(`SELECT w.company_id,w.id,j.next_run_at ${shopsSql} AND ${jobActorSql} IS NOT NULL AND NOT ${trialEndedSql}
 AND j.next_run_at>0 AND j.next_run_at<?`)
      .bind(Date.now() - stallMinutes * 60000)
      .all<{ company_id: string; id: string; next_run_at: number }>()
  ).results;
  for (const s of stalled)
    problems.push({
      key: `stalled:${s.company_id}:${s.id}`,
      kind: 'stalled',
      company: s.company_id,
      shop: s.id,
      message: `Kørslen er ${Math.round((Date.now() - s.next_run_at) / 60000)} minutter forsinket.`,
    });
  // The last three runs of each import or queue in the last 6 hours, newest first.
  const failing = (
    await db
      .prepare(`SELECT company_id,webshop_id,module,max(CASE WHEN rn=1 THEN message END) message FROM (
 SELECT company_id,webshop_id,module,status,message,row_number() OVER (PARTITION BY company_id,webshop_id,module ORDER BY started_at DESC,id DESC) rn
 FROM operation_runs WHERE started_at>datetime('now','-6 hours') AND module LIKE 'auto.%' AND module NOT IN (SELECT value FROM json_each(?)) AND status<>'running'
) WHERE rn<=? GROUP BY company_id,webshop_id,module HAVING count(*)=? AND sum(status='failed')=?`)
      .bind(JSON.stringify(postModules), failingRuns, failingRuns, failingRuns)
      .all<{
        company_id: string;
        webshop_id: string;
        module: string;
        message: string;
      }>()
  ).results;
  for (const f of failing)
    problems.push({
      key: `failing:${f.company_id}:${f.webshop_id}:${f.module}`,
      kind: 'failing',
      company: f.company_id,
      shop: f.webshop_id,
      message: `${moduleName(f.module)} er fejlet ${failingRuns} gange i træk: ${f.message || 'ingen besked'}`,
    });
  return problems;
}

async function recipients(env: PlatformEnv) {
  return (
    await env.PLATFORM_DB.prepare(
      "SELECT u.email FROM users u JOIN platform_admins a ON a.user_id=u.id WHERE u.status='active' ORDER BY u.email",
    ).all<{ email: string }>()
  ).results.map((r) => r.email);
}
async function mail(env: PlatformEnv, subject: string, text: string) {
  const to = await recipients(env);
  if (!to.length || !env.PLATFORM_AUTH_MAIL) return false;
  for (const address of to)
    await env.PLATFORM_AUTH_MAIL.send({
      from: { email: sender, name: 'WebshopToolbox drift' },
      to: address,
      subject,
      text,
    });
  return true;
}
async function names(env: PlatformEnv) {
  const rows = (
    await env.PLATFORM_DB.prepare(
      'SELECT w.company_id,w.id,c.name company,w.name shop FROM webshops w JOIN companies c ON c.id=w.company_id',
    ).all<{ company_id: string; id: string; company: string; shop: string }>()
  ).results;
  const map = new Map(
    rows.map((r) => [r.company_id + ':' + r.id, `${r.company} · ${r.shop}`]),
  );
  return (company: string | null, shop: string | null) =>
    company && shop
      ? map.get(company + ':' + shop) || `${company} · ${shop}`
      : 'Platformen';
}

// Records the problems found now, mails new and resolved ones, and sends the daily mail when it is due.
export async function checkOperations(env: PlatformEnv, now = new Date()) {
  if (!productionWrites(env)) return { problems: 0, mailed: 0 };
  const db = env.PLATFORM_DB,
    problems = await findProblems(env);
  const keys = JSON.stringify(problems.map((p) => p.key));
  await db.batch([
    ...problems.map((p) =>
      db
        .prepare(`INSERT INTO ops_alerts(key,kind,company_id,webshop_id,message) VALUES(?,?,?,?,?)
 ON CONFLICT(key) DO UPDATE SET message=excluded.message,last_seen_at=CURRENT_TIMESTAMP,
 first_at=CASE WHEN ops_alerts.resolved_at IS NULL THEN ops_alerts.first_at ELSE CURRENT_TIMESTAMP END,
 notified_at=CASE WHEN ops_alerts.resolved_at IS NULL THEN ops_alerts.notified_at END,
 resolved_notified_at=CASE WHEN ops_alerts.resolved_at IS NULL THEN ops_alerts.resolved_notified_at END,resolved_at=NULL`)
        .bind(p.key, p.kind, p.company, p.shop, p.message),
    ),
    db
      .prepare(
        'UPDATE ops_alerts SET resolved_at=CURRENT_TIMESTAMP WHERE resolved_at IS NULL AND key NOT IN (SELECT value FROM json_each(?))',
      )
      .bind(keys),
    db.prepare(
      "DELETE FROM ops_alerts WHERE resolved_at<datetime('now','-90 days')",
    ),
  ]);
  // Claim before sending, so two overlapping ticks never mail the same change twice.
  const claim = crypto.randomUUID();
  await db.batch([
    db
      .prepare(
        'UPDATE ops_alerts SET notified_at=? WHERE resolved_at IS NULL AND notified_at IS NULL',
      )
      .bind(claim),
    db
      .prepare(
        'UPDATE ops_alerts SET resolved_notified_at=? WHERE resolved_at IS NOT NULL AND notified_at IS NOT NULL AND resolved_notified_at IS NULL',
      )
      .bind(claim),
  ]);
  const changed = (
    await db
      .prepare(
        'SELECT key,kind,company_id,webshop_id,message,resolved_at FROM ops_alerts WHERE notified_at=? OR resolved_notified_at=? ORDER BY resolved_at IS NOT NULL,first_at',
      )
      .bind(claim, claim)
      .all<{
        key: string;
        company_id: string | null;
        webshop_id: string | null;
        message: string;
        resolved_at: string | null;
      }>()
  ).results;
  let mailed = 0;
  if (changed.length) {
    const label = await names(env),
      started = changed.filter((c) => !c.resolved_at),
      resolved = changed.filter((c) => c.resolved_at);
    const text = [
      ...(started.length
        ? [
            'Nye driftsproblemer:',
            ...started.map(
              (c) => `- ${label(c.company_id, c.webshop_id)}: ${c.message}`,
            ),
            '',
          ]
        : []),
      ...(resolved.length
        ? [
            'Løst:',
            ...resolved.map(
              (c) => `- ${label(c.company_id, c.webshop_id)}: ${c.message}`,
            ),
            '',
          ]
        : []),
      'Se Tier 0 → Indsigt → Driftsoverblik.',
      '',
      'WebshopToolbox',
    ].join('\n');
    const subject = started.length
      ? `Driftsalarm: ${started.length} ${started.length === 1 ? 'problem' : 'problemer'} på WebshopToolbox`
      : 'Driftsalarm løst på WebshopToolbox';
    try {
      if (await mail(env, subject, text)) mailed++;
    } catch (error) {
      // Not sent: release the claim so the next tick tries again.
      await db.batch([
        db
          .prepare('UPDATE ops_alerts SET notified_at=NULL WHERE notified_at=?')
          .bind(claim),
        db
          .prepare(
            'UPDATE ops_alerts SET resolved_notified_at=NULL WHERE resolved_notified_at=?',
          )
          .bind(claim),
      ]);
      console.error('Driftsalarmen kunne ikke sendes', error);
    }
  }
  const today = copenhagen(now, 'day') as string;
  if ((copenhagen(now, 'hour') as number) >= 7) {
    const previous = await db
      .prepare('SELECT digest_date FROM ops_state WHERE id=1')
      .first<{ digest_date: string }>();
    const claimed = await db
      .prepare(
        'UPDATE ops_state SET digest_date=? WHERE id=1 AND digest_date<?',
      )
      .bind(today, today)
      .run();
    if (claimed.meta.changes === 1) {
      try {
        if (
          await mail(
            env,
            `Driftsoverblik ${today}: WebshopToolbox`,
            await digest(env),
          )
        )
          mailed++;
      } catch (error) {
        await db
          .prepare(
            'UPDATE ops_state SET digest_date=? WHERE id=1 AND digest_date=?',
          )
          .bind(previous?.digest_date ?? '', today)
          .run();
        console.error('Den daglige driftsmail kunne ikke sendes', error);
      }
    }
  }
  return { problems: problems.length, mailed };
}

async function digest(env: PlatformEnv) {
  const view = await overview(env),
    lines = [
      `Seneste gennemførte kørsel: ${danishTime(view.scheduler.lastOkAt)}.`,
      '',
    ];
  if (view.alerts.length)
    lines.push(
      'Åbne driftsproblemer:',
      ...view.alerts.map(
        (a) => `- ${a.label}: ${a.message} (siden ${danishTime(a.firstAt)})`,
      ),
      '',
    );
  const attention = view.shops.filter(
    (s) =>
      s.failed24h ||
      s.retrying ||
      s.delayMinutes > stallMinutes ||
      !s.scheduled,
  );
  if (attention.length)
    lines.push(
      'Webshops med fejl det seneste døgn:',
      ...attention.map(
        (s) =>
          `- ${s.label}: ${[
            !s.scheduled ? s.reason : '',
            s.failed24h ? `${s.failed24h} fejlede kørsler` : '',
            s.retrying ? `${s.retrying} poster venter på nyt forsøg` : '',
            s.delayMinutes > stallMinutes
              ? `${s.delayMinutes} min. forsinket`
              : '',
          ]
            .filter(Boolean)
            .join(', ')}`,
      ),
      '',
    );
  else lines.push(`Alle ${view.shops.length} webshops kører uden fejl.`, '');
  lines.push('Se Tier 0 → Indsigt → Driftsoverblik.', '', 'WebshopToolbox');
  return lines.join('\n');
}

// The cross-customer overview in Tier 0 and the source of the daily mail.
export async function overview(env: PlatformEnv) {
  const db = env.PLATFORM_DB,
    label = await names(env);
  const [state, alerts, shops, failed, retrying, success] = await Promise.all([
    db
      .prepare(
        'SELECT last_tick_at,last_tick_ok_at,last_tick_error FROM ops_state WHERE id=1',
      )
      .first<{
        last_tick_at: string | null;
        last_tick_ok_at: string | null;
        last_tick_error: string;
      }>(),
    db
      .prepare(
        'SELECT key,kind,company_id,webshop_id,message,first_at FROM ops_alerts WHERE resolved_at IS NULL ORDER BY first_at',
      )
      .all<{
        key: string;
        kind: string;
        company_id: string | null;
        webshop_id: string | null;
        message: string;
        first_at: string;
      }>(),
    db
      .prepare(
        `SELECT w.company_id,w.id,${jobActorSql} IS NOT NULL has_actor,${trialEndedSql} trial_ended,j.next_run_at ${shopsSql} ORDER BY c.name,w.name`,
      )
      .all<{
        company_id: string;
        id: string;
        has_actor: number;
        trial_ended: number;
        next_run_at: number | null;
      }>(),
    db
      .prepare(
        "SELECT company_id,webshop_id,count(*) n FROM operation_runs WHERE status='failed' AND started_at>datetime('now','-1 day') GROUP BY company_id,webshop_id",
      )
      .all<{ company_id: string; webshop_id: string; n: number }>(),
    db
      .prepare(
        // Posts the customer dismissed (stopped until Fortryd), or that were booked or voided since, wait for nothing.
        `SELECT company_id,webshop_id,count(*) n FROM production_attempts a WHERE failures>0 AND next_attempt_at>? AND next_attempt_at<>?
 AND NOT ${settledFailureSql('a')} GROUP BY company_id,webshop_id`,
      )
      .bind(Date.now(), neverRetry)
      .all<{ company_id: string; webshop_id: string; n: number }>(),
    db
      .prepare(
        "SELECT company_id,webshop_id,max(finished_at) at FROM operation_runs WHERE status='success' AND started_at>datetime('now','-1 day') GROUP BY company_id,webshop_id",
      )
      .all<{ company_id: string; webshop_id: string; at: string }>(),
  ]);
  const by = <T extends { company_id: string; webshop_id: string }>(
    rows: T[],
  ) => new Map(rows.map((r) => [r.company_id + ':' + r.webshop_id, r]));
  const failedBy = by(failed.results),
    retryingBy = by(retrying.results),
    successBy = by(success.results);
  return {
    scheduler: {
      enabled: productionWrites(env),
      lastTickAt: state?.last_tick_at ?? null,
      lastOkAt: state?.last_tick_ok_at ?? null,
      lastError: state?.last_tick_error || '',
    },
    alerts: alerts.results.map((a) => ({
      key: a.key,
      kind: a.kind,
      companyId: a.company_id,
      webshopId: a.webshop_id,
      label: label(a.company_id, a.webshop_id),
      message: a.message,
      firstAt: a.first_at,
    })),
    shops: shops.results.map((s) => {
      const key = s.company_id + ':' + s.id;
      return {
        companyId: s.company_id,
        webshopId: s.id,
        label: label(s.company_id, s.id),
        scheduled: !!s.has_actor && !s.trial_ended,
        reason: !s.has_actor
          ? 'Ingen aktiv administrator, så den kører ikke automatisk'
          : s.trial_ended
            ? 'Prøveperioden er udløbet'
            : '',
        nextRunAt: s.next_run_at ? new Date(s.next_run_at).toISOString() : null,
        delayMinutes: s.next_run_at
          ? Math.max(0, Math.round((Date.now() - s.next_run_at) / 60000))
          : 0,
        lastSuccessAt: successBy.get(key)?.at ?? null,
        failed24h: failedBy.get(key)?.n ?? 0,
        retrying: retryingBy.get(key)?.n ?? 0,
      };
    }),
  };
}

export async function handleOperationsOverview(
  request: Request,
  env: PlatformEnv,
  actor: Actor,
) {
  if (!actor.platformAdmin || actor.support)
    throw new HttpError(403, 'Driftsoverblikket findes kun i Tier 0.');
  if (request.method !== 'GET') throw new HttpError(405, 'Brug Hent.');
  return Response.json(await overview(env));
}

// For an external uptime monitor: 200 while the scheduler completes runs, 503 when it has not for 30 minutes.
// No customer data, only whether and how long ago.
export async function schedulerHealth(env: PlatformEnv) {
  if (!productionWrites(env))
    return Response.json({ ok: true, scheduler: 'disabled' });
  const row = await env.PLATFORM_DB.prepare(
    "SELECT CAST((julianday('now')-julianday(last_tick_ok_at))*1440 AS INTEGER) minutes FROM ops_state WHERE id=1 AND last_tick_ok_at IS NOT NULL",
  ).first<{ minutes: number }>();
  const ok = !!row && row.minutes <= stallMinutes;
  return Response.json(
    { ok, minutesSinceLastRun: row?.minutes ?? null },
    { status: ok ? 200 : 503 },
  );
}
