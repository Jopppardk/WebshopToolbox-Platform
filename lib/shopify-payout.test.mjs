import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';

const source = fs.readFileSync(
  new URL('./shopify-payout.ts', import.meta.url),
  'utf8',
);
const js = ts.transpileModule(
  source.replace(
    "import { minorUnits } from './shopify-payments';",
    `const minorUnits=(amount)=>Math.round(Number(amount)*100);`,
  ),
  {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  },
).outputText;
const module = { exports: {} };
new Function('exports', 'module', js)(module.exports, module);
const { payoutBreakdown } = module.exports;
const money = (n) => ({ amount: n, currencyCode: 'DKK' });
const summary = () => ({
  adjustmentsFee: money('0'),
  adjustmentsGross: money('0'),
  advanceFees: money('0'),
  advanceGross: money('0'),
  chargesFee: money('10'),
  chargesGross: money('1000'),
  refundsFee: money('0'),
  refundsFeeGross: money('-100'),
  reservedFundsFee: money('0'),
  reservedFundsGross: money('0'),
  retriedPayoutsFee: money('0'),
  retriedPayoutsGross: money('0'),
  usdcRebateCreditAmount: money('0'),
});
test('afstemmer standardudbetaling', () =>
  assert.deepEqual(payoutBreakdown(summary(), money('890')), {
    currency: 'DKK',
    charges: 100000,
    refunds: -10000,
    fees: 1000,
    net: 89000,
  }));
test('afstemmer konkret Shopify-udbetaling med positivt gebyr', () => {
  const value = summary();
  value.chargesGross = money('3560.00');
  value.chargesFee = money('71.28');
  value.refundsFeeGross = money('0');
  assert.deepEqual(payoutBreakdown(value, money('3488.72')).net, 348872);
});
test('afviser ukendte reguleringer', () => {
  const value = summary();
  value.adjustmentsGross = money('-5');
  assert.throws(() => payoutBreakdown(value, money('885')), /reguleringer/);
});
test('afviser difference', () =>
  assert.throws(
    () => payoutBreakdown(summary(), money('891')),
    /stemmer ikke/,
  ));
