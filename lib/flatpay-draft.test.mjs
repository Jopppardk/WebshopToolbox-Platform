import test from 'node:test';
import assert from 'node:assert/strict';
import {databaseFixture,loader} from './automation-test-fixture.mjs';
const payment={paymentID:'12345',merchantID:'m',agreementNumber:'11',paidDate:'2020-01-10T00:00:00',currency:'DKK',payoutAmount:98,settlements:'56789'};
const settlement={settlementNumber:'56789',merchantID:'m',agreementNumber:'11',currency:'DKK',grossPurchase:100,grossSettlement:100,netPurchase:100,netSettlement:98,payout:98,feeAmount:2,deduction:2,refundAmount:0,chargeback:0,rollingReserve:0,rollingRelease:0,addedSum:0,deductedSum:0,balanceTransfer:0,reversals:0};
const accounts={bank:55000,clearing:55110,fees:7220,flatpay:55105};
test('Flatpay draft reconciles bank and fees without counting aggregate deduction twice',()=>{
 const {flatpayDraft}=loader()('lib/flatpay-draft.ts');
 const p=flatpayDraft(payment,settlement,accounts);
 assert.deepEqual(p.voucher.Lines.map(l=>[l.AccountNumber,l.BalancingAccountNumber,l.Amount]),[[55105,55110,100],[7220,55105,2],[55000,55105,98]]);
 for(const s of [{...settlement,netSettlement:99},{...settlement,chargeback:1},{...settlement,newFee:1},{...settlement,deduction:4},{...settlement,feeAmount:2.001}])assert.throws(()=>flatpayDraft(payment,s,accounts));
 assert.throws(()=>flatpayDraft({...payment,paidDate:null},settlement,accounts));
 assert.throws(()=>flatpayDraft(payment,settlement,{...accounts,bank:accounts.flatpay}));
});
function fixture(t,mode='ok'){
 const h=databaseFixture();t.after(()=>h.sql.close());
 const creds={username:'test',password:'test',merchantID:'m',agreementId:'a',agreementNumber:'11',startDate:'2020-01-01'};
 const settings=loader()('lib/admin-settings.ts');
 h.set('admin_settings',{accounts:{...settings.emptyAccounts,bank:'55000 Bank',fees:'7220 Fees',clearing:'55110 Clearing'},automation:{...settings.defaultAutomation,payoutsBookDinero:true}});
 const id='flatpay:payout:m:a:12345';h.set(id,{...payment,agreementID:'a'});
 const calls=[];let currentSettlement={...settlement};
 const api=loader({'cloudflare:workers':{env:{INVOICES:{get:async()=>mode==='missing-report'?null:({etag:'etag',arrayBuffer:async()=>new ArrayBuffer(8)})}}},'./flatpay-report':{ensureFlatpayReport:async()=>({report:{key:'pdf',etag:'etag',filename:'Flatpay.pdf',fingerprint:'hash'},source:{payment,settlements:[currentSettlement]}})},'./database':{database:()=>h.db},'./credentials':{loadCredentials:async p=>p==='flatpay'?creds:{organizationId:'org'}},'./dinero-accounts':{readDineroAccounts:async()=>Object.values(accounts).map(n=>({number:String(n),name:'Account '+n,vatCode:'',hidden:false}))},'@/lib/flatpay-api':{flatpayRead:async(c,k)=>k==='payments'?[payment]:[currentSettlement]},'./dinero-client':{dineroClient:async()=>async(path,method,body)=>{calls.push({path,method,body});if(mode==='timeout')throw Error('timeout');if(path==='files'&&mode==='bad-upload')return {};if(path==='files'&&mode==='null-upload')return null;if(path==='files'&&mode==='wrong-type-upload')return {FileGuid:1234567890};if(path==='files'&&mode==='invalid-upload')return {FileGuid:'not/a/file/id'};if(path==='vouchers/manuel'&&mode==='voucher-timeout')throw Error('timeout');if(path==='files')return {FileGuid:'web0crmck5v0ndcx3313g6zn61tc7wgc'};return {...body,Guid:'12345678-1234-1234-1234-123456789abc',Status:'Draft',Timestamp:'timestamp',Lines:body.Lines.map(l=>({...l,AmountExclVatValue:l.Amount,VatAmountValue:0,AmountInclVatValue:l.Amount}))};}}})('db/flatpay-draft.ts');
 return {...h,calls,id,run:(action,extra={})=>api.flatpayDraftAction({externalId:id,action,...extra}),change:s=>{currentSettlement=s;}};
}
test('documented Dinero opaque file ID reaches voucher; preview never writes; concurrent create and repeat submit create one draft and never book',async t=>{
 const f=fixture(t);assert.equal((await f.run('preview')).phase,'select-account');
 const p=await f.run('preview',{flatpayAccount:accounts.flatpay});assert.equal(f.calls.length,0);
 const results=await Promise.allSettled([f.run('create',{version:p.version}),f.run('create',{version:p.version})]);
 assert.ok(results.some(r=>r.status==='fulfilled'&&r.value.phase==='draft'));assert.deepEqual(f.calls.map(c=>c.path),['files','vouchers/manuel']);assert.equal(f.calls[1].body.FileGuid,'web0crmck5v0ndcx3313g6zn61tc7wgc');
 assert.equal((await f.run('create',{version:p.version})).phase,'draft');assert.equal(f.calls.length,2);
});
test('uncertain write is persistently blocked from retry',async t=>{
 const f=fixture(t,'timeout');const p=await f.run('preview',{flatpayAccount:accounts.flatpay});await assert.rejects(f.run('create',{version:p.version}),/usikker/);
 assert.equal((await f.run('status')).phase,'uncertain');assert.equal((await f.run('create',{version:p.version})).phase,'uncertain');assert.equal(f.calls.length,1);
});

test('preview defaults to saved Flatpay account and creation keeps the reviewed account',async t=>{
 const f=fixture(t);
 const settings=f.get('admin_settings');
 f.set('admin_settings',{...settings,accounts:{...settings.accounts,flatpayClearing:'55105 - Flatpay'}});
 const p=await f.run('preview');
 assert.equal(p.phase,'prepared');assert.equal(p.proposal.voucher.Lines[0].AccountNumber,55105);
 assert.equal(f.calls.length,0);
 f.set('admin_settings',{...settings,accounts:{...settings.accounts,flatpayClearing:'99999 - Changed after preview'}});
 assert.equal((await f.run('create',{version:p.version})).phase,'draft');
 assert.equal(f.calls.find(c=>c.path==='vouchers/manuel').body.Lines[0].AccountNumber,55105);
});

test('invalid configured Flatpay account is rejected before any Dinero write',async t=>{
 const f=fixture(t);const settings=f.get('admin_settings');
 f.set('admin_settings',{...settings,accounts:{...settings.accounts,flatpayClearing:'99999 - Unavailable'}});
 await assert.rejects(f.run('preview'),/99999/);assert.equal(f.calls.length,0);
});
test('changed agreement, adjustments and stale preview prevent Dinero writes',async t=>{
 const f=fixture(t);const p=await f.run('preview',{flatpayAccount:accounts.flatpay});await assert.rejects(f.run('create',{version:'old'}),/Forslaget/);
 f.change({...settlement,chargeback:1});await assert.rejects(f.run('create',{version:p.version}),/reguleringer/);assert.equal(f.calls.length,0);
});
test('settlement list accepts actual AgreementNumber and ID while rejecting conflicting or foreign scope',async()=>{
 const base={...settlement,id:'settlement-id',createdDate:'2020-01-08T03:00:00'};
 const api=loader({'@/db/flatpay-report':{ensureFlatpayReport:async()=>{},flatpayReportStateKey:id=>'flatpay_report:'+id},'next/server':{NextResponse:{json:(data,options)=>({data,...options})}},'@/db/database':{},'@/db/credentials':{loadCredentials:async()=>({merchantID:'m',agreementId:'a',agreementNumber:'11',startDate:'2020-01-01'})},'@/lib/flatpay-api':{flatpayDateRange:()=>{},flatpayRead:async()=>[base,{...base,agreementID:'other'},{...base,merchantID:'other'},{...base,agreementNumber:'other'}]}})('app/api/flatpay/records/route.ts');
 const response=await api.POST(new Request('https://test/api/flatpay/records',{method:'POST',headers:{origin:'https://test','content-type':'application/json'},body:JSON.stringify({kind:'settlements',start:'2020-01-01',end:'2020-01-31'})}));
 assert.equal(response.status,200);assert.equal(response.data.records.length,1);assert.equal(response.data.records[0].id,'settlement-id');
});

test('missing PDF and rejected file upload prevent voucher creation',async t=>{
 for(const mode of ['missing-report','bad-upload','null-upload','wrong-type-upload','invalid-upload']){const f=fixture(t,mode);const p=await f.run('preview',{flatpayAccount:accounts.flatpay});await assert.rejects(f.run('create',{version:p.version}));assert.ok(!f.calls.some(c=>c.path==='vouchers/manuel'));}
});
test('uncertain voucher creation after upload is never repeated',async t=>{
 const f=fixture(t,'voucher-timeout');const p=await f.run('preview',{flatpayAccount:accounts.flatpay});await assert.rejects(f.run('create',{version:p.version}));assert.equal((await f.run('create',{version:p.version})).phase,'uncertain');assert.deepEqual(f.calls.map(c=>c.path),['files','vouchers/manuel']);
});
