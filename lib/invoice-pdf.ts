import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

type Money = { amount: string; currencyCode: string };
type InvoiceOrder = {
  id: string;
  name: string;
  createdAt: string;
  billingAddress?: { name?: string; address1?: string; address2?: string; zip?: string; city?: string; country?: string } | null;
  shippingAddress?: { name?: string; address1?: string; address2?: string; zip?: string; city?: string; country?: string } | null;
  lineItems?: { nodes?: Array<{ name: string; quantity: number; discountedTotalSet: { shopMoney: Money } }> };
  shippingLines?: { nodes?: Array<{ title: string; discountedPriceSet: { shopMoney: Money } }> };
  currentSubtotalPriceSet?: { shopMoney: Money };
  currentTotalTaxSet?: { shopMoney: Money } | null;
  currentTotalPriceSet: { shopMoney: Money };
};

type PdfEnv = { INVOICES: R2Bucket; ASSETS: Fetcher };
const tenant = 'sablen.dk';
const keyFor = (externalId: string) => `invoices/${encodeURIComponent(externalId)}.pdf`;
const money = (value: number) => new Intl.NumberFormat('da-DK', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);

export async function buildInvoicePdf(order: InvoiceOrder, logoBytes?: ArrayBuffer | Uint8Array) {
  const pdf = await PDFDocument.create();
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  let logo: Awaited<ReturnType<typeof pdf.embedPng>> | undefined;
  try { if (logoBytes) logo = await pdf.embedPng(logoBytes); } catch {}
  const total = Number(order.currentTotalPriceSet.shopMoney.amount);
  const subtotal = Number(order.currentSubtotalPriceSet?.shopMoney.amount || total / 1.25);
  const tax = Number(order.currentTotalTaxSet?.shopMoney.amount || total - subtotal);
  const currency = order.currentTotalPriceSet.shopMoney.currencyCode;
  const address = order.billingAddress || order.shippingAddress || {};
  const rows = [
    ...(order.lineItems?.nodes || []).map((line) => ({ name: line.name, quantity: line.quantity, total: Number(line.discountedTotalSet.shopMoney.amount) })),
    ...(order.shippingLines?.nodes || []).map((line) => ({ name: line.title || 'Levering', quantity: 1, total: Number(line.discountedPriceSet.shopMoney.amount) })),
  ];
  const chunks = rows.length ? Array.from({ length: Math.ceil(rows.length / 18) }, (_, i) => rows.slice(i * 18, i * 18 + 18)) : [[{ name: `Shopify-ordre ${order.name}`, quantity: 1, total }]];
  chunks.forEach((pageRows, pageIndex) => {
    const page = pdf.addPage([595.28, 841.89]);
    const { width } = page.getSize();
    if (logo) { const scale = Math.min(150 / logo.width, 55 / logo.height); page.drawImage(logo, { x: width - 55 - logo.width * scale, y: 748, width: logo.width * scale, height: logo.height * scale }); }
    page.drawText(address.name || 'Kunde', { x: 55, y: 765, size: 11, font: bold, color: rgb(.12, .12, .12) });
    [address.address1, address.address2, [address.zip, address.city].filter(Boolean).join(' '), address.country].filter(Boolean).forEach((line, i) => page.drawText(String(line), { x: 55, y: 746 - i * 15, size: 10, font: regular }));
    page.drawText(pageIndex ? `Faktura ${order.name} - fortsat` : 'Faktura', { x: 55, y: 650, size: 22, font: bold });
    page.drawText(`Ordrenr. ${order.name}`, { x: 55, y: 628, size: 10, font: regular });
    page.drawText(`Fakturanr. ${order.name}`, { x: 385, y: 650, size: 10, font: bold });
    page.drawText(`Fakturadato: ${new Intl.DateTimeFormat('da-DK').format(new Date(order.createdAt))}`, { x: 385, y: 632, size: 10, font: regular });
    page.drawLine({ start: { x: 55, y: 604 }, end: { x: 540, y: 604 }, thickness: 1.5, color: rgb(.14, .17, .22) });
    page.drawText('Beskrivelse', { x: 55, y: 588, size: 9, font: regular }); page.drawText('Antal', { x: 360, y: 588, size: 9, font: regular }); page.drawText('Stk. pris', { x: 420, y: 588, size: 9, font: regular }); page.drawText('Pris', { x: 505, y: 588, size: 9, font: regular });
    page.drawLine({ start: { x: 55, y: 580 }, end: { x: 540, y: 580 }, thickness: 1.5, color: rgb(.14, .17, .22) });
    pageRows.forEach((row, i) => { const y = 556 - i * 24; const title = row.name.length > 47 ? `${row.name.slice(0, 44)}...` : row.name; page.drawText(title, { x: 55, y, size: 9, font: regular }); page.drawText(String(row.quantity), { x: 370, y, size: 9, font: regular }); page.drawText(money(row.total / Math.max(row.quantity, 1)), { x: 420, y, size: 9, font: regular }); page.drawText(money(row.total), { x: 500, y, size: 9, font: regular }); });
    if (pageIndex === chunks.length - 1) {
      page.drawText('Total ekskl. moms', { x: 340, y: 120, size: 10, font: regular }); page.drawText(money(subtotal), { x: 490, y: 120, size: 10, font: regular });
      page.drawText('Moms', { x: 340, y: 101, size: 10, font: regular }); page.drawText(money(tax), { x: 490, y: 101, size: 10, font: regular });
      page.drawText(`Total inkl. moms ${currency}`, { x: 340, y: 76, size: 11, font: bold }); page.drawText(money(total), { x: 490, y: 76, size: 11, font: bold });
      page.drawLine({ start: { x: 340, y: 68 }, end: { x: 540, y: 68 }, thickness: 3, color: rgb(.32, .36, .42) });
    }
    page.drawLine({ start: { x: 55, y: 43 }, end: { x: 540, y: 43 }, thickness: .5, color: rgb(.72, .72, .72) });
    page.drawText('LA Trading ApS / Egetoften 13 / 7500 Holstebro / CVR 45036871 / sablen.dk / kontakt@sablen.dk', { x: 68, y: 27, size: 7.5, font: regular, color: rgb(.35, .38, .42) });
  });
  return pdf.save();
}

export async function createInvoicePdf(db: D1Database, order: InvoiceOrder, expiresAt: string) {
  const existing = await db.prepare(`SELECT id FROM integration_records WHERE tenant = ? AND record_type = 'invoice' AND external_id = ?`).bind(tenant, order.id).first();
  if (existing) return false;
  const { env } = await import('cloudflare:workers');
  const runtime = env as unknown as PdfEnv;
  let logoBytes: ArrayBuffer | undefined;
  try { const response = await runtime.ASSETS.fetch(new Request('https://assets.local/sablen-logo.png')); if (response.ok) logoBytes = await response.arrayBuffer(); } catch {}
  const bytes = await buildInvoicePdf(order, logoBytes);
  await runtime.INVOICES.put(keyFor(order.id), bytes, { httpMetadata: { contentType: 'application/pdf', contentDisposition: `inline; filename="faktura-${order.name.replace('#', '')}.pdf"` }, customMetadata: { expiresAt } });
  await db.prepare(`INSERT INTO integration_records (id, tenant, record_type, external_id, occurred_at, amount_minor, currency, booking_status, payload_json, expires_at) VALUES (?, ?, 'invoice', ?, ?, ?, ?, 'generated', ?, ?)`).bind(`invoice:${order.id}`, tenant, order.id, order.createdAt, Math.round(Number(order.currentTotalPriceSet.shopMoney.amount) * 100), order.currentTotalPriceSet.shopMoney.currencyCode, JSON.stringify({ order, generatedAt: new Date().toISOString(), r2Key: keyFor(order.id) }), expiresAt).run();
  return true;
}

export { keyFor };
