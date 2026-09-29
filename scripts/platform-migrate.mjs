// Guarded remote D1 migration: record a Time Travel restore point, apply pending
// migrations, and verify that row counts are unchanged and no FK is broken.
// Usage: node scripts/platform-migrate.mjs <dev|prod> <status|apply>
import {spawnSync} from 'node:child_process';
import {readFileSync} from 'node:fs';

const configs = {dev: 'wrangler.platform-test.json', prod: 'wrangler.platform-production.json'};
const [target, mode = 'status'] = process.argv.slice(2);
if (!(target in configs) || !['status', 'apply'].includes(mode)) throw Error('Brug: <dev|prod> <status|apply>');
const config = configs[target];
const settings = JSON.parse(readFileSync(config, 'utf8'));
const database = settings.d1_databases.find(d => d.binding === 'PLATFORM_DB').database_name;

function wrangler(args, json = true) {
  const result = spawnSync(process.execPath, ['node_modules/wrangler/bin/wrangler.js', ...args, ...(json ? ['--json'] : []), '--config', config],
    {encoding: 'utf8', env: {...process.env, CLOUDFLARE_ACCOUNT_ID: settings.account_id, WRANGLER_SEND_METRICS: 'false', CI: 'true'}, maxBuffer: 16 * 1024 * 1024});
  if (result.status !== 0) throw Error(`wrangler ${args.slice(0, 3).join(' ')} fejlede:\n${result.stderr || result.stdout}`);
  return json ? JSON.parse(result.stdout) : result.stdout;
}
const query = sql => wrangler(['d1', 'execute', 'PLATFORM_DB', '--remote', '--command', sql])[0].results;

// Every user table except internal ones; counts must match before and after.
function counts() {
  const tables = query("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' AND name<>'d1_migrations' ORDER BY name").map(r => r.name);
  const [row] = query('SELECT ' + tables.map(t => `(SELECT count(*) FROM "${t}") AS "${t}"`).join(','));
  return row;
}
const fkViolations = () => query('SELECT count(*) AS n FROM pragma_foreign_key_check')[0].n;

console.log(`Miljø: ${target} · database: ${database}`);
console.log(wrangler(['d1', 'migrations', 'list', 'PLATFORM_DB', '--remote'], false).trim());
const restore = wrangler(['d1', 'time-travel', 'info', database]);
console.log(`Gendannelsespunkt (Time Travel): ${JSON.stringify(restore)}`);
const before = counts(), fkBefore = fkViolations();
console.log(`Rækketal før: ${JSON.stringify(before)}`);
console.log(`FK-brud før: ${fkBefore}`);
if (mode === 'status') process.exit(0);

wrangler(['d1', 'migrations', 'apply', 'PLATFORM_DB', '--remote'], false);
const after = counts(), fkAfter = fkViolations();
console.log(`Rækketal efter: ${JSON.stringify(after)}`);
console.log(`FK-brud efter: ${fkAfter}`);
// Tables a migration adds are allowed; existing tables must keep every row.
const changed = Object.keys(before).filter(t => before[t] !== after[t]);
const restoreHint = `Gendan: npx wrangler d1 time-travel restore ${database} --bookmark=${restore.bookmark} --config ${config}`;
if (changed.length) throw Error(`Rækketal ændret i: ${changed.join(', ')}. ${restoreHint}`);
if (fkAfter > fkBefore) throw Error(`Nye fremmednøglebrud (${fkBefore} → ${fkAfter}). ${restoreHint}`);
console.log('Migrationen er anvendt: rækketal uændrede og ingen nye fremmednøglebrud.');
