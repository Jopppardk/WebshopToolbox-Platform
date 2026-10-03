import test from 'node:test';
import assert from 'node:assert/strict';
import { loader, databaseFixture } from './automation-test-fixture.mjs';
test('cached payment providers are enriched without changing accounting or overwriting concurrent order changes', async (t) => {
  const h = databaseFixture();
  t.after(() => h.sql.close());
  const id = 'gid://shopify/Order/123';
  h.record(
    'order',
    id,
    { id, name: '#123', total: '100' },
    '2026-09-08T12:00:00Z',
    'booked',
  );
  const rows = [
    { payload_json: JSON.stringify({ id, name: '#123', total: '100' }) },
  ];
  let calls = 0;
  const api = loader({
    '@/db/shopify': { getShopifyAccess: async () => ({}) },
    '@/db/shopify-order': {
      orderQuery: async () => {
        calls++;
        return {
          nodes: [
            { id, paymentGatewayNames: ['shopify_payments', 'gift_card'] },
          ],
        };
      },
    },
  })('db/order-payment-provider.ts');
  await api.enrichOrderPaymentProviders(h.db, rows);
  await api.enrichOrderPaymentProviders(h.db, rows);
  assert.equal(calls, 1);
  const stored = h.sql
    .prepare(
      'SELECT payload_json,booking_status FROM integration_records WHERE external_id=?',
    )
    .get(id);
  assert.equal(stored.booking_status, 'booked');
  assert.equal(JSON.parse(stored.payload_json).total, '100');
  assert.deepEqual(JSON.parse(stored.payload_json).paymentGatewayNames, [
    'shopify_payments',
    'gift_card',
  ]);
  h.sql
    .prepare(
      'UPDATE integration_records SET payload_json=? WHERE external_id=?',
    )
    .run(JSON.stringify({ id, total: '200' }), id);
  await api.enrichOrderPaymentProviders(h.db, [
    { payload_json: JSON.stringify({ id, total: '100' }) },
  ]);
  assert.equal(
    JSON.parse(
      h.sql
        .prepare(
          'SELECT payload_json FROM integration_records WHERE external_id=?',
        )
        .get(id).payload_json,
    ).total,
    '200',
  );
  const { orderPaymentProvider } = loader()('lib/order-payment-provider.ts');
  assert.equal(
    orderPaymentProvider(['shopify_payments', 'gift_card']),
    'Shopify Payments, Gavekort',
  );
  assert.equal(orderPaymentProvider(['Custom Gateway']), 'Custom Gateway');
  assert.equal(orderPaymentProvider([]), 'Ikke oplyst');
});
