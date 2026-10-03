import test from 'node:test';
import assert from 'node:assert/strict';
import { loader } from './automation-test-fixture.mjs';

const visibility = loader()('platform/tier1/src/lib/integration-visibility.ts');

test('datavisninger kræver en relevant forbundet integration', () => {
  const shopify = new Set(['shopify']);
  assert.equal(visibility.hasRequiredIntegration('orders', shopify), true);
  assert.equal(visibility.hasRequiredIntegration('feeds', shopify), true);
  assert.equal(
    visibility.hasRequiredIntegration('orders', new Set(['dinero'])),
    false,
  );
  assert.equal(
    visibility.hasRequiredIntegration('inventory', new Set()),
    false,
  );
});

test('fælles betalingsvisninger åbner for hver relevant udbyder', () => {
  for (const provider of ['shopify', 'flatpay'])
    assert.equal(
      visibility.hasRequiredIntegration('refunds', new Set([provider])),
      true,
    );
  for (const provider of ['shopify', 'flatpay', 'viabill'])
    assert.equal(
      visibility.hasRequiredIntegration('payouts', new Set([provider])),
      true,
    );
  assert.equal(
    visibility.hasRequiredIntegration('documents', new Set(['viabill'])),
    false,
  );
});
