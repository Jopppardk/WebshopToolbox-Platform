import test from 'node:test';
import assert from 'node:assert/strict';
import {databaseFixture,loader} from './automation-test-fixture.mjs';

test('Manual Flatpay import respects start/history, refreshes recent data without changing automatic progress',async t=>{
 const h=databaseFixture();t.after(()=>h.sql.close());
 h.set('admin_settings',{automation:{payouts:false}});
 const c={merchantID:'m',agreementId:'a',startDate:'2026-01-01'};
 const progress={scope:JSON.stringify(['m','a','2026-02-01']),next:'2026-02-10'};
 h.set('flatpay_sync:payouts',progress);
 const api=loader({'./database':{database:()=>h.db},'./credentials':{loadCredentials:async()=>c},'./history':{loadHistory:async()=>({months:24,startDate:'2026-02-01'})},'./flatpay-report':{}})('db/flatpay-sync.ts');
 const calls=[];const dispatch=async(path,body)=>{calls.push({path,body});return Response.json({records:[],reportWarnings:['Report unavailable']});};
 const now=new Date('2026-04-10T12:00:00Z');
 const result=await api.syncFlatpay('payouts',dispatch,now,true);
 assert.deepEqual(calls.map(c=>c.body),[{kind:'payments',start:'2026-02-10',end:'2026-03-09'},{kind:'payments',start:'2026-03-14',end:'2026-04-10'}]);
 assert.ok(calls.every(c=>c.path==='/api/flatpay/records'));
 assert.deepEqual(h.get('flatpay_sync:payouts'),progress);
 assert.deepEqual(result.reportWarnings,['Report unavailable']);
 c.startDate='2026-04-08';calls.length=0;
 await api.syncFlatpay('payouts',dispatch,now,true);
 assert.deepEqual(calls[0].body,{kind:'payments',start:'2026-04-08',end:'2026-04-10'});
 c.startDate='2026-05-01';calls.length=0;
 assert.equal((await api.syncFlatpay('payouts',dispatch,now,true)).status,'skipped');
 assert.equal(calls.length,0);
 await assert.rejects(api.syncFlatpay('payouts',async()=>{throw Error('upstream');},new Date('2026-05-02T12:00:00Z'),true),/upstream/);
 assert.deepEqual(h.get('flatpay_sync:payouts'),progress);
});

test('Manual sync endpoint guards origin, imports only payout records, returns errors and warnings',async()=>{
 let calls=0,skip=false,fail=false;
 const api=loader({'next/server':{NextResponse:{json:(data,init)=>Response.json(data,init)}},'@/db/flatpay-sync':{syncFlatpay:async(kind,dispatch,now,manual)=>{
  calls++;assert.equal(kind,'payouts');assert.equal(manual,true);
  if(fail)throw Error('upstream unavailable');
  if(skip)return {status:'skipped',message:'Not connected'};
  const response=await dispatch('/api/flatpay/records',{kind:'payments',start:'2026-09-10',end:'2026-09-11'});
  assert.equal(response.status,200);return {message:'Done',reportWarnings:['Report unavailable']};
 }},'../records/route':{POST:async request=>{
  assert.equal(request.headers.get('origin'),'https://example.test');
  assert.equal(new URL(request.url).pathname,'/api/flatpay/records');
  assert.equal((await request.json()).kind,'payments');return Response.json({records:[]});
 }}})('app/api/flatpay/sync/route.ts');
 const request=(origin='https://example.test')=>new Request('https://example.test/api/flatpay/sync',{method:'POST',headers:{origin,'content-type':'application/json'},body:'{}'});
 assert.equal((await api.POST(request('https://other.test'))).status,403);assert.equal(calls,0);
 assert.deepEqual(await (await api.POST(request())).json(),{message:'Done',reportWarnings:['Report unavailable']});
 skip=true;assert.equal((await api.POST(request())).status,422);
 skip=false;fail=true;assert.match((await (await api.POST(request())).json()).error,/upstream unavailable/);
});
