import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { invoiceTotals } from './invoice-totals';
import { checkInvoice, invoiceFingerprint, type InvoiceSource } from './invoice-check';


type PdfEnv = { INVOICES: R2Bucket; ASSETS: Fetcher };
const tenant = 'sablen.dk';
const keyFor = (externalId: string) => `invoices/${encodeURIComponent(externalId)}.pdf`;
const money = (value: number) => new Intl.NumberFormat('da-DK', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);


export async function buildInvoicePdf(order: InvoiceSource, logoBytes?: ArrayBuffer | Uint8Array) {
  const checked = checkInvoice(order);
  const pdf = await PDFDocument.create();
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  if (bold.widthOfTextAtSize(`Fakturanr. ${order.name}`, 10) > 155) throw new Error('Fakturanummeret er for langt til PDF-layoutet.');
  let logo: Awaited<ReturnType<typeof pdf.embedPng>> | undefined;
  try { if (logoBytes) logo = await pdf.embedPng(logoBytes); } catch { throw new Error('Sablens logo kunne ikke indlæses i PDF’en.'); }
  const { total, tax, subtotal } = invoiceTotals(order.currentTotalPriceSet.shopMoney.amount, order.currentTotalTaxSet?.shopMoney.amount, order.currentTotalPriceSet.shopMoney.currencyCode);
  const currency = order.currentTotalPriceSet.shopMoney.currencyCode;
  const address = order.billingAddress || order.shippingAddress || {};
  const factor = 10 ** new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions().maximumFractionDigits!;
  const wrap = (value: string, width: number, size: number) => {
    const lines: string[] = []; let line = '';
    for (const word of value.trim().split(/\s+/)) {
      if (line && regular.widthOfTextAtSize(`${line} ${word}`, size) > width) { lines.push(line); line = ''; }
      if (regular.widthOfTextAtSize(word, size) > width) {
        for (const character of word) { if (regular.widthOfTextAtSize(line + character, size) > width) { lines.push(line); line = ''; } line += character; }
      } else line = line ? `${line} ${word}` : word;
    }
    if (line.trim()) lines.push(line.trim());
    return lines;
  };
  const rows = checked.lines.map(line => {
    const rates = [...new Set(line.rates.filter(rate => Number.isFinite(rate) && rate >= 0))];
    if (rates.length !== 1) throw new Error('En fakturalinje mangler en entydig momssats. Ingen PDF gemmes.');
    return { title: wrap(line.title, 255, 9), quantity: line.quantity, total: line.net / factor, rate: rates[0] };
  });
  const vatGroups = [...checked.lines.reduce((groups, line) => {
    const rates = [...new Set(line.rates.filter(rate => Number.isFinite(rate) && rate >= 0))];
    if (rates.length !== 1) throw new Error('En fakturalinje mangler en entydig momssats. Ingen PDF gemmes.');
    const key = rates[0]; const current = groups.get(key) || { rate: key, net: 0, tax: 0 };
    current.net += line.net; current.tax += line.tax; groups.set(key, current); return groups;
  }, new Map<number, { rate: number; net: number; tax: number }>()).values()].sort((a, b) => b.rate - a.rate);
  if (!vatGroups.length || vatGroups.length > 4) throw new Error('Momsopgørelsen kan ikke vises entydigt på fakturaen. Ingen PDF gemmes.');
  const chunks: typeof rows[] = []; let chunk: typeof rows = [], height = 0;
  for (const row of rows) {
    const rowHeight = Math.max(24, row.title.length * 13 + 10);
    if (rowHeight > 390) throw new Error('En varebeskrivelse er for lang til PDF-layoutet. Ingen PDF gemmes.');
    if (height + rowHeight > 290) { chunks.push(chunk); chunk = []; height = 0; }
    chunk.push(row); height += rowHeight;
  }
  if (chunk.length) chunks.push(chunk);
  const customerLines = [checked.customer.name, address.address1, address.address2, [address.zip, address.city].filter(Boolean).join(' '), address.country].filter(Boolean).flatMap(value => wrap(String(value), 285, 10));
  if (customerLines.length > 7) throw new Error('Kundeadressen er for lang til PDF-layoutet. Ingen PDF gemmes.');
  const black = rgb(.09, .09, .095), gold = rgb(.68, .50, .19), softGold = rgb(.97, .94, .86), ink = rgb(.13, .13, .14), muted = rgb(.40, .42, .46), line = rgb(.86, .84, .80), paper = rgb(.985, .982, .972);
  const invoiceDate = new Intl.DateTimeFormat('da-DK', { timeZone: 'Europe/Copenhagen' }).format(new Date(checked.date));
  const paid = order.displayFinancialStatus === 'PAID';
  chunks.forEach((pageRows, pageIndex) => {
    const page = pdf.addPage([595.28, 841.89]);
    const { width } = page.getSize();
    page.drawLine({ start: { x: 54, y: 806 }, end: { x: 541, y: 806 }, thickness: 2, color: gold });
    if (logo) { const scale = Math.min(142 / logo.width, 44 / logo.height); page.drawImage(logo, { x: 54, y: 742, width: logo.width * scale, height: logo.height * scale }); }
    page.drawText(pageIndex ? 'FAKTURA - FORTSAT' : 'FAKTURA', { x: 419, y: 770, size: 18, font: bold, color: black });
    page.drawText(`Side ${pageIndex + 1} af ${chunks.length}`, { x: 541 - regular.widthOfTextAtSize(`Side ${pageIndex + 1} af ${chunks.length}`, 7), y: 816, size: 7, font: regular, color: muted });
    page.drawLine({ start: { x: 54, y: 721 }, end: { x: 541, y: 721 }, thickness: .7, color: line });

    if (!pageIndex) {
      page.drawText('FAKTURERES TIL', { x: 54, y: 667, size: 7.5, font: bold, color: gold, characterSpacing: 1 });
      customerLines.forEach((text, i) => page.drawText(text, { x: 54, y: 647 - i * 13, size: i ? 9 : 11, font: i ? regular : bold, color: ink }));
      page.drawRectangle({ x: 356, y: 604, width: 185, height: 65, color: paper, borderColor: line, borderWidth: .7 });
      page.drawText('FAKTURANUMMER', { x: 372, y: 649, size: 7, font: bold, color: muted });
      page.drawText(order.name.replace(/^#/, ''), { x: 372, y: 633, size: 11, font: bold, color: ink });
      page.drawText('FAKTURADATO', { x: 455, y: 649, size: 7, font: bold, color: muted });
      page.drawText(invoiceDate, { x: 455, y: 633, size: 9, font: regular, color: ink });
      page.drawText(`Ordre ${order.name}`, { x: 372, y: 615, size: 8, font: regular, color: muted });
      page.drawRectangle({ x: 443, y: 678, width: 98, height: 23, color: paid ? softGold : rgb(.96, .92, .84), borderColor: gold, borderWidth: .5 });
      const status = paid ? 'BETALT' : 'AFVENTER BETALING';
      page.drawText(status, { x: 492 - bold.widthOfTextAtSize(status, 8) / 2, y: 686, size: 8, font: bold, color: black });
    }
    page.drawText('FAKTURALINJER', { x: 54, y: 583, size: 8, font: bold, color: gold, characterSpacing: 1 });
    page.drawText('Priser er ekskl. moms og efter rabatter', { x: 352, y: 583, size: 7.5, font: regular, color: muted });
    page.drawRectangle({ x: 54, y: 552, width: 487, height: 24, color: softGold, borderColor: line, borderWidth: .5 });
    page.drawText('Beskrivelse', { x: 66, y: 560, size: 8, font: bold, color: ink }); page.drawText('Moms', { x: 332, y: 560, size: 8, font: bold, color: ink }); page.drawText('Antal', { x: 378, y: 560, size: 8, font: bold, color: ink }); page.drawText('Stk. pris', { x: 431, y: 560, size: 8, font: bold, color: ink }); page.drawText('Beløb', { x: 507, y: 560, size: 8, font: bold, color: ink });
    const amount = (value: number, right: number, y: number, size = 9, font = regular) => { const text = money(value); if (font.widthOfTextAtSize(text, size) > (size === 9 ? 60 : 95)) throw new Error('Beløbet er for bredt til PDF-layoutet.'); page.drawText(text, { x: right - font.widthOfTextAtSize(text, size), y, size, font }); };
    let y = 527;
    pageRows.forEach((row, rowIndex) => {
      if (rowIndex % 2 === 0) page.drawRectangle({ x: 54, y: y - Math.max(24, row.title.length * 13 + 10) + 8, width: 487, height: Math.max(24, row.title.length * 13 + 10), color: paper });
      if (regular.widthOfTextAtSize(String(row.quantity), 9) > 30) throw new Error('Antallet er for bredt til PDF-layoutet.');
      row.title.forEach((title, index) => page.drawText(title, { x: 66, y: y - index * 13, size: 9, font: regular, color: ink }));
      const rateLabel = `${new Intl.NumberFormat('da-DK', { maximumFractionDigits: 2 }).format(row.rate * 100)} %`;
      page.drawText(rateLabel, { x: 332, y, size: 8.5, font: regular, color: muted });
      page.drawText(String(row.quantity), { x: 382, y, size: 9, font: regular }); amount(row.total / row.quantity, 475, y); amount(row.total, 540, y);
      y -= Math.max(24, row.title.length * 13 + 10);
    });
    if (pageIndex === chunks.length - 1) {
      const boxHeight = 82 + vatGroups.length * 32, boxTop = 70 + boxHeight;
      page.drawRectangle({ x: 281, y: 70, width: 260, height: boxHeight, color: paper, borderColor: line, borderWidth: .5 });
      let summaryY = boxTop - 25;
      page.drawText('Total ekskl. moms', { x: 299, y: summaryY, size: 9, font: regular, color: muted }); amount(subtotal, 523, summaryY, 9);
      summaryY -= 20;
      vatGroups.forEach(group => {
        const rate = new Intl.NumberFormat('da-DK', { maximumFractionDigits: 2 }).format(group.rate * 100);
        page.drawText(`Momsgrundlag ${rate} %`, { x: 299, y: summaryY, size: 8, font: regular, color: muted }); amount(group.net / factor, 430, summaryY, 8);
        page.drawText(`Moms ${rate} %`, { x: 445, y: summaryY, size: 8, font: regular, color: muted }); amount(group.tax / factor, 523, summaryY, 8);
        summaryY -= 18;
      });
      page.drawLine({ start: { x: 299, y: 111 }, end: { x: 523, y: 111 }, thickness: .7, color: line });
      page.drawText(`TOTAL ${currency}`, { x: 329, y: 91, size: 10, font: bold, color: black }); amount(total, 523, 89, 13, bold);
      page.drawRectangle({ x: 281, y: 70, width: 4, height: boxHeight, color: gold });
    }
    page.drawLine({ start: { x: 54, y: 43 }, end: { x: 541, y: 43 }, thickness: .7, color: gold });
    page.drawText('LA Trading ApS', { x: 54, y: 26, size: 7.5, font: bold, color: ink });
    page.drawText('Egetoften 13 / 7500 Holstebro / CVR 45036871', { x: 151, y: 26, size: 7.5, font: regular, color: muted });
    page.drawText('sablen.dk / kontakt@sablen.dk', { x: 423, y: 26, size: 7.5, font: regular, color: muted });
  });
  return pdf.save();
}

export async function createInvoicePdf(db: D1Database, order: InvoiceSource, expiresAt: string, force = false) {
  const { env } = await import('cloudflare:workers');
  const runtime = env as unknown as PdfEnv;
  const existing = await db.prepare(`SELECT payload_json FROM integration_records WHERE tenant = ? AND record_type = 'invoice' AND external_id = ?`).bind(tenant, order.id).first<{ payload_json: string }>();
  if (existing && !force) {
    try { const saved = JSON.parse(existing.payload_json) as { r2Key?: string }; if (saved.r2Key && await runtime.INVOICES.head(saved.r2Key)) return false; } catch {}
  }
  const checked = checkInvoice(order);
  const fingerprint = await invoiceFingerprint(checked);
  if (existing) {
    const saved = JSON.parse(existing.payload_json);
    let previous: string;
    try { previous = saved.invoiceFingerprint || await invoiceFingerprint(checkInvoice(saved.order)); }
    catch { throw new Error('Den eksisterende faktura er fra før den fulde kontrol og bevares. Den skal gennemgås særskilt før en erstatning.'); }
    if (previous !== fingerprint) throw new Error('Ordre eller kundeoplysninger er ændret siden faktureringen. Eksisterende PDF bevares; afklar en rettelse/kreditnota først.');
  }
  let logoBytes: ArrayBuffer | undefined;
  try { const response = await runtime.ASSETS.fetch(new Request('https://assets.local/sablen-logo.png')); if (response.ok) logoBytes = await response.arrayBuffer(); } catch {}
  if (!logoBytes) throw new Error('Sablens logo kunne ikke hentes. Ingen PDF er ændret.');
  const bytes = await buildInvoicePdf(order, logoBytes);
  const invoiceNumber = order.name.replace(/^#/, '').replace(/[^a-zA-Z0-9_-]/g, '-');
  await runtime.INVOICES.put(keyFor(order.id), bytes, { httpMetadata: { contentType: 'application/pdf', contentDisposition: `inline; filename="${invoiceNumber}.pdf"` }, customMetadata: { expiresAt } });
  await db.prepare(`INSERT INTO integration_records (id, tenant, record_type, external_id, occurred_at, amount_minor, currency, booking_status, payload_json, expires_at) VALUES (?, ?, 'invoice', ?, ?, ?, ?, 'generated', ?, ?) ON CONFLICT(tenant, record_type, external_id) DO UPDATE SET booking_status = 'generated', payload_json = excluded.payload_json, expires_at = excluded.expires_at`).bind(`invoice:${order.id}`, tenant, order.id, order.createdAt, checked.gross, checked.currency, JSON.stringify({ order, invoiceFingerprint: fingerprint, generatedAt: new Date().toISOString(), r2Key: keyFor(order.id) }), expiresAt).run();
  return true;
}

export async function removeLegacyInvoices(db: D1Database) {
  // Retired one-off migration. Never delete issued PDFs on page load/import.
  return 0;
}

export { keyFor };
