import { NextResponse } from 'next/server';
import { prepareDatabase } from '@/db/database';
import { env } from 'cloudflare:workers';
import { validateSettings } from '@/lib/admin-settings';
import { invoiceFilename, renderInvoiceEmail } from '@/lib/invoice-email';
import { InvoiceCheckError, invoiceFingerprint, type InvoiceSource } from '@/lib/invoice-check';
import { loadCompleteOrder } from '@/db/shopify-order';
import { recordFailure } from '@/db/errors';

type EmailBinding = { send(message: { to: string; from: { email: string; name: string }; replyTo: string; subject: string; text: string; attachments: Array<{ content: ArrayBuffer; filename: string; type: string; disposition: 'attachment' }> }): Promise<{ messageId: string }> };
const reply = (data: unknown, status = 200) => NextResponse.json(data, { status, headers: { 'Cache-Control': 'no-store' } });
const failed = async (message: string, status: number) => { await recordFailure('Faktura-afsendelse'); return reply({ error: message }, status); };

const validRecipient = (value: string) => value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) && !/[\r\n]/.test(value);
const recipientKey = async (value: string) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))).map(byte => byte.toString(16).padStart(2, '0')).join('').slice(0, 24);

export async function POST(request: Request) {
  const origin = request.headers.get('origin');
  if (!origin || origin !== new URL(request.url).origin || !request.headers.get('content-type')?.startsWith('application/json')) return reply({ error: 'Handlingen skal startes fra integrationssiden.' }, 403);
  const actor = request.headers.get('cf-access-authenticated-user-email')?.trim().toLowerCase();
  if (process.env.NODE_ENV === 'production' && actor !== 'rene@sablen.dk') return reply({ error: 'Adgang afvist.' }, 403);
  const db = await prepareDatabase();
  try {
    const input = await request.json() as { recipient?: unknown };
    const recipient = typeof input.recipient === 'string' ? input.recipient.trim().toLowerCase() : '';
    if (!validRecipient(recipient)) return failed('Angiv en gyldig e-mailadresse til testen.', 400);
    const rows = await db.prepare("SELECT external_id, payload_json FROM integration_records WHERE tenant='sablen.dk' AND record_type='invoice' AND booking_status='generated' ORDER BY occurred_at DESC LIMIT 20").all<{ external_id: string; payload_json: string }>();
    let selected: { row: { external_id: string; payload_json: string }; saved: { order: InvoiceSource; r2Key: string; invoiceFingerprint: string }; order: InvoiceSource } | null = null;
    for (const row of rows.results) {
      try {
        const saved = JSON.parse(row.payload_json) as { order?: InvoiceSource; r2Key?: string; invoiceFingerprint?: string };
        if (!saved.order || !saved.r2Key || !saved.invoiceFingerprint) continue;
        const order = await loadCompleteOrder(row.external_id);
        const rendered = renderInvoiceEmail(undefined, order);
        const currentFingerprint = await invoiceFingerprint(rendered.invoice);
        if (Array.isArray(saved.order.fulfillments) && saved.order.fulfillments.length) {
          if (currentFingerprint !== saved.invoiceFingerprint) continue;
        } else {
          // Legacy snapshots predate persisted fulfilment timestamps. Hydrate only
          // that missing field, then require every controlled invoice value to
          // match the freshly loaded Shopify order before reusing the stored PDF.
          const legacyChecked = renderInvoiceEmail(undefined, { ...saved.order, fulfillments: order.fulfillments });
          if (await invoiceFingerprint(legacyChecked.invoice) !== currentFingerprint) continue;
        }
        selected = { row, saved: { order: saved.order, r2Key: saved.r2Key, invoiceFingerprint: saved.invoiceFingerprint }, order };
        break;
      } catch (error) { if (!(error instanceof InvoiceCheckError) && !(error instanceof SyntaxError)) throw error; }
    }
    if (!selected) return failed('Ingen af de seneste fakturaer består den fulde fakturakontrol. Kontrollér fakturaoversigten først.', 409);
    const { row, saved, order } = selected;
    const settingsRow = await db.prepare("SELECT setting_value FROM app_settings WHERE tenant='sablen.dk' AND setting_key='admin_settings'").first<{ setting_value: string }>();
    const settings = settingsRow ? validateSettings(JSON.parse(settingsRow.setting_value)) : undefined;
    const { subject, text } = renderInvoiceEmail(settings?.invoiceEmail, order);
    const id = `invoice-email:test:${row.external_id}:${await recipientKey(recipient)}`;
    const existing = await db.prepare('SELECT status FROM invoice_email_deliveries WHERE id=?').bind(id).first<{ status: string }>();
    if (existing?.status === 'sent' || existing?.status === 'sending') return failed('Testfakturaen er allerede sendt eller afsendelsen er i gang. Den sendes ikke igen automatisk.', 409);
    const object = await (env as unknown as { INVOICES: R2Bucket }).INVOICES.get(saved.r2Key);
    if (!object) return failed('PDF-fakturaen blev ikke fundet.', 404);
    const bytes = await object.arrayBuffer();
    if (bytes.byteLength > 4_500_000) return failed('PDF-fakturaen er for stor til en sikker mailafsendelse.', 413);
    await db.prepare("INSERT INTO invoice_email_deliveries (id,tenant,external_id,recipient,delivery_mode,status) VALUES (?,'sablen.dk',?,?,'test','sending') ON CONFLICT(id) DO UPDATE SET status='sending',error_message=NULL,updated_at=CURRENT_TIMESTAMP").bind(id, row.external_id, recipient).run();
    const result = await (env as unknown as { INVOICE_EMAIL: EmailBinding }).INVOICE_EMAIL.send({
      to: recipient,
      from: { email: 'faktura@sablen.dk', name: 'Sablen.dk' },
      replyTo: 'rene@sablen.dk',
      subject,
      text,
      attachments: [{ content: bytes, filename: invoiceFilename(order), type: 'application/pdf', disposition: 'attachment' }],
    });
    await db.prepare("UPDATE invoice_email_deliveries SET status='sent',provider_message_id=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(result.messageId, id).run();
    return reply({ sent: true, recipient, invoiceNumber: order.name.replace(/^#/, '') });
  } catch (error) {
    const code = error && typeof error === 'object' && 'code' in error ? String((error as { code: unknown }).code) : '';
    const message = code === 'E_SENDER_DOMAIN_NOT_AVAILABLE' || code === 'E_SENDER_NOT_VERIFIED'
      ? 'Sablen.dk er endnu ikke godkendt til mailafsendelse i Cloudflare Email Service.'
      : code === 'E_RECIPIENT_NOT_ALLOWED' ? 'Testadressen skal først godkendes som destination i Cloudflare.'
      : error instanceof InvoiceCheckError ? error.message
      : `Cloudflare afviste testmailen${code ? ` (${code})` : ''}. Ingen kundemail er aktiveret.`;
    await db.prepare("UPDATE invoice_email_deliveries SET status='failed',error_message=?,updated_at=CURRENT_TIMESTAMP WHERE delivery_mode='test' AND status='sending'").bind(message).run();
    await recordFailure('Faktura-afsendelse');
    return reply({ error: message }, 503);
  }
}
