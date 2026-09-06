import { NextRequest, NextResponse } from 'next/server';
import { env } from 'cloudflare:workers';
import { prepareDatabase } from '@/db/database';
import { recordFailure } from '@/db/errors';
import { loadCompleteOrder } from '@/db/shopify-order';
import { validateSettings } from '@/lib/admin-settings';
import { InvoiceCheckError, invoiceFingerprint, type InvoiceSource } from '@/lib/invoice-check';
import { invoiceFilename, renderInvoiceEmail } from '@/lib/invoice-email';

type EmailBinding = { send(message: { to: string; from: { email: string; name: string }; replyTo: string; subject: string; text: string; attachments: Array<{ content: ArrayBuffer; filename: string; type: string; disposition: 'attachment' }> }): Promise<{ messageId: string }> };
type SavedInvoice = { order?: InvoiceSource; r2Key?: string; invoiceFingerprint?: string };

const reply = (data: unknown, status = 200) => NextResponse.json(data, { status, headers: { 'Cache-Control': 'no-store' } });
const validRecipient = (value: string) => value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) && !/[\r\n]/.test(value);

export async function POST(request: NextRequest) {
  const origin = request.headers.get('origin');
  if (!origin || origin !== request.nextUrl.origin || !request.headers.get('content-type')?.startsWith('application/json')) return reply({ error: 'Handlingen skal startes fra integrationssiden.' }, 403);
  const actor = request.headers.get('cf-access-authenticated-user-email')?.trim().toLowerCase();
  if (process.env.NODE_ENV === 'production' && actor !== 'rene@sablen.dk') return reply({ error: 'Adgang afvist.' }, 403);

  const db = await prepareDatabase();
  let deliveryId = '';
  try {
    const body = await request.json() as { externalId?: unknown };
    if (typeof body.externalId !== 'string' || !/^gid:\/\/shopify\/Order\/\d{1,30}$/.test(body.externalId)) return reply({ error: 'Ugyldig ordre.' }, 400);

    const row = await db.prepare("SELECT payload_json FROM integration_records WHERE tenant='sablen.dk' AND record_type='invoice' AND booking_status='generated' AND external_id=?").bind(body.externalId).first<{ payload_json: string }>();
    if (!row) return reply({ error: 'Fakturaen er ikke genereret endnu.' }, 404);
    const saved = JSON.parse(row.payload_json) as SavedInvoice;
    if (!saved.order || !saved.r2Key || !saved.invoiceFingerprint) throw new InvoiceCheckError('Den gemte faktura mangler kontroldata. Regenerér fakturaen først.');

    const order = await loadCompleteOrder(body.externalId);
    const rendered = renderInvoiceEmail(undefined, order);
    const currentFingerprint = await invoiceFingerprint(rendered.invoice);
    if (Array.isArray(saved.order.fulfillments) && saved.order.fulfillments.length) {
      if (currentFingerprint !== saved.invoiceFingerprint) throw new InvoiceCheckError('Ordren er ændret siden fakturaen blev genereret. Gennemgå fakturaen før afsendelse.');
    } else {
      const legacyChecked = renderInvoiceEmail(undefined, { ...saved.order, fulfillments: order.fulfillments });
      if (await invoiceFingerprint(legacyChecked.invoice) !== currentFingerprint) throw new InvoiceCheckError('Ordren er ændret siden fakturaen blev genereret. Gennemgå fakturaen før afsendelse.');
    }

    const recipient = order.email?.trim().toLowerCase() || '';
    if (!validRecipient(recipient)) throw new InvoiceCheckError('Shopify-ordren mangler en gyldig kundemail. Ret ordren før fakturaen sendes.');
    deliveryId = `invoice-email:customer:${body.externalId}`;
    const existing = await db.prepare('SELECT status FROM invoice_email_deliveries WHERE id=?').bind(deliveryId).first<{ status: string }>();
    if (existing?.status === 'sent') return reply({ error: 'Fakturaen er allerede sendt til kunden og sendes ikke igen.' }, 409);
    if (existing?.status === 'sending') return reply({ error: 'Fakturaen er allerede ved at blive sendt.' }, 409);

    const object = await (env as unknown as { INVOICES: R2Bucket }).INVOICES.get(saved.r2Key);
    if (!object) throw new InvoiceCheckError('PDF-fakturaen blev ikke fundet. Regenerér fakturaen først.');
    const bytes = await object.arrayBuffer();
    if (bytes.byteLength > 4_500_000) throw new InvoiceCheckError('PDF-fakturaen er for stor til en sikker mailafsendelse.');

    const settingsRow = await db.prepare("SELECT setting_value FROM app_settings WHERE tenant='sablen.dk' AND setting_key='admin_settings'").first<{ setting_value: string }>();
    const settings = settingsRow ? validateSettings(JSON.parse(settingsRow.setting_value)) : undefined;
    const { subject, text } = renderInvoiceEmail(settings?.invoiceEmail, order);
    const lock = await db.prepare("INSERT INTO invoice_email_deliveries (id,tenant,external_id,recipient,delivery_mode,status) VALUES (?,'sablen.dk',?,?,'customer','sending') ON CONFLICT(id) DO UPDATE SET recipient=excluded.recipient,status='sending',error_message=NULL,updated_at=CURRENT_TIMESTAMP WHERE invoice_email_deliveries.status='failed'").bind(deliveryId, body.externalId, recipient).run();
    if (lock.meta.changes !== 1) return reply({ error: 'Fakturaen er allerede sendt eller ved at blive sendt.' }, 409);
    const result = await (env as unknown as { INVOICE_EMAIL: EmailBinding }).INVOICE_EMAIL.send({
      to: recipient,
      from: { email: 'faktura@sablen.dk', name: 'Sablen.dk' },
      replyTo: 'rene@sablen.dk',
      subject,
      text,
      attachments: [{ content: bytes, filename: invoiceFilename(order), type: 'application/pdf', disposition: 'attachment' }],
    });
    await db.prepare("UPDATE invoice_email_deliveries SET status='sent',provider_message_id=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(result.messageId, deliveryId).run();
    return reply({ sent: true, recipient, invoiceNumber: order.name.replace(/^#/, '') });
  } catch (error) {
    const code = error && typeof error === 'object' && 'code' in error ? String((error as { code: unknown }).code) : '';
    const message = code === 'E_SENDER_DOMAIN_NOT_AVAILABLE' || code === 'E_SENDER_NOT_VERIFIED'
      ? 'Sablen.dk er ikke godkendt til mailafsendelse i Cloudflare.'
      : code === 'E_RECIPIENT_NOT_ALLOWED' ? 'Cloudflare afviste kundens mailadresse som destination.'
      : error instanceof InvoiceCheckError ? error.message
      : `Cloudflare kunne ikke sende fakturaen${code ? ` (${code})` : ''}. Prøv igen senere.`;
    if (deliveryId) await db.prepare("UPDATE invoice_email_deliveries SET status='failed',error_message=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND status='sending'").bind(message, deliveryId).run();
    await recordFailure('Faktura-afsendelse');
    return reply({ error: message }, error instanceof InvoiceCheckError ? 409 : 503);
  }
}
