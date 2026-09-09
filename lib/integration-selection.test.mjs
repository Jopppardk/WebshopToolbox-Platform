import test from 'node:test';
import assert from 'node:assert/strict';
import {databaseFixture,loader} from './automation-test-fixture.mjs';
const selection=loader()('db/integration-selection.ts');
test('selection persists independently, additions are idempotent and removal preserves other settings',async()=>{
 const h=databaseFixture();h.set('admin_settings',{keep:true});
 assert.deepEqual(await selection.integrationSelection(h.db),{selected:[],connected:[]});
 await Promise.all(['shopify','dinero'].map(id=>selection.selectIntegration(h.db,id,true)));
 await selection.selectIntegration(h.db,'shopify',true);
 assert.deepEqual((await selection.integrationSelection(h.db)).selected,['shopify','dinero']);
 await selection.selectIntegration(h.db,'shopify',false);
 assert.deepEqual((await selection.integrationSelection(h.db)).selected,['dinero']);
 assert.deepEqual(h.get('admin_settings'),{keep:true});
});
test('existing connections are selected automatically and cannot be removed or expose secrets',async()=>{
 const h=databaseFixture();
 h.sql.exec("INSERT INTO integration_credentials(tenant,provider,ciphertext,iv,display_name,verified_at) VALUES('sablen.dk','shopify','private','iv','Shop',CURRENT_TIMESTAMP)");
 h.set('viabill_credentials',{ciphertext:'private'});
 assert.deepEqual(await selection.integrationSelection(h.db),{selected:['shopify','viabill'],connected:['shopify','viabill']});
 assert.equal(await selection.selectIntegration(h.db,'shopify',false),false);
 assert.equal(await selection.selectIntegration(h.db,'viabill',false),false);
 assert.deepEqual(h.get('viabill_credentials'),{ciphertext:'private'});
});
test('selection endpoint validates requests, saves choices and rejects connected removal',async()=>{
 const h=databaseFixture();
 const api=loader({'@/db/database':{prepareDatabase:async()=>h.db},'next/server':{NextResponse:{json:(data,options)=>({data,...options})}}})('app/api/integrations/selection/route.ts');
 const request=(body,origin='https://example.test')=>new Request('https://example.test/api/integrations/selection',{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify(body)});
 assert.equal((await api.POST(request({provider:'shopify',action:'add'},'https://foreign.test'))).status,403);
 for(const body of [null,{}, {provider:'unknown',action:'add'},{provider:'shopify',action:'delete'}])assert.equal((await api.POST(request(body))).status,400);
 assert.equal((await api.POST(request({provider:'shopify',action:'add'}))).status,200);
 assert.deepEqual((await api.GET()).data.selected,['shopify']);
 h.set('viabill_credentials',{ciphertext:'private'});
 assert.equal((await api.POST(request({provider:'viabill',action:'remove'}))).status,409);
});
