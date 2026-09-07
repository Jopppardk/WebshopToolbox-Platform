import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import ts from 'typescript';

const root = fileURLToPath(new URL('../', import.meta.url));
export function loader(overrides = {}) {
  const cache = new Map();
  return function load(file) {
    const full = path.resolve(root, file);
    if (cache.has(full)) return cache.get(full);
    const exports = {}; cache.set(full, exports);
    const code = ts.transpileModule(readFileSync(full, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    // oxlint-disable-next-line typescript/no-implied-eval -- Execute repository TypeScript with isolated fixture dependencies, never user input.
    new Function('exports', 'require', 'fetch', code)(exports, name => {
      if (name in overrides) return overrides[name];
      return load((name.startsWith('@/') ? path.join(root, name.slice(2)) : path.resolve(path.dirname(full), name)) + '.ts');
    }, overrides.fetch || (() => { throw Error('Unexpected network call in isolated test'); }));
    return exports;
  };
}

export function databaseFixture() {
  const sql = new DatabaseSync(':memory:');
  const faults = { beforeRun: null };
  for (const statement of loader()('db/schema.ts').schemaStatements) sql.exec(statement);
  const db = {
    prepare(query) {
      const wrap = args => ({
        bind: (...values) => wrap(values),
        first: async () => sql.prepare(query).get(...args) ?? null,
        all: async () => ({ results: sql.prepare(query).all(...args) }),
        run: async () => {
          await faults.beforeRun?.(query, args);
          return { meta: { changes: sql.prepare(query).run(...args).changes } };
        },
      });
      return wrap([]);
    },
    batch: async statements => Promise.all(statements.map(statement => statement.run())),
  };
  const set = (key, value) => sql.prepare('INSERT INTO app_settings(tenant,setting_key,setting_value) VALUES(?,?,?) ON CONFLICT DO UPDATE SET setting_value=excluded.setting_value')
    .run('sablen.dk', key, JSON.stringify(value));
  const get = key => {
    const row = sql.prepare("SELECT setting_value FROM app_settings WHERE tenant='sablen.dk' AND setting_key=?").get(key);
    return row ? JSON.parse(row.setting_value) : null;
  };
  const record = (type, id, payload, date = '2026-09-06T10:00:00Z', status = 'pending') => sql.prepare('INSERT INTO integration_records(id,tenant,record_type,external_id,occurred_at,amount_minor,currency,booking_status,payload_json,expires_at) VALUES(?,?,?,?,?,?,?,?,?,?)')
    .run(`${type}:${id}`, 'sablen.dk', type, id, date, type === 'refund' ? -12500 : 12500, 'DKK', status, JSON.stringify(payload), '2028-09-06');
  return { sql, db, set, get, record, faults };
}
