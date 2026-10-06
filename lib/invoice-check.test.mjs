import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture, money } from './invoice-fixture.mjs';
import { loader } from './automation-test-fixture.mjs';
const { checkInvoice, invoiceFingerprint } = loader()(
  'platform/invoice-check.ts',
);
const { salesDraft } = loader()('platform/sales-preview.ts');
const settings = {
  vatCode: 'U25 - Moms',
  noVatCode: 'U0 - Momsfri',
  goodsVat: '1000 - Salg',
  shippingVat: '1350 - Fragt',
  clearing: '55000 - Mellemregning',
};
const chart = [
  {
    number: '1000',
    name: 'Salg',
    vatCode: 'U25',
    kind: 'entry',
    hidden: false,
  },
  {
    number: '1350',
    name: 'Fragt',
    vatCode: 'U25',
    kind: 'entry',
    hidden: false,
  },
  {
    number: '55000',
    name: 'Mellemregning',
    vatCode: '',
    kind: 'deposit',
    hidden: false,
  },
];

test('invoice and sales check wait for full shipment, including missing and partial statuses', () => {
  for (const status of [
    undefined,
    null,
    'UNFULFILLED',
    'PARTIAL',
    'IN_PROGRESS',
    'ON_HOLD',
    'SCHEDULED',
  ]) {
    const order = fixture();
    order.displayFulfillmentStatus = status;
    assert.throws(() => checkInvoice(order), /Afventer afsendelse/);
    order.displayFulfillmentStatus = 'FULFILLED';
    assert.equal(checkInvoice(order).gross, 16250);
  }
});

test('all allocated discounts are included and line/shipping/VAT totals reconcile', () => {
  const checked = checkInvoice(fixture());
  assert.equal(checked.gross, 16250);
  assert.equal(checked.tax, 3250);
  assert.equal(checked.net, 13000);
  assert.equal(checked.lines[0].net, 9000);
  assert.equal(checked.discount, 1250);
  assert.equal(checked.customer.name, 'Testkunde Æble Øster');
  assert.equal(checked.paid, true);
});
test('tax-exclusive and zero VAT orders retain actual tax without assuming 25%', () => {
  const order = fixture();
  order.taxesIncluded = false;
  order.lineItems.nodes[0].originalTotalSet = money('100');
  order.lineItems.nodes[0].discountAllocations[0].allocatedAmountSet =
    money('10');
  order.shippingLines.nodes[0].originalPriceSet =
    order.shippingLines.nodes[0].discountedPriceSet = money('40');
  order.currentSubtotalPriceSet = money('90');
  assert.equal(checkInvoice(order).gross, 16250);
  for (const line of [...order.lineItems.nodes, ...order.shippingLines.nodes])
    line.taxLines = [];
  order.currentTotalPriceSet = order.totalPriceSet = money('130');
  order.currentTotalTaxSet = order.totalTaxSet = money('0');
  assert.equal(checkInvoice(order).tax, 0);
});
test('incomplete, mismatched, edited, refunded, gift-card and missing customer data fail closed', () => {
  for (const change of [
    (o) => (o.lineItems.pageInfo.hasNextPage = true),
    (o) => (o.lineItems.nodes = []),
    (o) => (o.billingAddress.name = ''),
    (o) => (o.totalPriceSet = money('163')),
    (o) => (o.currentTotalTaxSet = money('0')),
    (o) => (o.edited = true),
    (o) => (o.totalRefundedSet = money('1')),
    (o) => (o.lineItems.nodes[0].isGiftCard = true),
    (o) => (o.lineItems.nodes[0].currentQuantity = 0),
    (o) => (o.shippingLines.nodes[0].isRemoved = true),
    (o) => delete o.test,
    (o) =>
      (o.lineItems.nodes[0].originalTotalSet.shopMoney.currencyCode = 'EUR'),
  ]) {
    const order = fixture();
    change(order);
    assert.throws(() => checkInvoice(order));
  }
});
test('fingerprint changes for commercial content, not payment status', async () => {
  const checked = checkInvoice(fixture()),
    first = await invoiceFingerprint(checked);
  checked.paid = false;
  assert.equal(await invoiceFingerprint(checked), first);
  checked.customer.name = 'Anden testkunde';
  assert.notEqual(await invoiceFingerprint(checked), first);
});
test('read-only draft balances and uses verified accounts; unsafe mappings block', () => {
  const checked = checkInvoice(fixture());
  const draft = salesDraft(checked, settings, chart);
  assert.equal(draft.ready, true);
  assert.equal(draft.debit, draft.credit);
  assert.equal(draft.lines[0].account, '1000 - Salg');
  assert.equal(salesDraft(checked, {}, chart).ready, false);
  assert.equal(salesDraft(checked, settings, []).ready, false);
  assert.equal(
    salesDraft(
      checked,
      settings,
      chart.map((a) => ({ ...a, vatCode: '' })),
    ).ready,
    false,
  );
  assert.equal(
    salesDraft(checked, { ...settings, clearing: settings.goodsVat }, chart)
      .ready,
    false,
  );
  checked.countryCode = 'DE';
  assert.equal(salesDraft(checked, settings, chart).ready, false);
  checked.countryCode = 'DK';
  checked.lines[0].kind = 'unclassified';
  assert.equal(salesDraft(checked, settings, chart).ready, false);
});
test('explicit no VAT differs from missing or legacy U0; accounts and clearing remain checked', () => {
  const checked = checkInvoice(fixture());
  checked.lines.forEach((line) => {
    line.tax = 0;
    line.rates = [];
    line.gross = line.net;
  });
  checked.tax = 0;
  checked.gross = checked.net;
  const noVatChart = chart.map((a) => ({ ...a, vatCode: '' }));
  const mapped = {
    ...settings,
    noVatCode: 'NONE',
    goodsNoVat: settings.goodsVat,
    shippingNoVat: settings.shippingVat,
  };
  const draft = salesDraft(checked, mapped, noVatChart);
  assert.equal(draft.ready, true);
  assert.equal(draft.lines[0].vatCode, '');
  for (const noVatCode of ['', 'U0', 'U0 - Momsfri', 'U25'])
    assert.equal(
      salesDraft(checked, { ...mapped, noVatCode }, noVatChart).ready,
      false,
    );
  assert.equal(salesDraft(checked, mapped, chart).ready, false);
  assert.equal(
    salesDraft(
      checked,
      mapped,
      noVatChart.map((a) =>
        a.number === '55000' ? { ...a, vatCode: 'U25' } : a,
      ),
    ).ready,
    false,
  );
  assert.equal(
    salesDraft(
      checked,
      mapped,
      noVatChart.map((a) =>
        a.number === '55000' ? { ...a, hidden: true } : a,
      ),
    ).ready,
    false,
  );
});
