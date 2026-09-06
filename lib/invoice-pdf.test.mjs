import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import ts from 'typescript';
import { PDFDocument } from 'pdf-lib';
import { fixture, money } from './invoice-fixture.mjs';
const require = createRequire(import.meta.url);
function load(file, runtime = {}) {
  const exports = {};
  const code = ts.transpileModule(readFileSync(new URL(file, import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  new Function('exports', 'require', code)(exports, name => { if (name === 'cloudflare:workers') return { env: runtime }; if (name === 'pdf-lib') return require(name); return load(name + '.ts', runtime); });
  return exports;
}
const logo = new Uint8Array(readFileSync(new URL('../public/sablen-logo.png', import.meta.url)));
test('PDF renders validated lines; many long lines paginate; optional QA files contain synthetic data only', async () => {
  const { buildInvoicePdf } = load('./invoice-pdf.ts');
  const normal = await buildInvoicePdf(fixture(), logo);
  assert.equal((await PDFDocument.load(normal)).getPageCount(), 1);
  const large = fixture();
  large.lineItems.nodes = Array.from({ length: 25 }, (_, i) => ({ ...large.lineItems.nodes[0], id: `line${i}`, name: `Testvare ${i + 1} - lang beskrivelse med æ, ø og å som skal vises fuldt i fakturaen uden afkortning eller overlap med antallet` }));
  large.currentSubtotalPriceSet = money('2812.50'); large.currentTotalPriceSet = large.totalPriceSet = money('2862.50'); large.currentTotalTaxSet = large.totalTaxSet = money('572.50');
  const multipage = await buildInvoicePdf(large, logo);
  assert.ok((await PDFDocument.load(multipage)).getPageCount() >= 3);
  if (process.env.INVOICE_PDF_QA === '1') {
    const dir = new URL('../outputs/invoice-qa/', import.meta.url); mkdirSync(dir, { recursive: true });
    writeFileSync(new URL('single.pdf', dir), normal); writeFileSync(new URL('multipage.pdf', dir), multipage);
  }
});
test('legacy or changed invoice snapshots cannot overwrite an existing PDF or database row', async () => {
  let writes = 0;
  const runtime = { INVOICES: { put() { writes++; }, head: async () => ({}) }, ASSETS: { fetch: async () => new Response(logo) } };
  const { createInvoicePdf, removeLegacyInvoices } = load('./invoice-pdf.ts', runtime);
  const dbFor = saved => ({ prepare() { return { bind() { return this; }, first: async () => ({ payload_json: JSON.stringify(saved) }), run() { writes++; } }; } });
  await assert.rejects(createInvoicePdf(dbFor({ order: {} }), fixture(), '2028-09-04', true), /bevares/);
  await assert.rejects(createInvoicePdf(dbFor({ invoiceFingerprint: 'different' }), fixture(), '2028-09-04', true), /bevares/);
  assert.equal(await createInvoicePdf(dbFor({ r2Key: 'existing.pdf', order: {} }), fixture(), '2028-09-04'), false);
  assert.equal(await removeLegacyInvoices({ prepare() { throw Error('Unexpected delete'); } }), 0);
  assert.equal(writes, 0);
});
test('failed new invoice validation does not write to R2 or D1', async () => {
  let writes = 0;
  const { createInvoicePdf } = load('./invoice-pdf.ts', { INVOICES: { put() { writes++; } } });
  const db = { prepare() { return { bind() { return this; }, first: async () => null, run() { writes++; } }; } };
  const source = fixture(); source.currentTotalTaxSet = money('0');
  await assert.rejects(createInvoicePdf(db, source, '2028-09-04'));
  assert.equal(writes, 0);
});

test('unshipped and partially shipped orders cannot generate or regenerate PDF', async () => {
  let writes = 0;
  const { createInvoicePdf } = load('./invoice-pdf.ts', { INVOICES: { put() { writes++; } } });
  const db = { prepare() { return { bind() { return this; }, first: async () => null, run() { writes++; } }; } };
  for (const status of ['UNFULFILLED', 'PARTIAL']) {
    const source = fixture(); source.displayFulfillmentStatus = status;
    for (const force of [false, true]) await assert.rejects(createInvoicePdf(db, source, '2028-09-04', force), /Afventer afsendelse/);
  }
  assert.equal(writes, 0);
});

test('PDF supports separate Danish VAT groups and rejects ambiguous line rates', async () => {
  const { buildInvoicePdf } = load('./invoice-pdf.ts');
  const mixed = fixture();
  mixed.lineItems.nodes.push({ ...mixed.lineItems.nodes[0], id: 'line-zero', name: 'Momsfri testvare', originalTotalSet: money('25'), discountedTotalSet: money('25'), discountAllocations: [], taxLines: [{ priceSet: money('0'), rate: 0, channelLiable: false }] });
  mixed.currentSubtotalPriceSet = money('137.50'); mixed.currentTotalPriceSet = mixed.totalPriceSet = money('187.50');
  assert.equal((await PDFDocument.load(await buildInvoicePdf(mixed, logo))).getPageCount(), 1);
  const ambiguous = fixture();
  ambiguous.lineItems.nodes[0].taxLines.push({ priceSet: money('0'), rate: 0, channelLiable: false });
  await assert.rejects(buildInvoicePdf(ambiguous, logo), /entydig momssats/);
});
