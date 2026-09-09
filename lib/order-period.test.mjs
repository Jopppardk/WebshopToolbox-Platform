import test from 'node:test';
import assert from 'node:assert/strict';
import { databaseFixture, loader } from './automation-test-fixture.mjs';
const { orderPeriodWindow: window } = loader()('lib/order-period.ts');
test('sales periods use Danish calendar days across DST and month/year boundaries', () => {
  assert.deepEqual(window('today', '2020', new Date('2026-03-29T10:00:00Z')), { from: '2026-03-28T23:00:00.000Z', until: '2026-03-29T22:00:00.000Z' });
  assert.deepEqual(window('last-month', '2020', new Date('2026-01-09T10:00:00Z')), { from: '2025-11-30T23:00:00.000Z', until: '2025-12-31T23:00:00.000Z' });
  assert.equal(window('7days', '2020', new Date('2026-09-09T10:00:00Z')).from, '2026-09-02T22:00:00.000Z');
  assert.equal(window('30days', '2020', new Date('2026-09-09T10:00:00Z')).from, '2026-08-10T22:00:00.000Z');
  assert.equal(window('month', '2020', new Date('2026-09-09T10:00:00Z')).from, '2026-08-31T22:00:00.000Z');
  assert.equal(window('year', '2020', new Date('2026-09-09T10:00:00Z')).from, '2025-12-31T23:00:00.000Z');
});
test('periods cannot reveal orders before the configured history cutoff', () => {
  const cutoff = '2026-09-05T22:00:00.000Z';
  assert.equal(window('30days', cutoff, new Date('2026-09-09')).from, cutoff);
  assert.equal(window('all', cutoff).from, cutoff);
  assert.throws(() => window('invalid', cutoff));
});
test('sales API paginates 50 records and applies identical period boundaries to total and rows', async t => {
  const h = databaseFixture(); t.after(() => h.sql.close());
  const now = new Date();
  const today = window('today', '2020', now);
  const date = new Date(+new Date(today.from) + 3600000).toISOString();
  const money = { shopMoney: { amount: '125', currencyCode: 'DKK' } };
  const add = (id, at) => h.record('order', id, { id, name: id, createdAt: at, processedAt: at, displayFinancialStatus: 'PAID', displayFulfillmentStatus: 'FULFILLED', currentTotalPriceSet: money }, at);
  for (let i = 0; i < 105; i++) add(String(i).padStart(3, '0'), date);
  add('yesterday', new Date(+new Date(today.from) - 1).toISOString());
  add('tomorrow', today.until);
  const api = loader({
    '@/db/database': { prepareDatabase: async () => h.db },
    '@/db/errors': { recordFailure: async () => {} },
    '@/db/shopify': {}, '@/lib/invoice-pdf': {}, '@/db/shopify-order': {}, '@/lib/invoice-check': {},
    'next/server': { NextResponse: { json: (data, options) => ({ data, ...options }) } },
  })('app/api/shopify/orders/route.ts');
  const get = query => api.GET({ nextUrl: new URL('https://example.test/?' + query) });
  const pages = await Promise.all([0, 50, 100].map(offset => get('period=today&offset=' + offset)));
  assert.deepEqual(pages.map(p => p.data.orders.length), [50, 50, 5]);
  assert.ok(pages.every(p => p.data.total === 105));
  assert.equal(new Set(pages.flatMap(p => p.data.orders.map(o => o.id))).size, 105);
  assert.equal(pages[0].data.orders[0].id, '104');
  assert.equal((await get('period=all')).data.total, 107);
  assert.equal((await get('period=today&limit=100')).data.orders.length, 100);
  for (const query of ['period=bad', 'offset=-1', 'offset=1.5', 'limit=500']) assert.equal((await get(query)).status, 400);
  assert.equal(pages[0].headers['Cache-Control'], 'no-store');
});
