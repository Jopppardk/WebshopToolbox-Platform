import { asText } from './tier1/src/lib/format';
import {
  connectedIntegrations,
  selectedIntegrations,
} from './tier1-connections';
import { normalizeSyncInterval } from './tier1/src/lib/sync-schedule';
import { handleProductionSale } from './production-sales';
import { handleProductionOther } from './production-proposals';
import { productionWrites } from './production-policy';
import { bookingStatuses } from './booking-onboarding';
import { handleMail } from './mail';
import { requireCompany } from './auth';
import { jsonBody } from './invitations';
import { unseal } from './connections';
import { readDineroAccounts, readDineroSuppliers } from './dinero-read';
import { handleStocktake } from './stocktake';
import { handleInvoices } from './invoices';
import { handlePackaging } from './packaging';
import { financeService } from './finance-source';
import { dataStartDate } from './tier1-history';
import { ensureMarketRow, webshopInvoiceRow } from './invoice-profiles';
import { HttpError, reply, type Actor, type PlatformEnv } from './types';
import { forwarded, pageNumber } from './tier1-data-shared';
import { orderData } from './tier1-orders';
import { orderRefundData } from './tier1-order-refunds';
import { documentData } from './tier1-documents';
import { providerRecordData } from './tier1-provider-records';

export async function handleTier1Data(
  request: Request,
  env: PlatformEnv,
  actor: Actor,
  company: string,
  shop: string,
  path: string,
): Promise<Response | null> {
  const db = env.PLATFORM_DB,
    url = new URL(request.url),
    get = request.method === 'GET';
  if (path === '/runtime' && get)
    return reply({
      production: env.PLATFORM_ENV === 'production',
      bookkeeping: productionWrites(env),
      customerEmail:
        env.PLATFORM_ENV === 'production' &&
        env.PLATFORM_CUSTOMER_EMAIL === 'enabled',
    });
  if (path === '/bookkeeping/manual' && !get && productionWrites(env)) {
    const b = await jsonBody(request);
    const next = forwarded(request, b);
    return b.kind === 'sale'
      ? handleProductionSale(next, env, actor, company, shop)
      : handleProductionOther(next, env, actor, company, shop, String(b.kind));
  }
  if (
    path === '/invoices/email' &&
    !get &&
    env.PLATFORM_ENV === 'production' &&
    env.PLATFORM_CUSTOMER_EMAIL === 'enabled'
  ) {
    const b = await jsonBody(request);
    return handleInvoices(
      forwarded(request, { webshopId: shop, externalId: b.externalId }),
      env,
      actor,
      company,
      'send',
    );
  }
  const blocked = [
    '/bookkeeping/manual',
    '/sales/transfer',
    '/refunds/transfer',
    '/payouts/transfer',
    '/flatpay/draft',
    '/flatpay/production',
    '/invoices/email',
  ];
  if (blocked.includes(path) && !get)
    throw new HttpError(
      403,
      'Denne overførsel er ikke tilgængelig her. Brug Bogfør manuelt på posten i produktionsportalen.',
    );
  const runs = async () =>
    (
      await db
        .prepare(
          'SELECT * FROM operation_runs WHERE company_id=? AND webshop_id=? ORDER BY started_at DESC,id DESC LIMIT 1000',
        )
        .bind(company, shop)
        .all<any>()
    ).results;
  // Polled every 15 seconds by each open portal: only the newest run is read.
  if (path === '/admin/sync-status' && get) {
    const row = await db
        .prepare(
          'SELECT status,started_at,finished_at FROM operation_runs WHERE company_id=? AND webshop_id=? ORDER BY started_at DESC,id DESC LIMIT 1',
        )
        .bind(company, shop)
        .first<any>(),
      saved = await db
        .prepare(
          'SELECT preferences_json FROM tier1_preferences WHERE company_id=? AND webshop_id=?',
        )
        .bind(company, shop)
        .first<{ preferences_json: string }>();
    return reply({
      automatic: productionWrites(env),
      intervalMinutes: normalizeSyncInterval(
        saved ? JSON.parse(saved.preferences_json).syncIntervalMinutes : 15,
      ),
      serverNow: Date.now(),
      status:
        row?.status === 'success' ? 'succeeded' : row?.status || 'unknown',
      startedAt: row?.started_at || null,
      finishedAt: row?.finished_at || null,
      blockedUntil: null,
    });
  }
  if (path === '/admin/insights' && get) {
    if (!actor.platformAdmin || actor.support)
      throw new HttpError(403, 'Joboversigten findes kun i Tier 0.');
    const list = (await runs()).map((r) => ({
      ...r,
      job_key: r.module,
      job_name: r.module,
      status: r.status === 'success' ? 'succeeded' : r.status,
      // A row can stand for several quiet runs in a row (collapseRepeat in run-cleanup.ts).
      repeats: r.repeats ?? 1,
      duration_ms: r.finished_at
        ? Date.parse(r.finished_at) - Date.parse(r.started_at)
        : null,
    }));
    const status = url.searchParams.get('status'),
      filtered = status ? list.filter((r) => r.status === status) : list,
      runsWith = (wanted?: string) =>
        list
          .filter((r) => !wanted || r.status === wanted)
          .reduce((n, r) => n + r.repeats, 0),
      p = Math.max(1, pageNumber(url.searchParams.get('page'), 1));
    return reply({
      summary: {
        total: runsWith(),
        succeeded: runsWith('succeeded'),
        failed: runsWith('failed'),
        skipped: 0,
        running: list.filter((r) => r.status === 'running').length,
      },
      latest: list.slice(0, 20),
      runs: filtered.slice((p - 1) * 50, p * 50),
      pagination: {
        page: p,
        pageSize: 50,
        total: filtered.length,
        until: new Date().toISOString(),
        since: list.at(-1)?.started_at || new Date().toISOString(),
      },
    });
  }
  if (path === '/admin/errors' && (!actor.platformAdmin || actor.support))
    throw new HttpError(403, 'Jobfejl vises i Tier 0.');
  if (path === '/notifications') {
    // Any user with webshop access may mark the failures they were shown as seen; the list itself keeps them.
    if (!get) {
      const b = await jsonBody(request, 8000);
      if (
        b.action !== 'seen' ||
        !Array.isArray(b.ids) ||
        b.ids.length > 100 ||
        b.ids.some(
          (id) => typeof id !== 'string' || !/^[a-f0-9-]{36}$/.test(id),
        )
      )
        throw new HttpError(400, 'Ugyldig markering af fejl.');
      // Seeing the list covers everything up to the newest failure shown, also older ones beyond
      // the 50 listed; failures that arrive later stay unseen.
      if (b.ids.length)
        await db
          .prepare(
            "INSERT OR IGNORE INTO operation_acknowledgements(company_id,run_id) SELECT r.company_id,r.id FROM operation_runs r WHERE r.company_id=? AND r.webshop_id=? AND r.status='failed' AND r.started_at<=(SELECT max(started_at) FROM operation_runs WHERE company_id=? AND webshop_id=? AND status='failed' AND id IN (SELECT value FROM json_each(?)))",
          )
          .bind(company, shop, company, shop, JSON.stringify(b.ids))
          .run();
    }
    const errors = (
      await db
        .prepare(
          "SELECT r.id,r.module AS source,r.message,COALESCE(r.finished_at,r.started_at) AS created_at,EXISTS(SELECT 1 FROM operation_acknowledgements a WHERE a.company_id=r.company_id AND a.run_id=r.id) AS seen FROM operation_runs r WHERE r.company_id=? AND r.webshop_id=? AND r.status='failed' ORDER BY r.started_at DESC,r.id DESC LIMIT 50",
        )
        .bind(company, shop)
        .all<{
          id: string;
          source: string;
          message: string;
          created_at: string;
          seen: number;
        }>()
    ).results;
    const unseen = await db
      .prepare(
        "SELECT count(*) AS n FROM operation_runs r WHERE r.company_id=? AND r.webshop_id=? AND r.status='failed' AND NOT EXISTS(SELECT 1 FROM operation_acknowledgements a WHERE a.company_id=r.company_id AND a.run_id=r.id)",
      )
      .bind(company, shop)
      .first<{ n: number }>();
    return reply({
      notifications: [],
      incidents: { warnings: 0, alarms: unseen?.n || 0 },
      errors: errors.map((e) => ({ ...e, seen: !!e.seen })),
    });
  }
  if (path === '/admin/errors') {
    if (!get) {
      if (request.method !== 'POST') throw new HttpError(405, 'Brug Gem.');
      await requireCompany(db, actor, company, true);
      const b = await jsonBody(request);
      if (typeof b.id !== 'string')
        throw new HttpError(
          400,
          'Vælg en fejl til kvittering. Mailnotifikationer er ikke aktiveret i dev.',
        );
      await db
        .prepare(
          "INSERT OR IGNORE INTO operation_acknowledgements(company_id,run_id) SELECT company_id,id FROM operation_runs WHERE company_id=? AND webshop_id=? AND id=? AND status='failed'",
        )
        .bind(company, shop, b.id)
        .run();
    }
    const errors = (
      await db
        .prepare(
          "SELECT r.id,r.module AS source,r.message,r.started_at AS created_at FROM operation_runs r WHERE r.company_id=? AND r.webshop_id=? AND r.status='failed' AND NOT EXISTS(SELECT 1 FROM operation_acknowledgements a WHERE a.company_id=r.company_id AND a.run_id=r.id) ORDER BY r.started_at DESC LIMIT 100",
        )
        .bind(company, shop)
        .all()
    ).results;
    return path === '/admin/errors'
      ? reply({
          errors,
          openCount: errors.length,
          notifications: {
            enabled: false,
            warnings: false,
            alarms: false,
            email: '',
          },
        })
      : reply({
          notifications: [],
          incidents: { warnings: 0, alarms: errors.length },
        });
  }
  if (path === '/dinero/suppliers') {
    await requireCompany(db, actor, company, true);
    if (!get) {
      if (request.method !== 'POST') throw new HttpError(405, 'Brug Hent.');
      await jsonBody(request);
    }
    const saved = await db
      .prepare(
        'SELECT organization_id,credentials_encrypted FROM accounting_connections WHERE company_id=?',
      )
      .bind(company)
      .first<any>();
    if (!saved) throw new HttpError(409, 'Forbind Dinero først.');
    try {
      return reply({
        suppliers: await readDineroSuppliers(
          await unseal(
            env,
            [company, 'dinero', saved.organization_id],
            saved.credentials_encrypted,
          ),
        ),
        fetchedAt: new Date().toISOString(),
      });
    } catch {
      throw new HttpError(409, 'Leverandørerne kunne ikke hentes fra Dinero.');
    }
  }
  if (path === '/dinero/accounts' && !get) {
    if (request.method !== 'POST')
      throw new HttpError(405, 'Brug Synkronisér.');
    await requireCompany(db, actor, company, true);
    await jsonBody(request);
    const saved = await db
      .prepare(
        'SELECT organization_id,credentials_encrypted,revision FROM accounting_connections WHERE company_id=?',
      )
      .bind(company)
      .first<any>();
    if (!saved) throw new HttpError(409, 'Forbind Dinero først.');
    let accounts;
    try {
      accounts = await readDineroAccounts(
        await unseal(
          env,
          [company, 'dinero', saved.organization_id],
          saved.credentials_encrypted,
        ),
      );
    } catch {
      throw new HttpError(
        409,
        'Kontoplanen kunne ikke hentes. Tidligere kontoplan er bevaret.',
      );
    }
    const update = await db
      .prepare(
        'UPDATE accounting_connections SET chart_json=?,verified_at=CURRENT_TIMESTAMP WHERE company_id=? AND revision=?',
      )
      .bind(JSON.stringify(accounts), company, saved.revision)
      .run();
    if (!update.meta.changes)
      throw new HttpError(409, 'Forbindelsen blev ændret. Hent igen.');
    return reply({ accounts, fetchedAt: new Date().toISOString() });
  }
  if (path === '/dashboard/finance' && get) {
    await requireCompany(db, actor, company, true);
    await financeService(env, company).syncDashboardFinance();
    return reply(await financeService(env, company).dashboardFinance());
  }
  if (path === '/dashboard/platform' && get) {
    // Today's activity: only the runs of the last 24 hours are read.
    const list = (
        await db
          .prepare(
            "SELECT status,repeats FROM operation_runs WHERE company_id=? AND webshop_id=? AND started_at>datetime('now','-1 day')",
          )
          .bind(company, shop)
          .all<{ status: string; repeats: number }>()
      ).results,
      // Quiet runs in a row are one row with a repeat count (collapseRepeat in run-cleanup.ts).
      count = (status: string) =>
        list
          .filter((r) => r.status === status)
          .reduce((n, r) => n + (r.repeats ?? 1), 0),
      allRuns = list.reduce((n, r) => n + (r.repeats ?? 1), 0);
    const connections = await db
      .prepare(
        'SELECT verified_at FROM webshop_connections WHERE company_id=? AND webshop_id=?',
      )
      .bind(company, shop)
      .first<any>();
    const accounting = await db
      .prepare(
        'SELECT verified_at FROM accounting_connections WHERE company_id=?',
      )
      .bind(company)
      .first<any>();
    const snapshots = (
      await db
        .prepare(
          'SELECT module,sum(CASE WHEN substr(occurred_at,1,10)=? THEN 1 ELSE 0 END) AS total,max(imported_at) AS updated FROM operation_snapshots WHERE company_id=? AND webshop_id=? GROUP BY module',
        )
        .bind(new Date().toISOString().slice(0, 10), company, shop)
        .all<any>()
    ).results;
    const today = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Europe/Copenhagen',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date());
    const lower = new Date(Date.parse(today) - 86400000)
        .toISOString()
        .slice(0, 10),
      upper = new Date(Date.parse(today) + 2 * 86400000)
        .toISOString()
        .slice(0, 10);
    const day = (value: string) =>
      value.length === 10
        ? value
        : new Intl.DateTimeFormat('en-CA', {
            timeZone: 'Europe/Copenhagen',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
          }).format(new Date(value));
    const sourceRows = (
      await db
        .prepare(
          "SELECT 'shopify' provider,module,external_id,occurred_at,payload_json FROM operation_snapshots WHERE company_id=? AND webshop_id=? AND module IN ('orders','payouts') AND occurred_at>=? AND occurred_at<? UNION ALL SELECT provider,kind module,external_id,occurred_at,payload_json FROM payment_records WHERE company_id=? AND webshop_id=? AND ((provider='flatpay' AND kind='payments') OR (provider='viabill' AND kind='payout')) AND occurred_at>=? AND occurred_at<?",
        )
        .bind(company, shop, lower, upper, company, shop, lower, upper)
        .all<any>()
    ).results;
    const statusFor = await bookingStatuses(
      env,
      company,
      shop,
      sourceRows.map((r: any) => String(r.external_id)),
    );
    const activity = (module: string) => {
      const selected = sourceRows.filter(
        (r) =>
          (module === 'orders'
            ? r.module === 'orders'
            : r.module !== 'orders') && day(r.occurred_at) === today,
      );
      let synced = 0,
        failed = 0;
      for (const r of selected) {
        const status = statusFor(
          r.provider,
          r.module,
          r.external_id,
          r.occurred_at,
          r.payload_json,
        );
        if (['booked', 'draft'].includes(status)) synced++;
        else if (
          [
            'failed_retry',
            'failed_manual',
            'uncertain',
            'held',
            'booked_changed',
          ].includes(status)
        )
          failed++;
      }
      return {
        total: selected.length,
        synced,
        failed,
        pending: selected.length - synced - failed,
      };
    };
    const providers = [
      {
        key: 'shopify',
        name: 'Shopify',
        connected: !!connections?.verified_at,
        checkedAt: connections?.verified_at || null,
        health: 'unknown',
      },
      {
        key: 'dinero',
        name: 'Dinero',
        connected: !!accounting,
        checkedAt: accounting?.verified_at || null,
        health: 'unknown',
      },
    ];
    // Same count as the Integrationer page: connected, and chosen but not yet connected.
    const [selected, linked] = await Promise.all([
        selectedIntegrations(db, company),
        connectedIntegrations(db, company, shop),
      ]),
      linkedSet = new Set(linked.map((i) => i.provider));
    return reply({
      inactive: [...new Set(selected)].filter((p) => !linkedSet.has(p)).length,
      connected: linkedSet.size,
      providers,
      failed: count('failed'),
      succeeded: count('success'),
      skipped: 0,
      running: count('running'),
      successRate: allRuns ? (100 * count('success')) / allRuns : null,
      checkedAt: new Date().toISOString(),
      activity: {
        today,
        orders: activity('orders'),
        payouts: activity('payouts'),
        updated: Object.fromEntries(
          ['sales', 'refunds', 'packaging'].map((k) => [
            k,
            snapshots.find((r) => r.module === (k === 'sales' ? 'orders' : k))
              ?.updated || null,
          ]),
        ),
      },
    });
  }
  if (path === '/shopify/packaging') {
    if (shop === 'none') throw new HttpError(409, 'Forbind webshoppen først.');
    const today = new Date().toISOString().slice(0, 10),
      year = Number(today.slice(0, 4)),
      month = Number(today.slice(5, 7)) - 1,
      q = Math.floor(month / 3) * 3;
    const date = (y: number, m: number, d = 1) =>
      new Date(Date.UTC(y, m, d)).toISOString().slice(0, 10);
    const periods: Record<string, [string, string]> = {
      currentQuarter: [date(year, q), today],
      previousQuarter: [date(year, q - 3), date(year, q, 0)],
      yearToDate: [date(year, 0), today],
      previousYear: [date(year - 1, 0), date(year, 0, 0)],
      custom: [
        url.searchParams.get('start') || date(year, q),
        url.searchParams.get('end') || today,
      ],
    };
    if (!get) {
      if (request.method !== 'POST') throw new HttpError(405, 'Brug Gem.');
      await requireCompany(db, actor, company, true);
      const b = await jsonBody(request);
      if (b.action === 'delete') {
        if (!Number.isSafeInteger(b.version))
          throw new HttpError(409, 'Genindlæs posten før sletning.');
        const deleted = await db
          .prepare(
            'DELETE FROM platform_packaging WHERE company_id=? AND webshop_id=? AND id=? AND version=?',
          )
          .bind(company, shop, b.id, b.version)
          .run();
        if (!deleted.meta.changes)
          throw new HttpError(409, 'Posten er ændret. Genindlæs.');
        await db
          .prepare(
            'INSERT INTO audit_events(id,company_id,actor_id,action,resource_id,details_json) VALUES(?,?,?,?,?,?)',
          )
          .bind(
            crypto.randomUUID(),
            company,
            actor.id,
            'packaging.deleted',
            shop,
            JSON.stringify({ id: b.id, version: b.version }),
          )
          .run();
        return reply({ ok: true });
      }
      const from = await dataStartDate(env, company, shop);
      const input =
        b.action === 'price'
          ? {
              action: 'prices',
              household: b.pricePerKg,
              commercial: b.commercialPricePerKg,
            }
          : b.action === 'upsert'
            ? { ...(b.entry as object), action: 'save' }
            : b.action === 'sync'
              ? {
                  action: 'sync',
                  start: [asText(b.start || from), from].sort().at(-1),
                  end: b.end || today,
                }
              : b;
      const response = await handlePackaging(
        forwarded(request, input),
        env,
        actor,
        company,
        shop,
      );
      if (!response.ok) return response;
    }
    const result: Record<string, unknown> = {};
    let prices: any = {},
      lastSyncedAt = null;
    for (const [key, [from, to]] of Object.entries(periods)) {
      const next = new URL(request.url);
      next.searchParams.set('from', from);
      next.searchParams.set('to', to);
      const response = await handlePackaging(
        new Request(next, { headers: request.headers }),
        env,
        actor,
        company,
        shop,
      );
      if (!response.ok) return response;
      const value = (await response.json()) as any;
      result[key] = value.period;
      prices = value.prices;
      lastSyncedAt = value.sync?.synced_at || null;
    }
    return reply({
      periods: result,
      pricePerKg: prices.household,
      commercialPricePerKg: prices.commercial,
      lastSyncedAt,
    });
  }
  // A market's tab (?marketId=) has its own sender, company details, design and logo. Danmark's tab is the
  // company's, or the webshop's own when it has switched them on (webshop_invoice_settings).
  const marketId = url.searchParams.get('marketId');
  if (marketId && !/^gid:\/\/shopify\/Market\/\d{1,30}$/.test(marketId))
    throw new HttpError(400, 'Vælg et marked.');
  const withShop = () => {
    const next = new URL(request.url);
    next.searchParams.set('webshopId', shop);
    return new Request(next, request);
  };
  if (path === '/invoices/sender' || path === '/invoices/sender/test') {
    if (!marketId)
      return handleMail(
        request,
        env,
        actor,
        company,
        path.endsWith('/test') ? 'test' : undefined,
        undefined,
        (await webshopInvoiceRow(env, company, shop)) ? { shop } : undefined,
      );
    if (shop === 'none') throw new HttpError(409, 'Forbind en webshop først.');
    if (request.method !== 'GET' && !actor.support)
      await ensureMarketRow(env, company, shop, marketId);
    return handleMail(
      request,
      env,
      actor,
      company,
      path.endsWith('/test') ? 'test' : undefined,
      undefined,
      { shop, market: marketId },
    );
  }
  if (path === '/invoices/logo')
    return handleInvoices(
      shop !== 'none' ? withShop() : request,
      env,
      actor,
      company,
      'logo',
    );
  if (path === '/invoices/preview') {
    if (shop === 'none')
      throw new HttpError(409, 'Opret en webshop for at se fakturaeksemplet.');
    const next = new URL(request.url);
    next.searchParams.set('webshopId', shop);
    return handleInvoices(
      new Request(next, request),
      env,
      actor,
      company,
      'preview',
    );
  }
  if (path === '/invoices/settings')
    return handleInvoices(
      shop !== 'none' ? withShop() : request,
      env,
      actor,
      company,
      'settings',
    );
  const dataPaths = [
    '/shopify/orders',
    '/shopify/orders/process',
    '/shopify/refunds',
    '/shopify/payouts',
    '/shopify/payments',
    '/refunds/overview',
    '/payouts/overview',
    '/sales/log',
    '/payouts/log',
    '/refunds/log',
    '/sales/preview',
    '/shopify/inventory',
    '/documents',
    '/invoices',
    '/invoices/pdf',
    '/invoices/email-test',
    '/flatpay/records',
    '/flatpay/sync',
    '/flatpay/refunds',
    '/viabill/records',
    '/pensopay/records',
    '/order-refunds',
    '/order-refunds/sync',
    '/order-refunds/credit-note',
    '/orders/detail',
  ];
  if (!dataPaths.includes(path)) return null;
  if (shop === 'none') throw new HttpError(409, 'Forbind en webshop først.');
  if (path === '/shopify/inventory') {
    if (get) return handleStocktake(request, env, actor, company, shop);
    const b = await jsonBody(request, 40000);
    const response = await handleStocktake(
      forwarded(request, b),
      env,
      actor,
      company,
      shop,
    );
    if (
      ['prepare', 'prepare-reconcile'].includes(String(b.action)) &&
      response.ok
    ) {
      const d = (await response.json()) as any;
      return reply({ ...d, operationId: d.id });
    }
    return response;
  }
  const context = { request, env, actor, company, shop, path, db, url, get };
  return (
    (await orderData(context)) ??
    (await orderRefundData(context)) ??
    (await documentData(context)) ??
    (await providerRecordData(context))
  );
}
