import test from 'node:test';
import assert from 'node:assert/strict';
import { loader, databaseFixture } from './automation-test-fixture.mjs';
const json = {
  NextResponse: { json: (data, options) => ({ data, ...options }) },
};
test('individual dates preserve inherited history and cannot bypass retention', async (t) => {
  const h = databaseFixture();
  t.after(() => h.sql.close());
  const load = loader();
  const { loadHistory } = load('db/history.ts');
  h.set('history_policy', { months: 24, startDate: '2025-02-01' });
  assert.equal((await loadHistory(h.db, 'shopify')).startDate, '2025-02-01');
  h.set('integration_start:shopify', '2026-03-01');
  h.set('integration_start:viabill', '2024-01-01');
  assert.equal((await loadHistory(h.db, 'shopify')).startDate, '2026-03-01');
  assert.equal((await loadHistory(h.db, 'viabill')).startDate, '2025-02-01');
  const { historyWindow } = load('lib/history-policy.ts');
  assert.equal(
    historyWindow(
      await loadHistory(h.db, 'viabill'),
      new Date('2028-09-10T12:00:00Z'),
    ).effectiveDate,
    '2026-09-10',
  );
});
test('date fields expose existing configured and finance dates without writing on GET', async (t) => {
  const h = databaseFixture();
  t.after(() => h.sql.close());
  h.set('history_policy', { months: 24, startDate: '2025-02-01' });
  h.set('dashboard_finance:org', {
    loaded: [{ from: '2024-07-01', to: '2025-06-30' }],
  });
  const api = loader({
    'next/server': json,
    '@/db/database': { prepareDatabase: async () => h.db },
    '@/db/credentials': {
      loadCredentials: async () => ({ organizationId: 'org' }),
    },
  })('app/api/integrations/start-date/route.ts');
  const get = (p) =>
    api.GET({
      nextUrl: new URL(
        'https://test/api/integrations/start-date?provider=' + p,
      ),
    });
  assert.equal((await get('shopify')).data.startDate, '2025-02-01');
  assert.equal((await get('dinero')).data.startDate, '2024-07-01');
  assert.equal(h.get('integration_start:shopify'), null);
  const post = (startDate, origin = 'https://test') =>
    api.POST(
      new Request('https://test/api/integrations/start-date', {
        method: 'POST',
        headers: { origin, 'content-type': 'application/json' },
        body: JSON.stringify({ provider: 'shopify', startDate }),
      }),
    );
  assert.equal((await post('2026-02-30')).status, 422);
  assert.equal((await post('2026-01-01', 'https://other')).status, 403);
  assert.equal(h.get('integration_start:shopify'), null);
  assert.equal((await post('2026-01-01')).status, 200);
  assert.equal((await get('shopify')).data.startDate, '2026-01-01');
});
test('Flatpay start date updates preserve credentials without another upstream login', async () => {
  let saved;
  const original = {
    username: 'u',
    password: 'p',
    merchantID: 'm',
    agreementId: 'a',
    agreementNumber: '1',
    startDate: '2025-01-01',
  };
  const api = loader({
    'next/server': json,
    '@/db/credentials': {
      loadCredentials: async () => original,
      saveCredentials: async (p, c) => {
        saved = c;
      },
    },
  })('app/api/flatpay/connection/route.ts');
  const r = await api.POST(
    new Request('https://test/api/flatpay/connection', {
      method: 'POST',
      headers: { origin: 'https://test', 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'start-date', startDate: '2026-01-01' }),
    }),
  );
  assert.equal(r.status, 200);
  assert.deepEqual(saved, { ...original, startDate: '2026-01-01' });
  assert.equal('password' in r.data, false);
});
test('Shopify refund import sends the saved boundary even when an older period is requested', async (t) => {
  const h = databaseFixture();
  t.after(() => h.sql.close());
  h.set('history_policy', { months: 120, startDate: '' });
  h.set('integration_start:shopify', '2026-08-01');
  let query;
  const api = loader({
    'next/server': json,
    '@/db/database': { prepareDatabase: async () => h.db },
    '@/db/shopify': {
      getShopifyAccess: async () => ({
        shop: 'example.myshopify.com',
        accessToken: 'test',
      }),
    },
    '@/db/errors': { recordFailure: async () => {} },
    '@/lib/shopify-request': {
      shopifyFailure: () => '',
      shopifyFetch: async (url, options) => {
        query = JSON.parse(options.body).variables.query;
        return Response.json({
          data: {
            shopifyPaymentsAccount: {
              balanceTransactions: {
                nodes: [],
                pageInfo: { hasNextPage: false, endCursor: null },
              },
            },
          },
        });
      },
    },
  })('app/api/shopify/refunds/route.ts');
  const result = await api.POST(
    new Request('https://test/api/shopify/refunds', {
      method: 'POST',
      body: JSON.stringify({ from: '2025-01-01', to: '2026-09-01' }),
    }),
  );
  assert.equal(result.status, 200);
  assert.match(query, /2026-07-31T22:00:00/);
  assert.doesNotMatch(query, /2025-01-01/);
});
test('Dinero import bounds entries and keeps partial-year totals unavailable', async (t) => {
  const h = databaseFixture();
  t.after(() => h.sql.close());
  h.set('integration_start:dinero', '2026-08-01');
  const requests = [];
  const api = loader({
    './database': { database: () => h.db },
    './credentials': {
      loadCredentials: async () => ({
        organizationId: 'org',
        clientId: 'x',
        clientSecret: 'y',
        apiKey: 'z',
      }),
    },
    fetch: async (url) => {
      requests.push(url);
      if (url.includes('/oauth/'))
        return Response.json({ access_token: 'token' });
      if (url.endsWith('/accountingyears'))
        return Response.json([
          { FromDate: '2026-01-01', ToDate: '2026-12-31' },
        ]);
      if (url.includes('/accounts/entry'))
        return Response.json([{ AccountNumber: 1000, Category: 'Turnover' }]);
      return Response.json([]);
    },
  })('db/dashboard-finance.ts');
  await api.syncDashboardFinance();
  assert.ok(requests.some((url) => url.includes('fromDate=2026-08-01')));
  const result = await api.dashboardFinance();
  assert.equal(result.data.revenueYtd, null);
  assert.equal(result.data.inventory, null);
});
