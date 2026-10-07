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
    reason(payment, [{ ...settlement, refundAmount: 1.5 }]),
    'Flatpay-afregningen kræver særskilt kontrol: Afregning 56789: omsætning 100,00 kr. minus tilbagebetalinger 1,50 kr. og gebyr 2,00 kr. giver ikke udbetalingen 98,00 kr. (forskel -1,50 kr.).',
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

test('a Flatpay settlement with a refund is booked with the refund as its own line, whatever sign Flatpay uses', () => {
  const { flatpayDraft } = loader()('platform/flatpay-draft.ts');
  // The real case: order #2683, 5,24 kr. sold, 3,29 kr. refunded, 0,11 kr. fee, 1,84 kr. paid out.
  const base = {
    ...settlement,
    settlementNumber: '60904810',
    grossPurchase: 5.24,
    feeAmount: 0.11,
    payout: 1.84,
    netSettlement: 1.84,
  };
  const pay = { ...payment, settlements: '60904810', payoutAmount: 1.84 };
  for (const variant of [
    {
      refundAmount: 3.29,
      grossSettlement: 5.24,
      netPurchase: 5.24,
      deduction: 0.11,
    },
    {
      refundAmount: -3.29,
      grossSettlement: 1.95,
      netPurchase: 1.95,
      deduction: 0.11,
    },
    {
      refundAmount: 3.29,
      grossSettlement: 5.24,
      netPurchase: 1.95,
      deduction: 3.4,
    },
  ]) {
    const p = flatpayDraft(pay, [{ ...base, ...variant }], accounts);
    assert.deepEqual(
      [p.gross, p.refunds, p.fees, p.net],
      [524, 329, 11, 184],
      JSON.stringify(variant),
    );
    assert.deepEqual(
      p.voucher.Lines.map((l) => [
        l.Description.split(' · ')[1],
        l.AccountNumber,
        l.BalancingAccountNumber,
        l.Amount,
      ]),
      [
        ['Afregnede betalinger', 55105, 55110, 5.24],
        ['Tilbagebetalinger', 55105, 55110, -3.29],
        ['Gebyr', 7220, 55105, 0.11],
        ['Udbetaling til bank', 55000, 55105, 1.84],
      ],
    );
    // The Flatpay account comes out even: in 5,24, out 3,29 + 0,11 + 1,84.
    assert.equal(
      p.voucher.Lines.reduce(
        (sum, l) =>
          sum +
          (l.AccountNumber === 55105 ? l.Amount : 0) -
          (l.BalancingAccountNumber === 55105 ? l.Amount : 0),
        0,
      ).toFixed(2),
      '0.00',
    );
  }
  // A refund that does not explain the difference, or totals fitting neither reading, are still refused.
  assert.throws(
    () =>
      flatpayDraft(
        pay,
        [
          {
            ...base,
            refundAmount: 3.28,
            grossSettlement: 5.24,
            netPurchase: 5.24,
            deduction: 0.11,
          },
        ],
        accounts,
      ),
    /forskel/,
  );
  assert.throws(
    () =>
      flatpayDraft(
        pay,
        [
          {
            ...base,
            refundAmount: 3.29,
            grossSettlement: 4,
            netPurchase: 5.24,
            deduction: 0.11,
          },
        ],
        accounts,
      ),
    /brutto afregnet er 4,00 kr\., forventet 5,24 kr\. eller 1,95 kr\./,
  );
  assert.throws(
    () =>
      flatpayDraft(
        { ...pay, payoutAmount: 1.85 },
        [
          {
            ...base,
            refundAmount: 3.29,
            grossSettlement: 5.24,
            netPurchase: 5.24,
            deduction: 0.11,
          },
        ],
        accounts,
      ),
    /banken modtog 1,85 kr\./,
  );
});
