import app from './dist/server/index.js';
import { runSalesAutomation } from './db/sales-automation';
import { runPayoutAutomation } from './db/payout-automation';
import { runRefundAutomation } from './db/refund-automation';
import { recordFailure } from './db/errors';
import { database } from './db/database';
import { normalizeSyncInterval, scheduledRunIsDue } from './lib/sync-schedule';
import { runTrackedJob } from './db/job-runs';

async function runInvoiceEmailAutomation(workerEnv: unknown, ctx: ExecutionContext) {
  const db = database();
  const settingsRow = await db.prepare("SELECT setting_value FROM app_settings WHERE tenant='sablen.dk' AND setting_key='admin_settings'").first<{setting_value:string}>();
  if (!settingsRow || JSON.parse(settingsRow.setting_value)?.automation?.invoiceEmails !== true) return { status: 'skipped' as const, message: 'Automatisk fakturaafsendelse er fravalgt under Indstillinger.' };
  const startRow = await db.prepare("SELECT setting_value FROM app_settings WHERE tenant='sablen.dk' AND setting_key='invoice_email_automation_started_at'").first<{setting_value:string}>();
  if (!startRow || !/^\d{4}-\d{2}-\d{2}T/.test(startRow.setting_value)) return { status: 'skipped' as const, message: 'Automatisk fakturaafsendelse har endnu ingen startdato.' };
  const rows = await db.prepare("SELECT i.external_id FROM integration_records i LEFT JOIN invoice_email_deliveries d ON d.tenant=i.tenant AND d.external_id=i.external_id AND d.delivery_mode='customer' AND d.status IN ('sent','sending') WHERE i.tenant='sablen.dk' AND i.record_type='invoice' AND i.booking_status='generated' AND i.occurred_at>=? AND d.id IS NULL ORDER BY i.occurred_at ASC LIMIT 10").bind(startRow.setting_value).all<{external_id:string}>();
  let sent = 0, failed = 0;
  for (const row of rows.results) {
    const request = new Request('https://integration.sablen.dk/api/invoices/email', { method: 'POST', headers: { origin: 'https://integration.sablen.dk', 'content-type': 'application/json', 'cf-access-authenticated-user-email': 'rene@sablen.dk' }, body: JSON.stringify({ externalId: row.external_id }) });
    const response = await app.fetch(request, workerEnv, ctx);
    if (!response.ok) { failed++; await recordFailure('Faktura-afsendelse · automatik'); } else sent++;
  }
  if (failed) throw new Error(`${failed} fakturaer kunne ikke sendes; ${sent} blev sendt.`);
  return { status: 'succeeded' as const, message: rows.results.length ? `${sent} fakturaer blev sendt.` : 'Ingen nye fakturaer ventede på afsendelse.' };
}

export default {
  fetch: app.fetch.bind(app),
  async scheduled(controller: ScheduledController, workerEnv: unknown, ctx: ExecutionContext) {
    ctx.waitUntil((async () => {
      const settingsRow = await database().prepare("SELECT setting_value FROM app_settings WHERE tenant='sablen.dk' AND setting_key='admin_settings'").first<{setting_value:string}>();
      const interval = normalizeSyncInterval(settingsRow ? JSON.parse(settingsRow.setting_value)?.syncIntervalMinutes : 5);
      if (!scheduledRunIsDue(controller.scheduledTime, interval)) return;
      let ordersReady = false;
      try { await runTrackedJob('shopify-orders', 'Shopify · Ordrer', async () => { const request = new Request('https://integration.sablen.dk/api/shopify/orders', { method: 'POST', headers: { 'content-type': 'application/json', 'cf-access-authenticated-user-email': 'rene@sablen.dk' }, body: '{}' }); const response = await app.fetch(request, workerEnv, ctx); if (!response.ok) throw new Error('Shopify-ordrer kunne ikke synkroniseres.'); ordersReady = true; return { message: 'Ordresynkroniseringen blev gennemført.' }; }); } catch { await recordFailure('Shopify · automatisk ordresynkronisering'); }
      try { await runTrackedJob('shopify-packaging', 'Shopify · Emballage', async () => { const request = new Request('https://integration.sablen.dk/api/shopify/packaging', { method: 'POST', headers: { origin: 'https://integration.sablen.dk', 'content-type': 'application/json', 'cf-access-authenticated-user-email': 'rene@sablen.dk' }, body: JSON.stringify({ action: 'sync' }) }); const response = await app.fetch(request, workerEnv, ctx); const result = await response.json().catch(() => null) as { error?: string } | null; if (!response.ok) throw new Error(result?.error || 'Emballagedata kunne ikke synkroniseres.'); return { message: 'Emballagedata blev synkroniseret og gemt.' }; }); } catch { /* Jobhistorik og emballageruten registrerer fejlen. */ }
      try { await runTrackedJob('dinero-sales', 'Dinero · Salg', async () => ordersReady ? await runSalesAutomation() : { status: 'skipped', message: 'Sprunget over, fordi ordresynkroniseringen fejlede.' }); } catch { /* Jobbet har sin egen historik og salgsfejl registreres ved kilden. */ }
      try { await runTrackedJob('invoice-email', 'Fakturaer · Afsendelse', async () => await runInvoiceEmailAutomation(workerEnv,ctx)); } catch { /* Fejl registreres både i jobhistorikken og fejloversigten. */ }
      let refundsReady = false;
      try { await runTrackedJob('shopify-refunds', 'Shopify Payments · Tilbagebetalinger', async () => { const request = new Request('https://integration.sablen.dk/api/shopify/refunds', { method: 'POST', headers: { 'content-type': 'application/json', 'cf-access-authenticated-user-email': 'rene@sablen.dk' }, body: '{}' }); const response = await app.fetch(request, workerEnv, ctx); if (!response.ok) throw new Error('Shopify-tilbagebetalinger kunne ikke synkroniseres.'); refundsReady = true; return { message: 'Tilbagebetalingerne blev synkroniseret.' }; }); } catch { await recordFailure('Shopify · automatisk tilbagebetaling'); }
      try { await runTrackedJob('dinero-refunds', 'Dinero · Tilbagebetalinger', async () => refundsReady ? await runRefundAutomation() : { status: 'skipped' as const, message: 'Sprunget over, fordi tilbagebetalingerne ikke kunne synkroniseres.' }); } catch { /* Jobbet har sin egen historik og fejloversigt. */ }
      let payoutsReady = false;
      try { await runTrackedJob('shopify-payouts', 'Shopify Payments · Udbetalinger', async () => { const payoutRequest = new Request('https://integration.sablen.dk/api/shopify/payouts', { method: 'POST', headers: { 'content-type': 'application/json', 'cf-access-authenticated-user-email': 'rene@sablen.dk' }, body: '{}' }); const response=await app.fetch(payoutRequest,workerEnv,ctx); if(!response.ok)throw new Error('Shopify-udbetalinger kunne ikke synkroniseres.'); payoutsReady = true; return { message: 'Udbetalingssynkroniseringen blev gennemført.' }; }); } catch { await recordFailure('Shopify · automatisk udbetalingssynkronisering'); }
      try { await runTrackedJob('dinero-payouts', 'Dinero · Udbetalinger', async () => payoutsReady ? await runPayoutAutomation() : { status: 'skipped', message: 'Sprunget over, fordi udbetalingssynkroniseringen fejlede.' }); } catch { /* Jobbet har sin egen historik og udbetalingsfejl registreres ved kilden. */ }
    })());
  },
};
