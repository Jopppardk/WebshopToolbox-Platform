import {invoiceDesign,type InvoiceDesign} from './invoice-design';
import { invoiceDisplayLines } from './invoice-line-order';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { invoiceTotals } from '../lib/invoice-totals';
import { checkInvoice, InvoiceCheckError, type InvoiceSource } from './order-check';


export type InvoiceIssuer={name:string;address:string;cvr:string;contact:string;webshopName?:string;design?:InvoiceDesign;example?:boolean};
const money = (value: number) => new Intl.NumberFormat('da-DK', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);


export async function buildInvoicePdf(order: InvoiceSource, issuer:InvoiceIssuer, logoBytes?: ArrayBuffer | Uint8Array) {
  const checked = checkInvoice(order),design=invoiceDesign(issuer.design);
  const pdf = await PDFDocument.create();
  if(issuer.example){pdf.setCreationDate(new Date('2026-09-04T09:00:00Z'));pdf.setModificationDate(new Date('2026-09-04T09:00:00Z'));}
  const classic=design.layout==='classic';
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  if(bold.widthOfTextAtSize(issuer.name,7.5)+regular.widthOfTextAtSize(issuer.contact,7.5)>465 || regular.widthOfTextAtSize(issuer.address+' / CVR '+issuer.cvr,7.5)>487)throw new InvoiceCheckError('Fakturaoplysningerne er for lange til sidefoden.');
  if (bold.widthOfTextAtSize(`Fakturanr. ${order.name}`, 10) > 155) throw new InvoiceCheckError('Fakturanummeret er for langt til PDF-layoutet.');
  let logo: Awaited<ReturnType<typeof pdf.embedPng>> | undefined;
  try { if (logoBytes) logo = await pdf.embedPng(logoBytes); } catch { throw new InvoiceCheckError('Virksomhedens logo kunne ikke indlæses i PDF’en.'); }
  const { total } = invoiceTotals(order.currentTotalPriceSet.shopMoney.amount, order.currentTotalTaxSet?.shopMoney.amount, order.currentTotalPriceSet.shopMoney.currencyCode);
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
  const rows = invoiceDisplayLines(checked.lines).map(line => {
    const rates = [...new Set(line.rates.filter(rate => Number.isFinite(rate) && rate >= 0))];
    if (rates.length !== 1) throw new InvoiceCheckError('En fakturalinje mangler en entydig momssats. Ingen PDF gemmes.');
    const indent = /indgravering/i.test(line.title) ? 12 : 0;
    return { indent, title: wrap(line.title, 255-indent, 9), quantity: line.quantity, total: line.gross / factor, rate: rates[0] };
  });
  const vatGroups = [...checked.lines.reduce((groups, line) => {
    const rates = [...new Set(line.rates.filter(rate => Number.isFinite(rate) && rate >= 0))];
    if (rates.length !== 1) throw new InvoiceCheckError('En fakturalinje mangler en entydig momssats. Ingen PDF gemmes.');
    const key = rates[0]; const current = groups.get(key) || { rate: key, net: 0, tax: 0 };
    current.net += line.net; current.tax += line.tax; groups.set(key, current); return groups;
  }, new Map<number, { rate: number; net: number; tax: number }>()).values()].sort((a, b) => b.rate - a.rate);
  if (!vatGroups.length || vatGroups.length > 4) throw new InvoiceCheckError('Momsopgørelsen kan ikke vises entydigt på fakturaen. Ingen PDF gemmes.');
  const maxRowsHeight=Math.min(290,527-(70+62+vatGroups.length*18)-20);
  const chunks: typeof rows[] = []; let chunk: typeof rows = [], height = 0;
  for (const row of rows) {
    const rowHeight = Math.max(24, row.title.length * 13 + 10);
    if (rowHeight > maxRowsHeight) throw new InvoiceCheckError('En varebeskrivelse er for lang til PDF-layoutet. Ingen PDF gemmes.');
    if (height + rowHeight > maxRowsHeight) { chunks.push(chunk); chunk = []; height = 0; }
    chunk.push(row); height += rowHeight;
  }
  if (chunk.length) chunks.push(chunk);
  const customerLines = [checked.customer.name, address.address1, address.address2, [address.zip, address.city].filter(Boolean).join(' '), address.country].filter(Boolean).flatMap(value => wrap(String(value), 285, 10));
  if (customerLines.length > 7) throw new InvoiceCheckError('Kundeadressen er for lang til PDF-layoutet. Ingen PDF gemmes.');
  const black = rgb(.09, .09, .095), gold = classic?rgb(.35,.35,.35):rgb(parseInt(design.accent.slice(1,3),16)/255,parseInt(design.accent.slice(3,5),16)/255,parseInt(design.accent.slice(5,7),16)/255), softGold = rgb(.96,.96,.96), ink = rgb(.13, .13, .14), muted = rgb(.40, .42, .46), line = rgb(.86, .84, .80), paper = rgb(.985, .982, .972);
  const invoiceDate = new Intl.DateTimeFormat('da-DK', { timeZone: 'Europe/Copenhagen' }).format(new Date(checked.date));
  const paid = order.displayFinancialStatus === 'PAID';
  chunks.forEach((pageRows, pageIndex) => {
    const page = pdf.addPage([595.28, 841.89]);
    const { width } = page.getSize();
    if(!classic)page.drawLine({ start: { x: 54, y: 806 }, end: { x: 541, y: 806 }, thickness: 2, color: gold });
    if (logo) { const scale = Math.min(142 / logo.width, 44 / logo.height); page.drawImage(logo, { x: 54, y: 742, width: logo.width * scale, height: logo.height * scale }); }
    if(!logo){const title=wrap(issuer.name,285,14);if(title.length>2)throw new InvoiceCheckError('Virksomhedsnavnet er for langt.');title.forEach((t,i)=>page.drawText(t,{x:54,y:779-i*17,size:14,font:bold,color:ink}));
     const shop=wrap(issuer.webshopName||'',285,10);if(shop.length>2)throw new InvoiceCheckError('Webshopnavnet er for langt.');shop.forEach((t,i)=>page.drawText(t,{x:54,y:742-i*12,size:10,font:regular,color:muted}));}
    if(issuer.example)page.drawText('EKSEMPEL - IKKE EN GYLDIG FAKTURA',{x:54,y:816,size:8,font:bold,color:muted});
    const pageTitle=pageIndex ? 'FAKTURA - FORTSAT' : 'FAKTURA',titleSize=classic?14:18;
    page.drawText(pageTitle, { x: 541-bold.widthOfTextAtSize(pageTitle,titleSize), y: 770, size: titleSize, font: bold, color: black });
    page.drawText(`Side ${pageIndex + 1} af ${chunks.length}`, { x: 541 - regular.widthOfTextAtSize(`Side ${pageIndex + 1} af ${chunks.length}`, 7), y: 816, size: 7, font: regular, color: muted });
    page.drawLine({ start: { x: 54, y: 721 }, end: { x: 541, y: 721 }, thickness: .7, color: line });

    if (!pageIndex) {
      page.drawText('FAKTURERES TIL', { x: 54, y: 667, size: 7.5, font: bold, color: gold });
      customerLines.forEach((text, i) => page.drawText(text, { x: 54, y: 647 - i * 13, size: i ? 9 : 11, font: i ? regular : bold, color: ink }));
      if(!classic)page.drawRectangle({ x: 356, y: 589, width: 185, height: 80, color: paper, borderColor: line, borderWidth: .7 });
      page.drawText('FAKTURANUMMER', { x: 372, y: 649, size: 7, font: bold, color: muted });
      page.drawText(order.name.replace(/^#/, ''), { x: 372, y: 633, size: 10, font: bold, color: ink });
      page.drawText('FAKTURADATO', { x: 372, y: 617, size: 7, font: bold, color: muted });
      page.drawText(invoiceDate, { x: 455, y: 617, size: 9, font: regular, color: ink });
      page.drawText(`Ordre ${order.name}`, { x: 372, y: 601, size: 8, font: regular, color: muted });
      if(!classic)page.drawRectangle({ x: 443, y: 678, width: 98, height: 23, color: paid ? softGold : rgb(.96, .92, .84), borderColor: gold, borderWidth: .5 });
      const status = paid ? 'BETALT' : 'AFVENTER BETALING';
      page.drawText(status, { x: 492 - bold.widthOfTextAtSize(status, 8) / 2, y: 686, size: 8, font: bold, color: black });
    }
    page.drawText('FAKTURALINJER', { x: 54, y: 583, size: 8, font: bold, color: gold });
    page.drawText('Priser er inkl. moms og efter rabatter', { x: 352, y: 583, size: 7.5, font: regular, color: muted });
    if(classic)page.drawLine({start:{x:54,y:552},end:{x:541,y:552},thickness:.5,color:line});
    else page.drawRectangle({ x: 54, y: 552, width: 487, height: 24, color: softGold, borderColor: line, borderWidth: .5 });
    page.drawText('Beskrivelse', { x: 66, y: 560, size: 8, font: bold, color: ink }); page.drawText('Antal', { x: 378, y: 560, size: 8, font: bold, color: ink }); page.drawText('Stk. pris', { x: 431, y: 560, size: 8, font: bold, color: ink }); page.drawText('Beløb', { x: 507, y: 560, size: 8, font: bold, color: ink });
    const amount = (value: number, right: number, y: number, size = 9, font = regular) => { const text = money(value); if (font.widthOfTextAtSize(text, size) > (size === 9 ? 60 : 95)) throw new InvoiceCheckError('Beløbet er for bredt til PDF-layoutet.'); page.drawText(text, { x: right - font.widthOfTextAtSize(text, size), y, size, font }); };
    let y = 527;
    pageRows.forEach(row => {
      if (regular.widthOfTextAtSize(String(row.quantity), 9) > 30) throw new InvoiceCheckError('Antallet er for bredt til PDF-layoutet.');
      row.title.forEach((title, index) => page.drawText(title, { x: 66 + row.indent, y: y - index * 13, size: 9, font: regular, color: ink }));
      page.drawText(String(row.quantity), { x: 382, y, size: 9, font: regular }); amount(row.total / row.quantity, 475, y); amount(row.total, 540, y);
      y -= Math.max(24, row.title.length * 13 + 10);
    });
    if (pageIndex === chunks.length - 1) {
      const boxHeight = 62 + vatGroups.length * 18, boxTop = 70 + boxHeight;
      if(!classic)page.drawRectangle({ x: 281, y: 70, width: 260, height: boxHeight, color: paper, borderColor: line, borderWidth: .5 });
      let summaryY = boxTop - 25;
      vatGroups.forEach(group => {
        const rate = new Intl.NumberFormat('da-DK', { maximumFractionDigits: 2 }).format(group.rate * 100);
        page.drawText(`Heraf moms (${rate} %)`, { x: 299, y: summaryY, size: 9, font: regular, color: muted }); amount(group.tax / factor, 523, summaryY, 9);
        summaryY -= 18;
      });
      page.drawLine({ start: { x: 299, y: 111 }, end: { x: 523, y: 111 }, thickness: .7, color: line });
      page.drawText(`TOTAL ${currency} inkl. moms`, { x: 299, y: 91, size: 10, font: bold, color: black }); amount(total, 523, 89, 13, bold);
      if(!classic)page.drawRectangle({ x: 281, y: 70, width: 4, height: boxHeight, color: gold });
    }
    page.drawLine({ start: { x: 54, y: 43 }, end: { x: 541, y: 43 }, thickness: .7, color: gold });
    if(design.footer){const lines=wrap(design.footer,487,8);if(lines.length>2)throw new InvoiceCheckError('Bundteksten er for lang til layoutet.');lines.forEach((t,i)=>page.drawText(t,{x:54,y:62-i*10,size:8,font:regular,color:muted}));}
    page.drawText(issuer.name, { x: 54, y: 26, size: 7.5, font: bold, color: ink });
    page.drawText(issuer.address+' / CVR '+issuer.cvr, { x: 54, y: 15, size: 7.5, font: regular, color: muted });
    page.drawText(issuer.contact, { x: 541-regular.widthOfTextAtSize(issuer.contact,7.5), y: 26, size: 7.5, font: regular, color: muted });
  });
  return pdf.save();
}
