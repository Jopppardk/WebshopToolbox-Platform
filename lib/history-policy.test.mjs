import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateHistory, historyWindow, shiftMonths } from './history-policy.ts';
test('rolling window and import start choose the later boundary', () => {
  const now = new Date('2026-09-04T10:00:00Z');
  assert.equal(historyWindow({ months: 12, startDate: '' }, now).effectiveDate, '2025-09-04');
  assert.equal(historyWindow({ months: 12, startDate: '2026-01-01' }, now).effectiveDate, '2026-01-01');
  assert.equal(historyWindow({ months: 12, startDate: '2024-01-01' }, now).effectiveDate, '2025-09-04');
  assert.equal(historyWindow({ months: 12, startDate: '2026-01-01' }, now).retentionCutoff, '2025-09-03T22:00:00.000Z');
});
test('calendar month shifting clamps end of month and leap years', () => {
  assert.equal(shiftMonths(new Date('2026-03-31T00:00:00Z'), -1).toISOString(), '2026-02-28T00:00:00.000Z');
  assert.equal(shiftMonths(new Date('2024-02-29T00:00:00Z'), 12).toISOString(), '2025-02-28T00:00:00.000Z');
});
test('invalid dates and retention values are rejected', () => {
  for (const months of [0, 121, -1, 1.5, NaN]) assert.throws(() => validateHistory({ months, startDate: '' }));
  for (const startDate of ['2026-02-30', 'garbage', '2026-9-4']) assert.throws(() => validateHistory({ months: 12, startDate }));
  assert.deepEqual(validateHistory({ months: 120, startDate: '' }), { months: 120, startDate: '' });
});
