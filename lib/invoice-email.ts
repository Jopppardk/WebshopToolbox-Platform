import { checkInvoice, type InvoiceSource } from './invoice-check';
import { defaultInvoiceEmail, type InvoiceEmailSettings } from './admin-settings';

export const TEST_INVOICE_RECIPIENT = 'rene.jeppesen@live.dk';
const allowedTokens = new Set(['kundenavn', 'fakturanummer', 'ordrenummer']);

export function renderInvoiceEmail(template: InvoiceEmailSettings | undefined, order: InvoiceSource) {
  const invoice = checkInvoice(order);
  const values: Record<string, string> = {
    kundenavn: invoice.customer.name,
    fakturanummer: invoice.number.replace(/^#/, ''),
    ordrenummer: invoice.number,
  };
  const apply = (value: string) => value.replace(/{{\s*([a-zA-ZæøåÆØÅ]+)\s*}}/g, (match, token) => allowedTokens.has(String(token).toLowerCase()) ? values[String(token).toLowerCase()] : match);
  const selected = template || defaultInvoiceEmail;
  return { subject: apply(selected.subject), text: apply(selected.body), invoice };
}

export function invoiceFilename(order: InvoiceSource) {
  return `${order.name.replace(/^#/, '').replace(/[^a-zA-Z0-9_-]/g, '-')}.pdf`;
}
