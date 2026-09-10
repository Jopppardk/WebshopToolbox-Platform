import test from 'node:test';
import assert from 'node:assert/strict';
import {loader,databaseFixture} from './automation-test-fixture.mjs';
const raw={transactionID:'123',merchantID:'m',agreementID:'a',transactionCode:'REFU06',purchaseDate:'2026-09-08T12:00:00Z',currency:'DKK',grossAmount:-100,fees:1.2345,netAmount:-101.2345,settlementNumber:'55',cardNumber:'must not store',arn:'must not store'};
test('Flatpay refund uses explicit code, preserves precision and removes payment-card data',()=>{
 const {flatpayRefund}=loader()('lib/flatpay-refunds.ts');const r=flatpayRefund(raw,'m','a');
 assert.equal(r.fee.amount,'1.2345');assert.equal(r.feeMinor,123);assert.equal(r.netMinor,-10123);assert.equal(r.cardNumber,undefined);assert.equal(r.arn,undefined);
 for(const code of ['SALE05','CHABAC','REJE16','SARV25','UNKNOWN'])assert.equal(flatpayRefund({...raw,transactionCode:code},'m','a'),null);
 assert.equal(flatpayRefund(raw,'other','a'),null);assert.equal(flatpayRefund(raw,'m','other'),null);
 assert.throws(()=>flatpayRefund({...raw,fees:NaN},'m','a'));
});
function fixture(t){const h=databaseFixture();t.after(()=>h.sql.close());const creds={username:'x',password:'y',merchantID:'m',agreementId:'a',startDate:'2026-09-05'};const overrides={'next/server':{NextResponse:{json:(data,options)=>({data,...options})}},'@/db/database':{prepareDatabase:async()=>h.db},'@/db/credentials':{loadCredentials:async()=>creds},'@/db/history':{loadHistory:async()=>({months:120,startDate:'2026-01-01'})}};return {...h,creds,overrides};}
test('refund fetch is scoped, idempotent, start-date limited and outside accounting queue',async t=>{
 const h=fixture(t),queries=[];
 const api=loader({...h.overrides,'@/lib/flatpay-api':{flatpayRead:async(c,k,q)=>{queries.push(q);return [raw,{...raw,transactionID:'foreign',merchantID:'other'},{...raw,transactionID:'sale',transactionCode:'SALE05'},{...raw,transactionID:'early',purchaseDate:'2026-09-01T00:00:00Z'}];}}})('app/api/flatpay/refunds/route.ts');
 const req=extra=>new Request('https://test/api/flatpay/refunds',{method:'POST',headers:{origin:'https://test','content-type':'application/json'},body:JSON.stringify({from:'2026-09-01',to:'2026-09-09',...extra})});
 assert.equal((await api.POST(req())).data.synced,1);await api.POST(req());assert.equal(h.sql.prepare('SELECT count(*) n FROM app_settings').get().n,1);assert.equal(h.sql.prepare('SELECT count(*) n FROM integration_records').get().n,0);
 assert.equal(queries[0].TransactionCode,'REFU06');assert.equal(queries[0].PurchaseDateFrom,'2026-09-04T22:00:00.000Z');
 assert.equal((await api.POST(req({after:'2020-01-01T00:00:00.000Z'}))).status,422);
 assert.equal((await api.POST(req({from:'2026-09-01',to:'2026-09-02'}))).data.synced,0);
});
test('combined refund list paginates across providers and scopes summary and search equally',async t=>{
 const h=fixture(t),{flatpayRefund}=loader()('lib/flatpay-refunds.ts');
 for(let i=0;i<51;i++)h.record('refund','shop'+i,{provider:'shopify_payments',associatedOrder:{name:'#100'},feeMinor:0,netMinor:-12500},'2026-09-07T12:00:00Z');
 const r=flatpayRefund(raw,'m','a');h.set(r.id,r);h.set('flatpay:refund:other:a:123',{...r,merchantID:'other'});
 const api=loader(h.overrides)('app/api/refunds/overview/route.ts');const get=(offset=0,search='')=>api.GET({nextUrl:new URL('https://test/api/refunds/overview?'+new URLSearchParams({from:'2026-09-01',to:'2026-09-09',offset:String(offset),search}))});
 const first=(await get()).data,last=(await get(50)).data;assert.equal(first.payments.length,50);assert.equal(last.payments.length,2);assert.equal(first.summary[0].count,52);assert.equal(first.payments[0].provider,'flatpay');assert.equal(first.payments[0].bookingStatus,'not_enabled');assert.ok(!last.payments.some(p=>first.payments.some(q=>q.id===p.id)));
 assert.equal((await get(0,'123')).data.summary[0].count,1);assert.equal((await get(0,'#100')).data.summary[0].count,51);
 h.creds.merchantID='not-connected';assert.equal((await get()).data.summary[0].count,51);
});
test('large Flatpay refund ranges use bounded pages with an exclusive next boundary',async t=>{
 const h=fixture(t);h.creds.startDate='2026-01-01';const queries=[];
 const api=loader({...h.overrides,'@/lib/flatpay-api':{flatpayRead:async(c,k,q)=>{queries.push(q);return [];}}})('app/api/flatpay/refunds/route.ts');
 const req=after=>new Request('https://test/api/flatpay/refunds',{method:'POST',headers:{origin:'https://test','content-type':'application/json'},body:JSON.stringify({from:'2026-07-01',to:'2026-09-09',after})});
 const first=(await api.POST(req())).data;assert.equal(first.hasNextPage,true);await api.POST(req(first.endCursor));assert.equal(queries[1].PurchaseDateFrom,first.endCursor);assert.equal(Date.parse(queries[0].PurchaseDateTo)+1,Date.parse(first.endCursor));
});
