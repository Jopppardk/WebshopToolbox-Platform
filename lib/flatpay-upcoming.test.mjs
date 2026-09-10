import test from 'node:test';
import assert from 'node:assert/strict';
import {databaseFixture,loader} from './automation-test-fixture.mjs';
const c={username:'x',password:'y',merchantID:'m',agreementId:'a',agreementNumber:'466127',startDate:'2026-09-10'};
const settlement={merchantID:'m',agreementNumber:'466127',settlementNumber:'59600626',scheduledDate:'2026-09-11T00:00:00',paidDate:null,currency:'DKK',netSettlement:1263.14,payout:0,iban:'private'};
function fixture(t){const h=databaseFixture();t.after(()=>h.sql.close());let rows=[settlement],fail=false;const overrides={'@/lib/flatpay-api':{flatpayRead:async(_c,kind,q)=>{assert.equal(kind,'settlements');assert.equal(q.AgreementNumber,'466127');if(fail)throw Error('HTTP 503');return rows;}}};const api=loader(overrides)('db/flatpay-upcoming.ts');return {...h,...api,rows:v=>{rows=v;},fail:()=>{fail=true;}};}
test('upcoming settlements use expected net, preserve start date, hide card fields and never enter accounting queue',async t=>{
 const h=fixture(t);h.rows([settlement,{...settlement,settlementNumber:'2',merchantID:'other'},{...settlement,settlementNumber:'3',paidDate:'2026-09-11'},{...settlement,settlementNumber:'4',scheduledDate:'2026-09-09'}]);
 assert.equal(await h.refreshFlatpayUpcoming(h.db,c,'2026-09-10','2026-10-10'),1);
 const entries=await h.readFlatpayUpcoming(h.db,c);assert.equal(entries[0].payoutAmount,1263.14);assert.equal(entries[0].paidDate,null);assert.equal(entries[0].iban,undefined);assert.ok(entries[0].id.startsWith('flatpay:upcoming:'));
 assert.deepEqual(await h.readFlatpayUpcoming(h.db,{...c,startDate:'2026-09-12'}),[]);assert.deepEqual(await h.readFlatpayUpcoming(h.db,{...c,agreementId:'other'}),[]);
 assert.equal(h.sql.prepare("SELECT COUNT(*) n FROM app_settings WHERE substr(setting_key,1,15)='flatpay:payout:'").get().n,0);
});
test('actual bank payment replaces estimates, including combined settlements and stale snapshots',async t=>{
 const h=fixture(t);await h.refreshFlatpayUpcoming(h.db,c,'2026-09-10','2026-10-10');
 h.set('flatpay:payout:m:a:1',{merchantID:'m',agreementID:'a',settlements:'111; 59600626,222',paidDate:'2026-09-11'});
 assert.deepEqual(await h.readFlatpayUpcoming(h.db,c),[]);
});
test('failed or invalid upstream data preserves snapshot, successful empty response clears it',async t=>{
 const h=fixture(t);await h.refreshFlatpayUpcoming(h.db,c,'2026-09-10','2026-10-10');
 h.rows([{...settlement,netSettlement:null}]);await assert.rejects(h.refreshFlatpayUpcoming(h.db,c,'2026-09-10','2026-10-10'));assert.equal((await h.readFlatpayUpcoming(h.db,c)).length,1);
 h.rows([]);await h.refreshFlatpayUpcoming(h.db,c,'2026-09-10','2026-10-10');assert.deepEqual(await h.readFlatpayUpcoming(h.db,c),[]);
 h.fail();await assert.rejects(h.refreshFlatpayUpcoming(h.db,c,'2026-09-10','2026-10-10'));
});
test('shared payout overview includes expected settlements in pagination and prohibits booking',async t=>{
 const h=fixture(t);await h.refreshFlatpayUpcoming(h.db,c,'2026-09-10','2026-10-10');
 h.set('flatpay:payout:m:a:paid',{merchantID:'m',agreementID:'a',paymentID:'paid',settlements:'123',paidDate:'2026-09-10',payoutAmount:1737.68,currency:'DKK'});
 const api=loader({'next/server':{NextResponse:{json:(data,options)=>({data,...options})}},'@/db/database':{prepareDatabase:async()=>h.db},'@/db/credentials':{loadCredentials:async p=>p==='flatpay'?c:{organizationId:'org'}},'@/db/history':{loadHistory:async()=>({months:120,startDate:'2026-09-10'})}})('app/api/payouts/overview/route.ts');
 const result=await api.GET({nextUrl:new URL('https://test/api/payouts/overview')});assert.equal(result.data.total,2);assert.equal(result.data.payouts[0].amount,1263.14);assert.equal(result.data.payouts[0].status,'Kommende');assert.equal(result.data.payouts[0].canBook,false);assert.equal(result.data.payouts[0].booking,'expected');
});
