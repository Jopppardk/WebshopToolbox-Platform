import test from 'node:test';
import assert from 'node:assert/strict';
import {loader,databaseFixture} from './automation-test-fixture.mjs';
const guid='12345678-1234-1234-1234-123456789abc';
function fixture(t,kind='flatpay',mode='missing',phase='uncertain'){
 const h=databaseFixture();t.after(()=>h.sql.close());
 const id=kind==='flatpay'?'flatpay:payout:m:a:1':`gid://shopify/${kind==='sale'?'Order':kind==='refund'?'ShopifyPaymentsTransaction':'ShopifyPaymentsPayout'}/1`;
 const key=kind==='flatpay'?`flatpay_draft:org:${id}`:`${kind==='sale'?'sales_transfer':kind+'_production'}:${id}`;
 const voucher={VoucherDate:'2026-09-10',ExternalReference:'test',Lines:[]},snapshot={voucher,expected:[]};
 const state={phase,updatedAt:'2020-01-01T00:00:00Z',organizationId:'org',...(mode==='no-guid'?{}:{guid}),...(kind==='flatpay'?{proposal:snapshot}:{snapshot})};h.set(key,state);
 if(kind==='flatpay')h.set(id,{merchantID:'m',agreementID:'a',paidDate:'2026-09-10'});
 else h.record(kind==='sale'?'order':kind,id,{provider:'shopify_payments',displayFulfillmentStatus:'FULFILLED',createdAt:'2026-09-10',fulfillments:[{status:'SUCCESS',createdAt:'2026-09-10'}]});
 h.set('admin_settings',{accounts:{},automation:{salesBookDinero:true,payoutsBookDinero:true}});
 const calls=[];
 class HttpError extends Error{constructor(status){super('HTTP '+status);this.status=status;}}
 async function complete(){calls.push('execute');h.set(key,{...state,phase:'booked'});return {message:'Bogført'};}
 const api=loader({'./database':{database:()=>h.db},'./credentials':{loadCredentials:async p=>p==='flatpay'?{merchantID:'m',agreementId:'a',startDate:'2020-01-01'}:{organizationId:'org'}},
 './dinero-client':{DineroHttpError:HttpError,dineroClient:async()=>async()=>{calls.push('GET');if(mode==='missing')throw new HttpError(404);if(mode==='unavailable')throw new HttpError(503);if(mode==='invalid')return null;return {...voucher,Guid:guid,Timestamp:'v',Status:mode==='booked'?'Booked':'Draft'};}},
 './sales-transfer':{runTransfer:async()=>{await complete();return {state:{phase:'booked',snapshot:{invoiceNumber:'1'}}};}},
 './payout-automation':{runSinglePayout:complete},'./refund-automation':{runSingleRefund:complete},
 './flatpay-draft':{flatpayDraftAction:async()=>{await complete();return {phase:'booked'};}},'./flatpay-automation':{bookFlatpay:async()=>{}},
 '@/lib/admin-settings':{validateSettings:x=>x},'@/lib/invoice-check':{shipmentDate:()=> '2026-09-10'},
 })('db/manual-booking.ts');
 return {...h,key,id,state,calls,run:(action,extra={})=>api.manualBooking({kind,externalId:id,action,...extra},'test@example.com')};
}
for(const kind of ['sale','payout','refund','flatpay'])test(`${kind}: explicit confirmation reopens missing voucher and audits prior receipt`,async t=>{
 const f=fixture(t,kind);const p=await f.run('inspect');assert.equal(f.calls.length,0);
 await assert.rejects(f.run('retry',{version:p.version}),/Bekræft/);assert.equal(f.calls.length,0);
 await f.run('retry',{version:p.version,confirmed:true});assert.deepEqual(f.calls,['GET','execute']);assert.equal(f.get(f.key).phase,'booked');
 const audit=f.sql.prepare("SELECT setting_value FROM app_settings WHERE setting_key LIKE 'manual_booking:%'").get();assert.equal(JSON.parse(audit.setting_value).previous.phase,'uncertain');assert.equal(JSON.parse(audit.setting_value).outcome,'completed');
});
test('existing booked voucher repairs local receipt without another write',async t=>{
 const f=fixture(t,'payout','booked');const p=await f.run('inspect');await f.run('retry',{version:p.version,confirmed:true});assert.deepEqual(f.calls,['GET']);assert.equal(f.get(f.key).phase,'booked');assert.equal(f.sql.prepare("SELECT booking_status FROM integration_records WHERE external_id=?").get(f.id).booking_status,'booked');
});
test('503 never authorizes reset and retains original GUID',async t=>{
 const f=fixture(t,'flatpay','unavailable');const p=await f.run('inspect');await assert.rejects(f.run('retry',{version:p.version,confirmed:true}),/503/);assert.deepEqual(f.calls,['GET']);assert.equal(f.get(f.key).guid,guid);assert.equal(f.get(f.key).phase,'uncertain');
});
test('missing GUID needs confirmation; simultaneous and stale requests cannot both retry',async t=>{
 const f=fixture(t,'flatpay','no-guid');const p=await f.run('inspect');const results=await Promise.allSettled([f.run('retry',{version:p.version,confirmed:true}),f.run('retry',{version:p.version,confirmed:true})]);assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.deepEqual(f.calls,['execute']);
});
test('fresh running claims, foreign ledger, test and archived receipts are blocked',async t=>{
 const f=fixture(t);for(const state of [{...f.state,phase:'creating',updatedAt:new Date().toISOString()},{...f.state,organizationId:'other'},{...f.state,draftTest:true},{...f.state,phase:'archived'}]){f.set(f.key,state);await assert.rejects(f.run('inspect'));}assert.equal(f.calls.length,0);
});
test('cancelled or unshipped order cannot be manually booked',async t=>{
 const f=fixture(t,'sale');f.sql.prepare("UPDATE integration_records SET payload_json=? WHERE external_id=?").run(JSON.stringify({cancelledAt:'2026-09-10',displayFulfillmentStatus:'FULFILLED'}),f.id);await assert.rejects(f.run('inspect'),/annullerede/);
});

test('known draft is resumed with its GUID instead of creating a fresh receipt',async t=>{
 const f=fixture(t,'payout','draft');const p=await f.run('inspect');await f.run('retry',{version:p.version,confirmed:true});assert.deepEqual(f.calls,['GET','execute']);assert.equal(f.get(f.key).guid,guid);
});
test('a changed receipt invalidates the confirmation',async t=>{
 const f=fixture(t);const p=await f.run('inspect');f.set(f.key,{...f.state,message:'Changed'});await assert.rejects(f.run('retry',{version:p.version,confirmed:true}),/Bekræft/);assert.equal(f.calls.length,0);
});
test('invalid HTTP 200 response cannot be interpreted as a missing voucher',async t=>{
 const f=fixture(t,'flatpay','invalid');const p=await f.run('inspect');await assert.rejects(f.run('retry',{version:p.version,confirmed:true}));assert.deepEqual(f.calls,['GET']);assert.equal(f.get(f.key).guid,guid);
});
test('manual booking endpoint rejects cross-origin requests before invoking recovery',async()=>{
 let calls=0;
 const api=loader({'@/db/manual-booking':{manualBooking:async()=>{calls++;return {};}},'next/server':{NextResponse:{json:(data,options)=>({data,...options})}}})('app/api/bookkeeping/manual/route.ts');
 const result=await api.POST(new Request('https://toolbox/api/bookkeeping/manual',{method:'POST',headers:{origin:'https://other','content-type':'application/json'},body:'{}'}));assert.equal(result.status,403);assert.equal(calls,0);
});
