import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { fixture, money } from './invoice-fixture.mjs';
function load(file, overrides = {}) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(readFileSync(new URL(file, import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, {
    exports, Intl, crypto, TextEncoder, AbortSignal,
    fetch: (...args) => overrides.fetch(...args),
    require(name) { if (name in overrides) return overrides[name]; return load(name.replace('@/lib/', './') + '.ts', overrides); },
  }); return exports;
}
const { checkInvoice, invoiceFingerprint } = load('./invoice-check.ts');
const { salesDraft } = load('./sales-preview.ts');
const settings = { vatCode: 'U25 - Moms', noVatCode: 'U0 - Momsfri', goodsVat: '1000 - Salg', shippingVat: '1350 - Fragt', clearing: '55000 - Mellemregning' };
const chart = [{ number: '1000', name: 'Salg', vatCode: 'U25', kind: 'entry', hidden: false }, { number: '1350', name: 'Fragt', vatCode: 'U25', kind: 'entry', hidden: false }, { number: '55000', name: 'Mellemregning', vatCode: '', kind: 'deposit', hidden: false }];

test('invoice and sales check wait for full shipment, including missing and partial statuses', () => {
  for (const status of [undefined, null, 'UNFULFILLED', 'PARTIAL', 'IN_PROGRESS', 'ON_HOLD', 'SCHEDULED']) {
    const order = fixture(); order.displayFulfillmentStatus = status;
    assert.throws(() => checkInvoice(order), /Afventer afsendelse/);
    order.displayFulfillmentStatus = 'FULFILLED';
    assert.equal(checkInvoice(order).gross, 16250);
  }
});

test('all allocated discounts are included and line/shipping/VAT totals reconcile', () => {
  const checked = checkInvoice(fixture());
  assert.equal(checked.gross, 16250); assert.equal(checked.tax, 3250); assert.equal(checked.net, 13000);
  assert.equal(checked.lines[0].net, 9000); assert.equal(checked.discount, 1250);
  assert.equal(checked.customer.name, 'Testkunde Æble Øster'); assert.equal(checked.paid, true);
});
test('tax-exclusive and zero VAT orders retain actual tax without assuming 25%', () => {
  const order = fixture(); order.taxesIncluded = false;
  order.lineItems.nodes[0].originalTotalSet = money('100'); order.lineItems.nodes[0].discountAllocations[0].allocatedAmountSet = money('10');
  order.shippingLines.nodes[0].originalPriceSet = order.shippingLines.nodes[0].discountedPriceSet = money('40'); order.currentSubtotalPriceSet = money('90');
  assert.equal(checkInvoice(order).gross, 16250);
  for (const line of [...order.lineItems.nodes, ...order.shippingLines.nodes]) line.taxLines = [];
  order.currentTotalPriceSet = order.totalPriceSet = money('130'); order.currentTotalTaxSet = order.totalTaxSet = money('0');
  assert.equal(checkInvoice(order).tax, 0);
});
test('incomplete, mismatched, edited, refunded, gift-card and missing customer data fail closed', () => {
  for (const change of [o => o.lineItems.pageInfo.hasNextPage = true, o => o.lineItems.nodes = [], o => o.billingAddress.name = '', o => o.totalPriceSet = money('163'), o => o.currentTotalTaxSet = money('0'), o => o.edited = true, o => o.totalRefundedSet = money('1'), o => o.lineItems.nodes[0].isGiftCard = true, o => o.lineItems.nodes[0].currentQuantity = 0, o => o.shippingLines.nodes[0].isRemoved = true, o => delete o.test, o => o.lineItems.nodes[0].originalTotalSet.shopMoney.currencyCode = 'EUR']) {
    const order = fixture(); change(order); assert.throws(() => checkInvoice(order));
  }
});
test('fingerprint changes for commercial content, not payment status', async () => {
  const checked = checkInvoice(fixture()), first = await invoiceFingerprint(checked);
  checked.paid = false; assert.equal(await invoiceFingerprint(checked), first);
  checked.customer.name = 'Anden testkunde'; assert.notEqual(await invoiceFingerprint(checked), first);
});
test('read-only draft balances and uses verified accounts; unsafe mappings block', () => {
  const checked = checkInvoice(fixture()); const draft = salesDraft(checked, settings, chart);
  assert.equal(draft.ready, true); assert.equal(draft.debit, draft.credit); assert.equal(draft.lines[0].account, '1000 - Salg');
  assert.equal(salesDraft(checked, {}, chart).ready, false);
  assert.equal(salesDraft(checked, settings, []).ready, false);
  assert.equal(salesDraft(checked, settings, chart.map(a => ({ ...a, vatCode: '' }))).ready, false);
  assert.equal(salesDraft(checked, { ...settings, clearing: settings.goodsVat }, chart).ready, false);
  checked.countryCode = 'DE'; assert.equal(salesDraft(checked, settings, chart).ready, false);
  checked.countryCode = 'DK'; checked.lines[0].kind = 'unclassified'; assert.equal(salesDraft(checked, settings, chart).ready, false);
});
test('explicit no VAT differs from missing or legacy U0; accounts and clearing remain checked', () => {
  const checked = checkInvoice(fixture());
  checked.lines.forEach(line => { line.tax = 0; line.rates = []; line.gross = line.net; });
  checked.tax = 0; checked.gross = checked.net;
  const noVatChart = chart.map(a => ({ ...a, vatCode: '' }));
  const mapped = { ...settings, noVatCode: 'NONE', goodsNoVat: settings.goodsVat, shippingNoVat: settings.shippingVat };
  const draft = salesDraft(checked, mapped, noVatChart);
  assert.equal(draft.ready, true); assert.equal(draft.lines[0].vatCode, '');
  for (const noVatCode of ['', 'U0', 'U0 - Momsfri', 'U25']) assert.equal(salesDraft(checked, { ...mapped, noVatCode }, noVatChart).ready, false);
  assert.equal(salesDraft(checked, mapped, chart).ready, false);
  assert.equal(salesDraft(checked, mapped, noVatChart.map(a => a.number === '55000' ? { ...a, vatCode: 'U25' } : a)).ready, false);
  assert.equal(salesDraft(checked, mapped, noVatChart.map(a => a.number === '55000' ? { ...a, hidden: true } : a)).ready, false);
});

test('pagination completes extra lines; rejects stalled cursors, duplicates, changed revisions', async () => {
  const order = fixture(); order.lineItems.pageInfo = { hasNextPage: true, endCursor: 'a' };
  const extra = { ...order.lineItems.nodes[0], id: 'line2' };
  const responses = [{ order: { id: order.id, updatedAt: order.updatedAt, lineItems: { nodes: [extra], pageInfo: { hasNextPage: false, endCursor: 'b' } } } }, { order: { updatedAt: order.updatedAt } }];
  const module = load('../db/shopify-order.ts', { './shopify': {}, fetch: async () => ({ ok: true, json: async () => ({ data: responses.shift() }) }) });
  assert.equal((await module.completeOrder(order, { shop: 'test.myshopify.com', accessToken: 'test' })).lineItems.nodes.length, 2);
  for (const caseName of ['duplicate', 'stalled', 'changed']) {
    const source = fixture(); source.lineItems.pageInfo = { hasNextPage: true, endCursor: 'a' };
    const mod = load('../db/shopify-order.ts', { './shopify': {}, fetch: async () => ({ ok: true, json: async () => ({ data: { order: { id: source.id, updatedAt: caseName === 'changed' ? 'changed' : source.updatedAt, lineItems: { nodes: [caseName === 'duplicate' ? source.lineItems.nodes[0] : extra], pageInfo: { hasNextPage: caseName === 'stalled', endCursor: 'a' } } } } }) }) });
    await assert.rejects(mod.completeOrder(source, { shop: 'test.myshopify.com', accessToken: 'test' }));
  }
});
test('preview route only SELECTs, never changes PDFs or booking status; invoice mode skips Dinero', async () => {
  let dineroReads = 0;
  const db = { prepare(sql) { assert.match(sql, /^SELECT /); return { bind() { return this; }, async first() { if (sql.includes("record_type = 'order'")) return { external_id: fixture().id }; return null; } }; } };
  const route = load('../app/api/sales/preview/route.ts', {
    'next/server': { NextResponse: { json: (data, options) => ({ data, ...options }) } },
    '@/db/database': { database: () => db }, '@/db/history': { loadHistory: async () => ({}) }, '@/lib/history-policy': { historyWindow: () => ({ cutoff: '2026-01-01T00:00:00Z' }) },
    '@/db/shopify-order': { loadCompleteOrder: async () => fixture() }, '@/db/dinero-chart': { loadDineroChart: async () => { dineroReads++; return { accounts: chart, fetchedAt: '2026-09-04T08:00:00Z' }; } },
  });
  const invoice = await route.POST({ json: async () => ({ externalId: fixture().id, mode: 'invoice' }) });
  assert.equal(invoice.status, 200); assert.equal(invoice.data.readOnly, true); assert.equal(dineroReads, 0);
  const sale = await route.POST({ json: async () => ({ externalId: fixture().id }) });
  assert.equal(sale.status, 200); assert.equal(sale.data.draft.ready, false); assert.equal(dineroReads, 1);
  assert.equal((await route.POST({ json: async () => ({ externalId: 'not an id' }) })).status, 400);
});
