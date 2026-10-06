import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

import { payoutBreakdown, type PayoutSummary } from './payout-calculations';
import type { PayoutTransaction } from './payout-source';
import { minorUnits } from './money';

type PayoutSource = {
  id: string;
  issuedAt: string;
  status: string;
  transactionType: string;
  provider: string;
  net: { amount: string; currencyCode: string };
  summary: PayoutSummary;
  transactions?: PayoutTransaction[];
  reportVersion?: number;
  reportKey?: string;
  reportFingerprint?: string;
  reportEtag?: string;
};
const safeId = (id: string) =>
  id
    .split('/')
    .pop()
    ?.replace(/[^a-zA-Z0-9_-]/g, '-') || 'udbetaling';
const money = (minor: number, currency: string) =>
  new Intl.NumberFormat('da-DK', { style: 'currency', currency }).format(
    minor /
      10 **
        new Intl.NumberFormat('en', {
          style: 'currency',
          currency,
        }).resolvedOptions().maximumFractionDigits!,
  );

export async function buildPayoutReport(
  source: PayoutSource,
  issuer: string,
  logoBytes?: ArrayBuffer,
) {
  if (
    source.provider !== 'shopify_payments' ||
    source.status !== 'PAID' ||
    source.transactionType !== 'DEPOSIT'
  )
    throw new Error(
      'Kun gennemførte Shopify Payments-udbetalinger kan danne en rapport.',
    );
  if (!Number.isFinite(Date.parse(source.issuedAt)))
    throw new Error('Udbetalingen mangler en gyldig dato.');
  const breakdown = payoutBreakdown(source.summary, source.net);
  if (!Array.isArray(source.transactions) || !source.transactions.length)
    throw new Error('Udbetalingen mangler de konkrete Shopify-transaktioner.');
  const pdf = await PDFDocument.create(),
    regular = await pdf.embedFont(StandardFonts.Helvetica),
    bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const page = pdf.addPage([595.28, 841.89]);
  let logo: Awaited<ReturnType<typeof pdf.embedPng>> | undefined;
  if (logoBytes) {
    try {
      logo = await pdf.embedPng(logoBytes);
    } catch {
      throw new Error(
        'Virksomhedens logo kunne ikke indlæses i udbetalingsrapporten.',
      );
    }
  }
  if (logo) {
    const scale = Math.min(145 / logo.width, 50 / logo.height);
    page.drawImage(logo, {
      x: 540 - logo.width * scale,
      y: 752,
      width: logo.width * scale,
      height: logo.height * scale,
    });
  }
  page.drawText('Udbetalingsrapport', {
    x: 55,
    y: 750,
    size: 23,
    font: bold,
    color: rgb(0.1, 0.14, 0.12),
  });
  page.drawText('Shopify Payments', { x: 55, y: 724, size: 11, font: regular });
  const id = safeId(source.id);
  const date = new Intl.DateTimeFormat('da-DK', {
    dateStyle: 'long',
    timeZone: 'Europe/Copenhagen',
  }).format(new Date(source.issuedAt));
  page.drawText(`Udbetalings-ID: ${id}`, {
    x: 55,
    y: 680,
    size: 10,
    font: regular,
  });
  page.drawText(`Udbetalingsdato: ${date}`, {
    x: 55,
    y: 662,
    size: 10,
    font: regular,
  });
  page.drawText('Status: Udbetalt', { x: 55, y: 644, size: 10, font: regular });
  page.drawLine({
    start: { x: 55, y: 620 },
    end: { x: 540, y: 620 },
    thickness: 1.4,
    color: rgb(0.14, 0.17, 0.22),
  });
  page.drawText('Afregning', { x: 55, y: 594, size: 12, font: bold });
  const rows = [
    ['Bruttobetalinger', breakdown.charges],
    ['Refunderinger', breakdown.refunds],
    ['Gebyrer', -breakdown.fees],
    ['Netto udbetalt til bank', breakdown.net],
  ] as const;
  rows.forEach(([label, amount], index) => {
    const y = 558 - index * 38;
    page.drawText(label, {
      x: 55,
      y,
      size: 10,
      font: index === rows.length - 1 ? bold : regular,
    });
    const value = money(amount, breakdown.currency),
      font = index === rows.length - 1 ? bold : regular;
    page.drawText(value, {
      x: 540 - font.widthOfTextAtSize(value, 10),
      y,
      size: 10,
      font,
    });
    page.drawLine({
      start: { x: 55, y: y - 12 },
      end: { x: 540, y: y - 12 },
      thickness: 0.5,
      color: rgb(0.82, 0.82, 0.82),
    });
  });
  page.drawText(
    'Rapporten er dannet ud fra den kontrollerede afregningsoversigt fra Shopify Payments.',
    { x: 55, y: 350, size: 9, font: regular, color: rgb(0.35, 0.38, 0.42) },
  );
  page.drawText(
    'Specifikation af de konkrete transaktioner fremgår fra side 2.',
    { x: 55, y: 334, size: 9, font: regular, color: rgb(0.35, 0.38, 0.42) },
  );
  page.drawText(issuer.slice(0, 90), {
    x: 55,
    y: 28,
    size: 8,
    font: regular,
    color: rgb(0.35, 0.38, 0.42),
  });
  const typeLabel = (item: PayoutTransaction) =>
    ({
      CHARGE: 'Betaling',
      REFUND: 'Refundering',
      ADJUSTMENT: 'Regulering',
      CREDIT: 'Kreditering',
      DEBIT: 'Debitering',
      DISPUTE: 'Indsigelse',
    })[item.type] ||
    item.adjustmentReason ||
    item.type;
  const clip = (value: string, width: number) => {
    let result = value;
    while (result.length && regular.widthOfTextAtSize(result, 8) > width)
      result = result.slice(0, -1);
    return result === value ? result : `${result.slice(0, -3)}...`;
  };
  const drawHeader = (target: typeof page, pageNumber: number) => {
    target.drawText('Transaktionsspecifikation', {
      x: 55,
      y: 780,
      size: 17,
      font: bold,
      color: rgb(0.1, 0.14, 0.12),
    });
    target.drawText(`Shopify Payments ${id}`, {
      x: 55,
      y: 759,
      size: 9,
      font: regular,
      color: rgb(0.35, 0.38, 0.42),
    });
    const headers = [
      ['Dato', 55],
      ['Ordre', 118],
      ['Type', 205],
      ['Brutto', 350],
      ['Gebyr', 445],
      ['Netto', 540],
    ] as const;
    headers.forEach(([label, x]) =>
      target.drawText(label, {
        x:
          label === 'Brutto' || label === 'Gebyr' || label === 'Netto'
            ? x - bold.widthOfTextAtSize(label, 8)
            : x,
        y: 728,
        size: 8,
        font: bold,
      }),
    );
    target.drawLine({
      start: { x: 55, y: 718 },
      end: { x: 540, y: 718 },
      thickness: 1,
      color: rgb(0.14, 0.17, 0.22),
    });
    target.drawText(`Side ${pageNumber}`, {
      x: 500,
      y: 28,
      size: 8,
      font: regular,
      color: rgb(0.35, 0.38, 0.42),
    });
  };
  let detailPage = pdf.addPage([595.28, 841.89]),
    pageNumber = 2,
    y = 694;
  drawHeader(detailPage, pageNumber);
  for (const item of source.transactions) {
    if (y < 70) {
      detailPage = pdf.addPage([595.28, 841.89]);
      drawHeader(detailPage, ++pageNumber);
      y = 694;
    }
    const transactionDate = new Intl.DateTimeFormat('da-DK', {
      day: '2-digit',
      month: '2-digit',
      year: '2-digit',
      timeZone: 'Europe/Copenhagen',
    }).format(new Date(item.processedAt));
    const order =
      item.orderName || (item.orderId ? `ID ${item.orderId}` : 'Ingen ordre');
    detailPage.drawText(transactionDate, { x: 55, y, size: 8, font: regular });
    detailPage.drawText(clip(order, 80), { x: 118, y, size: 8, font: regular });
    detailPage.drawText(clip(typeLabel(item), 115), {
      x: 205,
      y,
      size: 8,
      font: regular,
    });
    const values = [
      money(
        minorUnits(item.amount.amount, breakdown.currency),
        breakdown.currency,
      ),
      money(
        -minorUnits(item.fee.amount, breakdown.currency),
        breakdown.currency,
      ),
      money(
        minorUnits(item.net.amount, breakdown.currency),
        breakdown.currency,
      ),
    ];
    [350, 445, 540].forEach((x, index) =>
      detailPage.drawText(values[index], {
        x: x - regular.widthOfTextAtSize(values[index], 8),
        y,
        size: 8,
        font: regular,
      }),
    );
    detailPage.drawLine({
      start: { x: 55, y: y - 9 },
      end: { x: 540, y: y - 9 },
      thickness: 0.35,
      color: rgb(0.86, 0.86, 0.86),
    });
    y -= 22;
  }
  return pdf.save();
}
