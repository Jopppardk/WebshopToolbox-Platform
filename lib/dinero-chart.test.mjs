import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import ts from 'typescript';
function load(file, overrides) {
  const exports = {};
  new Function('exports', 'require', 'fetch', ts.transpileModule(readFileSync(new URL(file, import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText)(exports, name => { if (!(name in overrides)) throw Error(name); return overrides[name]; }, overrides.fetch);
  return exports;
}
const entry = { AccountNumber: 55000, Name: 'Bank', VatCode: '' };
test('matching duplicates within and across lists merge; deposit visibility and entry VAT survive', async () => {
  const responses = [{ access_token: 'test' }, [entry, entry, { AccountNumber: 1000, Name: 'Salg', VatCode: 'U25' }], [{ AccountNumber: 55000, Name: ' Bank ', IsHidden: true }, { AccountNumber: 55000, Name: 'Bank' }]];
  const { readDineroAccounts } = load('../db/dinero-accounts.ts', { './credentials': { loadCredentials: async () => ({ organizationId: '1' }) }, fetch: async () => ({ ok: true, json: async () => responses.shift() }) });
  const accounts = await readDineroAccounts();
  assert.equal(accounts.length, 2); assert.equal(accounts[0].vatCode, 'U25'); assert.equal(accounts[1].hidden, true); assert.equal(accounts[1].kind, 'deposit');
});
test('conflicting duplicate metadata stops rather than picking an arbitrary account', async () => {
  for (const duplicate of [{ ...entry, Name: 'Anden konto' }, { ...entry, VatCode: 'U25' }]) {
    const responses = [{ access_token: 'test' }, [entry, duplicate]];
    const { readDineroAccounts } = load('../db/dinero-accounts.ts', { './credentials': {}, fetch: async () => ({ ok: true, json: async () => responses.shift() }) });
    await assert.rejects(readDineroAccounts({ organizationId: '1' }), /modstridende/);
  }
});
test('snapshot persists in SQLite; GET never fetches; failed sync preserves data; organizations isolated', async () => {
  const sql = new DatabaseSync(':memory:');
  sql.exec('CREATE TABLE app_settings (tenant TEXT, setting_key TEXT, setting_value TEXT, updated_at TEXT, PRIMARY KEY(tenant,setting_key))');
  const db = { prepare(query) { return { bind(...args) { return { first: async () => sql.prepare(query).get(...args), run: async () => sql.prepare(query).run(...args) }; } }; } };
  let org = '1', calls = 0, fail = false;
  const mod = load('../db/dinero-chart.ts', { './database': { database: () => db }, './credentials': { loadCredentials: async () => ({ organizationId: org }) }, './dinero-accounts': { readDineroAccounts: async () => { calls++; if (fail) throw Error('upstream failed'); return [{ number: '55000', name: 'Bank', vatCode: '', kind: 'deposit', hidden: false }]; } } });
  try {
    assert.equal(await mod.loadDineroChart(), null); assert.equal(calls, 0);
    const saved = await mod.syncDineroChart(); assert.equal(calls, 1);
    assert.deepEqual(await mod.loadDineroChart(), saved); assert.equal(calls, 1);
    fail = true; await assert.rejects(mod.syncDineroChart()); assert.deepEqual(await mod.loadDineroChart(), saved);
    org = '2'; assert.equal(await mod.loadDineroChart(), null);
    org = '1'; assert.equal((await mod.loadDineroChart()).accounts.length, 1);
    assert.equal(sql.prepare('SELECT count(*) AS n FROM app_settings').get().n, 1);
  } finally { sql.close(); }
});
