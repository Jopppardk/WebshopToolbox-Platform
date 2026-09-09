import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { DatabaseSync } from 'node:sqlite';
import { webcrypto } from 'node:crypto';
import ts from 'typescript';

// Isolated fixtures, never production calls. The accounts/export envelopes are
// intentionally assumptions: the public spec omits their response schemas.
function harness() {
  const sql = new DatabaseSync(':memory:'); const calls = []; const cache = new Map();
  let respond = () => new Response(JSON.stringify([{ accountId: 4566, name: 'Sablen' }]));
  let failBatch = false;
  const db = { prepare(text) {
    const statement = sql.prepare(text);
    const bound = args => ({ text, args, async first() { return statement.get(...args) ?? null; }, async all() { return { results: statement.all(...args) }; }, async run() { return { meta: { changes: statement.run(...args).changes } }; } });
    return { ...bound([]), bind: (...args) => bound(args) };
  }, async batch(statements) { if (failBatch) throw new Error('private database detail'); sql.exec('BEGIN'); try { for (const statement of statements) await statement.run(); sql.exec('COMMIT'); } catch (error) { sql.exec('ROLLBACK'); throw error; } } };
  const overrides = { 'next/server': { NextResponse: { json: (data, options = {}) => ({ data, status: 200, ...options }) } }, '@/db/database': { prepareDatabase: async () => db }, './database': { prepareDatabase: async () => db }, '@/db/errors': { recordFailure: async () => {} }, '@/db/history': { loadHistory: async () => ({ months: 24, startDate: '' }) } };
  function load(file) {
    const url = new URL(file, import.meta.url); if (cache.has(url.href)) return cache.get(url.href);
    const exports = {}; cache.set(url.href, exports);
    vm.runInNewContext(ts.transpileModule(readFileSync(url, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, {
      exports, Date, Intl, URL, crypto: webcrypto, TextEncoder, TextDecoder, Uint8Array, AbortSignal, btoa, atob,
      process: { env: { CREDENTIALS_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64') } },
      require(name) { if (overrides[name]) return overrides[name]; return load(name.startsWith('@/') ? '../' + name.slice(2) + '.ts' : new URL(name + '.ts', url).href); },
      async fetch(url, init) { calls.push({ url: String(url), ...init }); return respond(url, init); },
    });
    return exports;
  }
  for (const statement of load('../db/schema.ts').schemaStatements) sql.exec(statement);
  return { sql, calls, helper: load('./viabill.ts'), credentials: load('../db/credentials.ts'), connection: load('../app/api/viabill/connection/route.ts'), records: load('../app/api/viabill/records/route.ts'), respond: fn => { respond = fn; }, failBatch: () => { failBatch = true; } };
}
const request = body => ({ json: async () => body, headers: new Headers(), nextUrl: new URL('https://integration.sablen.dk/api/viabill/records') });
const now = new Date().toISOString().slice(0, 10);
const fixture = (entryUUID = 'entry-1', extra = {}) => ({ entryUUID, date: now, type: 'capture', orderNumber: '#1001', transactionId: 'tx-1', amount: { amount: 12500, currency: 'DKK' }, ...extra });
const json = value => new Response(JSON.stringify(value));
const save = h => h.credentials.saveCredentials('viabill', { apiKey: 'test-key', secret: 'test-secret', accountId: '4566' }, 'Sablen (4566)');

test('documented signature, read-only endpoint allowlist, no raw secrets in failures', async () => {
  const h = harness(); try {
    assert.equal(await h.helper.signature({ apiKey: 'key123', secret: 'mysecret' }), '766e4a702fd4360807175898db51e55fe91baf752344096d86bb4428c48fa834');
    await assert.rejects(h.helper.viabillRequest({ apiKey: 'key', secret: 'secret' }, '/transaction/capture'), /ikke tilladt/);
    await assert.rejects(h.helper.viabillRequest({ apiKey: 'key', secret: 'secret' }, '/public/merchant/accounts', {}), /ikke tilladt/);
    assert.equal(h.calls.length, 0);
    h.respond(() => { throw new Error('test-key test-secret private-url'); });
    await assert.rejects(h.helper.accounts({ apiKey: 'key', secret: 'secret' }), /kunne ikke kontaktes/);
    assert.equal(h.helper.publicError(new Error('private database detail')), 'ViaBill-handlingen mislykkedes. Prøv igen; der er ikke ændret noget hos ViaBill.');
  } finally { h.sql.close(); }
});
test('connection requires selected authorized account, encrypts secrets, GET never exposes them', async () => {
  const h = harness(); try {
    const draft = { action: 'discover', apiKey: 'test-key', secret: 'test-secret' };
    const discovered = await h.connection.POST(request(draft)); assert.equal(discovered.status, 200); assert.equal(discovered.data.accounts[0].id, '4566');
    assert.equal((await h.connection.GET()).data.connected, false);
    h.respond((url) => String(url).includes('/entries/download/') ? json([]) : json([{ accountId: 4566, name: 'Sablen' }]));
    assert.equal((await h.connection.POST(request({ ...draft, action: 'connect', accountId: '4566' }))).status, 200);
    const stored = h.sql.prepare("SELECT setting_value FROM app_settings WHERE setting_key='viabill_credentials'").get().setting_value;
    assert.doesNotMatch(stored, /test-key|test-secret/);
    assert.equal((await h.credentials.loadCredentials('viabill')).secret, 'test-secret');
    const publicStatus = await h.connection.GET(); assert.equal(publicStatus.data.connected, true); assert.doesNotMatch(JSON.stringify(publicStatus), /ciphertext|signature|test-key|test-secret/);
    const foreign = request(draft); foreign.headers.set('origin', 'https://evil.example'); assert.equal((await h.connection.POST(foreign)).status, 403);
  } finally { h.sql.close(); }
});
test('forbidden discovery remains an error; direct account verification is still possible', async () => {
  const h = harness(); try {
    h.respond((url, init) => String(url).endsWith('/accounts?apikey=test-key&signature=' + new URL(String(url)).searchParams.get('signature'))
      ? new Response(null, { status: 403 }) : json({ entries: [] }));
    const draft = { action: 'discover', apiKey: 'test-key', secret: 'test-secret' };
    const discovered = await h.connection.POST(request(draft)); assert.equal(discovered.status, 403); assert.match(discovered.data.error, /HTTP 403/); assert.equal(discovered.data.manualAccountIdRequired, true);
    const connected = await h.connection.POST(request({ ...draft, action: 'connect', accountId: '4566' })); assert.equal(connected.status, 200);
    assert.equal((await h.credentials.loadCredentials('viabill')).accountId, '4566');
    assert.equal(JSON.parse(h.calls[1].body).entryPage.pageLength, 1);
  } finally { h.sql.close(); }
});
for (const status of [400, 401, 403, 429, 503]) test(`ViaBill preserves HTTP ${status} without blaming an unproven cause`, async () => {
  const h = harness(); try {
    h.respond(() => new Response('secret=test-secret signature=private', { status }));
    const result = await h.connection.POST(request({ action: 'discover', apiKey: 'test-key', secret: 'test-secret' }));
    assert.equal(result.status, status);
    assert.match(result.data.error, new RegExp(`HTTP ${status}`));
    assert.doesNotMatch(result.data.error, /test-secret|private|test-key/);
    assert.equal(result.data.manualAccountIdRequired, status === 403);
    assert.equal((await h.connection.GET()).data.connected, false);
    if (status === 400) assert.match(result.data.error, /beviser ikke/);
    if (status === 403) assert.match(result.data.error, /afgør ikke/);
  } finally { h.sql.close(); }
});
test('Worker-compatible manual redirects never forward credentials to another destination', async () => {
  const h = harness(); try {
    h.respond(() => new Response(null, { status: 302, headers: { Location: 'https://other.example/private-location' } }));
    await assert.rejects(h.helper.accounts({ apiKey: 'key', secret: 'secret' }), /omdirigerede/);
    assert.equal(h.calls.length, 1);
    assert.equal(h.calls[0].redirect, 'manual');
    assert.equal(new URL(h.calls[0].url).origin, 'https://secure.viabill.com');
  } finally { h.sql.close(); }
});
test('captures only; exact cents, stable IDs, upsert preserves bookkeeping', async () => {
  const h = harness(); try {
    await save(h); h.respond(() => json([fixture('entry-1'), fixture('entry-2'), fixture('refund', { type: 'refund', amount: { amount: -5000, currency: 'DKK' } })]));
    const body = { kind: 'payment', from: now, to: now };
    const result = await h.records.POST(request(body)); assert.equal(result.status, 200); assert.equal(result.data.synced, 2); assert.equal(result.data.skipped, 1);
    const exported = JSON.parse(h.calls[0].body); assert.equal(exported.filter.transactions, true); assert.equal(exported.filter.transfers, false); assert.equal(exported.entryPage.first, 1);
    let row = h.sql.prepare('SELECT * FROM integration_records ORDER BY id').get(); assert.equal(row.amount_minor, 12500); assert.equal(row.external_id, 'viabill:4566:entry-1');
    h.sql.prepare("UPDATE integration_records SET booking_status='booked'").run();
    assert.equal((await h.records.POST(request(body))).status, 200);
    assert.equal(h.sql.prepare('SELECT COUNT(*) AS n FROM integration_records').get().n, 2);
    assert.equal(h.sql.prepare('SELECT booking_status FROM integration_records').get().booking_status, 'booked');
    const read = await h.records.GET({ nextUrl: new URL(`https://integration.sablen.dk/api/viabill/records?kind=payment&from=${now}&to=${now}`) });
    assert.equal(read.data.records.length, 2); assert.equal(read.data.totals[0].amountMinor, 25000);
    assert.equal((await h.records.POST(request({ ...body, kind: 'refund' }))).status, 400);
  } finally { h.sql.close(); }
});
test('payout uses authoritative total and all settlement entries, reports imbalance', async () => {
  const h = harness(); try {
    await save(h);
    h.respond(url => String(url).includes('/entries/download/') ? json([fixture('payout-1', { type: 'transfer', amount: { amount: -11250, currency: 'DKK' } })]) : json({ accountId: 4566, list: [{ transferDate: now, total: { amount: 11250, currency: 'DKK' }, merchantEntryPostDTOs: [fixture(), fixture('fee', { type: 'invoice', amount: { amount: -1250, currency: 'DKK' } })] }] }));
    const result = await h.records.POST(request({ kind: 'payout', from: now, to: now })); assert.equal(result.status, 200); assert.equal(result.data.synced, 1); assert.equal(result.data.mismatches, 0);
    const row = h.sql.prepare('SELECT * FROM integration_records').get(); assert.equal(row.amount_minor, 11250); assert.equal(JSON.parse(row.payload_json).entries.length, 2);
    assert.equal(h.calls.length, 2); assert.equal(h.calls[1].method, 'GET');
    const wrong = h.helper.payout({ accountId: 4566, list: [{ transferDate: now, total: { amount: 1, currency: 'DKK' }, merchantEntryPostDTOs: [fixture()] }] }, '4566', 'p1'); assert.equal(wrong.reconciled, false);
    assert.throws(() => h.helper.payout({ accountId: 99, list: [] }, '4566', 'p1'));
  } finally { h.sql.close(); }
});
test('invalid money, unknown shapes/types, repeated or oversized pages fail closed', async () => {
  const h = harness(); try {
    await save(h); const body = { kind: 'payment', from: now, to: now };
    for (const payload of [{ unexpected: [] }, [fixture('bad', { amount: { amount: 12.5, currency: 'DKK' } })], [fixture('bad', { type: 'unknown' })], [fixture('same'), fixture('same')], Array.from({ length: 51 }, (_, i) => fixture(`entry-${i}`))]) {
      h.respond(() => json(payload)); assert.equal((await h.records.POST(request(body))).status, 400); assert.equal(h.sql.prepare('SELECT COUNT(*) AS n FROM integration_records').get().n, 0);
    }
    h.respond(() => json(Array.from({ length: 50 }, (_, i) => fixture(`entry-${i}`))));
    const first = await h.records.POST(request(body)); assert.equal(first.status, 200); assert.equal(first.data.next.first, 51);
    const second = await h.records.POST(request({ ...body, next: first.data.next })); assert.equal(second.status, 400); assert.match(second.data.error, /gentog/);
    assert.equal(h.sql.prepare('SELECT COUNT(*) AS n FROM integration_records').get().n, 50);
    assert.equal((await h.records.POST(request({ ...body, next: { ...first.data.next, accountId: 'other' } }))).status, 400);
  } finally { h.sql.close(); }
});
test('retention filters and missing connection prevent outside-scope writes; DB failure is sanitized', async () => {
  const h = harness(); try {
    const body = { kind: 'payment', from: now, to: now };
    assert.equal((await h.records.POST(request(body))).status, 400); assert.equal(h.calls.length, 0);
    await save(h); h.respond(() => json([fixture('old', { date: '2020-01-01' })]));
    assert.equal((await h.records.POST(request(body))).data.synced, 0);
    h.respond(() => json([fixture()])); h.failBatch();
    const result = await h.records.POST(request(body)); assert.equal(result.status, 400); assert.doesNotMatch(result.data.error, /private database/);
  } finally { h.sql.close(); }
});
