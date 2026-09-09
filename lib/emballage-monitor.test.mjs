import test from 'node:test';
import assert from 'node:assert/strict';
import {databaseFixture,loader} from './automation-test-fixture.mjs';
const now=Date.parse('2026-09-09T12:00:00Z');
function fixture(){
 const h=databaseFixture();let calls=0,connected=true,fail=false;
 const report={id:1,status:'draft',accepts_writes:true,period:{start_date:'2026-04-01',end_date:'2026-06-30'},responsibility:{code:'packaging',product_area:{slug:'packaging'}}};
 const reports=[report];
 const monitor=loader({'@/lib/emballage-api':{eiReports:async()=>{calls++;if(fail)throw Error('offline');return reports;},isSubmitted:s=>s==='submitted'},'./database':{database:()=>h.db},'./credentials':{loadCredentials:async()=>connected?{}:null},'./emballage':{getEIConfig:async()=>({startDate:'2026-04-01',responsibility:'packaging'}),eiAccess:async()=>({key:'fixture',context:{organisation:{id:17},api_key:{is_test:false}}})},'./job-runs':{runTrackedJob:async(k,n,task)=>task()}})('db/emballage-monitor.ts').monitorEmballagePeriods;
 return {...h,monitor,reports,report,calls:()=>calls,disconnect:()=>connected=false,fail:()=>fail=true,notices:()=>h.sql.prepare("SELECT setting_value FROM app_settings WHERE setting_key LIKE 'notice:%'").all().map(r=>JSON.parse(r.setting_value))};
}
test('hourly monitor deduplicates concurrent polls and preserves read notices',async t=>{
 const h=fixture();t.after(()=>h.sql.close());
 await Promise.all([h.monitor(now),h.monitor(now)]);assert.equal(h.calls(),1);assert.equal(h.notices().length,1);
 const notice=h.notices()[0];h.set(notice.id,{...notice,read:true});
 await h.monitor(now+3600000);assert.equal(h.calls(),2);assert.equal(h.notices()[0].read,true);assert.equal(h.notices().length,1);
});
test('only open completed quarters for configured responsibility and start date notify',async t=>{
 const h=fixture();t.after(()=>h.sql.close());h.report.accepts_writes=false;
 h.reports.push({...h.report,id:2,accepts_writes:true,status:'submitted'},{...h.report,id:3,accepts_writes:true,period:{start_date:'2026-01-01',end_date:'2026-03-31'}},{...h.report,id:4,accepts_writes:true,responsibility:{code:'other',product_area:{slug:'packaging'}}});
 await h.monitor(now);assert.equal(h.notices().length,0);
 h.report.accepts_writes=true;await h.monitor(now+3600000);assert.equal(h.notices().length,1);
});
test('disconnected integrations make no requests and failures never invent notifications',async t=>{
 const h=fixture();t.after(()=>h.sql.close());h.fail();await assert.rejects(h.monitor(now));assert.equal(h.notices().length,0);h.disconnect();await h.monitor(now+3600000);assert.equal(h.calls(),1);
});
test('notifications acknowledge persists and foreign origins are rejected',async t=>{
 const h=fixture();t.after(()=>h.sql.close());await h.monitor(now);
 const api=loader({'next/server':{NextResponse:{json:(data,options)=>({data,...options})}},'@/db/database':{prepareDatabase:async()=>h.db}})('app/api/notifications/route.ts');
 const id=h.notices()[0].id;
 const req=origin=>new Request('https://integration.test/api/notifications',{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify({id})});
 assert.equal((await api.POST(req('https://other.test'))).status,403);assert.equal((await api.GET()).data.notifications.length,1);
 assert.equal((await api.POST(req('https://integration.test'))).status,200);assert.equal((await api.GET()).data.notifications.length,0);
});
