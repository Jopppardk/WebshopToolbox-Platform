import { TransferError, type Voucher } from './dinero-sale';
export function flatpayDraft(
  payment: Record<string, unknown>,
  settlement: Record<string, unknown>,
  accounts: { bank: number; fees: number; clearing: number; flatpay: number },
) {
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
    payment.currency !== 'DKK' ||
    settlement.currency !== 'DKK' ||
    settlement.settlementNumber !== payment.settlements
  )
    fail();
  const gross = money(settlement.grossPurchase),
    fees = money(settlement.feeAmount),
    net = money(payment.payoutAmount);
  if (
    gross <= 0 ||
    fees < 0 ||
    net <= 0 ||
    gross - fees !== net ||
    money(settlement.grossSettlement) !== gross ||
    money(settlement.netPurchase) !== gross ||
    money(settlement.netSettlement) !== net ||
    money(settlement.payout) !== net ||
    money(settlement.deduction) !== fees
  )
    fail();
  const totals = new Set([
    'grossPurchase',
    'grossSettlement',
    'netPurchase',
    'netSettlement',
    'payout',
    'feeAmount',
    'deduction',
  ]);
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
