import { database } from './database';
import { env } from 'cloudflare:workers';

type ErrorNotificationSettings = { enabled: boolean; email: string };
type EmailBinding = { send(message: { to: string; from: { email: string; name: string }; replyTo: string; subject: string; text: string; attachments: [] }): Promise<unknown> };
export type FailureContext = {
  category?: 'shopify' | 'dinero' | 'document' | 'email' | 'integration' | 'system';
  cause?: string;
  action?: string;
  reference?: string;
};

const clean = (value: unknown, limit: number) => typeof value === 'string'
  ? value.replace(/[\x00-\x1f]+/g, ' ').replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g, '[mail skjult]').replace(/(?:token|secret|password|authorization|api[-_ ]?key)\s*[:=]\s*\S+/gi, '$1=[skjult]').trim().slice(0, limit)
  : '';

function safeContext(source: string, context: FailureContext = {}, previous?: { occurrenceCount?: unknown; firstSeenAt?: unknown }) {
  const category = context.category || (source.includes('Dinero') ? 'dinero' : source.includes('Shopify') ? 'shopify' : source.includes('Faktura') || source.includes('rapport') ? 'document' : 'system');
  const defaultAction = category === 'dinero' ? 'Kontrollér posteringen og Dinero-forbindelsen, og prøv derefter igen.' : category === 'shopify' ? 'Kontrollér Shopify-forbindelsen og de nødvendige app-rettigheder.' : category === 'document' ? 'Åbn det berørte dokumentmodul og prøv at danne dokumentet igen.' : 'Åbn det berørte modul og prøv igen.';
  const now = new Date().toISOString();
  return {
    category,
    cause: clean(context.cause, 500) || 'Jobbet eller handlingen blev afbrudt, før den kunne gennemføres.',
    action: clean(context.action, 300) || defaultAction,
    reference: clean(context.reference, 120) || null,
    occurrenceCount: Math.max(1, Number(previous?.occurrenceCount) || 0) + (previous ? 1 : 0),
    firstSeenAt: typeof previous?.firstSeenAt === 'string' ? previous.firstSeenAt : now,
    lastSeenAt: now,
  };
}

function notificationSettings(value: string | undefined): ErrorNotificationSettings {
  try {
    const parsed = JSON.parse(value || '{}') as Partial<ErrorNotificationSettings>;
    return { enabled: parsed.enabled === true, email: typeof parsed.email === 'string' ? parsed.email : '' };
  } catch { return { enabled: false, email: '' }; }
}

// Store a fixed diagnostic, not upstream responses that might contain secrets/customer data.
export async function recordFailure(source: string, context: FailureContext = {}) {
  try {
    const message = 'Handlingen mislykkedes. Åbn modulet og prøv igen for at se den aktuelle fejl.';
    const db = database();
    const existing = await db.prepare("SELECT id,details_json FROM system_errors WHERE tenant='sablen.dk' AND source=? AND resolved_at IS NULL ORDER BY created_at DESC LIMIT 1").bind(source).first<{ id: number; details_json?: string }>();
    let previous: { occurrenceCount?: unknown; firstSeenAt?: unknown } | undefined;
    try { previous = existing?.details_json ? JSON.parse(existing.details_json) : undefined; } catch { previous = undefined; }
    const details = safeContext(source, context, previous);
    if (existing) {
      await db.prepare('UPDATE system_errors SET details_json=? WHERE tenant=? AND id=? AND resolved_at IS NULL').bind(JSON.stringify(details), 'sablen.dk', existing.id).run();
      return;
    }
    const inserted = await db.prepare("INSERT INTO system_errors (tenant, source, message, details_json) VALUES ('sablen.dk', ?, ?, ?)").bind(source, message, JSON.stringify(details)).run();
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
