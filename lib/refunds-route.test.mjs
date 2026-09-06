import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

// Execute the real route and money/history helpers with isolated HTTP and D1 doubles.
function harness(nodes = [], pageInfo = { hasNextPage: false, endCursor: null }, errors) {
  const queries = [], writes = [], calls = [];
  const db = { prepare(sql) { return { bind(...args) { const statement = { sql, args, async all() { queries.push(statement); return { results: [] }; } }; return statement; } }; }, async batch(statements) { writes.push(...statements); } };
  const overrides = {
    '@/db/errors': { recordFailure: async () => {} },
    'next/server': { NextResponse: { json: (data, options) => ({ data, ...options }) } },
    '@/db/database': { prepareDatabase: async () => db },
    '@/db/history': { loadHistory: async () => ({ months: 24, startDate: '' }) },
    '@/db/shopify': { getShopifyAccess: async () => ({ shop: 'example.myshopify.com', accessToken: 'test' }) },
  };
  function load(file) {
    const exports = {};
    const source = readFileSync(new URL(file, import.meta.url), 'utf8');
    vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, {
      exports, Date, Intl, AbortSignal,
      require(name) { return overrides[name] || load(name.replace('@/lib/', './') + '.ts'); },
      async fetch(url, init) { calls.push({ url, ...JSON.parse(init.body) }); return { ok: true, status: 200, async json() { return { data: { shopifyPaymentsAccount: { balanceTransactions: { nodes, pageInfo } } }, errors }; } }; },
    });
    return exports;
  }
  return { route: load('../app/api/shopify/refunds/route.ts'), queries, writes, calls };
}
const today = new Date().toISOString().slice(0, 10);
const from = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
const item = (id, extra = {}) => ({ id, type: 'REFUND', test: false, transactionDate: new Date(Date.now() - 86400000).toISOString(), amount: { amount: '-49.95', currencyCode: 'DKK' }, fee: { amount: '0.00', currencyCode: 'DKK' }, net: { amount: '-49.95', currencyCode: 'DKK' }, associatedOrder: { id: 'order-1', name: '#1001' }, ...extra });
const request = (extra = {}) => ({ json: async () => ({ from, to: today, ...extra }) });

test('imports separate partial refunds, excludes charges/tests/old dates and preserves exact signed amounts', async () => {
  const h = harness([item('r1'), item('r2'), item('charge', { type: 'CHARGE' }), item('test', { test: true }), item('old', { transactionDate: '2020-01-01T00:00:00Z' })]);
  const result = await h.route.POST(request());
  assert.equal(result.status, 200); assert.equal(result.data.synced, 2);
  assert.match(h.calls[0].variables.query, /^transaction_type:refund processed_at:>='[^']+Z' processed_at:<'[^']+Z'$/);
  assert.equal(h.writes.length, 2);
  assert.equal(h.writes[0].args[0], 'shopify-refund:r1');
  assert.equal(h.writes[0].args[4], -4995);
  assert.match(h.writes[0].sql, /'refund'/);
  assert.match(h.writes[0].sql, /ON CONFLICT\(tenant, record_type, external_id\) DO UPDATE/);
  assert.doesNotMatch(h.writes[0].sql.split('DO UPDATE')[1], /booking_status\s*=/);
});

test('passes pagination through and rejects a stalled cursor without writing', async () => {
  const h = harness([item('r1')], { hasNextPage: true, endCursor: 'next' });
  const result = await h.route.POST(request({ after: 'previous' }));
  assert.equal(h.calls[0].variables.after, 'previous'); assert.equal(result.data.endCursor, 'next');
  const stalled = harness([item('r1')], { hasNextPage: true, endCursor: 'same' });
  assert.equal((await stalled.route.POST(request({ after: 'same' }))).status, 400);
  assert.equal(stalled.writes.length, 0);
});

test('GET isolates refunds and tenant; validates paging', async () => {
  const h = harness();
  const result = await h.route.GET({ nextUrl: new URL(`https://example.test?from=${from}&to=${today}&search=1001&offset=50`) });
  assert.equal(result.status, 200);
  assert.equal(h.queries.length, 2);
  assert.match(h.queries[0].sql, /record_type = 'refund'/);
  assert.equal(h.queries[0].args[0], 'sablen.dk');
  assert.equal(h.queries[0].args.at(-1), 50);
  assert.equal((await h.route.GET({ nextUrl: new URL(`https://example.test?from=${from}&to=${today}&offset=-1`) })).status, 400);
});

test('permission failure and currency mismatch never persist records', async () => {
  const denied = harness([], undefined, [{ message: 'Access denied', extensions: { code: 'ACCESS_DENIED' } }]);
  assert.match((await denied.route.POST(request())).data.error, /mangler adgang/);
  assert.equal(denied.writes.length, 0);
  const invalid = harness([item('r1', { fee: { amount: '0', currencyCode: 'EUR' } })]);
  assert.equal((await invalid.route.POST(request())).status, 400);
  assert.equal(invalid.writes.length, 0);
});
