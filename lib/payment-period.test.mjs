import test from 'node:test';
import assert from 'node:assert/strict';
import { loader } from './automation-test-fixture.mjs';

const { paymentPeriod } = loader()('lib/shopify-payments.ts');
const policy = { months: 24, startDate: '' };

for (const [name, now, today, start, end] of [
  [
    'summer midnight',
    '2026-09-07T22:01:00Z',
    '2026-09-08',
    '2026-09-07T22:00:00.000Z',
    '2026-09-08T22:00:00.000Z',
  ],
  [
    'winter midnight',
    '2026-01-07T23:01:00Z',
    '2026-01-08',
    '2026-01-07T23:00:00.000Z',
    '2026-01-08T23:00:00.000Z',
  ],
  [
    'spring clock change',
    '2026-03-28T23:01:00Z',
    '2026-03-29',
    '2026-03-28T23:00:00.000Z',
    '2026-03-29T22:00:00.000Z',
  ],
  [
    'autumn clock change',
    '2026-10-24T22:01:00Z',
    '2026-10-25',
    '2026-10-24T22:00:00.000Z',
    '2026-10-25T23:00:00.000Z',
  ],
]) {
  test(`payment period accepts Danish today at ${name}`, (t) => {
    t.mock.timers.enable({ apis: ['Date'], now: new Date(now) });
    assert.deepEqual(paymentPeriod(today, today, policy), { start, end });
    const tomorrow = new Date(`${today}T00:00:00Z`);
    tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
    assert.throws(
      () => paymentPeriod(today, tomorrow.toISOString().slice(0, 10), policy),
      /gyldig periode/,
    );
  });
}

test('payment period still rejects tomorrow before Danish midnight and invalid dates', (t) => {
  t.mock.timers.enable({
    apis: ['Date'],
    now: new Date('2026-09-07T21:59:00Z'),
  });
  assert.throws(
    () => paymentPeriod('2026-09-07', '2026-09-08', policy),
    /gyldig periode/,
  );
  assert.throws(
    () => paymentPeriod('2026-02-30', '2026-09-07', policy),
    /gyldig periode/,
  );
  assert.throws(
    () => paymentPeriod('2026-09-07', '2026-09-06', policy),
    /gyldig periode/,
  );
  assert.deepEqual(
    paymentPeriod('2026-09-01', '2026-09-07', {
      months: 24,
      startDate: '2026-09-05',
    }),
    {
      start: '2026-09-04T22:00:00.000Z',
      end: '2026-09-07T22:00:00.000Z',
    },
  );
});
