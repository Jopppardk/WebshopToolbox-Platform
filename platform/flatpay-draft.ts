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
  const fail = (): never => {
    throw new TransferError(
      'Flatpay-afregningen indeholder beløb eller reguleringer, som kræver særskilt kontrol.',
    );
  };
  const money = (v: unknown) => {
    if (
      typeof v !== 'number' ||
      !Number.isFinite(v) ||
      !Number.isSafeInteger(Math.round(v * 100)) ||
      Math.abs(v * 100 - Math.round(v * 100)) > 0.00001
    )
      return fail();
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
    fail();
  // The payout lists exactly these settlements, each once.
  const listed = flatpaySettlementNumbers(payment.settlements);
  if (
    !listed ||
    listed.length !== settlements.length ||
    new Set(settlements.map((x) => x.settlementNumber)).size !==
      settlements.length ||
    settlements.some((x) => !listed.includes(String(x.settlementNumber)))
  )
    fail();
  let gross = 0,
    fees = 0,
    payout = 0;
  for (const settlement of settlements) {
    const sGross = money(settlement.grossPurchase),
      sFees = money(settlement.feeAmount),
      sNet = money(settlement.payout);
    if (
      settlement.currency !== 'DKK' ||
      sGross <= 0 ||
      sFees < 0 ||
      sNet <= 0 ||
      sGross - sFees !== sNet ||
      money(settlement.grossSettlement) !== sGross ||
      money(settlement.netPurchase) !== sGross ||
      money(settlement.netSettlement) !== sNet ||
      money(settlement.deduction) !== sFees
    )
      fail();
    gross += sGross;
    fees += sFees;
    payout += sNet;
  }
  const net = money(payment.payoutAmount);
  if (net <= 0 || payout !== net || gross - fees !== net) fail();
  const totals = new Set([
    'grossPurchase',
    'grossSettlement',
    'netPurchase',
    'netSettlement',
    'payout',
    'feeAmount',
    'deduction',
  ]);
  for (const settlement of settlements) {
    for (const [k, v] of Object.entries(settlement))
      if (typeof v === 'number' && !totals.has(k) && v !== 0) fail();
    for (const k of [
      'refundAmount',
      'chargeback',
      'rollingReserve',
      'rollingRelease',
      'addedSum',
      'deductedSum',
      'balanceTransfer',
      'reversals',
    ])
      if (money(settlement[k]) !== 0) fail();
    if (settlement.preArbitration != null && settlement.preArbitration !== '0')
      fail();
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
