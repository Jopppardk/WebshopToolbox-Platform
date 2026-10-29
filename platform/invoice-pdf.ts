import { invoiceDesign, type InvoiceDesign } from './invoice-design';
import { invoiceDisplayLines } from './invoice-line-order';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { invoiceTotals } from './invoice-totals';
import {
  checkInvoice,
  InvoiceCheckError,
  type InvoiceSource,
} from './order-check';

/** A credit note: the refunded lines of an invoiced order, numbered after the invoice (e.g. 2683-K1). */
export type CreditNote = {
  number: string;
  date: string;
  invoiceNumber: string;
  currency: string;
  lines: Array<{
    kind: string;
    title: string;
    quantity: number;
    net: number;
    tax: number;
  }>;
};
export type InvoiceIssuer = {
  name: string;
  address: string;
  cvr: string;
  contact: string;
  webshopName?: string;
  design?: InvoiceDesign;
  example?: boolean;
  locale?: 'da' | 'sv' | 'en';
  soldVia?: string;
};
// The document's texts in the market's language (Indstillinger → Markeder); Danish for the home market.
const texts = {
  da: {
    intl: 'da-DK',
    invoice: 'FAKTURA',
    invoiceNumber: 'FAKTURANUMMER',
    invoiceDate: 'FAKTURADATO',
    invoiceTo: 'FAKTURERES TIL',
    invoiceLines: 'FAKTURALINJER',
    order: 'Ordre',
    invoiceRef: 'Faktura',
    credit: 'KREDITNOTA',
    creditNumber: 'KREDITNOTANUMMER',
    creditDate: 'KREDITNOTADATO',
    creditTo: 'KREDITERES TIL',
    creditLines: 'KREDITEREDE LINJER',
    refunded: 'TILBAGEBETALT',
    credited: 'KREDITERET',
    total: 'TOTAL',
    inclVat: 'inkl. moms',
    paid: 'BETALT',
    unpaid: 'AFVENTER BETALING',
    payment: 'BETALING',
    terms: 'Betalingsbetingelser',
    due: 'Forfaldsdato',
    continued: 'FORTSAT',
    page: (n: number, of: number) => `Side ${n} af ${of}`,
    prices: 'Priser er inkl. moms og efter rabatter',
    description: 'Beskrivelse',
    quantity: 'Antal',
    unitPrice: 'Stk. pris',
    amount: 'Beløb',
    vat: (rate: string) => `Heraf moms (${rate} %)`,
  },
  sv: {
    intl: 'sv-SE',
    invoice: 'FAKTURA',
    invoiceNumber: 'FAKTURANUMMER',
    invoiceDate: 'FAKTURADATUM',
    invoiceTo: 'FAKTURERAS TILL',
    invoiceLines: 'FAKTURARADER',
    order: 'Order',
    invoiceRef: 'Faktura',
    credit: 'KREDITFAKTURA',
    creditNumber: 'KREDITFAKTURANUMMER',
    creditDate: 'KREDITFAKTURADATUM',
    creditTo: 'KREDITERAS TILL',
    creditLines: 'KREDITERADE RADER',
    refunded: 'ÅTERBETALD',
    credited: 'KREDITERAT',
    total: 'TOTALT',
    inclVat: 'inkl. moms',
    paid: 'BETALD',
    unpaid: 'INVÄNTAR BETALNING',
    payment: 'BETALNING',
    terms: 'Betalningsvillkor',
    due: 'Förfallodatum',
    continued: 'FORTSÄTTNING',
    page: (n: number, of: number) => `Sida ${n} av ${of}`,
    prices: 'Priser inkl. moms och efter rabatter',
    description: 'Beskrivning',
    quantity: 'Antal',
    unitPrice: 'Á-pris',
    amount: 'Belopp',
    vat: (rate: string) => `Varav moms (${rate} %)`,
  },
  en: {
    intl: 'en-GB',
    invoice: 'INVOICE',
    invoiceNumber: 'INVOICE NUMBER',
    invoiceDate: 'INVOICE DATE',
    invoiceTo: 'BILL TO',
    invoiceLines: 'INVOICE LINES',
    order: 'Order',
    invoiceRef: 'Invoice',
    credit: 'CREDIT NOTE',
    creditNumber: 'CREDIT NOTE NO.',
    creditDate: 'CREDIT NOTE DATE',
    creditTo: 'CREDITED TO',
    creditLines: 'CREDITED LINES',
    refunded: 'REFUNDED',
    credited: 'CREDITED',
    total: 'TOTAL',
    inclVat: 'incl. VAT',
    paid: 'PAID',
    unpaid: 'AWAITING PAYMENT',
    payment: 'PAYMENT',
    terms: 'Payment terms',
    due: 'Due date',
    continued: 'CONTINUED',
    page: (n: number, of: number) => `Page ${n} of ${of}`,
    prices: 'Prices incl. VAT and after discounts',
    description: 'Description',
    quantity: 'Qty',
    unitPrice: 'Unit price',
    amount: 'Amount',
    vat: (rate: string) => `Incl. VAT (${rate} %)`,
  },
};

// The one VAT rate of an invoice line, from Shopify's tax lines. A line of 0 kr. without tax lines (e.g. free
// shipping) is 0 %. Otherwise the invoice stops, saying which line and why: no VAT at all usually means Shopify
// does not charge VAT for the customer's country, which has to be set up in Shopify.
export function lineRate(line: {
  title: string;
  net: number;
  tax: number;
  rates: number[];
}) {
  const rates = [
    ...new Set(line.rates.filter((rate) => Number.isFinite(rate) && rate >= 0)),
  ];
  if (!rates.length && line.tax === 0 && line.net === 0) return 0;
  if (rates.length === 1) return rates[0];
  throw new InvoiceCheckError(
    rates.length
      ? `“${line.title}” har flere momssatser (${rates.map((r) => Math.round(r * 100) + ' %').join(', ')}). Ingen PDF gemmes.`
      : `“${line.title}” har ingen moms i Shopify. Kontrollér, at Shopify opkræver moms for kundens land (Indstillinger → Moms og afgifter i Shopify). Ingen PDF gemmes.`,
  );
}

export async function buildInvoicePdf(
  order: InvoiceSource,
  issuer: InvoiceIssuer,
  logoBytes?: ArrayBuffer | Uint8Array,
  credit?: CreditNote,
) {
  const invoiceChecked = checkInvoice(order),
    design = invoiceDesign(issuer.design),
    t = texts[issuer.locale || 'da'];
  const money = (value: number) =>
    new Intl.NumberFormat(t.intl, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(value);
  // A credit note uses the invoice's customer and layout with the refunded lines (25 % or no VAT).
  const checked = credit
    ? {
        ...invoiceChecked,
        date: credit.date,
        lines: credit.lines.map((l, i) => ({
          id: 'credit-' + i,
          title: l.title,
          quantity: l.quantity,
          kind: (l.kind === 'goods'
            ? 'goods'
            : l.kind === 'shipping'
              ? 'shipping'
              : 'unclassified') as 'goods' | 'shipping' | 'unclassified',
          net: l.net,
          tax: l.tax,
          gross: l.net + l.tax,
          discount: 0,
          rates: [l.tax ? 0.25 : 0],
          channelLiable: false,
        })),
      }
    : invoiceChecked;
  const documentNumber = credit ? credit.number : order.name.replace(/^#/, '');
  const label = credit
    ? {
        title: t.credit,
        number: t.creditNumber,
        date: t.creditDate,
        to: t.creditTo,
        lines: t.creditLines,
        reference: `${t.invoiceRef} ${credit.invoiceNumber} · ${t.order} ${order.name}`,
        status: t.refunded,
        total: t.credited,
      }
    : {
        title: t.invoice,
        number: t.invoiceNumber,
        date: t.invoiceDate,
        to: t.invoiceTo,
        lines: t.invoiceLines,
        reference: `${t.order} ${order.name}`,
        status: '',
        total: t.total,
      };
  // An order from another market says which store it was sold from, e.g. "Order #2690 · Sabeln.se".
  // (added below once the font is known; left out if it does not fit the box)
  const pdf = await PDFDocument.create();
  if (issuer.example) {
    pdf.setCreationDate(new Date('2026-09-04T09:00:00Z'));
    pdf.setModificationDate(new Date('2026-09-04T09:00:00Z'));
  }
  const classic = design.layout === 'classic';
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  if (
    issuer.soldVia &&
    regular.widthOfTextAtSize(label.reference + ' · ' + issuer.soldVia, 8) <=
      165
  )
    label.reference += ' · ' + issuer.soldVia;
  if (regular.widthOfTextAtSize(label.reference, 8) > 165)
    throw new InvoiceCheckError(
      'Fakturanummeret er for langt til PDF-layoutet.',
    );
  if (
    bold.widthOfTextAtSize(issuer.name, 7.5) +
      regular.widthOfTextAtSize(issuer.contact, 7.5) >
      465 ||
    regular.widthOfTextAtSize(issuer.address + ' / CVR ' + issuer.cvr, 7.5) >
      487
  )
    throw new InvoiceCheckError(
      'Fakturaoplysningerne er for lange til sidefoden.',
    );
  if (bold.widthOfTextAtSize(`Fakturanr. ${documentNumber}`, 10) > 155)
    throw new InvoiceCheckError(
      'Fakturanummeret er for langt til PDF-layoutet.',
    );
  let logo: Awaited<ReturnType<typeof pdf.embedPng>> | undefined;
  try {
    if (logoBytes) logo = await pdf.embedPng(logoBytes);
  } catch {
    throw new InvoiceCheckError(
      'Virksomhedens logo kunne ikke indlæses i PDF’en.',
    );
  }
  const currency = credit
    ? credit.currency
    : order.currentTotalPriceSet.shopMoney.currencyCode;
  const address = order.billingAddress || order.shippingAddress || {};
  const factor =
    10 **
    new Intl.NumberFormat('en', {
      style: 'currency',
      currency,
    }).resolvedOptions().maximumFractionDigits!;
  const total = credit
    ? checked.lines.reduce((sum, l) => sum + l.gross, 0) / factor
    : invoiceTotals(
        order.currentTotalPriceSet.shopMoney.amount,
        order.currentTotalTaxSet?.shopMoney.amount,
        currency,
      ).total;
  const wrap = (value: string, width: number, size: number) => {
    const lines: string[] = [];
    let line = '';
    for (const word of value.trim().split(/\s+/)) {
      if (line && regular.widthOfTextAtSize(`${line} ${word}`, size) > width) {
        lines.push(line);
        line = '';
      }
      if (regular.widthOfTextAtSize(word, size) > width) {
        for (const character of word) {
          if (regular.widthOfTextAtSize(line + character, size) > width) {
            lines.push(line);
            line = '';
          }
          line += character;
        }
      } else line = line ? `${line} ${word}` : word;
    }
    if (line.trim()) lines.push(line.trim());
    return lines;
  };
  const rows = invoiceDisplayLines(checked.lines).map((line) => {
    const rates = [lineRate(line)];
    const indent = /indgravering/i.test(line.title) ? 12 : 0;
    return {
      indent,
      title: wrap(line.title, 255 - indent, 9),
      quantity: line.quantity,
      total: line.gross / factor,
      rate: rates[0],
    };
  });
  const vatGroups = [
    ...checked.lines
      .reduce((groups, line) => {
        const key = lineRate(line);
        const current = groups.get(key) || { rate: key, net: 0, tax: 0 };
        current.net += line.net;
        current.tax += line.tax;
        groups.set(key, current);
        return groups;
      }, new Map<number, { rate: number; net: number; tax: number }>())
      .values(),
  ].sort((a, b) => b.rate - a.rate);
  if (!vatGroups.length || vatGroups.length > 4)
    throw new InvoiceCheckError(
      'Momsopgørelsen kan ikke vises entydigt på fakturaen. Ingen PDF gemmes.',
    );
  const maxRowsHeight = Math.min(
    290,
    527 - (70 + 62 + vatGroups.length * 18) - 20,
  );
  const chunks: (typeof rows)[] = [];
  let chunk: typeof rows = [],
    height = 0;
  for (const row of rows) {
    const rowHeight = Math.max(24, row.title.length * 13 + 10);
    if (rowHeight > maxRowsHeight)
      throw new InvoiceCheckError(
        'En varebeskrivelse er for lang til PDF-layoutet. Ingen PDF gemmes.',
      );
    if (height + rowHeight > maxRowsHeight) {
      chunks.push(chunk);
      chunk = [];
      height = 0;
    }
    chunk.push(row);
    height += rowHeight;
  }
  if (chunk.length) chunks.push(chunk);
  // A business customer's company name heads the address (only when one is entered), the contact person follows.
  const company = checked.customer.company?.trim();
  const customerLines = [
    company,
    company?.toLowerCase() === checked.customer.name.toLowerCase()
      ? undefined
      : checked.customer.name,
    address.address1,
    address.address2,
    [address.zip, address.city].filter(Boolean).join(' '),
    address.country,
  ]
    .filter(Boolean)
    .flatMap((value) => wrap(String(value), 285, 10));
  if (customerLines.length > 7)
    throw new InvoiceCheckError(
      'Kundeadressen er for lang til PDF-layoutet. Ingen PDF gemmes.',
    );
  const black = rgb(0.09, 0.09, 0.095),
    gold = classic
      ? rgb(0.35, 0.35, 0.35)
      : rgb(
          parseInt(design.accent.slice(1, 3), 16) / 255,
          parseInt(design.accent.slice(3, 5), 16) / 255,
          parseInt(design.accent.slice(5, 7), 16) / 255,
        ),
    softGold = rgb(0.96, 0.96, 0.96),
    ink = rgb(0.13, 0.13, 0.14),
    muted = rgb(0.4, 0.42, 0.46),
    line = rgb(0.86, 0.84, 0.8),
    paper = rgb(0.985, 0.982, 0.972);
  const invoiceDate = new Intl.DateTimeFormat(t.intl, {
    timeZone: 'Europe/Copenhagen',
  }).format(new Date(checked.date));
  const paid = !!credit || order.displayFinancialStatus === 'PAID';
  // An unpaid order on payment terms (B2B invoice) says when and where to pay, left of the totals on the last page.
  const terms = !paid && order.paymentTerms ? order.paymentTerms : null;
  const paymentLines = terms
    ? [
        ...(terms.name
          ? [{ text: `${t.terms}: ${terms.name}`, font: regular }]
          : []),
        ...(terms.dueAt
          ? [
              {
                text: `${t.due}: ${new Intl.DateTimeFormat(t.intl, { timeZone: 'Europe/Copenhagen' }).format(new Date(terms.dueAt))}`,
                font: bold,
              },
            ]
          : []),
        ...wrap(design.payment, 210, 8.5).map((text) => ({
          text,
          font: regular,
        })),
      ]
    : [];
  if (
    paymentLines.length > 4 ||
    paymentLines.some((l) => l.font.widthOfTextAtSize(l.text, 8.5) > 215)
  )
    throw new InvoiceCheckError(
      'Betalingsoplysningerne er for lange til PDF-layoutet.',
    );
  chunks.forEach((pageRows, pageIndex) => {
    const page = pdf.addPage([595.28, 841.89]);
    if (!classic)
      page.drawLine({
        start: { x: 54, y: 806 },
        end: { x: 541, y: 806 },
        thickness: 2,
        color: gold,
      });
    if (logo) {
      const scale = Math.min(142 / logo.width, 44 / logo.height);
      page.drawImage(logo, {
        x: 54,
        y: 742,
        width: logo.width * scale,
        height: logo.height * scale,
      });
    }
    if (!logo) {
      const title = wrap(issuer.name, 285, 14);
      if (title.length > 2)
        throw new InvoiceCheckError('Virksomhedsnavnet er for langt.');
      title.forEach((t, i) =>
        page.drawText(t, {
          x: 54,
          y: 779 - i * 17,
          size: 14,
          font: bold,
          color: ink,
        }),
      );
      const shop = wrap(issuer.webshopName || '', 285, 10);
      if (shop.length > 2)
        throw new InvoiceCheckError('Webshopnavnet er for langt.');
      shop.forEach((t, i) =>
        page.drawText(t, {
          x: 54,
          y: 742 - i * 12,
          size: 10,
          font: regular,
          color: muted,
        }),
      );
    }
    if (issuer.example)
      page.drawText('EKSEMPEL - IKKE EN GYLDIG FAKTURA', {
        x: 54,
        y: 816,
        size: 8,
        font: bold,
        color: muted,
      });
    const pageTitle = pageIndex
        ? label.title + ' - ' + t.continued
        : label.title,
      titleSize = classic ? 14 : 18;
    page.drawText(pageTitle, {
      x: 541 - bold.widthOfTextAtSize(pageTitle, titleSize),
      y: 770,
      size: titleSize,
      font: bold,
      color: black,
    });
    page.drawText(t.page(pageIndex + 1, chunks.length), {
      x:
        541 -
        regular.widthOfTextAtSize(t.page(pageIndex + 1, chunks.length), 7),
      y: 816,
      size: 7,
      font: regular,
      color: muted,
    });
    page.drawLine({
      start: { x: 54, y: 721 },
      end: { x: 541, y: 721 },
      thickness: 0.7,
      color: line,
    });

    if (!pageIndex) {
      page.drawText(label.to, {
        x: 54,
        y: 667,
        size: 7.5,
        font: bold,
        color: gold,
      });
      customerLines.forEach((text, i) =>
        page.drawText(text, {
          x: 54,
          y: 647 - i * 13,
          size: i ? 9 : 11,
          font: i ? regular : bold,
          color: ink,
        }),
      );
      if (!classic)
        page.drawRectangle({
          x: 356,
          y: 589,
          width: 185,
          height: 80,
          color: paper,
          borderColor: line,
          borderWidth: 0.7,
        });
      page.drawText(label.number, {
        x: 372,
        y: 649,
        size: 7,
        font: bold,
        color: muted,
      });
      page.drawText(documentNumber, {
        x: 372,
        y: 633,
        size: 10,
        font: bold,
        color: ink,
      });
      page.drawText(label.date, {
        x: 372,
        y: 617,
        size: 7,
        font: bold,
        color: muted,
      });
      page.drawText(invoiceDate, {
        x: 455,
        y: 617,
        size: 9,
        font: regular,
        color: ink,
      });
      page.drawText(label.reference, {
        x: 372,
        y: 601,
        size: 8,
        font: regular,
        color: muted,
      });
      if (!classic)
        page.drawRectangle({
          x: 443,
          y: 678,
          width: 98,
          height: 23,
          color: paid ? softGold : rgb(0.96, 0.92, 0.84),
          borderColor: gold,
          borderWidth: 0.5,
        });
      const status = label.status || (paid ? t.paid : t.unpaid);
      page.drawText(status, {
        x: 492 - bold.widthOfTextAtSize(status, 8) / 2,
        y: 686,
        size: 8,
        font: bold,
        color: black,
      });
    }
    page.drawText(label.lines, {
      x: 54,
      y: 583,
      size: 8,
      font: bold,
      color: gold,
    });
    page.drawText(t.prices, {
      x: 352,
      y: 583,
      size: 7.5,
      font: regular,
      color: muted,
    });
    if (classic)
      page.drawLine({
        start: { x: 54, y: 552 },
        end: { x: 541, y: 552 },
        thickness: 0.5,
        color: line,
      });
    else
      page.drawRectangle({
        x: 54,
        y: 552,
        width: 487,
        height: 24,
        color: softGold,
        borderColor: line,
        borderWidth: 0.5,
      });
    page.drawText(t.description, {
      x: 66,
      y: 560,
      size: 8,
      font: bold,
      color: ink,
    });
    page.drawText(t.quantity, {
      x: 378,
      y: 560,
      size: 8,
      font: bold,
      color: ink,
    });
    page.drawText(t.unitPrice, {
      x: 431,
      y: 560,
      size: 8,
      font: bold,
      color: ink,
    });
    page.drawText(t.amount, {
      x: 507,
      y: 560,
      size: 8,
      font: bold,
      color: ink,
    });
    const amount = (
      value: number,
      right: number,
      y: number,
      size = 9,
      font = regular,
    ) => {
      const text = money(value);
      if (font.widthOfTextAtSize(text, size) > (size === 9 ? 60 : 95))
        throw new InvoiceCheckError('Beløbet er for bredt til PDF-layoutet.');
      page.drawText(text, {
        x: right - font.widthOfTextAtSize(text, size),
        y,
        size,
        font,
      });
    };
    let y = 527;
    pageRows.forEach((row) => {
      if (regular.widthOfTextAtSize(String(row.quantity), 9) > 30)
        throw new InvoiceCheckError('Antallet er for bredt til PDF-layoutet.');
      row.title.forEach((title, index) =>
        page.drawText(title, {
          x: 66 + row.indent,
          y: y - index * 13,
          size: 9,
          font: regular,
          color: ink,
        }),
      );
      page.drawText(String(row.quantity), {
        x: 382,
        y,
        size: 9,
        font: regular,
      });
      amount(row.total / row.quantity, 475, y);
      amount(row.total, 540, y);
      y -= Math.max(24, row.title.length * 13 + 10);
    });
    if (pageIndex === chunks.length - 1) {
      const boxHeight = 62 + vatGroups.length * 18,
        boxTop = 70 + boxHeight;
      if (!classic)
        page.drawRectangle({
          x: 281,
          y: 70,
          width: 260,
          height: boxHeight,
          color: paper,
          borderColor: line,
          borderWidth: 0.5,
        });
      let summaryY = boxTop - 25;
      vatGroups.forEach((group) => {
        const rate = new Intl.NumberFormat(t.intl, {
          maximumFractionDigits: 2,
        }).format(group.rate * 100);
        page.drawText(t.vat(rate), {
          x: 299,
          y: summaryY,
          size: 9,
          font: regular,
          color: muted,
        });
        amount(group.tax / factor, 523, summaryY, 9);
        summaryY -= 18;
      });
      page.drawLine({
        start: { x: 299, y: 111 },
        end: { x: 523, y: 111 },
        thickness: 0.7,
        color: line,
      });
      page.drawText(`${label.total} ${currency} ${t.inclVat}`, {
        x: 299,
        y: 91,
        size: 10,
        font: bold,
        color: black,
      });
      amount(total, 523, 89, 13, bold);
      if (paymentLines.length) {
        page.drawText(t.payment, {
          x: 54,
          y: 130,
          size: 7.5,
          font: bold,
          color: gold,
        });
        paymentLines.forEach((l, i) =>
          page.drawText(l.text, {
            x: 54,
            y: 114 - i * 12,
            size: 8.5,
            font: l.font,
            color: ink,
          }),
        );
      }
      if (!classic)
        page.drawRectangle({
          x: 281,
          y: 70,
          width: 4,
          height: boxHeight,
          color: gold,
        });
    }
    page.drawLine({
      start: { x: 54, y: 43 },
      end: { x: 541, y: 43 },
      thickness: 0.7,
      color: gold,
    });
    if (design.footer) {
      const lines = wrap(design.footer, 487, 8);
      if (lines.length > 2)
        throw new InvoiceCheckError('Bundteksten er for lang til layoutet.');
      lines.forEach((t, i) =>
        page.drawText(t, {
          x: 54,
          y: 62 - i * 10,
          size: 8,
          font: regular,
          color: muted,
        }),
      );
    }
    page.drawText(issuer.name, {
      x: 54,
      y: 26,
      size: 7.5,
      font: bold,
      color: ink,
    });
    page.drawText(issuer.address + ' / CVR ' + issuer.cvr, {
      x: 54,
      y: 15,
      size: 7.5,
      font: regular,
      color: muted,
    });
    page.drawText(issuer.contact, {
      x: 541 - regular.widthOfTextAtSize(issuer.contact, 7.5),
      y: 26,
      size: 7.5,
      font: regular,
      color: muted,
    });
  });
  return pdf.save();
}
