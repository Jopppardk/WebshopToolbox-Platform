import test from 'node:test';
import assert from 'node:assert/strict';
import { databaseFixture, loader } from './automation-test-fixture.mjs';

function harness() {
  const h = databaseFixture();
  h.policy = { months: 24, startDate: '2026-09-01' };
  const overrides = {
    './database': { database: () => h.db },
    './history': { loadHistory: async () => h.policy },
  };
  h.load = (extra) => loader({ ...overrides, ...extra });
  h.run = h.load()('db/paginated-sync.ts').runPaginatedSync;
  return h;
}
const page = (hasNextPage, endCursor = null) =>
  Response.json({ hasNextPage, endCursor });

test('import errors retain a sanitized reason and never advance the checkpoint', async () => {
  const h = harness();
  await assert.rejects(
    h.run('orders', async () =>
      Response.json(
        { error: 'Shopify THROTTLED https://example/?token=private' },
        { status: 503 },
      ),
    ),
    (error) =>
      /HTTP 503.*THROTTLED/.test(error.message) &&
      !/private/.test(error.message),
  );
  assert.equal(h.get('sync_progress:orders').after, null);
  assert.equal(h.get('sync_progress:orders').leaseUntil, 0);
});

test('bounded import persists progress across workers and starts a new full sweep after completion', async () => {
  const h = harness(),
    cursors = [];
  const fetch = async (after) => {
    cursors.push(after);
    const n = Number(after || 0) + 1;
    return page(n < 7, String(n));
  };
  const first = await h.run('orders', fetch);
  assert.equal(first.complete, false);
  assert.equal(first.status, 'skipped');
  assert.equal(h.get('sync_progress:orders').after, '5');
  const restarted = h.load()('db/paginated-sync.ts').runPaginatedSync;
  assert.equal((await restarted('orders', fetch)).complete, true);
  assert.equal(h.get('sync_progress:orders').after, null);
  await restarted('orders', async (after) => {
    assert.equal(after, null);
    return page(false);
  });
  assert.deepEqual(cursors, [null, '1', '2', '3', '4', '5', '6']);
});

test('HTTP and checkpoint failures retry only the uncommitted page', async () => {
  const h = harness();
  await assert.rejects(
    h.run('orders', async (after) =>
      after ? new Response('', { status: 503 }) : page(true, 'next'),
    ),
    /Importen fejlede/,
  );
  assert.equal(h.get('sync_progress:orders').after, 'next');
  assert.equal(h.get('sync_progress:orders').leaseUntil, 0);
  let failOnce = true;
  h.faults.beforeRun = (query, args) => {
    if (
      failOnce &&
      query.startsWith('UPDATE app_settings') &&
      JSON.parse(args[0]).after === 'later'
    ) {
      failOnce = false;
      throw Error('checkpoint failed');
    }
  };
  await assert.rejects(
    h.run('orders', async (after) => {
      assert.equal(after, 'next');
      return page(true, 'later');
    }),
    /checkpoint failed/,
  );
  assert.equal(h.get('sync_progress:orders').after, 'next');
  assert.equal(
    (
      await h.run('orders', async (after) => {
        assert.equal(after, 'next');
        return page(false);
      })
    ).complete,
    true,
  );
});

test('invalid cursors and malformed page metadata fail without advancing', async () => {
  for (const response of [
    () => page(true, ''),
    () => Response.json({}),
    () => page(true, 'next'),
  ]) {
    const h = harness();
    h.set('sync_progress:orders', {
      after: 'next',
      scope: JSON.stringify(h.policy),
      leaseUntil: 0,
      owner: 'old',
    });
    await assert.rejects(h.run('orders', response), /gyldig|gentaget/);
    assert.equal(h.get('sync_progress:orders').after, 'next');
  }
});

test('overlapping workers cannot claim the same import or release a newer lease', async () => {
  const h = harness();
  let release, started;
  const entered = new Promise((resolve) => {
    started = resolve;
  });
  const blocked = new Promise((resolve) => {
    release = resolve;
  });
  const first = h.run('orders', async () => {
    started();
    await blocked;
    return page(false);
  });
  await entered;
  assert.equal(
    (
      await h.run('orders', () => {
        throw Error('must not fetch');
      })
    ).status,
    'skipped',
  );
  const newer = {
    ...h.get('sync_progress:orders'),
    owner: 'newer-worker',
    leaseUntil: Date.now() + 600000,
  };
  h.set('sync_progress:orders', newer);
  release();
  await assert.rejects(first, /ændret af et andet job/);
  assert.deepEqual(h.get('sync_progress:orders'), newer);
});

test('changing history settings starts a fresh sweep', async () => {
  const h = harness();
  h.set('sync_progress:orders', {
    after: 'old',
    scope: 'different history',
    leaseUntil: 0,
    owner: 'old',
  });
  await h.run('orders', async (after) => {
    assert.equal(after, null);
    return page(false);
  });
});

test('actual scheduler follows all three imports and delays booking until each sweep completes', async () => {
  const h = harness(),
    calls = [],
    booked = [],
    jobs = [];
  const app = {
    async fetch(request) {
      const route = new URL(request.url).pathname;
      const body = await request.json();
      calls.push({ route, body });
      if (route.endsWith('/packaging')) return Response.json({});
      const n = Number(body.after || 0) + 1;
      return page(n < 7, String(n));
    },
  };
  const worker = h.load({
    './db/flatpay-sync': {
      syncFlatpay: async () => ({ status: 'skipped' }),
      syncFlatpayReports: async () => ({ status: 'skipped' }),
    },
    './db/flatpay-automation': {
      runFlatpayAutomation: async () => {
        throw Error('Flatpay must wait for import');
      },
    },
    './db/emballage-monitor': {
      monitorEmballagePeriods: async () => {
        throw Error('Period service unavailable');
      },
    },
    './db/dashboard-finance': {
      syncDashboardFinance: async () => ({
        status: 'skipped',
        message: 'Fixture',
      }),
    },
    './dist/server/index.js': { default: app },
    './db/database': { database: () => h.db },
    './db/errors': { recordFailure: async () => {} },
    './db/job-runs': {
      runTrackedJob: async (key, _name, task) => {
        const result = await task();
        jobs.push({ key, result });
        return result;
      },
    },
    './db/sales-automation': {
      runSalesAutomation: async () => booked.push('sales'),
    },
    './db/refund-automation': {
      runRefundAutomation: async () => booked.push('refunds'),
    },
    './db/payout-automation': {
      runPayoutAutomation: async () => booked.push('payouts'),
    },
  })('worker-entry.ts').default;
  let scheduledTime = 0;
  async function tick() {
    scheduledTime += 300000;
    let pending = Promise.resolve();
    await worker.scheduled(
      { scheduledTime },
      {},
      {
        waitUntil: (value) => {
          pending = value;
        },
      },
    );
    await pending;
  }
  await tick();
  assert.deepEqual(booked, []);
  await tick();
  assert.deepEqual(booked, ['sales', 'refunds', 'payouts']);
  for (const route of ['orders', 'refunds', 'payouts']) {
    assert.deepEqual(
      calls
        .filter((c) => c.route.endsWith('/' + route))
        .map((c) => c.body.after),
      [null, '1', '2', '3', '4', '5', '6'],
    );
    assert.equal(
      jobs.find((j) => j.key === 'shopify-' + route).result.complete,
      false,
    );
  }
});

test('scheduler excludes historical failed and uncertain emails without blocking a new invoice', async () => {
  const h = harness(),
    emailed = [];
  h.set('admin_settings', { automation: { invoiceEmails: true } });
  h.sql
    .prepare(
      "INSERT INTO app_settings(tenant,setting_key,setting_value) VALUES('sablen.dk','invoice_email_automation_started_at','2026-09-01T00:00:00Z')",
    )
    .run();
  for (let i = 0; i < 11; i++) {
    h.record('invoice', String(i), {}, undefined, 'generated');
    if (i < 10)
      h.sql
        .prepare(
          "INSERT INTO invoice_email_deliveries(id,external_id,recipient,delivery_mode,status) VALUES(?,?,?,'customer',?)",
        )
        .run(
          'mail-' + i,
          String(i),
          'fixture@example.invalid',
          i % 2 ? 'failed' : 'sending',
        );
  }
  const worker = h.load({
    './db/flatpay-sync': {
      syncFlatpay: async () => ({ status: 'skipped' }),
      syncFlatpayReports: async () => ({ status: 'skipped' }),
    },
    './db/flatpay-automation': {
      runFlatpayAutomation: async () => {
        throw Error('Flatpay must wait for import');
      },
    },
    './db/emballage-monitor': {
      monitorEmballagePeriods: async () => {
        throw Error('Period service unavailable');
      },
    },
    './db/dashboard-finance': {
      syncDashboardFinance: async () => ({
        status: 'skipped',
        message: 'Fixture',
      }),
    },
    './dist/server/index.js': {
      default: {
        async fetch(request) {
          if (new URL(request.url).pathname === '/api/invoices/email')
            emailed.push((await request.json()).externalId);
          return page(false);
        },
      },
    },
    './db/database': { database: () => h.db },
    './db/errors': { recordFailure: async () => {} },
    './db/job-runs': { runTrackedJob: async (_key, _name, task) => task() },
    './db/sales-automation': { runSalesAutomation: async () => {} },
    './db/refund-automation': { runRefundAutomation: async () => {} },
    './db/payout-automation': { runPayoutAutomation: async () => {} },
  })('worker-entry.ts').default;
  let pending = Promise.resolve();
  await worker.scheduled(
    { scheduledTime: 0 },
    {},
    {
      waitUntil: (value) => {
        pending = value;
      },
    },
  );
  await pending;
  assert.deepEqual(emailed, ['10']);
});
