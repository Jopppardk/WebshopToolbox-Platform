import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const source = readFileSync(
  new URL('./refund-voucher.ts', import.meta.url),
  'utf8',
);
const exports = {};
vm.runInNewContext(
  ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText,
  {
    exports,
    require(name) {
      if (name === './dinero-sale')
        return {
          rejectTransfer(message) {
            throw Error(message);
          },
        };
      throw Error(name);
    },
  },
);
const mapping = {
  clearing: '55110 - Fordelingskonto',
  vatCode: 'U25',
  noVatCode: 'none',
  refundGoodsVat: '1000 - Salg',
  refundGoodsNoVat: '1050 - Salg uden moms',
  refundShippingVat: '1350 - Fragt',
  refundShippingNoVat: '1300 - Fragt uden moms',
  refundServicesVat: '1000 - Salg',
  refundServicesNoVat: '1050 - Salg uden moms',
};
const input = {
  transactionId: 'gid://shopify/ShopifyPaymentsBalanceTransaction/123',
  orderName: '#2700',
  date: '2026-09-06',
  gross: 17500,
  parts: [
    { kind: 'goods', net: 12000, tax: 3000, description: 'varer' },
    { kind: 'shipping', net: 2000, tax: 500, description: 'fragt' },
  ],
};

test('tilbagebetaling vender salget korrekt og balancerer på fordelingskontoen', () => {
  const result = exports.refundVoucher(input, mapping);
  assert.deepEqual(
    Array.from(result.voucher.Lines, (line) => line.Amount),
    [-175, 150, 25],
  );
  assert.deepEqual(
    Array.from(result.expected, (line) => line.gross),
    [-17500, 15000, 2500],
  );
  assert.equal(result.voucher.ExternalReference, 'sablen:refund:123');
});
test('ukendt moms, forkert total og manglende konto blokerer før Dinero', () => {
  assert.throws(
    () =>
      exports.refundVoucher(
        {
          ...input,
          parts: [{ kind: 'goods', net: 10000, tax: 1000, description: 'x' }],
        },
        mapping,
      ),
    /momssats/,
  );
  assert.throws(
    () => exports.refundVoucher({ ...input, gross: 17499 }, mapping),
    /stemmer ikke/,
  );
  assert.throws(
    () => exports.refundVoucher(input, { ...mapping, refundGoodsVat: '' }),
    /konti/,
  );
});
