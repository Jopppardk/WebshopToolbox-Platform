import test from 'node:test';
import assert from 'node:assert/strict';
import { loader } from './automation-test-fixture.mjs';

const lib = loader()('platform/tier1/src/lib/shipments.ts');
const order = (fulfillment, extra = {}) => ({
  id: 'gid://shopify/Order/1',
  name: '#1001',
  shippingAddress: {
    name: 'Anna Hansen',
    city: 'Aarhus C',
    countryCodeV2: 'DK',
  },
  shippingLine: { title: 'PostNord Pakkeshop' },
  fulfillments: [
    {
      id: 'gid://shopify/Fulfillment/1',
      createdAt: '2026-10-01T08:00:00Z',
      status: 'SUCCESS',
      trackingInfo: [{ number: '12345678' }],
      ...fulfillment,
    },
  ],
  ...extra,
});
const event = (status, happenedAt, message = null) => ({
  status,
  happenedAt,
  message,
});

test('carriers are recognised from tracking company, link or shipping method', () => {
  assert.equal(lib.detectCarrier('PostNord DK'), 'postnord');
  assert.equal(
    lib.detectCarrier(null, 'https://gls-group.com/DK/da/find-pakke?match=1'),
    'gls',
  );
  assert.equal(lib.detectCarrier('', null, 'DAO Pakkeshop'), 'dao');
  assert.equal(lib.detectCarrier('Bring'), 'bring');
  assert.equal(lib.detectCarrier('Danske Fragtmænd'), null);
  assert.equal(lib.isPickupPoint('GLS ParcelShop'), true);
  assert.equal(lib.isPickupPoint('Afhentning i butik'), false);
  assert.equal(lib.isPickupPoint('Levering til adressen'), false);
});

test('a parcel shop shipment walks label → drop-off → transit → ready → picked up, with dates from Shopify events', () => {
  const [s] = lib.orderShipments(
    order({
      displayStatus: 'READY_FOR_PICKUP',
      trackingInfo: [
        {
          company: 'PostNord',
          number: '0001',
          url: 'https://tracking.postnord.com/?id=0001',
        },
      ],
      events: {
        nodes: [
          event('READY_FOR_PICKUP', '2026-10-03T09:00:00Z', 'Klar i Netto'),
          event('LABEL_PRINTED', '2026-10-01T08:05:00Z'),
          event('CARRIER_PICKED_UP', '2026-10-01T15:00:00Z'),
          event('IN_TRANSIT', '2026-10-02T03:00:00Z'),
        ],
      },
    }),
  );
  assert.deepEqual(
    s.steps.map((x) => [x.key, x.reached, x.at]),
    [
      ['printed', true, '2026-10-01T08:05:00Z'],
      ['dropped', true, '2026-10-01T15:00:00Z'],
      ['transit', true, '2026-10-02T03:00:00Z'],
      ['ready', true, '2026-10-03T09:00:00Z'],
      ['delivered', false, null],
    ],
  );
  assert.equal(s.current, 'ready');
  assert.equal(s.carrier, 'postnord');
  assert.equal(s.trackingNumber, '0001');
  assert.equal(s.customer, 'Anna Hansen');
  assert.equal(s.city, 'Aarhus C');
  assert.equal(s.steps.at(-1).label, 'Afhentet af kunden');
  assert.deepEqual(
    s.events.map((e) => e.status),
    ['LABEL_PRINTED', 'CARRIER_PICKED_UP', 'IN_TRANSIT', 'READY_FOR_PICKUP'],
    'oldest first',
  );
});

test('a home delivery has no parcel shop step; a later step marks earlier unreported steps as passed', () => {
  const [s] = lib.orderShipments(
    order(
      {
        deliveredAt: '2026-10-02T12:00:00Z',
        trackingInfo: [
          { company: 'GLS', number: '9', url: 'javascript:alert(1)' },
        ],
      },
      { shippingLine: { title: 'Levering til døren' } },
    ),
  );
  assert.equal(s.pickupPoint, false);
  assert.deepEqual(
    s.steps.map((x) => [x.key, x.reached]),
    [
      ['printed', true],
      ['dropped', true],
      ['transit', true],
      ['delivered', true],
    ],
  );
  assert.equal(s.steps[1].at, null);
  assert.equal(s.steps.at(-1).label, 'Leveret hos kunden');
  assert.equal(s.trackingUrl, null, 'only http(s) links reach the browser');
});

test('cancelled orders and failed fulfillments are left out; the latest problem is shown until delivery', () => {
  assert.equal(
    lib.orderShipments(order({}, { cancelledAt: '2026-10-01T09:00:00Z' }))
      .length,
    0,
  );
  assert.equal(lib.orderShipments(order({ status: 'CANCELLED' })).length, 0);
  const [s] = lib.orderShipments(
    order(
      {
        events: {
          nodes: [
            event('IN_TRANSIT', '2026-10-02T03:00:00Z'),
            event('DELAYED', '2026-10-02T10:00:00Z'),
          ],
        },
      },
      { shippingLine: { title: 'Bring' } },
    ),
  );
  assert.equal(s.issue, 'Forsinket');
  assert.equal(s.current, 'transit');
});

test('the pickup deadline warns 2 days before the estimated return and after it has passed', () => {
  const s = {
    pickupPoint: true,
    carrier: 'gls',
    readyAt: '2026-10-01T09:00:00Z',
    delivered: false,
  };
  assert.deepEqual(lib.pickupDeadline(s, '2026-10-04'), {
    deadline: '2026-10-08',
    daysLeft: 4,
    holdDays: 7,
    state: 'ok',
  });
  assert.equal(lib.pickupDeadline(s, '2026-10-06').state, 'soon');
  assert.equal(lib.pickupDeadline(s, '2026-10-08').daysLeft, 0);
  assert.equal(lib.pickupDeadline(s, '2026-10-09').state, 'overdue');
  assert.equal(
    lib.pickupDeadline({ ...s, delivered: true }, '2026-10-07'),
    null,
  );
  // Picked up according to Shopify's status, without a date: no return warning.
  const [picked] = lib.orderShipments(
    order({
      displayStatus: 'PICKED_UP',
      events: { nodes: [event('READY_FOR_PICKUP', '2026-09-20T09:00:00Z')] },
    }),
  );
  assert.equal(picked.delivered, true);
  assert.equal(picked.deliveredAt, null);
  assert.equal(lib.pickupDeadline(picked, '2026-10-07'), null);
  assert.equal(
    lib.pickupDeadline({ ...s, pickupPoint: false }, '2026-10-07'),
    null,
  );
  // Ready late in the evening Danish time counts from that Danish day.
  assert.equal(
    lib.pickupDeadline({ ...s, readyAt: '2026-10-01T22:30:00Z' }, '2026-10-04')
      .deadline,
    '2026-10-09',
  );
});

test('successful fulfillment without a number is manually completed, never printed or carrier-delivered', () => {
  for (const trackingInfo of [
    [],
    [{ number: '   ' }],
    [{ url: 'https://track.shipmondo.com/gls/12345678' }],
  ]) {
    const [s] = lib.orderShipments(
      order({ trackingInfo, displayStatus: 'DELIVERED' }),
    );
    assert.equal(s.current, 'manual');
    assert.equal(s.delivered, false);
    assert.equal(s.deliveredAt, null);
    assert.equal(s.steps.length, 1);
    assert.equal(s.steps[0].label, 'Afsluttet – manuelt håndteret');
    assert.equal(s.steps[0].at, null);
    assert.equal(lib.pickupDeadline(s, '2026-10-04'), null);
    const tracking = loader()('platform/public-tracking.ts');
    assert.equal(tracking.trackingTarget(s), null);
    assert.equal(
      tracking.applyPublicTracking(s, null).publicTracking,
      undefined,
    );
  }
  const pending = lib.buildShipment(
    { id: 'o', name: '#1' },
    { id: 'f', createdAt: '2026-10-01T08:00:00Z', status: 'PENDING' },
  );
  assert.equal(pending.current, 'untracked');
  assert.equal(pending.steps[0].label, 'Afventer trackingnummer');
  const [tracked] = lib.orderShipments(
    order({ trackingInfo: [{ number: '12345678' }] }),
  );
  assert.equal(tracked.current, 'printed');
});

test('dashboard counts shipments created today, on the way and waiting for pickup', () => {
  const s = (current, shippedAt) => ({ current, shippedAt });
  assert.deepEqual(
    lib.shipmentCounts(
      [
        // 23:30 UTC on the 10th is the 11th in Danish time.
        s('printed', '2026-10-10T23:30:00Z'),
        s('transit', '2026-10-09T08:00:00Z'),
        s('ready', '2026-10-08T08:00:00Z'),
        s('delivered', '2026-10-11T08:00:00Z'),
        s('manual', '2026-10-05T08:00:00Z'),
        s('untracked', '2026-10-05T08:00:00Z'),
      ],
      '2026-10-11',
    ),
    { created: 2, moving: 2, waiting: 1 },
  );
});

test('one parcel reported on two fulfillments of the same order is one shipment', () => {
  const parcel = {
    company: 'GLS',
    number: '084154470445',
    url: 'https://track.shipmondo.com/gls/084154470445',
  };
  const shipments = lib.orderShipments(
    order(
      {},
      {
        fulfillments: [
          {
            id: 'gid://shopify/Fulfillment/2',
            createdAt: '2026-10-26T07:40:13Z',
            status: 'SUCCESS',
            trackingInfo: [parcel],
            events: {
              nodes: [event('IN_TRANSIT', '2026-10-26T15:00:00Z')],
            },
          },
          {
            id: 'gid://shopify/Fulfillment/1',
            createdAt: '2026-10-26T07:40:12Z',
            status: 'SUCCESS',
            trackingInfo: [parcel],
          },
          {
            id: 'gid://shopify/Fulfillment/3',
            createdAt: '2026-10-27T09:00:00Z',
            status: 'SUCCESS',
            trackingInfo: [{ company: 'GLS', number: '084154470446' }],
          },
        ],
      },
    ),
  );
  assert.deepEqual(
    shipments.map((s) => [s.id, s.trackingNumber, s.current]),
    [
      // The first created fulfillment keeps the identity; the tracking comes from the one with the transit event.
      ['gid://shopify/Fulfillment/1', '084154470445', 'transit'],
      ['gid://shopify/Fulfillment/3', '084154470446', 'printed'],
    ],
  );
  const twins = lib.orderShipments(
    order(
      {},
      {
        fulfillments: [
          {
            id: 'b',
            createdAt: '2026-10-26T07:40:13Z',
            status: 'SUCCESS',
            trackingInfo: [parcel],
          },
          {
            id: 'a',
            createdAt: '2026-10-26T07:40:12Z',
            status: 'SUCCESS',
            trackingInfo: [parcel],
          },
        ],
      },
    ),
  );
  assert.deepEqual(
    twins.map((s) => s.id),
    ['a'],
  );
});
