import { TransferError, type Voucher } from './dinero-sale';
/** The settlement numbers a Flatpay payment lists ("123", "123,124", "123 124"); null when not a clean list. */
export function flatpaySettlementNumbers(value: unknown): string[] | null {
  const text =
    typeof value === 'number' && Number.isSafeInteger(value)
      ? String(value)
      : typeof value === 'string'
        ? value
        : '';
  const ids = text.split(/[,;\s]+/).filter(Boolean);
  if (
    !ids.length ||
    ids.length > 30 ||
    ids.some((id) => !/^\d{1,30}$/.test(id)) ||
    new Set(ids).size !== ids.length
  )
    return null;
  return ids;
}

// One Dinero voucher for one Flatpay bank payout. A payout can cover several settlements (paid out together,
// e.g. on Monday for the weekend): each is checked on its own exactly as a single one, and their sums must
// make exactly the bank payout.
export function flatpayDraft(
  payment: Record<string, unknown>,
  settlementOrList: Record<string, unknown> | Record<string, unknown>[],
  accounts: { bank: number; fees: number; clearing: number; flatpay: number },
) {
  const settlements = Array.isArray(settlementOrList)
    ? settlementOrList
    : [settlementOrList];
  // Every check says what does not add up, so the customer (and support) can see it directly.
  const fail = (reason: string): never => {
    throw new TransferError(
      'Flatpay-afregningen kræver særskilt kontrol: ' + reason,
    );
  };
  const kr = (cents: number) =>
    new Intl.NumberFormat('da-DK', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(cents / 100) + ' kr.';
  const money = (v: unknown, what: string) => {
    if (
      typeof v !== 'number' ||
      !Number.isFinite(v) ||
      !Number.isSafeInteger(Math.round(v * 100)) ||
      Math.abs(v * 100 - Math.round(v * 100)) > 0.00001
    )
      return fail(`${what} mangler eller er ikke et beløb i hele øre.`);
    return Math.round(v * 100);
  };
  if (
    typeof payment.paymentID !== 'string' ||
    !/^\d{1,30}$/.test(payment.paymentID) ||
    typeof payment.paidDate !== 'string' ||
    !Number.isFinite(Date.parse(payment.paidDate)) ||
    payment.paidDate.slice(0, 10) > new Date().toISOString().slice(0, 10) ||
    payment.currency !== 'DKK'
  )
    fail(
      'udbetalingen mangler ID eller dato, ligger i fremtiden eller er ikke i DKK.',
    );
  // The payout lists exactly these settlements, each once.
  const listed = flatpaySettlementNumbers(payment.settlements);
  if (
    !listed ||
    listed.length !== settlements.length ||
    new Set(settlements.map((x) => x.settlementNumber)).size !==
      settlements.length ||
    settlements.some((x) => !listed.includes(String(x.settlementNumber)))
  )
    fail(
      `udbetalingen lister afregning ${String(payment.settlements)}, men ${settlements.length} afregning(er) blev fundet.`,
    );
  let gross = 0,
    fees = 0,
    payout = 0;
  for (const settlement of settlements) {
    const name = 'Afregning ' + String(settlement.settlementNumber);
    if (settlement.currency !== 'DKK')
      fail(`${name} er i ${String(settlement.currency)}, ikke DKK.`);
    const sGross = money(settlement.grossPurchase, name + ': omsætning'),
      sFees = money(settlement.feeAmount, name + ': gebyr'),
      sNet = money(settlement.payout, name + ': udbetaling');
    if (sGross <= 0 || sFees < 0 || sNet <= 0)
      fail(
        `${name} har omsætning ${kr(sGross)}, gebyr ${kr(sFees)} og udbetaling ${kr(sNet)}; kun positive afregninger kan bogføres automatisk.`,
      );
    if (sGross - sFees !== sNet)
      fail(
        `${name}: omsætning ${kr(sGross)} minus gebyr ${kr(sFees)} giver ikke udbetalingen ${kr(sNet)} (forskel ${kr(sGross - sFees - sNet)}).`,
      );
    for (const [field, label, expected] of [
      ['grossSettlement', 'brutto afregnet', sGross],
      ['netPurchase', 'netto køb', sGross],
      ['netSettlement', 'netto afregnet', sNet],
      ['deduction', 'fradrag', sFees],
    ] as const) {
      const value = money(settlement[field], `${name}: ${label}`);
      if (value !== expected)
        fail(`${name}: ${label} er ${kr(value)}, forventet ${kr(expected)}.`);
    }
    gross += sGross;
    fees += sFees;
    payout += sNet;
  }
  const net = money(payment.payoutAmount, 'Udbetalingens beløb');
  if (net <= 0 || payout !== net || gross - fees !== net)
    fail(`afregningerne giver ${kr(payout)}, men banken modtog ${kr(net)}.`);
  const totals = new Set([
    'grossPurchase',
    'grossSettlement',
    'netPurchase',
    'netSettlement',
    'payout',
    'feeAmount',
    'deduction',
  ]);
  const adjustments: Record<string, string> = {
    refundAmount: 'tilbagebetalinger',
    chargeback: 'chargebacks',
    rollingReserve: 'reserve',
    rollingRelease: 'frigivet reserve',
    addedSum: 'tillæg',
    deductedSum: 'fradrag',
    balanceTransfer: 'saldooverførsel',
    reversals: 'tilbageførsler',
  };
  for (const settlement of settlements) {
    const name = 'Afregning ' + String(settlement.settlementNumber);
    for (const [k, v] of Object.entries(settlement))
      if (
        typeof v === 'number' &&
        !totals.has(k) &&
        !(k in adjustments) &&
        v !== 0
      )
        fail(`${name} har et ukendt beløbsfelt (${k}: ${v}).`);
    for (const [k, label] of Object.entries(adjustments)) {
      const value = money(settlement[k], `${name}: ${label}`);
      if (value !== 0)
        fail(
          `${name} indeholder ${label} på ${kr(value)} Den skal bogføres manuelt i Dinero.`,
        );
    }
    if (settlement.preArbitration != null && settlement.preArbitration !== '0')
      fail(`${name} har en igangværende indsigelse (pre-arbitration).`);
  }
  if (
    Object.values(accounts).some((n) => !Number.isSafeInteger(n) || n <= 0) ||
    new Set(Object.values(accounts)).size !== 4
  )
    throw new TransferError('Vælg fire forskellige, gyldige konti.');
  const movements = [
    {
      label: 'Afregnede betalinger',
      amount: gross,
      account: accounts.flatpay,
      balancing: accounts.clearing,
    },
    {
      label: 'Gebyr',
      amount: fees,
      account: accounts.fees,
      balancing: accounts.flatpay,
    },
    {
      label: 'Udbetaling til bank',
      amount: net,
      account: accounts.bank,
      balancing: accounts.flatpay,
    },
  ].filter((x) => x.amount !== 0);
  const voucher: Voucher = {
    VoucherDate: String(payment.paidDate).slice(0, 10),
    ExternalReference: 'sablen:flatpay:' + payment.paymentID,
    Lines: movements.map((x) => ({
      Description: `Flatpay ${String(payment.paymentID)} · ${x.label}`,
      AccountNumber: x.account,
      BalancingAccountNumber: x.balancing,
      Amount: x.amount / 100,
      AccountVatCode: 'none',
      BalancingAccountVatCode: 'none',
    })),
  };
  return {
    gross,
    fees,
    net,
    voucher,
    expected: movements.map((x) => ({
      net: x.amount,
      tax: 0,
      gross: x.amount,
    })),
  };
}
