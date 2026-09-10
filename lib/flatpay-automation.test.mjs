import test from 'node:test';
import assert from 'node:assert/strict';
import {databaseFixture,loader} from './automation-test-fixture.mjs';
const credentials={merchantID:'m',agreementId:'a',startDate:'2026-01-01'};

test('Flatpay sync resumes bounded history, refreshes recent data and resets on scope change',async t=>{
 const h=databaseFixture();t.after(()=>h.sql.close());h.set('admin_settings',{automation:{payouts:true,refunds:true}});
 const c={...credentials},calls=[];
 const api=loader({'./database':{database:()=>h.db},'./credentials':{loadCredentials:async()=>c},'./history':{loadHistory:async()=>({months:24,startDate:''})},'./flatpay-report':{}})('db/flatpay-sync.ts');
 let fail=false;const dispatch=async(path,body)=>{calls.push({path,body});return Response.json(fail?{error:'HTTP 503'}:{records:[],synced:0},{status:fail?503:200});};
 const now=new Date('2026-03-10T12:00:00Z');
 await api.syncFlatpay('payouts',dispatch,now);
 assert.deepEqual(calls.map(c=>[c.body.start,c.body.end]),[['2026-01-01','2026-01-28'],['2026-02-11','2026-03-10']]);
 assert.equal(h.get('flatpay_sync:payouts').next,'2026-01-29');
 fail=true;await assert.rejects(api.syncFlatpay('payouts',dispatch,now));assert.equal(h.get('flatpay_sync:payouts').next,'2026-01-29');
 fail=false;c.agreementId='b';calls.length=0;await api.syncFlatpay('payouts',dispatch,now);assert.equal(calls[0].body.start,'2026-01-01');
 h.set('admin_settings',{automation:{payouts:false,refunds:true}});calls.length=0;assert.equal((await api.syncFlatpay('payouts',dispatch,now)).status,'skipped');assert.equal(calls.length,0);
 await api.syncFlatpay('refunds',dispatch,now);assert.equal(calls[0].path,'/api/flatpay/refunds');assert.deepEqual(calls[0].body,{from:'2026-01-01',to:'2026-01-28'});
});

function bookFixture(t,mode='ok'){
 const h=databaseFixture();t.after(()=>h.sql.close());const id='flatpay:payout:m:a:1',guid='12345678-1234-1234-1234-123456789abc',key='flatpay_draft:org:'+id;
 const proposal={voucher:{FileGuid:'attachment'},expected:{}};
 h.set(key,{phase:'draft',organizationId:'org',guid,proposal});let posts=0;
 const api=loader({'./database':{database:()=>h.db},'./credentials':{},'./flatpay-draft':{},'./errors':{recordFailure:async()=>{}},'@/lib/dinero-sale':{verifyVoucher:value=>value},'./dinero-client':{dineroClient:async()=>async(path,method)=>{if(method==='POST'){posts++;if(mode==='timeout')throw Error('timeout');return {Guid:guid,Status:'Booked'};}return {Guid:guid,Status:mode==='booked'?'Booked':'Draft',Timestamp:'version'};}}})('db/flatpay-automation.ts');
 return {...h,key,posts:()=>posts,run:()=>api.bookFlatpay(id,{organizationId:'org'})};
}
test('concurrent booking claims one draft and never repeats booked or uncertain writes',async t=>{
 const h=bookFixture(t);await Promise.allSettled([h.run(),h.run()]);assert.equal(h.posts(),1);assert.equal(h.get(h.key).phase,'booked');await h.run();assert.equal(h.posts(),1);
 const failed=bookFixture(t,'timeout');await assert.rejects(failed.run());assert.equal(failed.get(failed.key).phase,'uncertain');await assert.rejects(failed.run());assert.equal(failed.posts(),1);
 const already=bookFixture(t,'booked');await already.run();assert.equal(already.posts(),0);assert.equal(already.get(already.key).phase,'booked');
});
test('booking requires attached PDF and matching Dinero organization',async t=>{
 const h=bookFixture(t);h.set(h.key,{phase:'draft',organizationId:'other',guid:'g',proposal:{voucher:{}}});await assert.rejects(h.run());assert.equal(h.posts(),0);
});

test('production activation and account scope gate all automatic Flatpay writes',async t=>{
 const h=databaseFixture();t.after(()=>h.sql.close());let writes=0;
 const api=loader({'./database':{database:()=>h.db},'./credentials':{loadCredentials:async p=>p==='flatpay'?credentials:{organizationId:'org'}},'./flatpay-draft':{flatpayDraftAction:async()=>{writes++;}},'./errors':{},'./dinero-client':{}})('db/flatpay-automation.ts');
 assert.equal((await api.runFlatpayAutomation()).status,'skipped');
 h.set('flatpay_production',{enabled:true,...credentials,organizationId:'other'});assert.equal((await api.runFlatpayAutomation()).status,'skipped');assert.equal(writes,0);
});

test('Flatpay dashboard counts only selected agreement, day and current ledger receipts',async t=>{
 const h=databaseFixture();t.after(()=>h.sql.close());const today='2026-09-10T12:00:00Z';
 h.set('flatpay:payout:m:a:1',{...credentials,agreementID:'a',paidDate:today});
 h.set('flatpay:payout:m:a:2',{...credentials,agreementID:'a',scheduledDate:today});
 h.set('flatpay:payout:m:b:3',{...credentials,agreementID:'b',paidDate:today});
 h.set('flatpay_draft:org:flatpay:payout:m:a:1',{phase:'draft'});
 h.set('flatpay_draft:old:flatpay:payout:m:a:2',{phase:'booked'});
 const api=loader({'./credentials':{loadCredentials:async p=>p==='flatpay'?credentials:{organizationId:'org'}}})('db/flatpay-activity.ts');
 assert.deepEqual({...await api.flatpayActivity(h.db,new Date(today))},{total:2,synced:1,failed:0,pending:1});
});

test('scheduler runs Flatpay independently and gates Dinero on successful payout import',async t=>{
 const h=databaseFixture();t.after(()=>h.sql.close());const jobs=[];let fails=true,books=0;
 const worker=loader({
  './dist/server/index.js':{default:{fetch:async()=>Response.json({})}},
  './db/database':{database:()=>h.db},'./db/errors':{recordFailure:async()=>{}},
  './db/emballage-monitor':{monitorEmballagePeriods:async()=>{}},'./db/dashboard-finance':{syncDashboardFinance:async()=>{}},
  './db/sync-cycle':{runSyncCycle:async(_at,fn)=>fn()},'./db/paginated-sync':{runPaginatedSync:async()=>{throw Error('Shopify unavailable');}},
  './db/sales-automation':{},'./db/refund-automation':{},'./db/payout-automation':{},
  './db/job-runs':{runTrackedJob:async(key,_name,fn)=>{jobs.push(key);return fn();}},
  './db/flatpay-sync':{syncFlatpay:async kind=>{if(kind==='payouts'&&fails)throw Error('Flatpay unavailable');return {message:'ok'};},syncFlatpayReports:async()=>({message:'ok'})},
  './db/flatpay-automation':{runFlatpayAutomation:async()=>{books++;}},
 })('worker-entry.ts').default;
 const tick=async()=>{const pending=[];await worker.scheduled({scheduledTime:0},{},{waitUntil:p=>pending.push(p)});await Promise.all(pending);};
 await tick();assert.equal(books,0);assert.ok(jobs.includes('flatpay-refunds'));assert.ok(jobs.includes('flatpay-reports'));
 fails=false;await tick();assert.equal(books,1);
});
