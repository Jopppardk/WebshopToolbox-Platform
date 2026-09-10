import test from 'node:test';
import assert from 'node:assert/strict';
import {loader,databaseFixture} from './automation-test-fixture.mjs';
test('Flatpay activation validates accounts, scopes production and retains existing holds',async t=>{
 const h=databaseFixture();t.after(()=>h.sql.close());let accountValid=false;
 h.set('admin_settings',{accounts:{bank:'55000',fees:'7220',clearing:'55110',flatpayClearing:'55105'},automation:{payouts:true}});
 const api=loader({'./database':{database:()=>h.db},'./credentials':{loadCredentials:async p=>p==='flatpay'?{merchantID:'m',agreementId:'a'}:{organizationId:'org'}},'./dinero-accounts':{readDineroAccounts:async()=>accountValid?[55000,7220,55110,55105].map(n=>({number:String(n),hidden:false,vatCode:''})):[]},'@/lib/admin-settings':{validateSettings:x=>x}})('db/flatpay-production.ts');
 assert.equal((await api.flatpayProduction()).active,false);await assert.rejects(api.flatpayProduction(true),/konti/);assert.equal(h.get('flatpay_production'),null);
 accountValid=true;assert.equal((await api.flatpayProduction(true)).active,true);assert.equal(h.get('flatpay_production').organizationId,'org');
 h.set('flatpay_production',{...h.get('flatpay_production'),holdIds:['test']});await api.flatpayProduction(true);assert.deepEqual(h.get('flatpay_production').holdIds,['test']);
 h.set('flatpay_production',{...h.get('flatpay_production'),organizationId:'other'});assert.equal((await api.flatpayProduction()).active,false);
});
