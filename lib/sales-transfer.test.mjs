import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import ts from 'typescript';
import { fixture } from './invoice-fixture.mjs';
const root = fileURLToPath(new URL('../', import.meta.url));
function loader(overrides = {}) {
  const cache = new Map();
  return function load(file) {
    const full = path.resolve(root, file);
    if (cache.has(full)) return cache.get(full);
    const exports = {}; cache.set(full, exports);
    const code = ts.transpileModule(readFileSync(full, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    new Function('exports', 'require', 'fetch', code)(exports, name => {
      if (name in overrides) return overrides[name];
      return load((name.startsWith('@/') ? path.join(root, name.slice(2)) : path.resolve(path.dirname(full), name)) + '.ts');
    }, overrides.fetch || (() => { throw Error('Unexpected network'); }));
    return exports;
  };
}
const chart = [{ number: '1000', name: 'Salg', vatCode: 'U25', kind: 'entry', hidden: false }, { number: '1350', name: 'Fragt', vatCode: 'U25', kind: 'entry', hidden: false }, { number: '55110', name: 'Fordelingskonto', vatCode: '', kind: 'deposit', hidden: false }];
async function harness(attach = false) {
  const sql = new DatabaseSync(':memory:');
  sql.exec("CREATE TABLE app_settings (tenant TEXT, setting_key TEXT, setting_value TEXT, updated_at TEXT, PRIMARY KEY(tenant,setting_key)); CREATE TABLE integration_records (tenant TEXT, record_type TEXT, external_id TEXT, occurred_at TEXT, booking_status TEXT, payload_json TEXT)");
  const db = { prepare(query) { const wrap = args => ({ bind: (...next) => wrap(next), first: async () => sql.prepare(query).get(...args) ?? null, all: async () => ({ results: sql.prepare(query).all(...args) }), run: async () => ({ meta: { changes: sql.prepare(query).run(...args).changes } }) }); return wrap([]); }, batch: async statements => Promise.all(statements.map(s => s.run())) };
  const source = fixture();
  const plain = loader(), { checkInvoice, invoiceFingerprint } = plain('lib/invoice-check.ts');
  const fingerprint = await invoiceFingerprint(checkInvoice(source));
  const settings = { accounts: { ...plain('lib/admin-settings.ts').emptyAccounts, vatCode: 'U25', noVatCode: 'NONE', goodsVat: '1000 - Salg', shippingVat: '1350 - Fragt', clearing: '55110 - Fordelingskonto' }, automation: { attachments: attach, sales: false, payments: false, refunds: false, payouts: false }, revision: 'r1' };
  sql.prepare('INSERT INTO app_settings VALUES (?, ?, ?, ?)').run('sablen.dk', 'admin_settings', JSON.stringify(settings), 'now');
  const key = `invoices/${encodeURIComponent(source.id)}.pdf`;
  sql.prepare('INSERT INTO integration_records VALUES (?, ?, ?, ?, ?, ?)').run('sablen.dk', 'order', source.id, source.createdAt, 'pending', JSON.stringify(source));
  sql.prepare('INSERT INTO integration_records VALUES (?, ?, ?, ?, ?, ?)').run('sablen.dk', 'invoice', source.id, source.createdAt, 'generated', JSON.stringify({ invoiceFingerprint: fingerprint, r2Key: key }));
  const runtime = { INVOICES: { head: async () => ({ etag: 'e1', size: 20 }), get: async () => ({ etag: 'e1', arrayBuffer: async () => new TextEncoder().encode('%PDF-test').buffer }) }, DINERO_SALES_WRITES_ENABLED: 'true' };
  const calls = [], faults = {}; let remote, org = '123';
  const guid = '12345678-1234-1234-1234-123456789012';
  const client = async (endpoint, method, body) => {
    calls.push({ endpoint, method, body });
    if (endpoint === 'files') return { FileGuid: 'test-file-12345' };
    if (endpoint === 'vouchers/manuel') {
      remote = { ...structuredClone(body), Guid: guid, Timestamp: 't1', Status: 'Draft', Lines: body.Lines.map(l => { const gross = Math.round(l.Amount * 100); const net = l.AccountVatCode === 'U25' ? Math.round(gross / 1.25) : gross; return { ...l, AmountExclVatValue: net / 100, VatAmountValue: (gross - net) / 100, AmountInclVatValue: gross / 100 }; }) };
      if (faults.createTimeout) throw Error('timeout after remote created');
      if (faults.wrongTax) remote.Lines[0].VatAmountValue -= 1;
      return remote;
    }
    if (method === 'GET') return remote;
    if (endpoint.endsWith('/book')) { remote = { ...remote, Status: 'Booked', Timestamp: 't2', VoucherNumber: 42 }; if (faults.bookTimeout) throw Error('timeout after booked'); return remote; }
    throw Error('Unexpected API');
  };
  const load = loader({ 'cloudflare:workers': { env: runtime }, './database': { database: () => db }, './credentials': { loadCredentials: async () => ({ organizationId: org }) }, './shopify-order': { loadCompleteOrder: async () => source }, './dinero-accounts': { readDineroAccounts: async () => chart }, './history': { loadHistory: async () => ({}) }, '@/lib/history-policy': { historyWindow: () => ({ cutoff: '2020-01-01T00:00:00Z' }) }, './dinero-client': { dineroClient: async () => client }, './errors': { recordFailure: async () => {} } });
  const mod = load('db/sales-transfer.ts');
  const run = (action, extra = {}) => mod.runTransfer({ externalId: source.id, action, ...extra }, 'rene@sablen.dk');
  const prepare = () => run('prepare', { date: '2026-09-04' });
  const approve = result => ({ version: result.state.version, noOtherBooking: true, storebuddyStopped: true, confirmNumber: result.state.snapshot.invoiceNumber });
  return { sql, run, prepare, approve, calls, source, runtime, faults, setOrg: value => { org = value; }, remote: () => remote, settings };
}
test('Dinero payload uses gross standalone sales amounts and exact returned VAT is mandatory', () => {
  const load = loader(), invoice = load('lib/invoice-check.ts').checkInvoice(fixture());
  const settings = { vatCode: 'U25', goodsVat: '1000', shippingVat: '1350', clearing: '55110' };
  const draft = load('lib/sales-preview.ts').salesDraft(invoice, settings, chart);
  const { voucherFor } = load('lib/dinero-sale.ts'), result = voucherFor(invoice, draft, '2026-09-04');
  assert.equal(result.voucher.Lines[0].Amount, 162.5);
  assert.equal(result.voucher.Lines[0].AccountNumber, 55110);
  assert.equal(result.voucher.Lines[0].AccountVatCode, 'none');
  assert.equal(result.voucher.Lines[1].Amount, -112.5); assert.equal(result.expected[1].tax, -2250);
  assert.ok(result.voucher.Lines.every(l => l.BalancingAccountNumber === undefined));
  assert.equal(result.expected.reduce((sum, l) => sum + l.gross, 0), 0);
  assert.throws(() => voucherFor(invoice, draft, '2026-02-30'));
  assert.throws(() => voucherFor(invoice, draft, '2099-01-01'));
});

test('groups products by account and VAT, keeps freight separate and omits zero groups', () => {
  const load = loader(), { voucherFor } = load('lib/dinero-sale.ts');
  const invoice = load('lib/invoice-check.ts').checkInvoice(fixture());
  const parts = [
    ['product', '1000', 'U25', 100, 25], ['product', '1000', 'U25', 200, 50],
    ['shipping', '1000', 'U25', 100, 25], ['product', '1000', '', 100, 0],
    ['product', '1050', '', 100, 0], ['shipping', '1350', 'U25', 0, 0],
  ];
  invoice.lines = parts.map(([kind]) => ({ ...invoice.lines[0], kind }));
  const lines = parts.map(([, account, vatCode, net, tax]) => ({ title: 'Test', account, vatCode, net, tax, gross: net + tax }));
  invoice.gross = lines.reduce((s, l) => s + l.gross, 0);
  const result = voucherFor(invoice, { ready: true, blockers: [], clearing: '55110', lines }, '2026-09-04');
  assert.deepEqual(result.voucher.Lines.map(l => l.Amount), [7, -3.75, -1.25, -1, -1]);
  assert.match(result.voucher.Lines[1].Description, /^Produktsalg/);
  assert.match(result.voucher.Lines[2].Description, /^Fragtsalg/);
  assert.equal(result.expected.reduce((s, l) => s + l.gross, 0), 0);
});
test('lagerautomatik tilføjer én momsfri vareforbrugslinje i samme bilag', () => {
  const load = loader(), invoice = load('lib/invoice-check.ts').checkInvoice(fixture());
  for (const line of invoice.lines) if (line.kind === 'goods') line.unitCostMinor = 1000;
  const inventoryChart = [...chart, { number: '52000', name: 'Varelager', vatCode: '', kind: 'entry', hidden: false }, { number: '2100', name: 'Vareforbrug', vatCode: '', kind: 'entry', hidden: false }];
  const draft = load('lib/sales-preview.ts').salesDraft(invoice, { vatCode: 'U25', goodsVat: '1000', shippingVat: '1350', clearing: '55110', inventory: '52000', inventoryAdjustment: '2100' }, inventoryChart, true);
  assert.equal(draft.ready, true); assert.ok(draft.inventory?.cost > 0);
  const result = load('lib/dinero-sale.ts').voucherFor(invoice, draft, '2026-09-04');
  const line = result.voucher.Lines.at(-1);
  assert.equal(line.AccountNumber, 2100); assert.equal(line.BalancingAccountNumber, 52000); assert.equal(line.AccountVatCode, 'none');
});
test('manglende kostpris på tillæg blokerer ikke salget og kun kendte positive kostpriser nedskriver lageret', () => {
  const load = loader(), invoice = load('lib/invoice-check.ts').checkInvoice(fixture());
  const goods = invoice.lines.filter(line => line.kind === 'goods');
  goods[0].unitCostMinor = 6900;
  invoice.lines.push({ ...goods[0], id: 'addon', title: 'Tillæg uden kostpris', quantity: 1, unitCostMinor: undefined, net: 0, tax: 0, gross: 0, discount: 0 });
  const inventoryChart = [...chart, { number: '52000', name: 'Varelager', vatCode: '', kind: 'entry', hidden: false }, { number: '2100', name: 'Vareforbrug', vatCode: '', kind: 'entry', hidden: false }];
  const draft = load('lib/sales-preview.ts').salesDraft(invoice, { vatCode: 'U25', goodsVat: '1000', shippingVat: '1350', clearing: '55110', inventory: '52000', inventoryAdjustment: '2100' }, inventoryChart, true);
  assert.equal(draft.ready, true);
  assert.equal(draft.blockers.some(message => /kostpris|lagerværdi/.test(message)), false);
  assert.equal(draft.inventory?.cost, 6900 * goods[0].quantity);
});
test('et salg uden positiv Shopify-kostpris bogføres uden lagerlinje', () => {
  const load = loader(), invoice = load('lib/invoice-check.ts').checkInvoice(fixture());
  for (const line of invoice.lines) if (line.kind === 'goods') line.unitCostMinor = undefined;
  const inventoryChart = [...chart, { number: '52000', name: 'Varelager', vatCode: '', kind: 'entry', hidden: false }, { number: '2100', name: 'Vareforbrug', vatCode: '', kind: 'entry', hidden: false }];
  const draft = load('lib/sales-preview.ts').salesDraft(invoice, { vatCode: 'U25', goodsVat: '1000', shippingVat: '1350', clearing: '55110', inventory: '52000', inventoryAdjustment: '2100' }, inventoryChart, true);
  assert.equal(draft.ready, true); assert.equal(draft.inventory, undefined);
});
test('prepare is externally read-only; create then separate book; repeated writes blocked', async () => {
  const h = await harness(true);
  try {
    let r = await h.prepare(); assert.equal(h.calls.length, 0);
    r = await h.run('create', h.approve(r)); assert.equal(r.state.phase, 'draft');
    assert.deepEqual(h.calls.map(c => c.endpoint), ['files', 'vouchers/manuel']);
    r = await h.run('book', h.approve(r)); assert.equal(r.state.phase, 'booked'); assert.equal(r.state.voucherNumber, 42);
    assert.equal(h.sql.prepare("SELECT booking_status FROM integration_records WHERE record_type='order'").get().booking_status, 'booked');
    const count = h.calls.length; await assert.rejects(h.run('create', h.approve(r))); await assert.rejects(h.run('book', h.approve(r))); assert.equal(h.calls.length, count);
  } finally { h.sql.close(); }
});
test('gate, confirmation, stale quote and shipment changes cannot write to Dinero', async () => {
  const h = await harness();
  try {
    const r = await h.prepare();
    h.runtime.DINERO_SALES_WRITES_ENABLED = 'false'; await assert.rejects(h.run('create', h.approve(r)), /låst/);
    h.runtime.DINERO_SALES_WRITES_ENABLED = 'true';
    await assert.rejects(h.run('create', { version: r.state.version }), /Bekræft/);
    const newer = await h.prepare(); await assert.rejects(h.run('create', h.approve(r)), /ændret/);
    h.source.displayFulfillmentStatus = 'PARTIAL'; await assert.rejects(h.run('create', h.approve(newer)), /afsendelse/);
    assert.equal(h.calls.length, 0);
  } finally { h.sql.close(); }
});
test('simultaneous tabs can only create one voucher', async () => {
  const h = await harness();
  try { const r = await h.prepare(); const results = await Promise.allSettled([h.run('create', h.approve(r)), h.run('create', h.approve(r))]); assert.equal(results.filter(r => r.status === 'fulfilled').length, 1); assert.equal(h.calls.filter(c => c.endpoint === 'vouchers/manuel').length, 1); }
  finally { h.sql.close(); }
});
test('lost create response blocks all new creates, even without a known GUID', async () => {
  const h = await harness();
  try { const r = await h.prepare(); h.faults.createTimeout = true; await assert.rejects(h.run('create', h.approve(r))); const status = await h.run('status'); assert.equal(status.state.phase, 'uncertain'); assert.equal(status.state.guid, undefined); await assert.rejects(h.run('create', h.approve(status))); await assert.rejects(h.run('reconcile'), /sikkert bilags-ID/); assert.equal(h.calls.filter(c => c.endpoint === 'vouchers/manuel').length, 1); }
  finally { h.sql.close(); }
});
test('lost book response recovers by GET without repeating a POST', async () => {
  const h = await harness();
  try { let r = await h.prepare(); r = await h.run('create', h.approve(r)); h.faults.bookTimeout = true; await assert.rejects(h.run('book', h.approve(r))); const status = await h.run('reconcile'); assert.equal(status.state.phase, 'booked'); assert.equal(h.calls.filter(c => c.endpoint.endsWith('/book')).length, 1); }
  finally { h.sql.close(); }
});
test('remote calculation mismatch keeps draft ID but never books; changed organization blocks', async () => {
  const h = await harness();
  try { let r = await h.prepare(); h.faults.wrongTax = true; await assert.rejects(h.run('create', h.approve(r)), /stemmer ikke/); r = await h.run('status'); assert.ok(r.state.guid); assert.equal(r.state.phase, 'uncertain'); await assert.rejects(h.run('reconcile'), /stemmer ikke/); h.setOrg('456'); await assert.rejects(h.prepare(), /anden Dinero/); assert.equal(h.calls.some(c => c.endpoint.endsWith('/book')), false); }
  finally { h.sql.close(); }
});
test('API rejects missing origin, wrong content type, invalid order before database use', async () => {
  let calls = 0;
  const load = loader({ 'next/server': { NextResponse: { json: (data, options) => ({ data, ...options }) } }, '@/db/sales-transfer': { runTransfer: async () => { calls++; return {}; } }, '@/db/errors': { recordFailure: async () => {} } });
  const { POST } = load('app/api/sales/transfer/route.ts');
  for (const headers of [{}, { origin: 'https://evil.test', 'content-type': 'application/json' }, { origin: 'https://integration.sablen.dk' }]) {
    const r = await POST({ url: 'https://integration.sablen.dk/api/sales/transfer', headers: new Headers(headers), json: async () => ({}) }); assert.equal(r.status, 403);
  }
  assert.equal(calls, 0);
});
test('database failure after remote draft creation cannot trigger another create', async () => {
  const h = await harness();
  try {
    const r = await h.prepare();
    h.sql.exec("CREATE TRIGGER fail_guid BEFORE UPDATE ON app_settings WHEN json_extract(NEW.setting_value, '$.guid') IS NOT NULL BEGIN SELECT RAISE(ABORT, 'simulated disk failure'); END");
    await assert.rejects(h.run('create', h.approve(r)));
    const status = await h.run('status'); assert.equal(status.state.phase, 'uncertain');
    await assert.rejects(h.run('create', h.approve(status))); assert.equal(h.calls.filter(c => c.endpoint === 'vouchers/manuel').length, 1);
  } finally { h.sql.close(); }
});
test('retention removes proposal details but preserves a minimal duplicate receipt', async () => {
  const sql = new DatabaseSync(':memory:');
  sql.exec('CREATE TABLE app_settings (tenant TEXT, setting_key TEXT, setting_value TEXT, PRIMARY KEY(tenant,setting_key)); CREATE TABLE integration_records(id TEXT, tenant TEXT, external_id TEXT, record_type TEXT, occurred_at TEXT)');
  const db = { prepare(query) { const wrap = args => ({ bind: (...next) => wrap(next), all: async () => ({ results: sql.prepare(query).all(...args) }), first: async () => sql.prepare(query).get(...args), run: async () => ({ meta: { changes: sql.prepare(query).run(...args).changes } }) }); return wrap([]); }, batch: async stmts => Promise.all(stmts.map(s => s.run())) };
  const load = loader({ '@/lib/history-policy': { historyWindow: () => ({ retentionCutoff: '2025-01-01' }), defaultHistory: {} } });
  try {
    for (const phase of ['prepared', 'booked', 'uncertain']) sql.prepare('INSERT INTO app_settings VALUES (?, ?, ?)').run('sablen.dk', `sales_transfer:${phase}`, JSON.stringify({ phase, externalId: phase, organizationId: '123', guid: 'test-guid', snapshot: { occurredAt: '2020-01-01', voucher: { Lines: [{ Description: 'private detail' }] } } }));
    await load('db/history.ts').cleanupHistory(db, { delete: async () => { throw Error('Unexpected deletion'); } });
    const rows = sql.prepare('SELECT setting_value FROM app_settings').all(); assert.equal(rows.length, 2);
    for (const row of rows) { const state = JSON.parse(row.setting_value); assert.equal(state.phase, 'archived'); assert.equal(state.guid, 'test-guid'); assert.equal(state.snapshot, undefined); assert.ok(!row.setting_value.includes('private detail')); }
  } finally { sql.close(); }
});
test('Dinero client blocks redirects, uses multipart file upload and never retries', async () => {
  const calls = [];
  const load = loader({ fetch: async (url, options) => { calls.push({ url, options }); return url.includes('/oauth/') ? { ok: true, json: async () => ({ access_token: 'test-token' }) } : { ok: false, status: 302 }; } });
  const client = await load('db/dinero-client.ts').dineroClient({ organizationId: '123', clientId: 'id', clientSecret: 'secret', apiKey: 'key' });
  const form = new FormData(); form.append('file', new Blob(['pdf']), '100.pdf');
  await assert.rejects(client('files', 'POST', form), /302/);
  assert.equal(calls.length, 2); assert.equal(calls[1].options.redirect, 'manual'); assert.equal(calls[1].options.headers['Content-Type'], undefined);
  await assert.rejects(client('https://evil.test', 'POST', {})); assert.equal(calls.length, 2);
});
test('changed settings or PDF after approval blocks before any external write', async () => {
  const h = await harness();
  try {
    let r = await h.prepare(); h.settings.revision = 'changed';
    h.sql.prepare("UPDATE app_settings SET setting_value=? WHERE setting_key='admin_settings'").run(JSON.stringify(h.settings));
    await assert.rejects(h.run('create', h.approve(r)), /ændret/);
    r = await h.prepare(); h.runtime.INVOICES.head = async () => ({ etag: 'e2', size: 20 });
    await assert.rejects(h.run('create', h.approve(r)), /ændret/); assert.equal(h.calls.length, 0);
  } finally { h.sql.close(); }
});
test('allowlisted draft test creates only a test voucher and can never book, even after enabling writes', async () => {
  const h = await harness();
  try {
    h.runtime.DINERO_SALES_WRITES_ENABLED = 'false'; h.runtime.DINERO_DRAFT_TEST_ORDER_ID = h.source.id;
    let r = await h.prepare(); assert.equal(r.enabled, false); assert.equal(r.draftTestAllowed, true); assert.equal(r.state.draftTest, true);
    await assert.rejects(h.run('create', h.approve(r)), /testkladden/);
    r = await h.run('create', { version: r.state.version, confirmNumber: r.state.snapshot.invoiceNumber, draftTestAcknowledged: true });
    const voucherCall = h.calls.find(c => c.endpoint === 'vouchers/manuel');
    assert.equal(r.state.phase, 'draft'); assert.match(voucherCall.body.ExternalReference, /^sablen:test-sale:/); assert.match(voucherCall.body.Lines[0].Description, /^TESTKLADDE/);
    for (const enabled of ['false', 'true']) { h.runtime.DINERO_SALES_WRITES_ENABLED = enabled; await assert.rejects(h.run('book', h.approve(r)), /aldrig bogføres/); }
    assert.equal(h.calls.some(c => c.endpoint.endsWith('/book')), false);
    h.remote().Status = 'Booked'; await assert.rejects(h.run('reconcile'), /uden om løsningen/);
    assert.equal(h.sql.prepare("SELECT booking_status FROM integration_records WHERE record_type='order'").get().booking_status, 'pending');
  } finally { h.sql.close(); }
});
test('draft test grant cannot authorize another order or survive removal before create', async () => {
  const h = await harness();
  try {
    h.runtime.DINERO_SALES_WRITES_ENABLED = 'false'; h.runtime.DINERO_DRAFT_TEST_ORDER_ID = `${h.source.id}0`;
    let r = await h.prepare(); assert.equal(r.draftTestAllowed, false); assert.equal(r.state.draftTest, false);
    await assert.rejects(h.run('create', { ...h.approve(r), draftTestAcknowledged: true }), /låst/);
    h.runtime.DINERO_DRAFT_TEST_ORDER_ID = h.source.id; r = await h.prepare();
    h.runtime.DINERO_DRAFT_TEST_ORDER_ID = ''; h.runtime.DINERO_SALES_WRITES_ENABLED = 'true';
    await assert.rejects(h.run('create', { ...h.approve(r), draftTestAcknowledged: true }), /ikke åben/);
    assert.equal(h.calls.length, 0);
  } finally { h.sql.close(); }
});
