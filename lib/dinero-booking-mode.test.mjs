import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

test('Dinero-bogføring kan vælges pr. modul uden at deaktivere kladdeoprettelse', () => {
  const settings = read('./admin-settings.ts');
  const page = read('../app/page.tsx');
  const sales = read('../db/sales-automation.ts');
  const salesTransfer = read('../db/sales-transfer.ts');
  const refunds = read('../db/refund-automation.ts');
  const payouts = read('../db/payout-automation.ts');
  const inventory = read('../app/api/shopify/inventory/route.ts');
  assert.match(settings, /salesBookDinero: true/);
  assert.match(settings, /refundsBookDinero: true/);
  assert.match(settings, /payoutsBookDinero: true/);
  assert.match(settings, /inventoryBookDinero: true/);
  assert.match(page, /bookingKey:'salesBookDinero'/);
  assert.match(page, /bookingKey:'refundsBookDinero'/);
  assert.match(page, /bookingKey:'payoutsBookDinero'/);
  assert.match(page, /automation\.inventoryBookDinero/);
  assert.doesNotMatch(page, /checked=\{automation\.bookDinero\}/);
  assert.match(sales, /automation\?\.salesBookDinero === false/);
  assert.match(salesTransfer, /Bogføring er fravalgt under Indstillinger/);
  assert.match(refunds, /settings\.automation\.refundsBookDinero/);
  assert.match(payouts, /automation\.payoutsBookDinero/);
  assert.match(inventory, /if \(!settings\.automation\.inventoryBookDinero\) return current\.state/);
});
