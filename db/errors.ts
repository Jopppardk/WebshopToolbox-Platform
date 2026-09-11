import {incidentMailSettings,type Severity} from '@/lib/incident-policy';
import { sanitizeDiagnostic } from '@/lib/diagnostics';
import { database } from './database';
import { env } from 'cloudflare:workers';

type EmailBinding = { send(message: { to: string; from: { email: string; name: string }; replyTo: string; subject: string; text: string; attachments: [] }): Promise<unknown> };
export type FailureContext = {
  severity?: Severity;
  organizationId?: string;
  category?: 'shopify' | 'dinero' | 'document' | 'email' | 'integration' | 'system';
  cause?: string;
  action?: string;
  reference?: string;
};

const clean = sanitizeDiagnostic;

function safeContext(source: string, context: FailureContext = {}, previous?: { occurrenceCount?: unknown; firstSeenAt?: unknown }) {
  const category = context.category || (source.includes('Dinero') ? 'dinero' : source.includes('Shopify') ? 'shopify' : source.includes('Faktura') || source.includes('rapport') ? 'document' : 'system');
  const defaultAction = category === 'dinero' ? 'Kontrollér posteringen og Dinero-forbindelsen, og prøv derefter igen.' : category === 'shopify' ? 'Kontrollér Shopify-forbindelsen og de nødvendige app-rettigheder.' : category === 'document' ? 'Åbn det berørte dokumentmodul og prøv at danne dokumentet igen.' : 'Åbn det berørte modul og prøv igen.';
  const now = new Date().toISOString();
  return {
    category,
    severity: context.severity==='warning'?'warning':'alarm',
    organizationId: clean(context.organizationId,120)||null,
    cause: clean(context.cause, 500) || 'Jobbet eller handlingen blev afbrudt, før den kunne gennemføres.',
    action: clean(context.action, 300) || defaultAction,
    reference: clean(context.reference, 300) || null,
    occurrenceCount: Math.max(1, Number(previous?.occurrenceCount) || 0) + (previous ? 1 : 0),
    firstSeenAt: typeof previous?.firstSeenAt === 'string' ? previous.firstSeenAt : now,
    lastSeenAt: now,
  };
}

// Store a fixed diagnostic, not upstream responses that might contain secrets/customer data.
export async function recordFailure(source: string, context: FailureContext = {}) {
  try {
    const message = 'Handlingen mislykkedes. Åbn modulet og prøv igen for at se den aktuelle fejl.';
    const db = database();
    const reference=clean(context.reference,300)||null,organizationId=clean(context.organizationId,120)||null;
    const existing = await db.prepare("SELECT id,details_json FROM system_errors WHERE tenant='sablen.dk' AND source=? AND resolved_at IS NULL AND CASE WHEN json_valid(details_json) THEN json_extract(details_json,'$.reference') END IS ? AND CASE WHEN json_valid(details_json) THEN json_extract(details_json,'$.organizationId') END IS ? ORDER BY created_at DESC LIMIT 1").bind(source,reference,organizationId).first<{ id: number; details_json?: string }>();
    let previous: { occurrenceCount?: unknown; firstSeenAt?: unknown; severity?:string } | undefined;
    try { previous = existing?.details_json ? JSON.parse(existing.details_json) : undefined; } catch { previous = undefined; }
    const details = safeContext(source, context, previous);
    if (existing) {
      await db.prepare('UPDATE system_errors SET details_json=? WHERE tenant=? AND id=? AND resolved_at IS NULL').bind(JSON.stringify(details), 'sablen.dk', existing.id).run();
      if(previous?.severity!=='warning'||details.severity!=='alarm')return;
    }else{
    const inserted = await db.prepare("INSERT INTO system_errors (tenant, source, message, details_json) VALUES ('sablen.dk', ?, ?, ?)").bind(source, message, JSON.stringify(details)).run();
    if (inserted.meta.changes !== 1) return;
    }
    const row = await db.prepare("SELECT setting_value FROM app_settings WHERE tenant='sablen.dk' AND setting_key='error_notifications'").first<{ setting_value: string }>();
    const settings = incidentMailSettings(row?.setting_value);
    if (!(details.severity==='warning'?settings.warnings:settings.alarms) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(settings.email)) return;
    try {
      const safeSource = source.replace(/[\r\n]/g, ' ').slice(0, 120);
      await (env as unknown as { INVOICE_EMAIL: EmailBinding }).INVOICE_EMAIL.send({
        to: settings.email,
        from: { email: 'faktura@sablen.dk', name: 'Sablen Toolbox' },
        replyTo: 'rene@sablen.dk',
        subject: `${details.severity==='warning'?'Advarsel':'Alarm'} i Sablen Toolbox: ${safeSource}`,
        text: `${details.severity==='warning'?'Systemet forsøger automatisk igen ved næste aktiverede kørsel.':'Denne alarm kræver manuel handling.'}\n\nKilde: ${safeSource}\nTidspunkt: ${new Date().toLocaleString('da-DK', { timeZone: 'Europe/Copenhagen' })}\n\nSe årsag og næste skridt i beskedoversigten: https://integration.sablen.dk/`,
        attachments: [],
      });
    } catch {
      await db.prepare("INSERT INTO system_errors (tenant,source,message) SELECT 'sablen.dk','Fejlmail','En fejlmail kunne ikke sendes. Kontrollér mailindstillingen.' WHERE NOT EXISTS (SELECT 1 FROM system_errors WHERE tenant='sablen.dk' AND source='Fejlmail' AND resolved_at IS NULL)").run();
    }
  } catch { /* Failure reporting must never hide the original error. */ }
}

