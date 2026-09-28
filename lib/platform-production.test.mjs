import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {validateProductionConfig} from '../scripts/platform-production-config.mjs';
import {loader} from './automation-test-fixture.mjs';
const config=JSON.parse(readFileSync(new URL('../wrangler.platform-production.json',import.meta.url),'utf8'));
// A synthetic audience is used while the real Access application is provisioned.
config.vars.PLATFORM_ACCESS_AUD='ab'.repeat(32);
test('production rejects test resources, public worker URL, cron, unblocked writes and shared login',()=>{
 assert.equal(validateProductionConfig(config),config);
 for(const mutate of [c=>c.workers_dev=true,c=>c.vars.PLATFORM_ACCESS_AUD='4edbc15bc801d85de33ef29839e2e3803b733ce3cebbe60728d8e3277982e646',c=>c.vars.PLATFORM_EXTERNAL_WRITES='true',c=>c.vars.PLATFORM_CUSTOMER_EMAIL='true',c=>c.vars.PLATFORM_AUTH='local-jwt',c=>c.d1_databases[0].database_id='438fde65-c538-4719-aa2e-9502ae37c7e6',c=>c.r2_buckets[0].bucket_name='webshop-toolbox-platform-test-documents',c=>c.routes[0].pattern='integration.sablen.dk',c=>c.triggers.crons=['* * * * *'],c=>c.assets.run_worker_first=false,c=>c.vars.PLATFORM_MAIL_TEST_RECIPIENTS='rj@itm8.com,rene.jeppesen@live.dk',c=>c.send_email[1].allowed_destination_addresses=['anyone@example.test']]){const copy=structuredClone(config);mutate(copy);assert.throws(()=>validateProductionConfig(copy));}
});
test('production runtime retains blocking and requires its own Access audience',()=>{
 const {assertTestRuntime,customerEmail,externalWrite}=loader()('platform/safety.ts');const env={...config.vars};assert.doesNotThrow(()=>assertTestRuntime(env));
 assert.throws(()=>assertTestRuntime({...env,PLATFORM_ACCESS_AUD:undefined}));assert.throws(()=>assertTestRuntime({...env,PLATFORM_AUTH:'local-jwt'}));assert.throws(()=>assertTestRuntime({...env,DB:{}}));assert.throws(()=>assertTestRuntime({...env,PLATFORM_CUSTOMER_EMAIL:'enabled'}));assert.throws(customerEmail);assert.throws(()=>externalWrite('book'));
});
