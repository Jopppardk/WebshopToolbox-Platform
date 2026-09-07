import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

test('Dinero-bogføring kan fravælges fælles uden at deaktivere kladdeoprettelse', () => {
  const settings = read('./admin-settings.ts');
  const page = read('../app/page.tsx');
  const sales = read('../db/sales-automation.ts');
  const salesTransfer = read('../db/sales-transfer.ts');
  const refunds = read('../db/refund-automation.ts');
  const payouts = read('../db/payout-automation.ts');
  const inventory = read('../app/api/shopify/inventory/route.ts');
  assert.match(settings, /bookDinero: true/);
  assert.match(page, /Bogfør kladder automatisk i Dinero/);
  assert.match(sales, /automation\?\.bookDinero === false/);
  assert.match(salesTransfer, /Bogføring er fravalgt under Indstillinger/);
  assert.match(refunds, /settings\.automation\.bookDinero/);
  assert.match(payouts, /automation\.bookDinero/);
  assert.match(inventory, /if \(!settings\.automation\.bookDinero\) return current\.state/);
});
