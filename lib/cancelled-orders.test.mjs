import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const read = (file) => readFileSync(path.join(root, file), 'utf8');

test('annullerede Shopify-ordrer markeres som håndterede og kan ikke overføres', () => {
  const orders = read('app/api/shopify/orders/route.ts');
  const automation = read('db/sales-automation.ts');
  const transfer = read('db/sales-transfer.ts');
  const page = read('app/page.tsx');

  assert.match(orders, /cancelled \? 'Annulleret'/);
  assert.match(orders, /cancelled \? 'Annulleret · håndteret'/);
  assert.match(orders, /order\.cancelledAt \? 'cancelled' : 'pending'/);
  assert.match(orders, /if \(order\.cancelledAt\) continue/);
  assert.match(automation, /booking_status NOT IN \('booked','cancelled'\)/);
  assert.match(automation, /if \(source\.cancelledAt\) continue/);
  assert.match(
    transfer,
    /Ordren er annulleret i Shopify og er allerede markeret som håndteret/,
  );
  assert.match(page, /booked \|\| state === 'Annulleret · håndteret'/);
});
