import test from 'node:test';
import assert from 'node:assert/strict';
import {databaseFixture,loader} from './automation-test-fixture.mjs';
const id='flatpay:payout:m:a:1',org='org';
const payload={paymentID:'1',merchantID:'m',agreementID:'a',paidDate:null,scheduledDate:'2026-09-11T12:00:00Z',payoutAmount:98,currency:'DKK',settlements:'55'};
function fixture(t){
 const h=databaseFixture();t.after(()=>h.sql.close());
 const events=loader()('db/payout-events.ts');
 const api=loader({'./credentials':{loadCredentials:async provider=>provider==='flatpay'?{merchantID:'m',agreementId:'a',startDate:'2026-01-01'}:{organizationId:org}},'./history':{loadHistory:async()=>({months:24,startDate:'2026-01-01'})}})('db/payout-log.ts');
 const read=(target=id,provider='flatpay',offset=0)=>api.readPayoutLog(h.db,target,provider,offset);
 const save=async(p)=>{const write=h.db.prepare("INSERT INTO app_settings(tenant,setting_key,setting_value) VALUES('sablen.dk',?,?) ON CONFLICT DO UPDATE SET setting_value=excluded.setting_value WHERE json_extract(excluded.setting_value,'$.paidDate') IS NOT NULL OR json_extract(app_settings.setting_value,'$.paidDate') IS NULL").bind(id,JSON.stringify(p));await h.db.batch(events.payoutImportStatements(h.db,id,'flatpay',p,write));};
 return {...h,...events,read,save};
}
test('first import, repeated polls and paid transition retain one receipt and one actual status change',async t=>{
 const f=fixture(t);await f.save(payload);await f.save(payload);await f.save({...payload,paidDate:'2026-09-11T12:00:00Z'});await f.save(payload);
 const log=await f.read();assert.equal(log.legacy,false);assert.equal(log.events.length,2);assert.ok(log.events.every(e=>e.at));assert.ok(log.events.some(e=>e.detail.includes('Kommende → Udbetalt')));assert.ok(log.details.some(d=>d.value==='Udbetalt'));
});
test('legacy import time remains unknown and logs are restricted by agreement, date and ledger',async t=>{
 const f=fixture(t);f.set(id,payload);
 const log=await f.read();assert.equal(log.legacy,true);assert.equal(log.events[0].at,null);
 f.set('flatpay:payout:other:a:1',{...payload,merchantID:'other'});assert.equal(await f.read('flatpay:payout:other:a:1'),null);
 await f.payoutEventStatement(f.db,id,'phase',{phase:'booked'},'other-ledger').run();assert.ok(!(await f.read()).events.some(e=>e.title.includes('bekræftet')));
 f.set(id,{...payload,scheduledDate:'2025-01-01T12:00:00Z'});assert.equal(await f.read(),null);
});
test('journal keeps failed attempts after manual recovery and distinguishes draft from booked',async t=>{
 const f=fixture(t);await f.save(payload);
 const key='flatpay_draft:org:'+id;let previous=null;
 for(const phase of ['creating','uncertain','draft','booking','booked']){
  const next={phase,organizationId:org,version:crypto.randomUUID(),message:phase==='uncertain'?'HTTP 503':''},raw=JSON.stringify(next);
  const write=f.db.prepare("INSERT INTO app_settings(tenant,setting_key,setting_value) VALUES('sablen.dk',?,?) ON CONFLICT DO UPDATE SET setting_value=excluded.setting_value").bind(key,raw);
  await f.savePayoutReceipt(f.db,write,key,id,previous,next,raw);previous=next;
 }
 f.set('manual_booking:test',{kind:'flatpay',externalId:id,organizationId:org,confirmedAt:'2026-09-10T10:00:00Z',finishedAt:'2026-09-10T10:01:00Z',outcome:'completed',message:'Udbetalingen er bogført i Dinero med rapport.'});
 const log=await f.read();assert.ok(log.events.some(e=>e.detail.includes('HTTP 503')));assert.ok(log.events.some(e=>e.title==='Kladde oprettet i Dinero'));assert.ok(log.events.some(e=>e.title==='Bogføring bekræftet i Dinero'));assert.ok(log.events.some(e=>e.title==='Manuel bogføring startet'));assert.ok(log.events.some(e=>e.title==='Bogført manuelt i Dinero'&&e.detail.includes('bogført')));
});
test('failed CAS cannot produce a journal entry and attachment remains separate from booking',async t=>{
 const f=fixture(t),key='flatpay_draft:org:'+id;const previous={phase:'creating',organizationId:org,version:'old',proposal:{voucher:{}}};f.set(key,previous);
 const next={...previous,version:'new',proposal:{voucher:{FileGuid:'opaque-dinero-id'}}},raw=JSON.stringify(next);
 const write=expected=>f.db.prepare("UPDATE app_settings SET setting_value=? WHERE tenant='sablen.dk' AND setting_key=? AND setting_value=?").bind(raw,key,expected);
 const failed=await f.savePayoutReceipt(f.db,write('stale'),key,id,previous,next,raw);assert.equal(failed.meta.changes,0);assert.equal(f.sql.prepare('SELECT count(*) n FROM payout_events').get().n,0);
 const success=await f.savePayoutReceipt(f.db,write(JSON.stringify(previous)),key,id,previous,next,raw);assert.equal(success.meta.changes,1);assert.deepEqual(f.sql.prepare('SELECT kind FROM payout_events').all().map(e=>e.kind),['attachment']);
});
test('pagination exposes all attempts, safe diagnostics and no unrelated credential payloads',async t=>{
 const f=fixture(t);await f.save(payload);
 for(let i=0;i<103;i++)await f.payoutEventStatement(f.db,id,'failed',{message:'HTTP 503 password=secret'}).run();
 f.set('credentials:secret',{password:'never-return-this'});
 const first=await f.read(),second=await f.read(id,'flatpay',first.nextOffset);assert.equal(first.events.length,100);assert.equal(second.events.length,4);assert.equal(second.nextOffset,null);assert.ok(!first.events.some(e=>second.events.some(x=>e.id===x.id)));assert.ok(!JSON.stringify(first).includes('password=secret'));assert.ok(!JSON.stringify(first).includes('never-return-this'));
});
test('Shopify and ViaBill use saved import date and provider-specific status changes',async t=>{
 const f=fixture(t);
 for(const [provider,p] of [['shopify_payments',{provider:'shopify_payments',status:'SCHEDULED',net:{amount:'98',currencyCode:'DKK'},transactionType:'DEPOSIT'}],['viabill',{provider:'viabill',amountMinor:9800,currency:'DKK',reconciled:false,entries:[]}]]){
  f.record('payout',provider,p,'2026-09-10T12:00:00Z');
  const next=provider==='viabill'?{...p,reconciled:true}:{...p,status:'PAID'};
  const write=f.db.prepare("UPDATE integration_records SET payload_json=? WHERE external_id=?").bind(JSON.stringify(next),provider);
  await f.db.batch(f.payoutImportStatements(f.db,provider,provider,next,write));
  const log=await f.read(provider,provider);assert.ok(log.events.some(e=>e.title==='Udbetalingsstatus ændret'));assert.ok(log.events.some(e=>e.title==='Modtaget i Toolbox'&&e.at));
 }
});
test('paid Flatpay logs include historical estimate events for its own settlement only',async t=>{
 const f=fixture(t);await f.save({...payload,paidDate:'2026-09-11T12:00:00Z'});
 await f.payoutEventStatement(f.db,'flatpay:upcoming:m:a:55','received',{status:'Kommende · forventet'}).run();await f.payoutEventStatement(f.db,'flatpay:upcoming:other:a:55','failed',{}).run();
 const log=await f.read();assert.ok(log.events.some(e=>e.detail.includes('forventet')));assert.ok(!log.events.some(e=>e.title==='Bogføringsforsøg mislykkedes'));
});

test('manual completion never labels an existing voucher or a draft as newly manually booked',()=>{
 const {payoutLogEvent}=loader()('lib/payout-log.ts');
 const event=message=>payoutLogEvent({id:'1',kind:'manual_completed',at:'invalid',data_json:JSON.stringify({message})});
 assert.equal(event('Bilaget var allerede bogført i Dinero.').title,'Bogført bilag fundet ved manuel kontrol');
 assert.equal(event('Udbetalingen er oprettet som kladde.').title,'Kladde oprettet manuelt i Dinero');
 assert.equal(event('Udbetalingen er bogført i Dinero.').at,null);
});
