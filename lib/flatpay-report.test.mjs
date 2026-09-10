import test from 'node:test';
import assert from 'node:assert/strict';
import * as pdfLib from 'pdf-lib';
import {databaseFixture,loader} from './automation-test-fixture.mjs';
const source={payment:{paymentID:'123',paidDate:'2026-09-08T00:00:00',currency:'DKK',payoutAmount:98,settlements:'456'},settlements:[{settlementNumber:'456',currency:'DKK',transactions:'1',payout:98,netSettlement:98,grossPurchase:100,refundAmount:0,feeAmount:2}],transactions:[{transactionID:'789',purchaseDate:'2026-09-06T12:00:00',settlementNumber:'456',currency:'DKK',transactionCode:'SALE05',grossAmount:100,fees:2.0001,netAmount:97.9999}]};
test('Flatpay report reconciles payouts, checks completeness and renders multipage PDF',async()=>{
 const {checkFlatpayReport,buildFlatpayReport}=loader({'pdf-lib':pdfLib})('lib/flatpay-report.ts');
 assert.equal(checkFlatpayReport(source).net,9800);
 assert.throws(()=>checkFlatpayReport({...source,transactions:[]}));assert.throws(()=>checkFlatpayReport({...source,payment:{...source.payment,payoutAmount:99}}));
 assert.throws(()=>checkFlatpayReport({...source,transactions:[...source.transactions,...source.transactions]}));
 const bytes=await buildFlatpayReport(source);assert.equal((await pdfLib.PDFDocument.load(bytes)).getPageCount(),3);
 const many={...source,settlements:[{...source.settlements[0],transactions:'60'}],transactions:Array.from({length:60},(_,i)=>({...source.transactions[0],transactionID:String(i)}))};assert.equal((await pdfLib.PDFDocument.load(await buildFlatpayReport(many))).getPageCount(),5);
});
test('archive versions are stable, scoped, exclude card data and block changed payouts',async t=>{
 const h=databaseFixture();t.after(()=>h.sql.close());const id='flatpay:payout:m:a:123';h.set(id,{...source.payment,merchantID:'m',agreementID:'a'});
 let mismatch=false,puts=0,rendered;const objects=new Map();
 const c={username:'x',password:'y',merchantID:'m',agreementId:'a',agreementNumber:'11',startDate:'2026-09-05'};
 const actual=loader({'pdf-lib':pdfLib})('lib/flatpay-report.ts');
 const api=loader({'cloudflare:workers':{env:{INVOICES:{head:async k=>objects.get(k),put:async k=>{puts++;objects.set(k,{etag:'etag'});}},ASSETS:{fetch:async()=>({ok:true,arrayBuffer:async()=>new ArrayBuffer(0)})}}},'./credentials':{loadCredentials:async()=>c},'./history':{loadHistory:async()=>({months:120,startDate:'2026-01-01'})},'@/lib/flatpay-report':{...actual,buildFlatpayReport:async s=>{rendered=s;return new Uint8Array([1]);}},'@/lib/flatpay-api':{flatpayRead:async(a,kind)=>kind==='payments'?[{...source.payment,merchantID:'m',agreementNumber:'11',payoutAmount:mismatch?99:98}]:kind==='settlements'?[{...source.settlements[0],merchantID:'m',agreementNumber:'11'}]:[{...source.transactions[0],merchantID:'m',agreementID:'a',cardNumber:'secret'}]}})('db/flatpay-report.ts');
 const first=await api.ensureFlatpayReport(h.db,id),second=await api.ensureFlatpayReport(h.db,id);assert.deepEqual(first.report,second.report);assert.equal(puts,1);assert.equal(rendered.transactions[0].cardNumber,undefined);assert.equal(h.get('flatpay_report:'+id).etag,'etag');
 mismatch=true;await assert.rejects(api.ensureFlatpayReport(h.db,id),/ændret/);c.merchantID='other';await assert.rejects(api.ensureFlatpayReport(h.db,id),/tilhører/);
});
test('document archive combines providers and serves only matching scoped PDF versions',async t=>{
 const h=databaseFixture();t.after(()=>h.sql.close());const id='flatpay:payout:m:a:123',key='payout-reports/flatpay/'+ 'a'.repeat(64)+'.pdf';
 h.set(id,{...source.payment,merchantID:'m',agreementID:'a'});h.set('flatpay_report:'+id,{payment:source.payment,key,etag:'right'});
 h.record('payout','gid://shopify/ShopifyPaymentsPayout/1',{provider:'shopify_payments',net:{amount:'10',currencyCode:'DKK'},reportKey:'shop.pdf'},'2026-09-07T12:00:00Z');
 const c={merchantID:'m',agreementId:'a',startDate:'2026-09-05'};let etag='right';
 class Reply{constructor(body,options){this.body=body;this.status=options?.status||200;}static json(data,options){return {data,...options};}}
 const api=loader({'next/server':{NextResponse:Reply},'cloudflare:workers':{env:{INVOICES:{get:async()=>({etag,body:'pdf-body'})}}},'@/db/database':{prepareDatabase:async()=>h.db},'@/db/errors':{recordFailure:async()=>{}},'@/db/history':{loadHistory:async()=>({months:120,startDate:'2026-01-01'})},'@/db/credentials':{loadCredentials:async()=>c},'@/db/flatpay-report':{ensureFlatpayReport:async()=>{}}})('app/api/documents/route.ts');
 const get=externalId=>api.GET({nextUrl:new URL('https://test/api/documents'+(externalId?'?externalId='+encodeURIComponent(externalId):''))});
 const list=(await get()).data.documents;assert.equal(list.length,2);assert.equal(list[0].provider,'flatpay');assert.equal(list[0].ready,true);assert.equal(list[0].report,undefined);
 assert.equal((await get(id)).body,'pdf-body');etag='changed';assert.equal((await get(id)).status,404);etag='right';c.merchantID='other';assert.equal((await get(id)).status,404);assert.equal((await get()).data.documents.length,1);
});
