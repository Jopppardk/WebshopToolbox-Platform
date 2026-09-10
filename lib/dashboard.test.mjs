import test from 'node:test';
import assert from 'node:assert/strict';
import { databaseFixture,loader } from './automation-test-fixture.mjs';
const { calculateFinance,financePeriods,parseEntries,percentageChange }=loader()('lib/dashboard-finance.ts');
const {integrationHealth,successRate}=loader()('lib/dashboard-platform.ts');
test('finance totals use posted normal entries, credit signs, prior matching dates and exclude tax/primo/ultimo from profit',()=>{
  const entries=[];
  const add=(account,date,minor,type='Normal')=>entries.push({guid:String(entries.length),account,date,minor,type});
  add(1000,'2026-09-01',-100000); add(1000,'2026-09-09',10000); add(1000,'2026-09-10',-999999);
  add(1000,'2026-01-02',-20000);add(2000,'2026-09-01',30000);add(9000,'2026-09-01',5000);
  add(1000,'2025-09-01',-50000);add(1000,'2025-09-10',-99999);add(1000,'2025-02-01',-10000);
  add(52000,'2026-01-01',250000,'Primo');add(52000,'2026-09-05',-25000);add(52000,'2026-09-09',-999999,'Ultimo');
  add(1000,'2026-09-01',999999,'Ultimo');
  const result=calculateFinance(entries,{'1000':'Turnover','2000':'Variable Expenses','9000':'Tax','52000':'Turnover Assets'},[{from:'2025-01-01',to:'2025-12-31'},{from:'2026-01-01',to:'2026-12-31'}],52000,new Date('2026-09-09T12:00:00Z'));
  assert.equal(result.revenueMtd,90000);assert.equal(result.revenueYtd,110000);assert.equal(result.profitMtd,60000);assert.equal(result.profitYtd,80000);
  assert.equal(result.previousMtd,50000);assert.equal(result.previousYtd,60000);assert.equal(result.inventory,225000);
  assert.equal(percentageChange(90000,50000),80);
  assert.equal(percentageChange(0,0),null);assert.equal(percentageChange(null,100),null);assert.equal(percentageChange(50,-10),null);
});
test('missing fiscal coverage and unknown account categories never become zero',()=>{
  const years=[{from:'2026-07-01',to:'2027-06-30'}],now=new Date('2026-09-09');
  const result=calculateFinance([],{},years,null,now);
  assert.equal(result.revenueYtd,null);assert.equal(result.previousMtd,null);assert.equal(result.revenueMtd,0);assert.equal(result.inventory,null);
  const unknown=calculateFinance([{guid:'a',account:1,date:'2026-09-01',minor:500,type:'Normal'}],{},years,null,now);
  assert.equal(unknown.profitMtd,null);
});
test('comparison clamps leap day and uses Danish date at midnight',()=>{
  assert.equal(financePeriods(new Date('2024-02-29T12:00:00Z')).previous,'2023-02-28');
  assert.equal(financePeriods(new Date('2026-08-31T22:30:00Z')).monthStart,'2026-09-01');
});
test('malformed entries fail closed',()=>{
  assert.throws(()=>parseEntries({}));
  assert.throws(()=>parseEntries([{Amount:NaN}]));
});
test('health distinguishes disconnected evidence, stale jobs, active jobs and failures; skipped jobs are excluded from success rate',()=>{
  const now=Date.now(),job=(status,minutes=1)=>({job_key:'a',status,started_at:new Date(now-minutes*60000).toISOString(),finished_at:null});
  assert.equal(integrationHealth([],5,now),'unknown');
  assert.equal(integrationHealth([job('skipped')],5,now),'unknown');
  assert.equal(integrationHealth([job('succeeded')],5,now),'healthy');
  assert.equal(integrationHealth([job('succeeded',60)],5,now),'stale');
  assert.equal(integrationHealth([job('failed')],5,now),'attention');
  assert.equal(integrationHealth([job('running',16)],5,now),'attention');
  assert.equal(successRate(3,1),75);assert.equal(successRate(0,0),null);
});
test('finance cache imports once, applies changes idempotently, isolates organizations and preserves checkpoint on failure',async t=>{
  const h=databaseFixture();t.after(()=>h.sql.close());
  let organizationId='org1',fail=false;
  const calls=[],year=String(new Date().getUTCFullYear()),guid='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  const entry=(amount)=>({EntryGuid:guid,AccountNumber:1000,Amount:amount,Date:year+'-01-02',Type:'Normal'});
  const module=loader({
    './database':{database:()=>h.db},
    './credentials':{loadCredentials:async()=>({organizationId,clientId:'x',clientSecret:'secret',apiKey:'private'})},
    fetch:async(url,init)=>{
      calls.push(String(url));assert.equal(init.redirect,'manual');
      if(String(url).includes('/oauth/token'))return Response.json({access_token:'token'});
      if(String(url).endsWith('/accountingyears'))return Response.json([{FromDate:year+'-01-01',ToDate:year+'-12-31'}]);
      if(String(url).includes('/accounts/entry'))return Response.json([{AccountNumber:1000,Category:'Turnover'}]);
      if(fail)return new Response('private',{status:503});
      return Response.json([entry(String(url).includes('/changes')?-200:-100)]);
    }
  })('db/dashboard-finance.ts');
  await module.syncDashboardFinance();
  assert.equal(h.sql.prepare('SELECT minor FROM dashboard_ledger').get().minor,-10000);
  const key='dashboard_finance:org1';
  const expire=()=>h.set(key,{...h.get(key),retryAt:0});
  expire();await module.syncDashboardFinance();
  assert.equal(h.sql.prepare('SELECT COUNT(*) n FROM dashboard_ledger').get().n,1);
  assert.equal(h.sql.prepare('SELECT minor FROM dashboard_ledger').get().minor,-20000);
  assert.equal(calls.filter(u=>u.includes('/entries?')).length,1);
  assert.equal(calls.filter(u=>u.includes('/entries/changes?')).length,1);
  const cursor=h.get(key).cursor;
  expire();fail=true;await assert.rejects(module.syncDashboardFinance(),/HTTP 503/);
  assert.equal(h.get(key).cursor,cursor);assert.equal((await module.dashboardFinance()).data,null);
  assert.doesNotMatch(h.get(key).error,/private/);
  organizationId='org2';assert.equal((await module.dashboardFinance()).data,null);
});

test('platform API returns safe connection status and the exact 24-hour success rate',async t=>{
  const h=databaseFixture();t.after(()=>h.sql.close());
  h.sql.prepare("INSERT INTO integration_credentials(tenant,provider,ciphertext,iv,display_name,verified_at) VALUES('sablen.dk','shopify','not-a-real-secret','iv','Shop',CURRENT_TIMESTAMP)").run();
  const now=new Date().toISOString();
  for(const [id,status] of [['a','succeeded'],['b','failed'],['c','skipped'],['d','succeeded']])h.sql.prepare("INSERT INTO job_runs(id,tenant,job_key,job_name,status,started_at) VALUES(?,'sablen.dk',?,'Fixture',?,?)").run(id,'shopify-'+id,status,now);
  const api=loader({'./credentials':{loadCredentials:async()=>null},'@/db/database':{prepareDatabase:async()=>h.db},'next/server':{NextResponse:{json:(data,options)=>({data,...options})}}})('app/api/dashboard/platform/route.ts');
  const response=await api.GET();
  assert.equal(response.data.connected,1);assert.equal(response.data.failed,1);assert.equal(response.data.successRate,2/3*100);
  assert.equal(response.data.providers[0].health,'attention');assert.equal(response.data.providers[1].health,'disconnected');
  assert.doesNotMatch(JSON.stringify(response.data),/ciphertext|not-a-real-secret/);
});
test('simultaneous finance refreshes issue only one initial import',async t=>{
  const h=databaseFixture();t.after(()=>h.sql.close());
  let imports=0;
  const year=String(new Date().getUTCFullYear());
  const module=loader({
    './database':{database:()=>h.db},'./credentials':{loadCredentials:async()=>({organizationId:'concurrent',clientId:'x',clientSecret:'x',apiKey:'x'})},
    fetch:async url=>{
      if(String(url).includes('/oauth/')) return Response.json({access_token:'x'});
      if(String(url).endsWith('/accountingyears')) return Response.json([{FromDate:year+'-01-01',ToDate:year+'-12-31'}]);
      if(String(url).includes('/accounts/')) return Response.json([]);
      imports++;return Response.json([]);
    }
  })('db/dashboard-finance.ts');
  await Promise.all([module.syncDashboardFinance(),module.syncDashboardFinance()]);
  assert.equal(imports,1);
});
