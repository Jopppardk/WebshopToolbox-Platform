import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
const source = readFileSync(new URL('./packaging.ts', import.meta.url), 'utf8'),
  js = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText,
  mod = {};
new Function('exports', js)(mod);
const routeSource = readFileSync(
  new URL('../app/api/shopify/packaging/route.ts', import.meta.url),
  'utf8',
);
const componentSource = readFileSync(
  new URL('../components/packaging.tsx', import.meta.url),
  'utf8',
);
test('emballagestatus normaliseres', () => {
  assert.equal(mod.normalizeReportable('Ja'), 'yes');
  assert.equal(mod.normalizeReportable('nej'), 'no');
  assert.equal(mod.normalizeReportable(''), 'unknown');
});
test('produkter og manuelle poster summeres uden flydende gram', () => {
  const row = {
      eventId: '1',
      date: '2026-09-05',
      productId: 'p',
      product: 'Sabel',
      quantity: 2,
      weightGrams: 125,
      reportable: 'yes',
      orderName: '#1',
    },
    manual = {
      id: 'm',
      date: '2026-09-05',
      description: 'Kasse',
      weightGrams: 50,
      reportable: 'unknown',
    };
  const p = mod.packagingPeriod([row], [manual], '2026-09-01', '2026-09-30');
  assert.equal(p.totalGrams, 250);
  assert.equal(p.reportableGrams, 250);
  assert.equal(p.unknownReportabilityGrams, 50);
  assert.equal(p.products[0].orders[0].orderName, '#1');
});
test('manuelle poster validerer dato, tekst, vægt og status', () => {
  const valid = {
    date: '2026-09-05',
    description: 'Pap',
    supplier: 'A',
    supplierCountry: 'dk',
    supplierCvr: '1',
    weightGrams: 10,
    reportable: 'yes',
  };
  assert.equal(mod.validateManualPackaging(valid).supplierCountry, 'DK');
  assert.throws(() =>
    mod.validateManualPackaging({ ...valid, weightGrams: -1 }),
  );
  assert.throws(() =>
    mod.validateManualPackaging({ ...valid, reportable: 'maybe' }),
  );
});
test('emballagehistorik henter større ordresider og sideinddeler leveringslinjer', () => {
  assert.match(routeSource, /orders\(first:25,/);
  assert.match(routeSource, /fulfillmentLineItems\(first:100,after:\$after\)/);
  assert.match(routeSource, /cursor===after/);
  assert.doesNotMatch(routeSource, /mere end 25 linjer/);
});
test('emballagesiden læser kun databasecache ved åbning', () => {
  assert.match(routeSource, /export async function GET[\s\S]*await report/);
  assert.match(routeSource, /b\.action==='sync'/);
  assert.match(routeSource, /last-sync/);
  assert.match(componentSource, /useEffect\(\(\)=>\{void load\(\);\},\[\]\)/);
  assert.doesNotMatch(
    componentSource,
    /await load\(\);if\(active\)void synchronize/,
  );
});

test('privat og erhverv deler mængder og får separate kg-priser', () => {
  const rows = [
    {
      date: '2026-06-01',
      product: 'A',
      productId: 'a',
      orderName: '#1',
      quantity: 2,
      weightGrams: 125,
      reportable: 'yes',
      audience: 'household',
    },
    {
      date: '2026-06-01',
      product: 'B',
      productId: 'b',
      orderName: '#2',
      quantity: 1,
      weightGrams: 100,
      reportable: 'no',
      audience: 'commercial',
    },
  ];
  const manual = [
    {
      date: '2026-06-01',
      weightGrams: 50,
      reportable: 'yes',
      audience: 'commercial',
    },
  ];
  const p = mod.packagingPeriod(rows, manual, '2026-04-01', '2026-06-30');
  assert.equal(p.householdGrams, 250);
  assert.equal(p.commercialGrams, 50);
  assert.equal(p.commercialTotalGrams, 150);
  assert.equal(mod.packagingEstimate(p, 2, 4), 0.7);
  assert.equal(mod.packagingEstimate(p, 2, null), null);
  const unknown = mod.packagingPeriod(
    [],
    [{ ...manual[0], audience: 'unknown' }],
    '2026-04-01',
    '2026-06-30',
  );
  assert.equal(unknown.unknownAudienceGrams, 0);
  assert.equal(unknown.householdGrams, 50);
  assert.equal(mod.packagingEstimate(unknown, 2, 4), 0.1);
  assert.equal(mod.validatePackagingPrice(4.12345), 4.1235);
  for (const value of [-1, 1001, Infinity, '4'])
    assert.throws(() => mod.validatePackagingPrice(value));
});

import { databaseFixture, loader } from './automation-test-fixture.mjs';
test('both prices persist and a legacy private-price update preserves the business price', async () => {
  const h = databaseFixture();
  const route = loader({
    'next/server': {
      NextResponse: { json: (data, options) => ({ data, ...options }) },
    },
    '@/db/database': { database: () => h.db },
    '@/db/shopify': {},
    '@/db/shopify-order': {},
    '@/db/errors': {},
  })('app/api/shopify/packaging/route.ts');
  const request = (body) =>
    new Request('https://integration.test/api/shopify/packaging', {
      method: 'POST',
      headers: {
        origin: 'https://integration.test',
        'content-type': 'application/json',
        'cf-access-authenticated-user-email': 'rene@sablen.dk',
      },
      body: JSON.stringify(body),
    });
  assert.equal(
    (
      await route.POST(
        request({ action: 'price', pricePerKg: 2, commercialPricePerKg: 4 }),
      )
    ).status,
    200,
  );
  assert.equal(h.get('packaging:price'), 2);
  assert.equal(h.get('packaging:commercial-price'), 4);
  await route.POST(request({ action: 'price', pricePerKg: 3 }));
  assert.equal(h.get('packaging:commercial-price'), 4);
  assert.equal(
    (
      await route.POST(
        request({ action: 'price', pricePerKg: 9, commercialPricePerKg: -1 }),
      )
    ).status,
    422,
  );
  assert.equal(h.get('packaging:price'), 3);
  const result = await route.GET({
    nextUrl: new URL('https://integration.test/api/shopify/packaging'),
  });
  assert.equal(result.data.commercialPricePerKg, 4);
});

test('unconfigured lines are excluded from consumption totals and do not block price estimates', () => {
  const valid = {
    date: '2026-06-01',
    product: 'A',
    orderName: '#1',
    quantity: 2,
    weightGrams: 125,
    reportable: 'yes',
  };
  const p = mod.packagingPeriod(
    [
      valid,
      { ...valid, product: 'Service', weightGrams: null },
      { ...valid, product: 'Unknown', reportable: 'unknown' },
    ],
    [],
    '2026-04-01',
    '2026-06-30',
  );
  assert.equal(p.totalGrams, 250);
  assert.equal(p.reportableGrams, 250);
  assert.equal(p.householdTotalGrams, 250);
  assert.equal(p.products.length, 1);
  assert.equal(p.unresolved, 2);
  assert.equal(mod.packagingEstimate(p, 2, null), 0.5);
});
