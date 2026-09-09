import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const id = 'gid://shopify/ShopifyPaymentsBalanceTransaction/123';
const guid = '12345678-1234-1234-1234-123456789012';
const source = readFileSync(
  new URL('../db/refund-automation.ts', import.meta.url),
  'utf8',
);

function harness({
  initial = 'draft',
  book = true,
  failPhase,
  failRecord = false,
  remoteStatus = 'Draft',
  remoteGuid = guid,
} = {}) {
  const sql = new DatabaseSync(':memory:');
  sql.exec(
    'CREATE TABLE app_settings(tenant TEXT,setting_key TEXT,setting_value TEXT,updated_at TEXT,PRIMARY KEY(tenant,setting_key)); CREATE TABLE integration_records(tenant TEXT,record_type TEXT,external_id TEXT,amount_minor INTEGER,currency TEXT,payload_json TEXT,booking_status TEXT,occurred_at TEXT)',
  );
  const snapshot = { voucher: { Lines: [] }, expected: [] };
  const key = `refund_production:${id}`;
  if (initial)
    sql
      .prepare('INSERT INTO app_settings VALUES(?,?,?,NULL)')
      .run(
        'sablen.dk',
        key,
        JSON.stringify({
          phase: initial,
          version: 'v1',
          organizationId: '123',
          externalId: id,
          guid,
          snapshot,
        }),
      );
  sql
    .prepare('INSERT INTO app_settings VALUES(?,?,?,NULL)')
    .run(
      'sablen.dk',
      'admin_settings',
      JSON.stringify({
        accounts: {},
        automation: { refunds: true, refundsBookDinero: book },
      }),
    );
  sql
    .prepare('INSERT INTO app_settings VALUES(?,?,?,NULL)')
    .run('sablen.dk', 'refund_automation_started_at', '2026-01-01');
  sql
    .prepare('INSERT INTO integration_records VALUES(?,?,?,?,?,?,?,?)')
    .run(
      'sablen.dk',
      'refund',
      id,
      -12500,
      'DKK',
      JSON.stringify({
        associatedOrder: { id: 'order1', name: '#2639' },
        sourceOrderTransactionId: 'transaction1',
      }),
      'pending',
      '2026-09-09',
    );
  const faults = { failPhase, failRecord };
  const db = {
    prepare(query) {
      const wrap = (args) => ({
        bind: (...values) => wrap(values),
        first: async () => sql.prepare(query).get(...args) ?? null,
        all: async () => ({ results: sql.prepare(query).all(...args) }),
        run: async () => {
          if (
            query.startsWith('UPDATE app_settings') &&
            JSON.parse(args[0]).phase === faults.failPhase
          )
            return { meta: { changes: 0 } };
          if (
            query.startsWith('UPDATE integration_records') &&
            faults.failRecord
          )
            throw Error('record write failed');
          return { meta: { changes: sql.prepare(query).run(...args).changes } };
        },
      });
      return wrap([]);
    },
  };
  const calls = [],
    failures = [];
  let org = '123',
    getHook,
    bookHook;
  const remote = () => ({
    Guid: remoteGuid,
    Status: remoteStatus,
    Timestamp: 't1',
  });
  const client = async (endpoint, method) => {
    calls.push({ endpoint, method });
    if (method === 'GET') {
      const result = remote();
      if (getHook) await getHook();
      return result;
    }
    if (endpoint.endsWith('/book')) {
      if (bookHook) await bookHook();
      return { Guid: guid, Status: 'Booked', VoucherNumber: 42 };
    }
    return { Guid: guid, Status: 'Draft' };
  };
  const money = (amount) => ({ shopMoney: { amount, currencyCode: 'DKK' } });
  const nodes = (values) => ({
    nodes: values,
    pageInfo: { hasNextPage: false },
  });
  let shopifyCalls = 0;
  const fetch = async () => {
    shopifyCalls++;
    return Response.json({
      data: {
        order: {
          refunds: [
            {
              id: 'refund1',
              processedAt: '2026-09-09T10:00:00Z',
              refundLineItems: nodes([
                { subtotalSet: money('100'), totalTaxSet: money('25') },
              ]),
              refundShippingLines: nodes([]),
              orderAdjustments: nodes([]),
              transactions: nodes([
                {
                  id: 'transaction1',
                  kind: 'REFUND',
                  status: 'SUCCESS',
                  test: false,
                  amountSet: money('125'),
                },
              ]),
            },
          ],
        },
      },
    });
  };
  // Isolate orchestration; voucher arithmetic has separate real-payload tests.
  const mocks = {
    'cloudflare:workers': {
      env: {
        DINERO_REFUND_WRITES_ENABLED: 'true',
        DINERO_REFUND_AUTOMATION_ENABLED: 'true',
      },
    },
    './database': { database: () => db },
    './credentials': { loadCredentials: async () => ({ organizationId: org }) },
    './shopify': {
      getShopifyAccess: async () => ({
        shop: 'fixture.myshopify.com',
        accessToken: 'fixture',
      }),
    },
    './dinero-accounts': { readDineroAccounts: async () => [] },
    './dinero-client': { dineroClient: async () => client },
    './errors': { recordFailure: async (...args) => failures.push(args) },
    '@/lib/admin-settings': { validateSettings: (value) => value },
    '@/lib/shopify-payments': {
      minorUnits: (value) => Math.round(Number(value) * 100),
    },
    '@/lib/refund-voucher': {
      refundVoucher: () => ({ ...snapshot, accounts: [] }),
    },
    '@/lib/dinero-sale': {
      TransferError: Error,
      verifyVoucher: (value) => value,
    },
  };
  const mod = {};
  // Execute only the repository's TypeScript module with isolated service mocks.
  // oxlint-disable-next-line typescript/no-implied-eval
  new Function(
    'exports',
    'require',
    'fetch',
    ts.transpileModule(source, {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
      },
    }).outputText,
  )(
    mod,
    (name) => {
      assert.ok(name in mocks, name);
      return mocks[name];
    },
    fetch,
  );
  return {
    sql,
    calls,
    faults,
    failures,
    run: () => mod.runSingleRefund(id),
    auto: () => mod.runRefundAutomation(),
    state: () =>
      JSON.parse(
        sql
          .prepare('SELECT setting_value FROM app_settings WHERE setting_key=?')
          .get(key).setting_value,
      ),
    raw: () =>
      sql
        .prepare('SELECT setting_value FROM app_settings WHERE setting_key=?')
        .get(key)?.setting_value,
    record: () =>
      sql.prepare('SELECT booking_status FROM integration_records').get()
        .booking_status,
    setOrg: (value) => {
      org = value;
    },
    shopifyCalls: () => shopifyCalls,
    onGet: (fn) => {
      getHook = fn;
    },
    onBook: (fn) => {
      bookHook = fn;
    },
  };
}
const writes = (h) => h.calls.filter((call) => call.method === 'POST');

test('manual and scheduled refund race sends exactly one booking request', async (t) => {
  const h = harness();
  t.after(() => h.sql.close());
  let arrivals = 0,
    release;
  const bothReading = new Promise((resolve) => {
    release = resolve;
  });
  h.onGet(async () => {
    if (++arrivals === 2) release();
    await bothReading;
  });
  const results = await Promise.allSettled([h.run(), h.auto()]);
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
  assert.equal(writes(h).length, 1);
  assert.equal(h.state().phase, 'booked');
  assert.equal(h.record(), 'booked');
});

test('lost booking claim stops before Dinero POST', async (t) => {
  const h = harness({ failPhase: 'booking' });
  t.after(() => h.sql.close());
  const original = h.raw();
  await assert.rejects(h.run());
  assert.equal(writes(h).length, 0);
  assert.equal(h.raw(), original);
});

for (const phase of ['creating', 'booking', 'uncertain'])
  test(`observer preserves another run's ${phase} state`, async (t) => {
    const h = harness({ initial: phase });
    t.after(() => h.sql.close());
    const original = h.raw();
    await assert.rejects(h.run());
    assert.equal(h.raw(), original);
    assert.equal(h.calls.length, 0);
  });

test('new refund creates and books once; booked retry never writes again', async (t) => {
  const h = harness({ initial: null });
  t.after(() => h.sql.close());
  await h.run();
  await h.run();
  assert.equal(writes(h).length, 2);
  assert.equal(h.state().phase, 'booked');
});

test('failed draft persistence cannot report successful draft creation or book', async (t) => {
  const h = harness({ initial: null, book: false, failPhase: 'draft' });
  t.after(() => h.sql.close());
  await assert.rejects(h.run());
  assert.equal(writes(h).length, 1);
  assert.equal(h.state().phase, 'uncertain');
});

test('failed booking receipt stays blocked and never marks the record booked', async (t) => {
  const h = harness({ failPhase: 'booked' });
  t.after(() => h.sql.close());
  await assert.rejects(h.run());
  await assert.rejects(h.run());
  assert.equal(writes(h).length, 1);
  assert.equal(h.state().phase, 'uncertain');
  assert.equal(h.record(), 'pending');
});

test('accepted receipt survives record update failure and reconciles without a new POST', async (t) => {
  const h = harness({ failRecord: true });
  t.after(() => h.sql.close());
  await assert.rejects(h.run());
  assert.equal(h.state().phase, 'booked');
  h.faults.failRecord = false;
  await h.run();
  assert.equal(writes(h).length, 1);
  assert.equal(h.record(), 'booked');
});

test('uncertain remote booking never automatically retries', async (t) => {
  const h = harness();
  t.after(() => h.sql.close());
  h.onBook(async () => {
    throw Error('timeout after remote accepted');
  });
  await assert.rejects(h.run());
  await assert.rejects(h.run());
  assert.equal(writes(h).length, 1);
  assert.equal(h.state().phase, 'uncertain');
});

for (const initial of ['draft', 'booked'])
  test(`different Dinero organization rejects ${initial} before external calls`, async (t) => {
    const h = harness({ initial });
    t.after(() => h.sql.close());
    const original = h.raw();
    h.setOrg('456');
    await assert.rejects(h.run());
    assert.equal(h.raw(), original);
    assert.equal(h.calls.length, 0);
    assert.equal(h.shopifyCalls(), 0);
  });

for (const options of [
  { remoteStatus: 'Booked' },
  { remoteGuid: '87654321-1234-1234-1234-123456789012' },
])
  test('unexpected remote draft is never booked', async (t) => {
    const h = harness(options);
    t.after(() => h.sql.close());
    await assert.rejects(h.run());
    assert.equal(writes(h).length, 0);
    assert.equal(h.state().phase, 'draft');
  });
