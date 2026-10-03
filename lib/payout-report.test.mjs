import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import ts from 'typescript';
import { PDFDocument } from 'pdf-lib';

const require = createRequire(import.meta.url);
const source = readFileSync(
  new URL('./payout-report.ts', import.meta.url),
  'utf8',
)
  .replace("import { env } from 'cloudflare:workers';", 'const env={};')
  .replace(
    "import { payoutBreakdown, type PayoutSummary } from './shopify-payout';",
    "const payoutBreakdown=(summary,net)=>({currency:'DKK',charges:100000,refunds:-10000,fees:1000,net:89000});",
  )
  .replace(
    "import { fetchPayoutTransactions, type PayoutTransaction } from './shopify-payout-transactions';",
    'const fetchPayoutTransactions=async()=>[];',
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
new Function('exports', 'module', 'require', js)(
  localModule.exports,
  localModule,
  require,
);
const { buildPayoutReport } = localModule.exports;

const transaction = (index) => ({
  id: String(index),
  type: index % 7 === 0 ? 'REFUND' : 'CHARGE',
  processedAt: `2026-09-${String((index % 28) + 1).padStart(2, '0')}T08:00:00Z`,
  amount: {
    amount: index % 7 === 0 ? '-100.00' : '100.00',
    currencyCode: 'DKK',
  },
  fee: { amount: index % 7 === 0 ? '-2.00' : '2.00', currencyCode: 'DKK' },
  net: { amount: index % 7 === 0 ? '-98.00' : '98.00', currencyCode: 'DKK' },
  sourceType: index % 7 === 0 ? 'REFUND' : 'CHARGE',
  orderId: String(1000 + index),
  orderName: `#${2600 + index}`,
  adjustmentReason: null,
});
test('udbetalingsrapport bevarer forsiden og starter specifikationen på side 2', async () => {
  const logo = new Uint8Array(
    readFileSync(new URL('../public/sablen-logo.png', import.meta.url)),
  );
  const bytes = await buildPayoutReport(
    {
      id: 'gid://shopify/ShopifyPaymentsPayout/99',
      issuedAt: '2026-09-05T08:00:00Z',
      status: 'PAID',
      transactionType: 'DEPOSIT',
      provider: 'shopify_payments',
      net: { amount: '890.00', currencyCode: 'DKK' },
      summary: {},
      transactions: Array.from({ length: 45 }, (_, index) =>
        transaction(index + 1),
      ),
    },
    logo,
  );
  const pdf = await PDFDocument.load(bytes);
  assert.equal(pdf.getPageCount(), 3);
  if (process.env.PAYOUT_PDF_QA === '1') {
    const dir = new URL('../outputs/payout-qa/', import.meta.url);
    mkdirSync(dir, { recursive: true });
    writeFileSync(new URL('specification.pdf', dir), bytes);
  }
});
