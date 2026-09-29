import test from 'node:test';
import assert from 'node:assert/strict';
import * as jose from 'jose';
import { loader } from './automation-test-fixture.mjs';

const calc = loader()('platform/performance-calculations.ts');
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const ranges = [{ from: '2025-01-01', to: '2025-12-31' }, { from: '2026-01-01', to: '2026-12-31' }];
const categories = { 1000: 'Turnover', 2000: 'Variable Expenses', 55000: 'Liquid Assets', 60000: 'Short Term Debt' };
const entry = (n, account, amount, date = '2026-01-10', extra = {}) => ({ EntryGuid: id(n), AccountNumber: account, Amount: amount, Date: date, Type: 'Normal', ...extra });
const aggregate = rows => calc.aggregateFinance(calc.parsePerformanceEntries(rows), categories, ranges, 2026, '2026-09-29', '2025-01-01', new Map([[id(80), 'Leverandør A']]));

test('performance sums signed booked expense/revenue entries, prior full year and creditor-linked suppliers', () => {
  const data = aggregate([
    entry(1, 1000, -100), entry(2, 1000, 20), entry(3, 2000, 40, undefined, { VoucherGuid: id(70) }),
    entry(4, 60000, -40, undefined, { VoucherGuid: id(70), ContactGuid: id(80) }),
    entry(5, 2000, -10, undefined, { ContactGuid: id(80) }), entry(6, 2000, 3),
    entry(7, 1000, -200, '2025-12-24'), entry(8, 1000, -9999, undefined, { Type: 'Primo' }),
    entry(9, 2000, 9999, undefined, { Type: 'Ultimo' }), entry(10, 1000, -9999, '2026-10-01'),
  ]);
  assert.equal(data.revenue.months.length, 12);
  assert.equal(data.revenue.months[0].current, 8000);
  assert.equal(data.revenue.months[11].previous, 20000);
  assert.equal(data.revenue.months[9].current, null);
  assert.equal(data.expenses.months[0].current, 3300);
  assert.equal(data.suppliers[0].id, id(80));
  assert.equal(data.suppliers[0].name, 'Leverandør A');
  assert.equal(data.suppliers[0].months[0].current, 3000);
  assert.equal(data.unassigned[0].current, 300);
  assert.equal(data.expenses.months[1].current, 0);
});

test('missing/partial history stays unknown and fiscal year boundaries cover calendar months', () => {
  const data = calc.comparison(2026, '2026-09-29', '2025-02-15', [{ from: '2025-02-15', to: '2025-06-30' }, { from: '2025-07-01', to: '2026-06-30' }], new Map());
  assert.equal(data[0].previous, null); assert.equal(data[1].previous, null);
  assert.equal(data[2].previous, 0); assert.equal(data[0].current, 0); assert.equal(data[6].current, null);
  assert.deepEqual(calc.monthRange(2024, 2), { from: '2024-02-01', to: '2024-02-29' });
});

test('invalid accounting data fails closed and ambiguous voucher contacts are not guessed', () => {
  assert.throws(() => aggregate([entry(1, 1000, -100), entry(1, 1000, -100)]), /gentog/);
  assert.throws(() => aggregate([entry(1, 9999, 100)]), /kategori/);
  assert.throws(() => aggregate([entry(1, 1000, -100, '2026-02-30')]), /ugyldige/);
  assert.throws(() => aggregate([entry(1, 2000, 1, undefined, { ContactGuid: 'not-a-guid' })]), /ugyldige/);
  const data = aggregate([entry(1, 2000, 1, undefined, { ContactGuid: id(80), VoucherGuid: id(90) }), entry(2, 2000, 1, undefined, { ContactGuid: id(81), VoucherGuid: id(90) }), entry(3, 2000, 1, undefined, { VoucherGuid: id(90) })]);
  assert.equal(data.suppliers.length, 2); assert.equal(data.unassigned[0].current, 100); assert.equal(data.expenses.months[0].current, 300);
});

const report = rows => ({ parseErrors: [], tableData: { columns: [{ name: 'month' }, { name: 'sessions' }], rows } });
test('Shopify report parser distinguishes explicit zeroes, missing months and future months', () => {
  const data = calc.parseShopifyMetric(report([{ month: '2026-01-01', sessions: '0' }, { month: '2025-12-01', sessions: 50 }, { month: '2026-10-01', sessions: 4 }]), 'sessions', 2026, '2026-09-29', '2025-01-01');
  assert.equal(data.months[0].current, 0); assert.equal(data.months[1].current, null);
  assert.equal(data.months[11].previous, 50); assert.equal(data.months[9].current, null);
  for (const value of [null, { parseErrors: ['Access denied'] }, report([{ month: '2026-01-01', sessions: null }]), report([{ month: '2026-01-01', sessions: 1.5 }]), report([{ month: '2026-01-01', sessions: 1 }, { month: '2026-01-01', sessions: 2 }])]) {
    assert.throws(() => calc.parseShopifyMetric(value, 'sessions', 2026, '2026-09-29', '2025-01-01'));
  }
});

test('Dinero performance reads booked entries and v2 historical contact names using auth plus GET only', async () => {
  const calls = [];
  const network = async (input, options) => {
    const url = new URL(input); calls.push(url);
    assert.equal(options.redirect, 'manual');
    if (url.pathname.endsWith('/oauth/token')) { assert.equal(options.method, 'POST'); return Response.json({ access_token: 'synthetic' }); }
    assert.equal(options.method, 'GET'); assert.equal(options.headers.Authorization, 'Bearer synthetic');
    if (url.pathname.endsWith('/accountingyears')) return Response.json(ranges.map(r => ({ FromDate: r.from, ToDate: r.to })));
    if (url.pathname.endsWith('/accounts/entry')) return Response.json(Object.entries(categories).map(([account, category]) => ({ AccountNumber: Number(account), Category: category })));
    if (url.pathname.endsWith('/entries')) {
      const year = url.searchParams.get('fromDate').slice(0, 4);
      assert.equal(url.searchParams.get('includePrimo'), 'false');
      return Response.json([entry(Number(year), 2000, 20, year + '-03-01', { ContactGuid: id(80) })]);
    }
    assert.equal(url.pathname, '/v2/123/contacts');
    assert.equal(url.searchParams.get('deletedOnly'), 'false');
    return Response.json({ Pagination: { Page: 0, PageSize: 1000, ResultWithoutFilter: 1 }, Collection: [{ ContactGuid: id(80), Name: 'Historisk leverandør' }] });
  };
  const api = loader({ jose, fetch: network })('platform/performance-source.ts');
  const data = await api.readPerformanceFinance({ organizationId: '123', clientId: 'test', clientSecret: 'test', apiKey: 'test' }, 2026, '2025-02-01', '2026-09-29');
  assert.equal(data.suppliers[0].name, 'Historisk leverandør');
  assert.equal(data.suppliers[0].months[2].previous, 2000); assert.equal(data.suppliers[0].months[0].previous, null);
  assert.equal(calls.filter(u => u.pathname.endsWith('/entries')).length, 2);
});

test('traffic errors do not hide order reports and shop timezone is used', async () => {
  const year = new Date().getUTCFullYear(), calls = [];
  const api = loader({ jose, './invoice-source': {
    shopAccess: async (_env, company, shop) => { assert.equal(company, 'company-a'); assert.equal(shop, 'shop-a'); return {}; },
    orderQuery: async (_access, query, variables) => {
      if (query.includes('PerformanceShop')) return { shop: { ianaTimezone: 'Europe/Copenhagen' } };
      calls.push(variables.query);
      if (variables.query.includes('FROM sessions')) throw Error('Shopify rapportadgang mangler');
      return { shopifyqlQuery: { parseErrors: [], tableData: { columns: [{ name: 'month' }, { name: 'orders' }], rows: [{ month: `${year}-01-01`, orders: '12' }] } } };
    },
  } })('platform/performance-source.ts');
  const data = await api.readPerformanceShop({}, 'company-a', 'shop-a', year, `${year - 1}-01-01`);
  assert.match(data.visits.error, /rapportadgang/); assert.equal(data.orders.months[0].current, 12);
  assert.equal(data.timezone, 'Europe/Copenhagen'); assert.equal(calls.length, 2);
});
