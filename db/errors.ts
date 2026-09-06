import { database } from './database';
import { env } from 'cloudflare:workers';

type ErrorNotificationSettings = { enabled: boolean; email: string };
type EmailBinding = { send(message: { to: string; from: { email: string; name: string }; replyTo: string; subject: string; text: string; attachments: [] }): Promise<unknown> };

function notificationSettings(value: string | undefined): ErrorNotificationSettings {
  try {
    const parsed = JSON.parse(value || '{}') as Partial<ErrorNotificationSettings>;
    return { enabled: parsed.enabled === true, email: typeof parsed.email === 'string' ? parsed.email : '' };
  } catch { return { enabled: false, email: '' }; }
}

// Store a fixed diagnostic, not upstream responses that might contain secrets/customer data.
export async function recordFailure(source: string) {
  try {
    const message = 'Handlingen mislykkedes. Åbn modulet og prøv igen for at se den aktuelle fejl.';
    const db = database();
    const inserted = await db.prepare("INSERT INTO system_errors (tenant, source, message) SELECT 'sablen.dk', ?, ? WHERE NOT EXISTS (SELECT 1 FROM system_errors WHERE tenant = 'sablen.dk' AND source = ? AND message = ? AND resolved_at IS NULL)").bind(source, message, source, message).run();
    if (inserted.meta.changes !== 1) return;
    const row = await db.prepare("SELECT setting_value FROM app_settings WHERE tenant='sablen.dk' AND setting_key='error_notifications'").first<{ setting_value: string }>();
    const settings = notificationSettings(row?.setting_value);
    if (!settings.enabled || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(settings.email)) return;
    try {
      const safeSource = source.replace(/[\r\n]/g, ' ').slice(0, 120);
      await (env as unknown as { INVOICE_EMAIL: EmailBinding }).INVOICE_EMAIL.send({
        to: settings.email,
        from: { email: 'faktura@sablen.dk', name: 'Sablen Toolbox' },
        replyTo: 'rene@sablen.dk',
        subject: `Fejl i Sablen Toolbox: ${safeSource}`,
        text: `Der er registreret en ny fejl i Sablen Toolbox.\n\nKilde: ${safeSource}\nTidspunkt: ${new Date().toLocaleString('da-DK', { timeZone: 'Europe/Copenhagen' })}\n\nÅbn fejloversigten: https://integration.sablen.dk/`,
        attachments: [],
      });
    } catch {
      await db.prepare("INSERT INTO system_errors (tenant,source,message) SELECT 'sablen.dk','Fejlmail','En fejlmail kunne ikke sendes. Kontrollér mailindstillingen.' WHERE NOT EXISTS (SELECT 1 FROM system_errors WHERE tenant='sablen.dk' AND source='Fejlmail' AND resolved_at IS NULL)").run();
    }
  } catch { /* Failure reporting must never hide the original error. */ }
}
