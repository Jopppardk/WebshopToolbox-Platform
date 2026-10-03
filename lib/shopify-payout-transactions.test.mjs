import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';

const source = fs
  .readFileSync(
    new URL('./shopify-payout-transactions.ts', import.meta.url),
    'utf8',
  )
  .replace("import { shopifyFetch } from '@/lib/shopify-request';", '')
  .replace(
    "import { getShopifyAccess } from '@/db/shopify';",
    'const getShopifyAccess=async()=>({});',
  )
  .replace(
    "import { minorUnits } from './shopify-payments';",
    'const minorUnits=(amount)=>Math.round(Number(amount)*100);',
  );
const js = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
  },
}).outputText;
const localModule = { exports: {} };
new Function('exports', 'module', js)(localModule.exports, localModule);
const { validatePayoutTransactions } = localModule.exports;

const row = (values = {}) => ({
  id: 1,
  type: 'charge',
  test: false,
  payout_id: 99,
  currency: 'DKK',
  amount: '100.00',
  fee: '2.00',
  net: '98.00',
  source_type: 'charge',
  source_order_id: 123,
  processed_at: '2026-09-05T08:00:00Z',
  adjustment_order_transactions: [],
  adjustment_reason: null,
  ...values,
});

test('udbetalingstransaktioner knyttes til konkrete ordrenumre og afstemmes', () => {
  const transfer = row({
    id: 2,
    type: 'payout',
    source_type: 'payout',
    source_order_id: null,
    amount: '-98.00',
    fee: '0.00',
    net: '-98.00',
  });
  const result = validatePayoutTransactions(
    [row(), transfer],
    '99',
    'DKK',
    9800,
    new Map([['123', '#2636']]),
  );
  assert.equal(result.length, 1);
  assert.equal(result[0].orderName, '#2636');
  assert.equal(result[0].net.amount, '98.00');
});

test('dubletter, forkert udbetaling og differencer afvises', () => {
  assert.throws(
    () => validatePayoutTransactions([row(), row()], '99', 'DKK', 19600),
    /dubleret/,
  );
  assert.throws(
    () =>
      validatePayoutTransactions([row({ payout_id: 100 })], '99', 'DKK', 9800),
    /ugyldig/,
  );
  assert.throws(
    () => validatePayoutTransactions([row()], '99', 'DKK', 9700),
    /stemmer ikke/,
  );
});
