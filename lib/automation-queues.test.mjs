import test from 'node:test';
import assert from 'node:assert/strict';
import { databaseFixture, loader } from './automation-test-fixture.mjs';

const plain = loader();
const { emptyAccounts, defaultAutomation } = plain('lib/admin-settings.ts');
function setup() {
  const h = databaseFixture();
  h.settings = {
    accounts: {
      ...emptyAccounts,
      clearing: '55000',
      refundGoodsVat: '1000',
      vatCode: 'U25',
      noVatCode: 'none',
    },
    automation: {
      ...defaultAutomation,
      sales: true,
      refunds: true,
      payouts: true,
    },
  };
  h.saveSettings = () => h.set('admin_settings', h.settings);
  h.saveSettings();
  const runtime = {
    DINERO_SALES_AUTOMATION_ENABLED: 'true',
    DINERO_SALES_START_AFTER: '2026-08-01',
    DINERO_REFUND_AUTOMATION_ENABLED: 'true',
    DINERO_REFUND_WRITES_ENABLED: 'true',
    DINERO_PAYOUT_AUTOMATION_ENABLED: 'true',
    DINERO_PAYOUT_WRITES_ENABLED: 'true',
    DINERO_PAYOUT_START_AFTER: '2026-08-01',
  };
  h.calls = [];
  h.remotes = new Map();
  h.client = async (endpoint, method, body) => {
    h.calls.push({ endpoint, method, body });
    if (endpoint === 'vouchers/manuel' && method === 'POST') {
      const guid = `12345678-1234-1234-1234-${String(h.remotes.size + 1).padStart(12, '0')}`;
      const remote = {
        ...structuredClone(body),
        Guid: guid,
        Status: 'Draft',
        Timestamp: 't1',
        Lines: body.Lines.map((line) => {
          const gross = Math.round(line.Amount * 100),
            net =
              line.AccountVatCode === 'U25' ? Math.round(gross / 1.25) : gross;
          return {
            ...line,
            AmountExclVatValue: net / 100,
            VatAmountValue: (gross - net) / 100,
            AmountInclVatValue: gross / 100,
          };
        }),
      };
      h.remotes.set(guid, remote);
      return structuredClone(remote);
    }
    const guid = endpoint.split('/')[2],
      remote = h.remotes.get(guid);
    assert.ok(remote, 'remote voucher must exist');
    if (method === 'GET') return structuredClone(remote);
    assert.ok(endpoint.endsWith('/book'));
    assert.equal(remote.Status, 'Draft', 'must not book twice');
    remote.Status = 'Booked';
    remote.Timestamp = 't2';
    remote.VoucherNumber = 42;
    return structuredClone(remote);
  };
  h.overrides = {
    'cloudflare:workers': { env: runtime },
    './database': { database: () => h.db },
    './credentials': {
      loadCredentials: async () => ({ organizationId: '123' }),
    },
    './dinero-client': { dineroClient: async () => h.client },
    './errors': { recordFailure: async () => {} },
    './dinero-accounts': {
      readDineroAccounts: async () => [
        { number: '55000', hidden: false },
        { number: '1000', hidden: false },
      ],
    },
  };
  return h;
}

test('sales selects fulfilled orders before LIMIT and later picks up an older fulfilled order', async () => {
  const h = setup(),
    actions = [];
  for (let i = 0; i < 10; i++)
    h.record('order', 'waiting-' + i, {
      displayFulfillmentStatus: 'UNFULFILLED',
    });
  h.record('order', 'partial', { displayFulfillmentStatus: 'PARTIAL' });
  h.record('order', 'cancelled', {
    displayFulfillmentStatus: 'FULFILLED',
    cancelledAt: '2026-09-06',
  });
  h.record(
    'order',
    'done',
    { displayFulfillmentStatus: 'FULFILLED' },
    undefined,
    'booked',
  );
  h.record('order', 'uncertain', { displayFulfillmentStatus: 'FULFILLED' });
  h.set('sales_transfer:uncertain', { phase: 'uncertain' });
  h.record(
    'order',
    'ready',
    { displayFulfillmentStatus: 'FULFILLED' },
    '2026-09-07T10:00:00Z',
  );
  const run = loader({
    ...h.overrides,
    '@/lib/invoice-check': { shipmentDate: () => '2026-09-06T10:00:00Z' },
    './sales-transfer': {
      runTransfer: async ({ externalId, action }) => {
        actions.push({ externalId, action });
        const phase = { prepare: 'prepared', create: 'draft', book: 'booked' }[
          action
        ];
        const state = {
          phase,
          version: 'v1',
          snapshot: { invoiceNumber: '123' },
        };
        h.set('sales_transfer:' + externalId, state);
        return { state };
      },
    },
  })('db/sales-automation.ts').runSalesAutomation;
  await run();
  assert.deepEqual(
    actions.map((a) => [a.externalId, a.action]),
    [
      ['ready', 'prepare'],
      ['ready', 'create'],
      ['ready', 'book'],
    ],
  );
  h.sql
    .prepare(
      "UPDATE integration_records SET payload_json=? WHERE external_id='waiting-0'",
    )
    .run(JSON.stringify({ displayFulfillmentStatus: 'FULFILLED' }));
  await run();
  assert.equal(actions.length, 6);
  assert.equal(actions[3].externalId, 'waiting-0');
  assert.equal(h.get('sales_transfer:uncertain').phase, 'uncertain');
});

test('refund draft-only queue advances past five drafts, excludes unsafe states, then books existing drafts', async () => {
  const h = setup();
  h.settings.automation.refundsBookDinero = false;
  h.saveSettings();
  h.sql
    .prepare(
      "INSERT INTO app_settings(tenant,setting_key,setting_value) VALUES('sablen.dk','refund_automation_started_at','2026-08-01')",
    )
    .run();
  const id = (n) => `gid://shopify/ShopifyPaymentsBalanceTransaction/${n}`;
  for (const [i, phase] of [
    'uncertain',
    'creating',
    'booking',
    'booked',
  ].entries()) {
    h.record('refund', id(90 + i), {}, '2026-09-01T00:00:00Z');
    h.set('refund_production:' + id(90 + i), { phase });
  }
  for (let i = 1; i <= 6; i++)
    h.record('refund', id(i), {
      associatedOrder: { id: String(i), name: '#' + i },
      sourceOrderTransactionId: 'tx-' + i,
    });
  const empty = { nodes: [], pageInfo: { hasNextPage: false } },
    money = (amount) => ({ shopMoney: { amount, currencyCode: 'DKK' } });
  const run = loader({
    ...h.overrides,
    './shopify': {
      getShopifyAccess: async () => ({
        shop: 'fixture.myshopify.com',
        accessToken: 'fixture',
      }),
    },
    fetch: async (_url, request) => {
      const i = JSON.parse(request.body).variables.id;
      return Response.json({
        data: {
          order: {
            refunds: [
              {
                id: 'r-' + i,
                processedAt: '2026-09-06T10:00:00Z',
                refundLineItems: {
                  nodes: [
                    { subtotalSet: money('100'), totalTaxSet: money('25') },
                  ],
                  pageInfo: { hasNextPage: false },
                },
                refundShippingLines: empty,
                orderAdjustments: empty,
                transactions: {
                  nodes: [
                    {
                      id: 'tx-' + i,
                      kind: 'REFUND',
                      status: 'SUCCESS',
                      test: false,
                      amountSet: money('125'),
                    },
                  ],
                  pageInfo: { hasNextPage: false },
                },
              },
            ],
          },
        },
      });
    },
  })('db/refund-automation.ts').runRefundAutomation;
  await run();
  assert.equal(h.remotes.size, 5);
  await run();
  assert.equal(h.remotes.size, 6);
  await run();
  assert.equal(h.remotes.size, 6);
  assert.equal(h.calls.filter((c) => c.endpoint.endsWith('/book')).length, 0);
  h.settings.automation.refundsBookDinero = true;
  h.saveSettings();
  await run();
  await run();
  await run();
  assert.equal(h.remotes.size, 6);
  assert.equal(h.calls.filter((c) => c.endpoint.endsWith('/book')).length, 6);
  for (let i = 1; i <= 6; i++)
    assert.equal(h.get('refund_production:' + id(i)).phase, 'booked');
  assert.equal(h.get('refund_production:' + id(90)).phase, 'uncertain');
});

test('payout draft-only queue advances and later resumes those drafts without creating duplicates', async () => {
  const h = setup();
  h.settings.automation.payoutsBookDinero = false;
  h.saveSettings();
  const payload = {
    provider: 'shopify_payments',
    status: 'PAID',
    transactionType: 'DEPOSIT',
  };
  for (let i = 1; i <= 6; i++) h.record('payout', String(i), payload);
  for (const [i, phase] of [
    'uncertain',
    'creating',
    'booking',
    'booked',
  ].entries()) {
    h.record('payout', 'unsafe-' + i, payload, '2026-09-01T00:00:00Z');
    h.set('payout_production:unsafe-' + i, { phase });
  }
  const run = loader({
    ...h.overrides,
    './payout-transfer': {
      payoutProposal: async (id) => ({
        payoutId: id,
        amount: 12500,
        currency: 'DKK',
        reportKey: 'fixture',
        reportEtag: 'etag',
        reportFilename: 'fixture.pdf',
        attach: false,
        voucher: {
          VoucherDate: '2026-09-06',
          ExternalReference: 'payout:' + id,
          Lines: [
            {
              Description: 'payout',
              AccountNumber: 55000,
              Amount: 125,
              AccountVatCode: 'none',
            },
          ],
        },
        expected: [{ net: 12500, tax: 0, gross: 12500 }],
      }),
    },
  })('db/payout-automation.ts').runPayoutAutomation;
  await run();
  await run();
  await run();
  assert.equal(h.remotes.size, 6);
  assert.equal(h.calls.filter((c) => c.endpoint.endsWith('/book')).length, 0);
  h.settings.automation.payoutsBookDinero = true;
  h.saveSettings();
  await run();
  await run();
  await run();
  assert.equal(h.remotes.size, 6);
  assert.equal(h.calls.filter((c) => c.endpoint.endsWith('/book')).length, 6);
  for (let i = 1; i <= 6; i++)
    assert.equal(h.get('payout_production:' + i).phase, 'booked');
  assert.equal(h.get('payout_production:unsafe-0').phase, 'uncertain');
});
