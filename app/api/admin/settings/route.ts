import { NextRequest, NextResponse } from 'next/server';
import { prepareDatabase } from '@/db/database';
import { validateSettings } from '@/lib/admin-settings';
const reply = (data: unknown, status = 200) => NextResponse.json(data, { status, headers: { 'Cache-Control': 'no-store' } });
export async function GET() {
  try {
    const db = await prepareDatabase();
    const row = await db.prepare("SELECT setting_value FROM app_settings WHERE tenant = 'sablen.dk' AND setting_key = 'admin_settings'").first<{ setting_value: string }>();
    if (!row) return reply({ settings: null, revision: null });
    const saved = JSON.parse(row.setting_value);
    return reply({ settings: validateSettings(saved), revision: saved.revision });
  } catch { return reply({ error: 'Fælles indstillinger kunne ikke indlæses. Prøv igen.' }, 503); }
}
export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as { settings: unknown; revision: string | null };
    const settings = validateSettings(body.settings);
    if (body.revision !== null && (typeof body.revision !== 'string' || body.revision.length > 100)) return reply({ error: 'Ugyldig version' }, 400);
    const revision = crypto.randomUUID();
    const db = await prepareDatabase();
    const previousRow = await db.prepare("SELECT setting_value FROM app_settings WHERE tenant = 'sablen.dk' AND setting_key = 'admin_settings'").first<{ setting_value: string }>();
    const wasSendingInvoices = previousRow ? validateSettings(JSON.parse(previousRow.setting_value)).automation.invoiceEmails : false;
    const wasBookingRefunds = previousRow ? validateSettings(JSON.parse(previousRow.setting_value)).automation.refunds : false;
    const value = JSON.stringify({ ...settings, revision });
    const result = body.revision === null
      ? await db.prepare("INSERT INTO app_settings (tenant, setting_key, setting_value) VALUES ('sablen.dk', 'admin_settings', ?) ON CONFLICT(tenant, setting_key) DO NOTHING").bind(value).run()
      : await db.prepare("UPDATE app_settings SET setting_value = ?, updated_at = CURRENT_TIMESTAMP WHERE tenant = 'sablen.dk' AND setting_key = 'admin_settings' AND json_extract(setting_value, '$.revision') = ?").bind(value, body.revision).run();
    if (!result.meta.changes) return reply({ error: 'Indstillingerne er ændret i en anden fane. Genindlæs siden før du gemmer igen.' }, 409);
    if (settings.automation.invoiceEmails && !wasSendingInvoices) {
      await db.prepare("INSERT INTO app_settings(tenant,setting_key,setting_value) VALUES ('sablen.dk','invoice_email_automation_started_at',?) ON CONFLICT(tenant,setting_key) DO UPDATE SET setting_value=excluded.setting_value,updated_at=CURRENT_TIMESTAMP").bind(new Date().toISOString()).run();
    }
    if (settings.automation.refunds && !wasBookingRefunds) {
      await db.prepare("INSERT INTO app_settings(tenant,setting_key,setting_value) VALUES ('sablen.dk','refund_automation_started_at',?) ON CONFLICT(tenant,setting_key) DO UPDATE SET setting_value=excluded.setting_value,updated_at=CURRENT_TIMESTAMP").bind(new Date().toISOString()).run();
    }
    return reply({ settings, revision });
  } catch { return reply({ error: 'Indstillingerne kunne ikke gemmes. Kontrollér felterne og prøv igen.' }, 400); }
}
