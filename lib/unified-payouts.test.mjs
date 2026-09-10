import test from 'node:test';
import assert from 'node:assert/strict';
import {databaseFixture,loader} from './automation-test-fixture.mjs';
test('unified payout pagination spans providers without losing or merging matching IDs',async t=>{
 const h=databaseFixture();t.after(()=>h.sql.close());
 for(let i=0;i<49;i++)h.record('payout','shop'+i,{provider:'shopify_payments',net:{amount:'10.00',currencyCode:'DKK'},status:'PAID',transactionType:'DEPOSIT'},'2026-09-01T10:00:00Z');
 h.record('payout','via',{provider:'viabill',entryUUID:'same',amountMinor:2000,currency:'DKK',entries:[],reconciled:true},'2026-09-02T10:00:00Z');
 h.set('flatpay:payout:m:a:same',{paymentID:'same',merchantID:'m',agreementID:'a',paidDate:'2026-09-03T10:00:00Z',payoutAmount:30,currency:'DKK'});
 h.set('flatpay:payout:other:a:wrong',{merchantID:'other',agreementID:'a',paidDate:'2026-09-03T10:00:00Z',payoutAmount:999,currency:'DKK'});
 const api=loader({'next/server':{NextResponse:{json:(data,options)=>({data,...options})}},'@/db/database':{prepareDatabase:async()=>h.db},'@/db/history':{loadHistory:async()=>({months:24})},'@/lib/history-policy':{historyWindow:()=>({cutoff:'2026-01-01T00:00:00Z'})},'@/db/credentials':{loadCredentials:async()=>({merchantID:'m',agreementId:'a',startDate:'2026-01-01'})}})('app/api/payouts/overview/route.ts');
 const req=offset=>({nextUrl:new URL('https://test/api/payouts/overview?offset='+offset)});
 const first=(await api.GET(req(0))).data;assert.equal(first.total,51);assert.equal(first.payouts.length,50);assert.equal(first.payouts[0].label,'Flatpay');assert.equal(first.payouts[1].label,'ViaBill');assert.equal(first.payouts[0].canBook,false);assert.equal(first.payouts[2].canBook,true);
 const last=(await api.GET(req(50))).data;assert.equal(last.payouts.length,1);assert.ok(!first.payouts.some(p=>p.id===last.payouts[0].id));
 assert.equal((await api.GET(req(-1))).status,400);
});
test('Flatpay bank payouts are cached without entering automatic accounting queue',async t=>{
 const h=databaseFixture();t.after(()=>h.sql.close());
 const api=loader({'next/server':{NextResponse:{json:(data,options)=>({data,...options})}},'@/db/database':{database:()=>h.db},'@/db/credentials':{loadCredentials:async()=>({username:'x',password:'y',merchantID:'m',agreementId:'a',agreementNumber:'1',startDate:'2026-01-01'})},'@/lib/flatpay-api':{flatpayDateRange:()=>{},flatpayRead:async()=>[{paymentID:'1',merchantID:'m',agreementNumber:'1',paidDate:'2026-09-01T12:00:00Z',payoutAmount:12.34,currency:'DKK',iban:'private'}]}})('app/api/flatpay/records/route.ts');
 const req=()=>new Request('https://test/api/flatpay/records',{method:'POST',headers:{origin:'https://test','content-type':'application/json'},body:JSON.stringify({kind:'payments',start:'2026-09-01',end:'2026-09-02'})});
 assert.equal((await api.POST(req())).status,200);await api.POST(req());
 const saved=h.get('flatpay:payout:m:a:1');assert.equal(saved.payoutAmount,12.34);assert.equal(saved.iban,undefined);assert.equal(h.sql.prepare('SELECT COUNT(*) n FROM integration_records').get().n,0);
});
