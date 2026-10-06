import test from 'node:test';
import assert from 'node:assert/strict';
import { loader } from './automation-test-fixture.mjs';
const payment = {
  paymentID: '12345',
  merchantID: 'm',
  agreementNumber: '11',
  paidDate: '2020-01-10T00:00:00',
  currency: 'DKK',
  payoutAmount: 98,
  settlements: '56789',
};
const settlement = {
  settlementNumber: '56789',
  merchantID: 'm',
  agreementNumber: '11',
  currency: 'DKK',
  grossPurchase: 100,
  grossSettlement: 100,
  netPurchase: 100,
  netSettlement: 98,
  payout: 98,
  feeAmount: 2,
  deduction: 2,
  refundAmount: 0,
  chargeback: 0,
  rollingReserve: 0,
  rollingRelease: 0,
  addedSum: 0,
  deductedSum: 0,
  balanceTransfer: 0,
  reversals: 0,
};
const accounts = { bank: 55000, clearing: 55110, fees: 7220, flatpay: 55105 };
test('Flatpay draft reconciles bank and fees without counting aggregate deduction twice', () => {
  const { flatpayDraft } = loader()('platform/flatpay-draft.ts');
  const p = flatpayDraft(payment, settlement, accounts);
  assert.deepEqual(
    p.voucher.Lines.map((l) => [
      l.AccountNumber,
      l.BalancingAccountNumber,
      l.Amount,
    ]),
    [
      [55105, 55110, 100],
      [7220, 55105, 2],
      [55000, 55105, 98],
    ],
  );
  for (const s of [
    { ...settlement, netSettlement: 99 },
    { ...settlement, chargeback: 1 },
    { ...settlement, newFee: 1 },
    { ...settlement, deduction: 4 },
    { ...settlement, feeAmount: 2.001 },
  ])
    assert.throws(() => flatpayDraft(payment, s, accounts));
  assert.throws(() =>
    flatpayDraft({ ...payment, paidDate: null }, settlement, accounts),
  );
  assert.throws(() =>
    flatpayDraft(payment, settlement, { ...accounts, bank: accounts.flatpay }),
  );
});
