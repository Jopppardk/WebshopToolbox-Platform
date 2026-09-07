import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import ts from 'typescript';
function load(file, overrides = {}) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(readFileSync(new URL(file, import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, {
    exports, Intl, crypto: { randomUUID },
    require(name) { return overrides[name] || load(name.replace('@/lib/', './') + '.ts', overrides); },
  });
  return exports;
}
const { invoiceTotals } = load('./invoice-totals.ts');
const { validateSettings, emptyAccounts, defaultAutomation } = load('./admin-settings.ts');
const { normalizeSyncInterval, scheduledRunIsDue, millisecondsToNextRun } = load('./sync-schedule.ts');
const serial = value => JSON.parse(JSON.stringify(value));
test('VAT dropdown options come only from chart, omit blanks and deduplicate without changing source', () => {
  const { vatCodeOptions } = load('./vat-code-options.ts');
  const chart = [{ vatCode: 'U25' }, { vatCode: ' U25 ' }, { vatCode: '' }, {}, { vatCode: null }, { vatCode: 'U0' }];
  assert.deepEqual(serial(vatCodeOptions(chart)), ['U0', 'U25']);
  assert.deepEqual(serial(vatCodeOptions([])), []);
  assert.equal(chart[1].vatCode, ' U25 ');
});
test('invoice totals preserve zero, actual rates and exact cents', () => {
  assert.deepEqual(serial(invoiceTotals('125.00', '25.00')), { total: 125, tax: 25, subtotal: 100 });
  assert.deepEqual(serial(invoiceTotals('125.00', '0.00')), { total: 125, tax: 0, subtotal: 125 });
  assert.deepEqual(serial(invoiceTotals('107.00', '7.00')), { total: 107, tax: 7, subtotal: 100 });
  assert.deepEqual(serial(invoiceTotals('0.30', '0.10')), { total: .3, tax: .1, subtotal: .2 });
  assert.deepEqual(serial(invoiceTotals('0', '0')), { total: 0, tax: 0, subtotal: 0 });
  assert.throws(() => invoiceTotals('100', undefined));
  assert.throws(() => invoiceTotals('100', '101'));
  assert.throws(() => invoiceTotals('100.001', '0'));
});
test('settings allow empty configuration but reject malformed input and omit unknown fields', () => {
  const value = { accounts: { ...emptyAccounts, goodsVat: '1000 - Salg', secret: 'not allowed' }, automation: defaultAutomation };
  assert.equal(validateSettings(value).accounts.goodsVat, '1000 - Salg');
  assert.equal(validateSettings(value).accounts.secret, undefined);
  const legacyAutomation = { ...defaultAutomation }; delete legacyAutomation.bookDinero;
  assert.equal(validateSettings({ accounts: emptyAccounts, automation: legacyAutomation }).automation.bookDinero, true);
  assert.throws(() => validateSettings({ ...value, automation: { ...defaultAutomation, sales: 'true' } }));
  assert.throws(() => validateSettings({ ...value, accounts: { ...emptyAccounts, goodsVat: 'x'.repeat(201) } }));
});
test('synkroniseringsinterval er allowlistet og følger faste minutgrænser', () => {
  assert.equal(normalizeSyncInterval(15), 15);
  assert.equal(normalizeSyncInterval(7), 5);
  assert.equal(validateSettings({ accounts: emptyAccounts, automation: defaultAutomation, syncIntervalMinutes: 30 }).syncIntervalMinutes, 30);
  assert.equal(scheduledRunIsDue(Date.UTC(2026, 8, 6, 12, 30), 15), true);
  assert.equal(scheduledRunIsDue(Date.UTC(2026, 8, 6, 12, 31), 15), false);
  assert.equal(millisecondsToNextRun(Date.UTC(2026, 8, 6, 12, 29, 30), 5), 30_000);
});
function routes() {
  const sql = new DatabaseSync(':memory:');
  sql.exec("CREATE TABLE app_settings (tenant TEXT, setting_key TEXT, setting_value TEXT, updated_at TEXT, PRIMARY KEY(tenant, setting_key)); CREATE TABLE system_errors (id INTEGER PRIMARY KEY, tenant TEXT, source TEXT, message TEXT, details_json TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP, resolved_at TEXT)");
  const db = { prepare(text) {
    const statement = sql.prepare(text);
    const bound = args => ({ async first() { return statement.get(...args); }, async all() { return { results: statement.all(...args) }; }, async run() { return { meta: { changes: statement.run(...args).changes } }; } });
    return { ...bound([]), bind: (...args) => bound(args) };
  }};
  const overrides = { 'next/server': { NextResponse: { json: (data, options = {}) => ({ data, status: 200, ...options }) } }, '@/db/database': { prepareDatabase: async () => db } };
  return { sql, settings: load('../app/api/admin/settings/route.ts', overrides), errors: load('../app/api/admin/errors/route.ts', overrides) };
}
test('settings persist across requests; stale tabs and duplicate initialization cannot overwrite', async () => {
  const h = routes();
  try {
    assert.equal((await h.settings.GET()).data.settings, null);
    const settings = { accounts: emptyAccounts, automation: { ...defaultAutomation, refunds: true } };
    const created = await h.settings.POST({ json: async () => ({ settings, revision: null }) });
    assert.equal(created.status, 200);
    assert.equal((await h.settings.GET()).data.settings.automation.refunds, true);
    assert.equal((await h.settings.POST({ json: async () => ({ settings, revision: null }) })).status, 409);
    const updated = await h.settings.POST({ json: async () => ({ settings: { ...settings, accounts: { ...emptyAccounts, fees: '3628' } }, revision: created.data.revision }) });
    assert.equal(updated.status, 200);
    assert.equal((await h.settings.POST({ json: async () => ({ settings, revision: created.data.revision }) })).status, 409);
    assert.equal((await h.settings.GET()).data.settings.accounts.fees, '3628');
  } finally { h.sql.close(); }
});
test('error list and resolution are tenant-scoped and do not delete history', async () => {
  const h = routes();
  try {
    h.sql.exec(`INSERT INTO system_errors(id,tenant,source,message,details_json) VALUES (1,'sablen.dk','Salg','Fejl','{"category":"shopify","cause":"Sikker årsag","occurrenceCount":2}'), (2,'other','Other','Private',NULL)`);
    const listedErrors = (await h.errors.GET()).data.errors;
    assert.equal(listedErrors.length, 1);
    assert.equal(listedErrors[0].details.cause, 'Sikker årsag');
    assert.equal(listedErrors[0].details_json, undefined);
    const defaultNotice = (await h.errors.GET()).data.notifications;
    assert.equal(defaultNotice.enabled, false); assert.equal(defaultNotice.email, '');
    assert.equal((await h.errors.POST({ json: async () => ({ action: 'notifications', enabled: true, email: 'ugyldig' }) })).status, 400);
    assert.equal((await h.errors.POST({ json: async () => ({ action: 'notifications', enabled: true, email: 'Drift@Sablen.dk' }) })).status, 200);
    const savedNotice = (await h.errors.GET()).data.notifications;
    assert.equal(savedNotice.enabled, true); assert.equal(savedNotice.email, 'drift@sablen.dk');
    assert.equal((await h.errors.POST({ json: async () => ({ id: -1 }) })).status, 400);
    await h.errors.POST({ json: async () => ({ id: 2 }) });
    assert.equal(h.sql.prepare('SELECT resolved_at FROM system_errors WHERE id = 2').get().resolved_at, null);
    await h.errors.POST({ json: async () => ({ id: 1 }) });
    assert.equal((await h.errors.GET()).data.errors.length, 0);
    assert.equal(h.sql.prepare('SELECT count(*) AS n FROM system_errors').get().n, 2);
  } finally { h.sql.close(); }
});
