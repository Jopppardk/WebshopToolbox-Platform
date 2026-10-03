import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const source = readFileSync(new URL('./inventory.ts', import.meta.url), 'utf8');
const js = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
  },
}).outputText;
const mod = {};
new Function('exports', js)(mod);
const routeSource = readFileSync(
  new URL('../app/api/shopify/inventory/route.ts', import.meta.url),
  'utf8',
);
const componentSource = readFileSync(
  new URL('../components/inventory.tsx', import.meta.url),
  'utf8',
);

test('lagerforespørgslen bruger kun understøttede Shopify-filtre', () => {
  assert.doesNotMatch(routeSource, /tracked:true/);
  assert.match(routeSource, /if \(!item\.tracked/);
});

test('lageropdateringen bruger Shopifys idempotente sammenligningsfelt', () => {
  assert.match(routeSource, /changeFromQuantity:\s*compareQuantity/);
  assert.doesNotMatch(routeSource, /quantities:\s*changes/);
});

test('antal-feltets pile tager udgangspunkt i det aktuelle Shopify-antal', () => {
  assert.match(
    componentSource,
    /value=\{counts\[key\] \?\? String\(row\.quantity\)\}/,
  );
});

test('lageroptælling kræver forberedelse og godkendelse før Shopify og Dinero', () => {
  assert.match(routeSource, /body\.action === 'prepare'/);
  assert.match(routeSource, /body\.action === 'commit'/);
  assert.match(routeSource, /phase: 'approved'/);
  assert.match(routeSource, /inventorySetQuantities/);
  assert.match(routeSource, /vouchers\/manuel/);
  assert.match(routeSource, /\/book`/);
  assert.match(componentSource, /window\.confirm/);
});

test('lagerværdi bruger positive fysiske antal og eksakte øre', () => {
  assert.equal(
    mod.inventoryValueMinor([
      { quantity: 3, unitCostMinor: 1250 },
      { quantity: -2, unitCostMinor: 500 },
    ]),
    3750,
  );
});

test('lageroptælling validerer ID, antal og dubletter', () => {
  const valid = {
    inventoryItemId: 'gid://shopify/InventoryItem/1',
    locationId: 'gid://shopify/Location/2',
    quantity: 4,
    compareQuantity: 3,
  };
  assert.deepEqual(mod.validateStocktakeChanges([valid]), [valid]);
  assert.throws(() =>
    mod.validateStocktakeChanges([{ ...valid, quantity: -1 }]),
  );
  assert.throws(() => mod.validateStocktakeChanges([valid, valid]));
});
