import test from 'node:test';
import assert from 'node:assert/strict';
import * as jose from 'jose';
import { loader } from './automation-test-fixture.mjs';
import { harness } from './platform-harness.mjs';

const table = (rows, columns = ['total_sales', 'taxes']) => ({
  parseErrors: [],
  tableData: { columns: columns.map((name) => ({ name })), rows },
});

test('dashboard revenue per webshop is Shopify total sales less taxes, in minor units', () => {
  const api = loader({ jose })('platform/dashboard-shop.ts');
  assert.equal(
    api.parseSalesTotal(table([{ total_sales: '1250.50', taxes: '250.10' }])),
    100040,
  );
  assert.equal(
    api.parseSalesTotal(table([{ total_sales: -80, taxes: -16 }])),
    -6400,
  );
  // No row: no sales in the period.
  assert.equal(api.parseSalesTotal(table([])), 0);
  assert.throws(() => api.parseSalesTotal(table([{ total_sales: 'x' }])));
  assert.throws(() =>
    api.parseSalesTotal(table([{ total_sales: '1' }], ['total_sales'])),
  );
  assert.throws(() =>
    api.parseSalesTotal({ ...table([]), parseErrors: ['bad'] }),
  );
});

test('dashboard webshop finance reads its own webshop, skips periods before the data start and keeps parts apart', async () => {
  const queries = [];
  const api = loader({
    jose,
    './invoice-source': {
      shopAccess: async (_env, company, shop) => {
        assert.equal(company, 'company-a');
        assert.equal(shop, 'shop-a2');
        return {};
      },
      orderQuery: async (_access, query, variables) => {
        if (query.includes('DashboardShop'))
          return { shop: { currencyCode: 'DKK' } };
        queries.push(variables.query);
        return {
          shopifyqlQuery: table([
            {
              total_sales: variables.query.includes('2026-10-01')
                ? '125'
                : '1250',
              taxes: variables.query.includes('2026-10-01') ? '25' : '250',
            },
          ]),
        };
      },
    },
    './inventory-source': {
      readInventory: async () => {
        throw Error('Shopify kunne ikke hente lagerdata.');
      },
    },
  })('platform/dashboard-shop.ts');
  const now = new Date('2026-10-11T10:00:00Z');
  const data = await api.readShopFinance(
    {},
    'company-a',
    'shop-a2',
    '2026-01-01',
    now,
  );
  // Last year lies before the data start, so it is unknown and never asked for.
  assert.deepEqual(
    queries.sort((a, b) => a.localeCompare(b)),
    [
      'FROM sales SHOW total_sales, taxes SINCE 2026-01-01 UNTIL 2026-10-11',
      'FROM sales SHOW total_sales, taxes SINCE 2026-10-01 UNTIL 2026-10-11',
    ],
  );
  assert.deepEqual(data.revenue, {
    revenueMtd: 10000,
    revenueYtd: 100000,
    previousMtd: null,
    previousYtd: null,
  });
  assert.equal(data.inventory, null);
  assert.match(data.inventoryError, /lagerdata/);
  assert.equal(data.currency, 'DKK');

  const full = await api.readShopFinance(
    {},
    'company-a',
    'shop-a2',
    '2024-01-01',
    now,
  );
  assert.ok(
    queries.includes(
      'FROM sales SHOW total_sales, taxes SINCE 2025-10-01 UNTIL 2025-10-11',
    ),
  );
  assert.ok(
    queries.includes(
      'FROM sales SHOW total_sales, taxes SINCE 2025-01-01 UNTIL 2025-10-11',
    ),
  );
  assert.equal(full.revenue.previousYtd, 100000);
});

test('a missing report access does not hide the webshop inventory value', async () => {
  const api = loader({
    jose,
    './invoice-source': {
      shopAccess: async () => ({}),
      orderQuery: async (_access, query) => {
        if (query.includes('DashboardShop'))
          return { shop: { currencyCode: 'DKK' } };
        throw Error('Shopify kunne ikke hente omsætningen.');
      },
    },
    './inventory-source': {
      readInventory: async () => ({
        rows: [{ currency: 'DKK' }],
        totalValueMinor: 123400,
        incomplete: [{}],
      }),
    },
  })('platform/dashboard-shop.ts');
  const data = await api.readShopFinance(
    {},
    'company-a',
    'shop-a1',
    '2024-01-01',
    new Date('2026-10-11T10:00:00Z'),
  );
  assert.equal(data.revenue, null);
  assert.match(data.revenueError, /omsætningen/);
  assert.deepEqual(data.inventory, { valueMinor: 123400, incomplete: 1 });
});

test('dashboard webshop finance checks access to the webshop on the server', async () => {
  const h = harness();
  try {
    const url = (shop) =>
      '/api/platform/tier1/shops/' + shop + '/dashboard/shop';
    // Another company's webshop is not found for the user at all.
    assert.equal(
      (await h.request(url('shop-a1'), { user: 'local-b' })).status,
      404,
    );
    assert.equal(
      (await h.request(url('shop-a2'), { user: 'local-reader' })).status,
      403,
    );
    const missing = await h.request(url('shop-a1'), { user: 'local-a' });
    assert.equal(missing.status, 409);
    assert.match((await missing.json()).error, /Forbind Shopify/);
    assert.equal(
      (
        await h.request(url('shop-a1'), {
          user: 'local-a',
          method: 'POST',
          body: {},
        })
      ).status,
      405,
    );
  } finally {
    h.close();
  }
});
