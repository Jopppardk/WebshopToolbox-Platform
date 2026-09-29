// One-off repair after the D1 change-count bug on 28 September 2026 (fixed by #24).
// While migration 0029's history triggers were live and the fix was not, every claim
// INSERT on these tables threw right after it was written, before any mail, report
// submission or PDF upload happened. The rows it left behind block retries forever.
// A row qualifies only if its history shows the claim insert and nothing after it.
import {spawnSync} from 'node:child_process';

// "local" only exists to rehearse the script against the local test database.
const fixLive = {local: '2099-01-01T00:00:00Z', dev: '2026-09-28T21:18:58Z', prod: '2026-09-28T21:19:33Z'};
const configs = {local: 'wrangler.platform-local.json', dev: 'wrangler.platform-test.json', prod: 'wrangler.platform-production.json'};
const [target, mode = 'list', expected = ''] = process.argv.slice(2);
if (!(target in configs) || !['list', 'cleanup'].includes(mode)) throw Error('Brug: <local|dev|prod> <list|cleanup> [kvitteringer,fakturaer,rapporter]');
const where = target === 'local' ? ['--local', '--persist-to', '.wrangler/platform-state'] : ['--remote'];
const until = fixLive[target], untilSql = until.replace('T', ' ').replace('Z', '');

const sameKey = 'e.company_id=t.company_id AND e.webshop_id=t.webshop_id';
const criteria = {
  receipts: `FROM production_receipts t WHERE t.phase='sending' AND t.updated_at<='${untilSql}'
    AND EXISTS(SELECT 1 FROM record_events e WHERE ${sameKey} AND e.provider=t.provider AND e.module=t.module AND e.external_id=t.external_id AND e.event='receipt.sending' AND e.at<='${until}')
    AND NOT EXISTS(SELECT 1 FROM record_events e WHERE ${sameKey} AND e.provider=t.provider AND e.module=t.module AND e.external_id=t.external_id AND e.event LIKE 'receipt.%' AND e.event<>'receipt.sending')`,
  invoices: `FROM platform_invoices t WHERE t.status='generating'
    AND EXISTS(SELECT 1 FROM record_events e WHERE ${sameKey} AND e.module='orders' AND e.external_id=t.external_id AND e.event='invoice.generating' AND json_extract(e.details_json,'$.documentId')=t.id AND e.at<='${until}')`,
  reports: `FROM platform_payout_documents t WHERE t.status='generating'
    AND EXISTS(SELECT 1 FROM record_events e WHERE ${sameKey} AND e.module='payouts' AND e.external_id=t.external_id AND e.event='report.generating' AND json_extract(e.details_json,'$.documentId')=t.id AND e.at<='${until}')`,
};
const columns = {
  receipts: 't.company_id,t.webshop_id,t.provider,t.module,t.external_id,t.destination,t.phase,t.updated_at',
  invoices: 't.company_id,t.webshop_id,t.external_id,t.id,t.status',
  reports: 't.company_id,t.webshop_id,t.external_id,t.id,t.status',
};

function d1(command) {
  const result = spawnSync(process.execPath, ['node_modules/wrangler/bin/wrangler.js', 'd1', 'execute', 'PLATFORM_DB', ...where, '--json', '--yes', '--config', configs[target], '--command', command],
    {encoding: 'utf8', env: {...process.env, WRANGLER_SEND_METRICS: 'false'}, maxBuffer: 16 * 1024 * 1024});
  if (result.status !== 0) throw Error('D1-kaldet fejlede:\n' + (result.stderr || result.stdout));
  return JSON.parse(result.stdout);
}
const list = () => Object.fromEntries(Object.keys(criteria).map(k => [k, d1(`SELECT ${columns[k]} ${criteria[k]}`)[0].results]));

const before = list();
const counts = Object.values(before).map(rows => rows.length);
console.log(`Miljø: ${target} · rettelsen live: ${until}`);
console.log(JSON.stringify(before, null, 2));
console.log(`Antal: kvitteringer ${counts[0]}, fakturaer ${counts[1]}, rapporter ${counts[2]} · til cleanup: ${counts.join(',')}`);
if (mode === 'list') process.exit(0);

if (!/^\d+,\d+,\d+$/.test(expected)) throw Error('Angiv det forventede antal fra list, fx 2,1,0.');
const want = expected.split(',').map(Number);
if (want.join() !== counts.join()) throw Error(`Antallet er ændret siden list (${counts.join(',')} ≠ ${expected}). Intet er slettet.`);
if (!want.some(Boolean)) { console.log('Intet at rydde op.'); process.exit(0); }

// Every statement repeats the count guard, so a change between list and delete removes nothing.
const guard = (k, n) => `(SELECT count(*) ${criteria[k]})=${n}`;
const note = `json_object('reason','d1-change-count-bug','fixedBy','#24')`;
const statements = [
  `INSERT INTO record_events(company_id,webshop_id,provider,module,external_id,event,details_json) SELECT t.company_id,t.webshop_id,t.provider,t.module,t.external_id,'cleanup.receipt_cleared',${note} ${criteria.receipts} AND ${guard('receipts', want[0])}`,
  `INSERT INTO record_events(company_id,webshop_id,provider,module,external_id,event,details_json) SELECT t.company_id,t.webshop_id,'shopify','orders',t.external_id,'cleanup.invoice_cleared',json_insert(${note},'$.documentId',t.id) ${criteria.invoices} AND ${guard('invoices', want[1])}`,
  `INSERT INTO record_events(company_id,webshop_id,provider,module,external_id,event,details_json) SELECT t.company_id,t.webshop_id,'shopify','payouts',t.external_id,'cleanup.report_cleared',json_insert(${note},'$.documentId',t.id) ${criteria.reports} AND ${guard('reports', want[2])}`,
  ...['receipts', 'invoices', 'reports'].map((k, i) => {
    const table = {receipts: 'production_receipts', invoices: 'platform_invoices', reports: 'platform_payout_documents'}[k];
    const guardBefore = `(SELECT count(*) ${criteria[k]})=${want[i]}`;
    return `DELETE FROM ${table} WHERE rowid IN (SELECT t.rowid ${criteria[k]}) AND ${guardBefore}`;
  }),
];
d1(statements.join(';\n'));
const after = list(), left = Object.values(after).map(rows => rows.length);
console.log(`Efter oprydning: ${left.join(',')} tilbage.`);
if (left.some(Boolean)) throw Error('Ikke alle rækker blev fjernet. Kontrollér loggen.');
