import test from 'node:test';
import assert from 'node:assert/strict';
import { loader } from './automation-test-fixture.mjs';
const { orderLog, logTimestamp } = loader()('lib/order-log.ts');
const record = (payload, created_at = '2026-09-01 10:00:00') => ({ payload_json: JSON.stringify(payload), created_at, booking_status: 'pending' });
test('timeline preserves original import, shipment and generated timestamps and sorts UTC', () => {
 const result = orderLog(record({name:'#2639',createdAt:'2026-09-01T09:00:00Z',fulfillments:[{status:'SUCCESS',createdAt:'2026-09-02T10:00:00Z'},{status:'CANCELLED',createdAt:'2026-09-03T10:00:00Z'}]}),record({generatedAt:'2026-09-02T10:01:00Z'}),null,[]);
 assert.equal(result.events[1].at,'2026-09-01T10:00:00.000Z');
 assert.equal(result.events.filter(e=>e.title.includes('Afsendelse registreret')).length,1);
 assert.equal(result.events.find(e=>e.title==='Faktura-PDF genereret').at,'2026-09-02T10:01:00.000Z');
 assert.equal(logTimestamp('bad'),null);
});
test('test mail never counts as customer delivery; ambiguous sends never claim success', () => {
 const result=orderLog(record({}),null,null,[{delivery_mode:'test',status:'sent',updated_at:'2026-09-01 12:00:00'}]);
 assert.ok(result.events.some(e=>e.title==='Fakturamail til kunden'&&e.detail.includes('Ingen afsendelse')));
 const pending=orderLog(record({}),null,null,[{delivery_mode:'customer',status:'sending',updated_at:'2026-09-01 12:00:00'}]);
 assert.ok(pending.events.some(e=>e.title.includes('afventer bekræftelse')&&e.tone==='warning'));
});
test('legacy fulfilled orders and invoices do not invent missing event dates', () => {
 const result=orderLog(record({displayFulfillmentStatus:'FULFILLED'}),record({}),null,[]);
 assert.equal(result.events.find(e=>e.title==='Afsendelse').at,null);
 assert.equal(result.events.find(e=>e.title==='Faktura-PDF genereret').at,null);
});
