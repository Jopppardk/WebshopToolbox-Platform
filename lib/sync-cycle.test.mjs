import test from 'node:test';
import assert from 'node:assert/strict';
import { databaseFixture, loader } from './automation-test-fixture.mjs';
function harness() {
  const h = databaseFixture();
  const load = loader({ './database': { database: () => h.db }, '@/db/database': { prepareDatabase: async () => h.db }, 'next/server': { NextResponse: { json: (data, options) => ({ data, ...options }) } } });
  return { ...h, ...load('db/sync-cycle.ts'), api: load('app/api/admin/sync-status/route.ts'), schedule: load('lib/sync-schedule.ts') };
}
test('overlapping cron calls and duplicate delivery execute only one cycle', async t => {
  const h = harness(); t.after(() => h.sql.close());
  let release, calls = 0;
  const gate = new Promise(resolve => { release = resolve; });
  const first = h.runSyncCycle(60000, async () => { calls++; await gate; return { failed: false }; });
  await new Promise(resolve => setImmediate(resolve));
  await h.runSyncCycle(120000, async () => { calls++; return { failed: false }; });
  assert.equal(h.get(h.cycleKey).status, 'running');
  release(); await first;
  await h.runSyncCycle(60000, async () => { calls++; return { failed: false }; });
  assert.equal(calls, 1); assert.equal(h.get(h.cycleKey).status, 'succeeded');
  await h.runSyncCycle(180000, async () => { calls++; return { failed: true }; });
  assert.equal(calls, 2); assert.equal(h.get(h.cycleKey).status, 'failed');
});
test('exceptions release the cycle with a recorded failure', async t => {
  const h = harness(); t.after(() => h.sql.close());
  await assert.rejects(h.runSyncCycle(60000, async () => { throw Error('failure'); }));
  const state = h.get(h.cycleKey); assert.equal(state.status, 'failed'); assert.equal(state.leaseUntil, 0); assert.ok(state.lastFinishedAt);
});
test('expired cycle is visible and can be reclaimed without clearing transfer receipts', async t => {
  const h = harness(); t.after(() => h.sql.close());
  h.set(h.cycleKey, { owner: 'old', scheduledTime: 0, startedAt: new Date(Date.now() - 21 * 60000).toISOString(), status: 'running', leaseUntil: Date.now() - 1 });
  assert.equal((await h.api.GET()).data.status, 'interrupted');
  h.set('refund_production:123', { phase: 'uncertain' });
  await h.runSyncCycle(60000, async () => ({ failed: false }));
  assert.equal(h.get(h.cycleKey).status, 'succeeded'); assert.equal(h.get('refund_production:123').phase, 'uncertain');
});
test('status reads the persisted interval and uses server time for next start', async t => {
  const h = harness(); t.after(() => h.sql.close());
  for (const interval of [1, 5, 10, 15, 30, 60]) {
    h.set('admin_settings', { syncIntervalMinutes: interval });
    const result = await h.api.GET();
    assert.equal(result.data.intervalMinutes, interval);
    assert.equal(result.data.nextScheduledAt % (interval * 60000), 0);
    assert.ok(result.data.nextScheduledAt > result.data.serverNow);
    assert.equal(h.schedule.scheduledRunIsDue(result.data.nextScheduledAt, interval), true);
    assert.equal(result.headers['Cache-Control'], 'no-store');
  }
});
test('completion cannot overwrite a newer owner', async t => {
  const h = harness(); t.after(() => h.sql.close());
  await assert.rejects(h.runSyncCycle(60000, async () => { h.set(h.cycleKey, { owner: 'replacement', scheduledTime: 120000, leaseUntil: Date.now() + 60000 }); return { failed: false }; }), /slutstatus/);
  assert.equal(h.get(h.cycleKey).owner, 'replacement');
});
