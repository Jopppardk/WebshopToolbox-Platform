import test from 'node:test';
import assert from 'node:assert/strict';
import {loader,databaseFixture} from './automation-test-fixture.mjs';
const access={username:'api-user',password:'secret-example'};
test('Flatpay only issues authenticated GET requests to fixed HTTPS host',async()=>{
 const seen=[];const api=loader({fetch:async(url,options)=>{seen.push({url,options});return Response.json({transactions:[]});}})('lib/flatpay-api.ts');
 await api.flatpayRead(access,'transactions',{SettlementNumber:'abc / 1'});
 assert.equal(new URL(seen[0].url).origin,'https://api.saga.valitor.com');assert.equal(seen[0].options.method,'GET');assert.equal(seen[0].options.redirect,'manual');assert.equal(seen[0].options.headers.Authorization,'Basic '+btoa('api-user:secret-example'));
 await assert.rejects(api.flatpayRead(access,'../other'));assert.equal(seen.length,1);
});
test('credentials and upstream error bodies never appear in errors; redirects rejected',async()=>{
 for(const status of [301,401,403,400]){let calls=0;const api=loader({fetch:async()=>{calls++;return new Response('secret-example',{status});}})('lib/flatpay-api.ts');await assert.rejects(api.flatpayRead(access,'agreements'),e=>!e.message.includes('secret-example'));assert.equal(calls,1);}
});
test('read retries are bounded and malformed envelopes fail',async()=>{
 let calls=0;const api=loader({fetch:async()=>{calls++;return new Response('',{status:503});}})('lib/flatpay-api.ts');await assert.rejects(api.flatpayRead(access,'agreements'));assert.equal(calls,3);
 const malformed=loader({fetch:async()=>Response.json({wrong:[]})})('lib/flatpay-api.ts');await assert.rejects(malformed.flatpayRead(access,'transactions'));
});
test('date bounds prohibit history before configured start and long scans',()=>{
 const api=loader()('lib/flatpay-api.ts');api.flatpayDateRange('2026-08-01','2026-08-31','2026-08-01');assert.throws(()=>api.flatpayDateRange('2026-07-31','2026-08-01','2026-08-01'));assert.throws(()=>api.flatpayDateRange('2026-08-01','2026-09-01','2026-08-01'));
});
test('records are scoped to selected agreement and exclude card data',async()=>{
 const api=loader({'next/server':{NextResponse:{json:(data,options)=>({data,...options})}},'@/db/credentials':{loadCredentials:async()=>({...access,merchantID:'m1',agreementId:'a1',agreementNumber:'100',startDate:'2026-08-01'})},'@/lib/flatpay-api':{flatpayDateRange:()=>{},flatpayRead:async()=>[{merchantID:'m1',agreementID:'a1',purchaseDate:'2026-08-02',transactionID:'t1',grossAmount:100,cardNumberSorted:'sensitive'},{merchantID:'m2',agreementID:'a2',purchaseDate:'2026-08-02',transactionID:'t2'}]}})('app/api/flatpay/records/route.ts');
 const req=origin=>new Request('https://integration.test/api/flatpay/records',{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify({kind:'transactions',start:'2026-08-01',end:'2026-08-03'})});
 assert.equal((await api.POST(req('https://other.test'))).status,403);const result=await api.POST(req('https://integration.test'));assert.equal(result.data.records.length,1);assert.equal(result.data.records[0].transactionID,'t1');assert.equal('cardNumberSorted' in result.data.records[0],false);
});
test('Flatpay encrypted credentials are automatically selected in library',async t=>{
 const h=databaseFixture();t.after(()=>h.sql.close());h.set('flatpay_credentials',{ciphertext:'encrypted'});const api=loader()('db/integration-selection.ts');const result=await api.integrationSelection(h.db);assert.ok(result.connected.includes('flatpay'));assert.ok(result.selected.includes('flatpay'));
});

test('documented null lists and empty arrays are accepted for every resource',async()=>{
 for(const resource of ['agreements','transactions','settlements','payments'])for(const value of [null,[]]){
 const api=loader({fetch:async()=>Response.json({[resource]:value})})('lib/flatpay-api.ts');assert.deepEqual(await api.flatpayRead(access,resource),[]);
 }
});
test('missing and malformed lists remain errors with safe structural diagnostics',async()=>{
 for(const value of [{error:'secret-example'},[],null,{transactions:'secret-example'}]){
 const api=loader({fetch:async()=>Response.json(value)})('lib/flatpay-api.ts');await assert.rejects(api.flatpayRead(access,'transactions'),e=>e.message.includes('/transactions')&&!e.message.includes('secret-example'));
 }
});
