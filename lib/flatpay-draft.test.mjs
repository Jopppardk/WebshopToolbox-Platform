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

test('a Flatpay payout of several settlements is one voucher with their sums, and only when they make the payout', () => {
  const { flatpayDraft, flatpaySettlementNumbers } = loader()(
    'platform/flatpay-draft.ts',
  );
  const friday = settlement,
    saturday = {
      ...settlement,
      settlementNumber: '56790',
      grossPurchase: 50,
      grossSettlement: 50,
      netPurchase: 50,
      netSettlement: 49,
      payout: 49,
      feeAmount: 1,
      deduction: 1,
    };
  const monday = { ...payment, settlements: '56789, 56790', payoutAmount: 147 };
  const p = flatpayDraft(monday, [friday, saturday], accounts);
  assert.deepEqual([p.gross, p.fees, p.net], [15000, 300, 14700]);
  assert.deepEqual(
    p.voucher.Lines.map((l) => [
      l.AccountNumber,
      l.BalancingAccountNumber,
      l.Amount,
    ]),
    [
      [55105, 55110, 150],
      [7220, 55105, 3],
      [55000, 55105, 147],
    ],
  );
  // The bank payout must be exactly the settlements; every listed settlement must be there, once.
  for (const [pay, list] of [
    [{ ...monday, payoutAmount: 146 }, [friday, saturday]],
    [monday, [friday]],
    [monday, [friday, friday]],
    [{ ...monday, settlements: '56789,56791' }, [friday, saturday]],
    [monday, [friday, { ...saturday, chargeback: 1 }]],
    [monday, [friday, { ...saturday, currency: 'EUR' }]],
  ])
    assert.throws(() => flatpayDraft(pay, list, accounts));
  assert.deepEqual(flatpaySettlementNumbers('1;2 3'), ['1', '2', '3']);
  assert.deepEqual(flatpaySettlementNumbers(56789), ['56789']);
  for (const bad of ['', '1,1', '1,x', null, {}, '1'.repeat(31)])
    assert.equal(flatpaySettlementNumbers(bad), null);
});

test('a Flatpay settlement that needs a separate check says which settlement, what and how much', () => {
  const { flatpayDraft } = loader()('platform/flatpay-draft.ts');
  const reason = (pay, list) => {
    try {
      flatpayDraft(pay, list, accounts);
    } catch (error) {
      return error.message;
    }
    return null;
  };
  assert.equal(
    reason(payment, [{ ...settlement, refundAmount: 125.5 }]),
    'Flatpay-afregningen kræver særskilt kontrol: Afregning 56789 indeholder tilbagebetalinger på 125,50 kr. Den skal bogføres manuelt i Dinero.',
  );
  assert.match(
    reason(payment, [{ ...settlement, netSettlement: 99 }]),
    /Afregning 56789: netto afregnet er 99,00 kr\., forventet 98,00 kr\./,
  );
  assert.match(
    reason({ ...payment, payoutAmount: 97 }, [settlement]),
    /afregningerne giver 98,00 kr\., men banken modtog 97,00 kr\./,
  );
  assert.match(
    reason(payment, [{ ...settlement, newFee: 1 }]),
    /ukendt beløbsfelt \(newFee: 1\)/,
  );
  const { reversals: _r, ...withoutReversals } = settlement;
  assert.match(
    reason(payment, [withoutReversals]),
    /Afregning 56789: tilbageførsler mangler/,
  );
});
