// One credit note per refund of an invoiced order. It is built from the invoice as it was issued (customer,
// company details and design), so it always matches the document it credits, and stored once in R2.
// Orders the platform did not invoice get no credit note; their refunds are still booked.
import { buildInvoicePdf } from './invoice-pdf';
import { sendCustomerInvoice } from './mail';
import type { OrderRefund } from './order-refunds';
import { danishSettings, fillTemplate, marketRow, profileOf } from './invoice-profiles';
import { orderMarketSettings } from './order-markets';
import { HttpError, type Actor, type PlatformEnv } from './types';

type Note = { id: string; number: string; r2_key: string; status: string; created_at: string };
const stuckMs = 10 * 60000;
type Locale = 'da' | 'sv' | 'en';
// The language and currency of the invoice the credit note belongs to, for its mail.
function documentFacts(invoice: { source_json: string; issuer_json: string }, refund: OrderRefund) {
  const issuer = JSON.parse(invoice.issuer_json), order = JSON.parse(invoice.source_json), currency = String(order.currentTotalPriceSet?.shopMoney?.currencyCode || refund.currency);
  const gross = currency === refund.currency ? refund.gross : refund.presentment?.currency === currency ? refund.presentment.gross : refund.gross;
  const customer = String(order.billingAddress?.name || order.shippingAddress?.name || order.customer?.displayName || '').trim();
  return { locale: (['sv', 'en'].includes(issuer.locale) ? issuer.locale : 'da') as Locale, currency: currency === refund.currency || refund.presentment?.currency === currency ? currency : refund.currency, gross, store: String(issuer.soldVia || issuer.name || ''), customer, invoiceNumber: String(order.name || '').replace(/^#/, '') };
}

export const creditNoteNumber = (orderName: string, sequence: number) => `${orderName.replace(/^#/, '')}-K${sequence}`;

/** The credit note of a refund, generated on first use; null when the order has no platform invoice. */
export async function ensureCreditNote(env: PlatformEnv, company: string, shop: string, refund: OrderRefund) {
  const db = env.PLATFORM_DB;
  const invoice = await db.prepare("SELECT source_json,issuer_json FROM platform_invoices WHERE company_id=? AND webshop_id=? AND external_id=? AND status='generated'").bind(company, shop, refund.orderId).first<{ source_json: string; issuer_json: string }>();
  if (!invoice) return null;
  const saved = await db.prepare('SELECT id,number,r2_key,status,created_at FROM platform_credit_notes WHERE company_id=? AND webshop_id=? AND external_id=?').bind(company, shop, refund.id).first<Note>();
  if (saved?.status === 'generated') {
    const file = await env.PLATFORM_DOCUMENTS.get(saved.r2_key);
    if (!file) throw new HttpError(409, 'Den gemte kreditnota mangler. Den genoprettes ikke automatisk.');
    return { id: saved.id, number: saved.number, key: saved.r2_key, file, email: String(JSON.parse(invoice.source_json).email || ''), ...documentFacts(invoice, refund) };
  }
  // A generation that stopped halfway (e.g. a timeout) is cleared after 10 minutes and made again.
  if (saved) {
    if (Date.now() - Date.parse(saved.created_at.replace(' ', 'T') + (saved.created_at.includes('Z') ? '' : 'Z')) < stuckMs) throw new HttpError(409, 'Kreditnotaen er ved at blive dannet. Prøv igen om lidt.');
    await db.prepare("DELETE FROM platform_credit_notes WHERE company_id=? AND webshop_id=? AND external_id=? AND status='generating'").bind(company, shop, refund.id).run();
  }
  if (refund.problem || !refund.lines.length) throw new HttpError(409, refund.problem || 'Tilbagebetalingen har ingen linjer at kreditere.');
  const order = JSON.parse(invoice.source_json), issuer = JSON.parse(invoice.issuer_json);
  let logo: ArrayBuffer | undefined;
  if (typeof issuer.logo_key === 'string') { const file = await env.PLATFORM_DOCUMENTS.get(issuer.logo_key); if (file) logo = await file.arrayBuffer(); }
  const invoiceNumber = String(order.name).replace(/^#/, ''), number = creditNoteNumber(String(order.name), refund.sequence);
  // The credit note is in the invoice's currency: the customer's (e.g. SEK) for an order from another market.
  const invoiceCurrency = order.currentTotalPriceSet?.shopMoney?.currencyCode;
  const credited = invoiceCurrency === refund.currency ? { currency: refund.currency, lines: refund.lines } : refund.presentment?.currency === invoiceCurrency ? refund.presentment : null;
  if (!credited) throw new HttpError(409, 'Tilbagebetalingen kan ikke opgøres i fakturaens valuta. Kreditnotaen dannes ikke automatisk.');
  const bytes = await buildInvoicePdf(order, issuer, logo, { number, date: refund.processedAt, invoiceNumber, currency: credited.currency, lines: credited.lines });
  const id = crypto.randomUUID(), key = `companies/${company}/webshops/${shop}/credit-notes/${id}.pdf`;
  const claim = await db.prepare("INSERT INTO platform_credit_notes(company_id,webshop_id,external_id,id,order_id,number,status,r2_key,source_json) VALUES(?,?,?,?,?,?,'generating',?,?) ON CONFLICT DO NOTHING")
    .bind(company, shop, refund.id, id, refund.orderId, number, key, JSON.stringify(refund)).run();
  if (!claim.meta.changes) throw new HttpError(409, 'Kreditnotaen er allerede dannet eller ved at blive dannet.');
  await env.PLATFORM_DOCUMENTS.put(key, bytes, { httpMetadata: { contentType: 'application/pdf' } });
  await db.batch([
    db.prepare("UPDATE platform_credit_notes SET status='generated' WHERE id=? AND status='generating'").bind(id),
    db.prepare("INSERT INTO record_events(company_id,webshop_id,provider,module,external_id,event,details_json) VALUES(?,?,'shopify','order_refunds',?,'credit.generated',?)").bind(company, shop, refund.id, JSON.stringify({ documentId: id, message: 'Kreditnota ' + number })),
  ]);
  const file = await env.PLATFORM_DOCUMENTS.get(key);
  if (!file) throw new HttpError(409, 'Kreditnotaen kunne ikke gemmes.');
  return { id, number, key, file, email: String(order.email || ''), ...documentFacts(invoice, refund) };
}

/** Mails the credit note of a refund to the customer, once. Nothing is sent for orders without a platform invoice. */
export async function sendCreditNote(env: PlatformEnv, actor: Actor, company: string, shop: string, refundId: string) {
  const row = await env.PLATFORM_DB.prepare("SELECT payload_json FROM order_refunds WHERE company_id=? AND webshop_id=? AND external_id=?").bind(company, shop, refundId).first<{ payload_json: string }>();
  if (!row) throw new HttpError(404, 'Hent tilbagebetalingen fra Shopify først.');
  const refund = JSON.parse(row.payload_json) as OrderRefund, note = await ensureCreditNote(env, company, shop, refund);
  if (!note) return { sent: false };
  if (!note.email) throw new HttpError(409, 'Ordren har ingen kundemail, så kreditnotaen kan ikke sendes.');
  // The credit-note mail text of Danmark or of the order's market (Indstillinger → Faktura-afsendelse), sent from its sender.
  const market = await orderMarketSettings(env.PLATFORM_DB, company, shop, refund.orderId);
  const profile = profileOf(await danishSettings(env, company), market ? await marketRow(env, company, shop, market.market_id) : null);
  const name = profile.issuer.name || (await env.PLATFORM_DB.prepare('SELECT name FROM companies WHERE id=?').bind(company).first<{ name: string }>())!.name;
  const intl = { da: 'da-DK', sv: 'sv-SE', en: 'en-GB' }[note.locale];
  const amount = new Intl.NumberFormat(intl, { style: 'currency', currency: note.currency }).format(note.gross / 10 ** new Intl.NumberFormat('en', { style: 'currency', currency: note.currency }).resolvedOptions().maximumFractionDigits!);
  const values = { kundenavn: note.customer, kreditnotanummer: note.number, fakturanummer: note.invoiceNumber, ordrenummer: refund.orderName, 'beløb': amount, butik: profile.storeName ?? (note.store || name), virksomhedsnavn: name };
  const mail = { subject: fillTemplate(profile.creditSubject, values), text: fillTemplate(profile.creditBody, values) };
  const content = await note.file.arrayBuffer();
  if (content.byteLength > 3500000) throw new HttpError(413, 'Kreditnotaen er for stor til mail.');
  const response = await sendCustomerInvoice(env, actor, company, shop, note.id, note.email, mail.subject, mail.text, { content, filename: `${note.locale === 'sv' ? 'kreditfaktura' : note.locale === 'en' ? 'credit-note' : 'kreditnota'}-${note.number}.pdf`, type: 'application/pdf', disposition: 'attachment' }, 'credit', market ? { shop, market: market.market_id } : undefined);
  if (!response.ok) throw new HttpError(response.status, ((await response.json()) as { error?: string }).error || 'Kreditnotaen kunne ikke sendes.');
  return { sent: true };
}
