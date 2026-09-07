import { env } from 'cloudflare:workers';
import { database } from './database';
import { runTransfer } from './sales-transfer';
import { shipmentDate, type InvoiceSource } from '@/lib/invoice-check';
import { recordFailure } from './errors';
import { validateSettings } from '@/lib/admin-settings';

const tenant = 'sablen.dk';
const day = (value: string) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Copenhagen', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(value));

export async function runSalesAutomation() {
  const runtime = env as unknown as { DINERO_SALES_AUTOMATION_ENABLED?: string; DINERO_SALES_START_AFTER?: string };
  if (runtime.DINERO_SALES_AUTOMATION_ENABLED !== 'true' || !runtime.DINERO_SALES_START_AFTER) return { status: 'skipped' as const, message: 'Salgsautomatikken er deaktiveret i driftsmiljøet.' };
  const db = database();
  const setting = await db.prepare("SELECT setting_value FROM app_settings WHERE tenant=? AND setting_key='admin_settings'").bind(tenant).first<{ setting_value: string }>();
  const automation = setting ? validateSettings(JSON.parse(setting.setting_value)).automation : null;
  if (automation?.sales !== true) return { status: 'skipped' as const, message: 'Salgsautomatikken er fravalgt under Indstillinger.' };
  const eligiblePhases = automation?.salesBookDinero === false ? "('prepared')" : "('prepared','draft')";
  const rows = await db.prepare(`SELECT o.external_id, o.payload_json FROM integration_records o LEFT JOIN app_settings t ON t.tenant=o.tenant AND t.setting_key='sales_transfer:'||o.external_id WHERE o.tenant=? AND o.record_type='order' AND o.occurred_at>? AND o.booking_status NOT IN ('booked','cancelled') AND (t.setting_key IS NULL OR json_extract(t.setting_value,'$.phase') IN ${eligiblePhases}) ORDER BY o.occurred_at ASC LIMIT 10`).bind(tenant, runtime.DINERO_SALES_START_AFTER).all<{ external_id: string; payload_json: string }>();
  let completed = 0, failed = 0;
  for (const row of rows.results) {
    try {
      const source = JSON.parse(row.payload_json) as InvoiceSource;
      if (source.cancelledAt) continue;
      if (source.displayFulfillmentStatus !== 'FULFILLED') continue;
      const date = day(shipmentDate(source));
      let result = await runTransfer({ externalId: row.external_id, action: 'prepare', date }, 'Automatik');
      const confirmNumber = result.state?.snapshot?.invoiceNumber;
      if (!confirmNumber) continue;
      if (result.state?.phase === 'prepared') result = await runTransfer({ externalId: row.external_id, action: 'create', version: result.state.version, confirmNumber, noOtherBooking: true, storebuddyStopped: true }, 'Automatik');
      if (result.state?.phase !== 'draft') continue;
      if (automation?.salesBookDinero === false) { completed++; continue; }
      await runTransfer({ externalId: row.external_id, action: 'book', version: result.state.version, confirmNumber, noOtherBooking: true, storebuddyStopped: true }, 'Automatik');
      completed++;
    } catch { failed++; await recordFailure('Dinero · automatisk salg'); }
  }
  if (failed) throw new Error(`${failed} salg kunne ikke bogføres automatisk; ${completed} blev gennemført.`);
  return { status: 'succeeded' as const, message: rows.results.length ? `${completed} salg blev ${automation?.salesBookDinero === false ? 'oprettet som kladde' : 'bogført'}.` : `Ingen nye afsendte salg ventede på ${automation?.salesBookDinero === false ? 'kladdeoprettelse' : 'bogføring'}.` };
}
