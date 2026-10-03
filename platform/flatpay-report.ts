import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
export type FlatpayReportSource = {
  payment: {
    paymentID: string;
    paidDate: string;
    currency: string;
    payoutAmount: number;
    settlements: string;
  };
  settlements: Record<string, unknown>[];
  transactions: Record<string, unknown>[];
};
export function checkFlatpayReport(source: FlatpayReportSource) {
  const { payment: p, settlements, transactions } = source;
  const cents = (v: unknown) => {
    if (
      typeof v !== 'number' ||
      !Number.isFinite(v) ||
      !Number.isSafeInteger(Math.round(v * 100))
    )
      throw Error('Rapporten indeholder et ugyldigt beløb.');
    return Math.round(v * 100);
  };
  if (
    p.currency !== 'DKK' ||
    !/^\d{1,30}$/.test(p.paymentID) ||
    !Number.isFinite(Date.parse(p.paidDate)) ||
    cents(p.payoutAmount) <= 0
  )
    throw Error('Rapporten kræver en gennemført positiv udbetaling i DKK.');
  const ids = p.settlements.split(/[,;\s]+/).filter(Boolean);
  if (
    !ids.length ||
    ids.length > 30 ||
    ids.some((id) => !/^\d{1,30}$/.test(id)) ||
    new Set(ids).size !== ids.length ||
    settlements.length !== ids.length
  )
    throw Error('Udbetalingens afregninger kunne ikke kontrolleres.');
  if (new Set(settlements.map((s) => s.settlementNumber)).size !== ids.length)
    throw Error('Afregningslisten indeholder dubletter.');
  let payout = 0;
  for (const s of settlements) {
    if (!ids.includes(String(s.settlementNumber)) || s.currency !== p.currency)
      throw Error('Afregningen tilhører ikke udbetalingen.');
    payout += cents(s.payout);
    for (const field of [
      'grossPurchase',
      'refundAmount',
      'feeAmount',
      'netSettlement',
    ])
      cents(s[field]);
    const list = transactions.filter(
        (t) => t.settlementNumber === s.settlementNumber,
      ),
      count = Number(s.transactions);
    if (!Number.isSafeInteger(count) || count < 0 || count !== list.length)
      throw Error(
        'Transaktionslisten er ufuldstændig i forhold til Flatpay-afregningen.',
      );
  }
  if (payout !== cents(p.payoutAmount))
    throw Error('Afregningerne stemmer ikke med bankudbetalingen.');
  const seen = new Set<string>();
  for (const t of transactions) {
    if (
      typeof t.transactionID !== 'string' ||
      !t.transactionID ||
      seen.has(t.transactionID) ||
      !ids.includes(String(t.settlementNumber)) ||
      t.currency !== p.currency ||
      typeof t.purchaseDate !== 'string' ||
      !Number.isFinite(Date.parse(t.purchaseDate))
    )
      throw Error(
        'Transaktionslisten indeholder ugyldige data eller dubletter.',
      );
    seen.add(t.transactionID);
    for (const k of ['grossAmount', 'fees', 'netAmount']) cents(t[k]);
  }
  return {
    gross: settlements.reduce((v, s) => v + cents(s.grossPurchase), 0),
    refunds: settlements.reduce((v, s) => v + cents(s.refundAmount), 0),
    fees: settlements.reduce((v, s) => v + cents(s.feeAmount), 0),
    net: cents(p.payoutAmount),
  };
}
export async function buildFlatpayReport(
  source: FlatpayReportSource,
  logoBytes?: ArrayBuffer,
  issuer = 'WebshopToolbox',
) {
  const totals = checkFlatpayReport(source),
    pdf = await PDFDocument.create(),
    regular = await pdf.embedFont(StandardFonts.Helvetica),
    bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const clean = (v: unknown) =>
    (typeof v === 'string' || typeof v === 'number' ? String(v) : '').replace(
      /[^\x20-\x7e\xa0-\xff]/g,
      '?',
    );
  const money = (v: number, digits = 2) =>
    new Intl.NumberFormat('da-DK', {
      minimumFractionDigits: 2,
      maximumFractionDigits: digits,
    }).format(v) + ' DKK';
  const page = () => pdf.addPage([595.28, 841.89]);
  let current = page();
  const text = (
    value: unknown,
    x: number,
    y: number,
    size = 10,
    strong = false,
  ) =>
    current.drawText(clean(value), {
      x,
      y,
      size,
      font: strong ? bold : regular,
      color: rgb(0.12, 0.16, 0.2),
    });
  const right = (value: string, x: number, y: number, size = 10) =>
    text(value, x - regular.widthOfTextAtSize(clean(value), size), y, size);
  const clip = (v: unknown, width: number) => {
    let s = clean(v);
    while (regular.widthOfTextAtSize(s, 8) > width) s = s.slice(0, -1);
    return s;
  };
  text('Udbetalingsrapport', 45, 778, 23, true);
  text('Flatpay', 45, 751, 12);
  if (logoBytes) {
    const logo = await pdf.embedPng(logoBytes);
    const scale = Math.min(120 / logo.width, 42 / logo.height);
    current.drawImage(logo, {
      x: 550 - logo.width * scale,
      y: 753,
      width: logo.width * scale,
      height: logo.height * scale,
    });
  }
  text('Genereret af Toolbox på baggrund af Flatpay-data', 45, 718, 9);
  text('Udbetalings-ID: ' + source.payment.paymentID, 45, 682);
  text('Udbetalingsdato: ' + source.payment.paidDate.slice(0, 10), 45, 664);
  text('Status: Udbetalt', 45, 646);
  const summary = [
    ['Bruttobetalinger', totals.gross],
    ['Refunderinger (Flatpay)', totals.refunds],
    ['Gebyrer', totals.fees],
    ['Netto udbetalt til bank', totals.net],
  ] as const;
  summary.forEach(([label, value], i) => {
    const y = 592 - i * 36;
    text(label, 45, y, 11, i === 3);
    right(money(value / 100), 550, y, 11);
    current.drawLine({
      start: { x: 45, y: y - 12 },
      end: { x: 550, y: y - 12 },
      color: rgb(0.8, 0.83, 0.85),
      thickness: 0.5,
    });
  });
  text('Afregningernes totaler er afstemt med bankudbetalingen.', 45, 405, 9);
  text(
    'Reguleringer fremgår af afregningsspecifikationen på de følgende sider.',
    45,
    388,
    9,
  );
  text(
    'Transaktionsbeløb bevarer op til fire decimaler; afregning vises i øre.',
    45,
    371,
    9,
  );
  text(
    'Dette er en Toolbox-rapport, ikke Flatpays originale dokument.',
    45,
    340,
    9,
  );
  const fieldLabels: Record<string, string> = {
    grossPurchase: 'Bruttobetalinger',
    grossSettlement: 'Bruttoafregning',
    netPurchase: 'Netto før afregningsfradrag',
    refundAmount: 'Refunderinger',
    feeAmount: 'Gebyrer',
    deduction: 'Samlede fradrag (inkl. gebyrer)',
    netSettlement: 'Nettoafregning',
    payout: 'Udbetalt',
    chargeback: 'Indsigelser',
    rollingReserve: 'Tilbageholdt reserve',
    rollingRelease: 'Frigivet reserve',
    addedSum: 'Tillæg',
    deductedSum: 'Fradrag',
    balanceTransfer: 'Saldooverførsel',
  };
  for (const s of source.settlements) {
    current = page();
    text('Afregning ' + String(s.settlementNumber), 45, 778, 19, true);
    text('Flatpay - udbetaling ' + source.payment.paymentID, 45, 753, 10);
    text('Antal transaktioner: ' + String(s.transactions), 45, 730, 10);
    let y = 692;
    for (const [k, v] of Object.entries(s).filter(
      ([k, v]) =>
        typeof v === 'number' &&
        (v !== 0 ||
          ['grossPurchase', 'refundAmount', 'feeAmount', 'payout'].includes(k)),
    )) {
      if (y < 75) {
        current = page();
        text(
          'Afregning ' + String(s.settlementNumber) + ' - fortsat',
          45,
          778,
          17,
          true,
        );
        y = 737;
      }
      text(fieldLabels[k] || k, 45, y, 9);
      right(money(v as number), 550, y, 9);
      y -= 23;
    }
  }
  let y = 0;
  const header = () => {
    current = page();
    text('Transaktionsspecifikation', 45, 778, 18, true);
    text('Flatpay - udbetaling ' + source.payment.paymentID, 45, 754, 10);
    [
      ['Dato', 45],
      ['Transaktions-ID', 110],
      ['Type', 252],
      ['Brutto', 356],
      ['Gebyr', 443],
      ['Netto', 535],
    ].forEach(([label, x]) => text(label, Number(x), 725, 8, true));
    y = 699;
  };
  header();
  for (const t of source.transactions) {
    if (y < 65) header();
    text(String(t.purchaseDate).slice(0, 10), 45, y, 8);
    text(clip(t.transactionID, 135), 110, y, 8);
    text(clip(t.transactionCode, 65), 252, y, 8);
    right(money(Number(t.grossAmount), 4), 400, y, 8);
    right(money(Number(t.fees), 4), 478, y, 8);
    right(money(Number(t.netAmount), 4), 550, y, 8);
    y -= 23;
  }
  pdf.getPages().forEach((p, i) => {
    p.drawText(
      `${clean(issuer)}     -     Side ${i + 1} af ${pdf.getPageCount()}`,
      { x: 45, y: 28, size: 8, font: regular, color: rgb(0.4, 0.43, 0.46) },
    );
  });
  pdf.setCreationDate(new Date(source.payment.paidDate));
  pdf.setModificationDate(new Date(source.payment.paidDate));
  pdf.setTitle('Flatpay udbetalingsrapport ' + source.payment.paymentID);
  pdf.setAuthor('WebshopToolbox');
  return pdf.save();
}
