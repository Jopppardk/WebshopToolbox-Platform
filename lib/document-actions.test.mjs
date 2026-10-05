import test from 'node:test';
import assert from 'node:assert/strict';
import {databaseFixture,loader} from './automation-test-fixture.mjs';
test('both payout providers use the shared report action, without bookkeeping calls',async t=>{
 const h=databaseFixture();t.after(()=>h.sql.close());const calls=[];
 const id='gid://shopify/ShopifyPaymentsPayout/1';
 h.record('payout',id,{provider:'shopify_payments',status:'PAID',transactionType:'DEPOSIT'},'2026-09-10T12:00:00Z');
 const api=loader({'next/server':{NextResponse:{json:(data,options)=>({data,...options})}},'cloudflare:workers':{env:{}},'@/db/database':{prepareDatabase:async()=>h.db},'@/db/errors':{recordFailure:async()=>{}},'@/db/history':{loadHistory:async()=>({months:24,startDate:'2026-01-01'})},'@/db/credentials':{loadCredentials:async()=>null},'@/db/flatpay-report':{ensureFlatpayReport:async(_db,id)=>calls.push(id)},'@/lib/payout-report':{ensurePayoutReport:async(_db,id)=>calls.push(id)}})('app/api/documents/route.ts');
 const post=(externalId,origin='https://test')=>api.POST(new Request('https://test/api/documents',{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify({externalId})}));
 assert.equal((await post(id)).status,200);assert.equal((await post('flatpay:payout:m:a:1')).status,200);assert.deepEqual(calls,[id,'flatpay:payout:m:a:1']);
 assert.equal((await post(id,'https://other')).status,403);assert.equal((await post('invalid')).status,400);
 h.sql.prepare("UPDATE integration_records SET occurred_at='2020-01-01'").run();assert.equal((await post(id)).status,404);assert.equal(calls.length,2);
});
