import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const url = 'https://fixture.myshopify.com/admin/api/2026-07/graphql.json';
const query = { method: 'POST', body: JSON.stringify({ query: 'query Orders { orders { id } }' }) };
const ok = () => Response.json({ data: { orders: [] } });
function harness(responses) {
  const calls = [], waits = [], exports = {};
  vm.runInNewContext(ts.transpileModule(readFileSync(new URL('./shopify-request.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, {
    exports, Error, AbortSignal, Date,
    fetch: async (...args) => { calls.push(args); const next = responses.shift(); if (next instanceof Error) throw next; return next(); },
    setTimeout: (fn, delay) => { waits.push(delay); fn(); },
  });
  return { ...exports, calls, waits };
}
test('503 and throttle recover with bounded backoff and identical query', async () => {
  const h = harness([() => new Response('not JSON', { status: 503 }), () => Response.json({ errors: [{ extensions: { code: 'THROTTLED' } }] }), ok]);
  assert.equal((await h.shopifyFetch(url, query)).status, 200);
  assert.deepEqual(h.waits, [1000, 2000]); assert.equal(h.calls.length, 3);
  assert.ok(h.calls.every(([target, init]) => target === url && init.body === query.body && init.redirect === 'manual'));
  assert.notEqual(h.calls[0][1].signal, h.calls[1][1].signal);
});
test('Retry-After is honored; longer waits defer instead of retrying early', async () => {
  const h = harness([() => new Response('', { status: 429, headers: { 'Retry-After': '3' } }), ok]);
  await h.shopifyFetch(url, query); assert.deepEqual(h.waits, [3000]);
  const long = harness([() => new Response('', { status: 429, headers: { 'Retry-After': '60' } })]);
  await assert.rejects(long.shopifyFetch(url, query), /HTTP 429.*1 forsøg/); assert.equal(long.calls.length, 1); assert.deepEqual(long.waits, []);
});
test('network failures stop after three attempts without leaking exception text', async () => {
  const h = harness([new Error('secret=private https://example/?token=abc'), new Error('private'), new Error('private')]);
  await assert.rejects(h.shopifyFetch(url, query), error => /3 forsøg/.test(error.message) && !/private|token=|https:/.test(error.message));
  assert.equal(h.calls.length, 3);
});
for (const status of [400, 401, 403, 302]) test(`HTTP ${status} is not retried or followed`, async () => {
  const h = harness([() => new Response('secret', { status })]);
  await assert.rejects(h.shopifyFetch(url, query), new RegExp(`HTTP ${status}`)); assert.equal(h.calls.length, 1);
});
test('GraphQL permanent errors do not retry or expose upstream payload', async () => {
  const h = harness([() => Response.json({ errors: [{ message: 'private customer', extensions: { code: 'ACCESS_DENIED' } }] })]);
  await assert.rejects(h.shopifyFetch(url, query), /ACCESS_DENIED/); assert.equal(h.calls.length, 1);
});
test('mutations run once even when throttled', async () => {
  const h = harness([() => new Response('', { status: 503 })]);
  const response = await h.shopifyFetch(url, { ...query, body: JSON.stringify({ query: 'mutation Stocktake { inventorySetQuantities { id } }' }) });
  assert.equal(response.status, 503); assert.equal(h.calls.length, 1); assert.deepEqual(h.waits, []);
});
test('REST reads retry; caller cancellation does not', async () => {
  const h = harness([() => new Response('', { status: 502 }), ok]);
  await h.shopifyFetch('https://fixture.myshopify.com/admin/api/2026-07/payouts.json'); assert.equal(h.calls.length, 2);
  const aborted = harness([new Error('abort')]);
  await assert.rejects(aborted.shopifyFetch(url, { ...query, signal: AbortSignal.abort() }), /afbrudt/); assert.equal(aborted.calls.length, 1);
});
test('diagnostic redaction preserves useful status and strips credentials', () => {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(readFileSync(new URL('./diagnostics.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, { exports });
  const result = exports.sanitizeDiagnostic('HTTP 403 https://secure.viabill.com/?apikey=abc&signature=xyz Bearer token123 {"secret":"hide me"} a@b.dk');
  assert.match(result, /HTTP 403/); assert.doesNotMatch(result, /abc|xyz|token123|hide me|a@b.dk/);
});
