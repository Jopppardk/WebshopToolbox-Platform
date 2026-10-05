// Operations: order and inventory imports, stocktakes, packaging, performance, record history, shipments and tracking.
import { test, assert, readFileSync, readdirSync, DatabaseSync, jose, pdfLib, fixture, loader, validateConfig, danishToday, root, secret, read, walk, token, harness, startSupport, mailFixture, invoiceHarness, customerEnv, feedSettings, feedFixture, customerRequest, customerStart, customerVerify, testShopConnections, productionSaleHarness, domesticMarkets, refundMoney, shopifyRefund } from './platform-harness.mjs';

test('operation snapshots isolate identical IDs, reject writes by readers and reject incomplete pages',async()=>{
 let mode='normal',calls=0;
 const order={id:'gid://shopify/Order/42',name:'#42',createdAt:new Date().toISOString(),test:false,currentTotalPriceSet:{shopMoney:{amount:'125.00',currencyCode:'DKK'}}};
 const network=async(url,opt)=>{calls++;assert.equal(opt.redirect,'manual');if(url.endsWith('/oauth/access_token'))return Response.json({access_token:'fixture-token'});const {query}=JSON.parse(opt.body);assert.doesNotMatch(query,/mutation/);return Response.json({data:{orders:{nodes:mode==='duplicate'?[order,order]:[order],pageInfo:{hasNextPage:mode==='cursor',endCursor:mode==='cursor'?'repeat':null}}}});};
 const h=harness(jose,network),env={PLATFORM_CREDENTIALS_KEY:'ab'.repeat(32)};try{
 const {seal}=loader()('platform/connections.ts');for(const shop of ['shop-a1','shop-a2'])h.sql.prepare('INSERT INTO webshop_connections(company_id,webshop_id,provider,shop_domain,credentials_encrypted) VALUES(?,?,?,?,?)').run('company-a',shop,'shopify','a.myshopify.com'.replace('a.',shop+'.'),await seal({...h.env,...env},['company-a',shop,'shopify',shop+'.myshopify.com'],{clientId:'test',clientSecret:'secret'}));
 const base=s=>'/api/platform/companies/company-a/webshops/'+s+'/data/orders';
 for(const shop of ['shop-a1','shop-a2']){const response=await h.request(base(shop),{user:'local-a',env,method:'POST',body:{}});assert.equal(response.status,200,await response.text());}
 assert.equal(h.sql.prepare('SELECT count(*) n FROM operation_snapshots').get().n,2);
 const before=calls;assert.equal((await h.request(base('shop-a2'),{user:'local-reader'})).status,403);assert.equal((await h.request(base('shop-a1'),{user:'local-b'})).status,403);assert.equal((await h.request(base('shop-a1'),{user:'local-reader',env,method:'POST',body:{}})).status,403);assert.equal(calls,before);
 const own=await(await h.request(base('shop-a1'),{user:'local-reader'})).json();assert.equal(own.rows.length,1);
 mode='cursor';assert.equal((await h.request(base('shop-a1'),{user:'local-a',env,method:'POST',body:{after:'repeat'}})).status,409);
 mode='duplicate';assert.equal((await h.request(base('shop-a1'),{user:'local-a',env,method:'POST',body:{}})).status,409);
 assert.equal(h.sql.prepare("SELECT count(*) n FROM operation_runs WHERE status='failed'").get().n,2);assert.equal(h.sql.prepare('SELECT count(*) n FROM operation_snapshots').get().n,2);
 }finally{h.close();}
});
test('packaging validates calendar dates, scopes data and preserves revision conflicts',async()=>{
 const h=harness();try{const base='/api/platform/companies/company-a/webshops/shop-a1/packaging',entry={action:'save',date:'2026-01-01',description:'Kasser',supplier:'Test',supplierCountry:'DK',supplierCvr:'',weightGrams:1000,reportable:'yes',audience:'household'};
 assert.equal((await h.request(base,{user:'local-reader',method:'POST',body:entry})).status,403);
 assert.equal((await h.request(base,{user:'local-a',method:'POST',body:{...entry,date:'2026-02-31'}})).status,400);
 const saved=await h.request(base,{user:'local-a',method:'POST',body:entry});assert.equal(saved.status,200);const {id}=await saved.json();
 assert.equal((await h.request(base,{user:'local-b'})).status,403);
 const data=await(await h.request(base+'?from=2026-01-01&to=2026-12-31',{user:'local-reader'})).json();assert.equal(data.period.householdGrams,1000);
 assert.equal((await h.request(base,{user:'local-a',method:'POST',body:{...entry,id,version:1,weightGrams:2000}})).status,200);
 assert.equal((await h.request(base,{user:'local-a',method:'POST',body:{...entry,id,version:1}})).status,409);
 }finally{h.close();}
});

test('order import warns when Shopify limits a longer history to 60 days without read_all_orders',async()=>{
 let scopes=['read_orders'];const queries=[];
 const network=async(url,opt)=>{if(url.endsWith('/oauth/access_token'))return Response.json({access_token:'fixture'});const {query}=JSON.parse(opt.body);assert.match(query,/^query /);queries.push(query.split(/[({ ]/)[1]);
  if(query.includes('OrderHistoryAccess'))return Response.json({data:{currentAppInstallation:{accessScopes:scopes.map(handle=>({handle}))}}});
  return Response.json({data:{orders:{nodes:[],pageInfo:{hasNextPage:false,endCursor:null}}}});};
 const h=harness(jose,network),env={PLATFORM_CREDENTIALS_KEY:'ab'.repeat(32)},path='/api/platform/companies/company-a/webshops/shop-a1/data/orders';
 try{await testShopConnections(h,env);
  let r=await h.request(path,{user:'local-a',env,method:'POST',body:{}});assert.equal(r.status,200,await r.clone().text());assert.match((await r.json()).warning,/read_all_orders/);
  assert.match(h.sql.prepare("SELECT message FROM operation_runs WHERE module='orders' ORDER BY rowid DESC").get().message,/60 dage/);
  r=await h.request(path,{user:'local-a',env,method:'POST',body:{after:'cursor-2'}});assert.equal((await r.json()).warning,undefined);
  scopes=['read_orders','read_all_orders'];r=await h.request(path,{user:'local-a',env,method:'POST',body:{}});assert.equal((await r.json()).warning,undefined);
  assert.deepEqual(queries,['OrderHistoryAccess','ToolboxSales','ToolboxSales','OrderHistoryAccess','ToolboxSales']);
 }finally{h.close();}
});

test('inventory import never fails on missing quantities; Lager lists tracked items without quantity or cost',async()=>{
 let missing=false;const item=(id,tracked,isActive,quantities)=>({id:'gid://shopify/InventoryItem/'+id,tracked,unitCost:null,variant:{title:'V'+id,sku:'SKU'+id,product:{title:'Vare '+id,status:'ACTIVE'}},inventoryLevels:{nodes:[{location:{id:'gid://shopify/Location/'+id,name:'Lager '+id,isActive},quantities}],pageInfo:{hasNextPage:false,endCursor:null}}});
 const network=async(url,opt)=>{if(url.endsWith('/oauth/access_token'))return Response.json({access_token:'fixture'});assert.match(JSON.parse(opt.body).query,/^query /);return Response.json({data:{inventoryItems:{nodes:[item(1,true,true,missing?[]:[{name:'on_hand',quantity:4}]),item(2,false,true,[]),item(3,true,false,[])],pageInfo:{hasNextPage:false,endCursor:null}}}});};
 const h=harness(jose,network),env={PLATFORM_CREDENTIALS_KEY:'ab'.repeat(32)},path='/api/platform/companies/company-a/webshops/shop-a1/data/inventory';
 try{await testShopConnections(h,env);
  let r=await h.request(path,{user:'local-a',env,method:'POST',body:{}});assert.equal(r.status,200,await r.clone().text());assert.equal((await r.json()).count,3);
  missing=true;r=await h.request(path,{user:'local-a',env,method:'POST',body:{}});assert.equal(r.status,200,await r.clone().text());assert.equal((await r.json()).count,3);
  assert.equal(h.sql.prepare("SELECT count(*) n FROM operation_runs WHERE module='inventory' AND status='failed'").get().n,0);
  const stock=await(await h.request('/api/platform/companies/company-a/webshops/shop-a1/stocktake',{user:'local-a',env})).json();
  assert.deepEqual(stock.incomplete.map(i=>[i.sku,i.location,i.reason]),[['SKU1','Lager 1','Mangler lagerantal og kostpris']]);assert.equal(stock.rows.length,0);
 }finally{h.close();}
});

test('notification bell lists failures per webshop and resets its count once the list is seen',async()=>{
 const h=harness(),base='/api/platform/tier1/shops/shop-a1',ids=['11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222','33333333-3333-4333-8333-333333333333'];
 try{
  const run=h.sql.prepare("INSERT INTO operation_runs(id,company_id,webshop_id,module,status,message,started_at) VALUES(?,?,?,?,?,?,?)");
  run.run(ids[0],'company-a','shop-a1','inventory','failed','Ufuldstændigt lagerantal.','2026-09-28 20:26:09');run.run(ids[1],'company-a','shop-a1','auto.import.orders','failed','Timeout','2026-09-28 20:30:00');run.run(ids[2],'company-a','shop-a2','orders','failed','Anden webshop','2026-09-28 20:31:00');
  const get=async user=>(await h.request(base+'/notifications',{user})).json();
  let d=await get('local-a');assert.equal(d.incidents.alarms,2);assert.deepEqual(d.errors.map(e=>[e.id,e.seen]),[[ids[1],false],[ids[0],false]]);
  for(const body of [{action:'seen',ids:'x'},{action:'seen',ids:['not-an-id']},{id:ids[0]}])assert.equal((await h.request(base+'/notifications',{user:'local-a',method:'POST',body})).status,400);
  assert.ok([403,404].includes((await h.request(base+'/notifications',{user:'local-b',method:'POST',body:{action:'seen',ids:[ids[0]]}})).status));
  let r=await h.request(base+'/notifications',{user:'local-reader',method:'POST',body:{action:'seen',ids:[ids[0],ids[2]]}});assert.equal(r.status,200,await r.clone().text());assert.equal((await r.json()).incidents.alarms,1);
  d=await get('local-a');assert.equal(d.errors.length,2);assert.deepEqual(d.errors.map(e=>e.seen),[false,true]);
  assert.equal(h.sql.prepare('SELECT count(*) n FROM operation_acknowledgements WHERE run_id=?').get(ids[2]).n,0);
  // More failures than the 50 listed: seeing the list clears the older ones too, not later ones.
  for(let i=0;i<70;i++)run.run(`44444444-4444-4444-8444-${String(i).padStart(12,'0')}`,'company-a','shop-a1','auto.import.inventory','failed','Lager',`2026-09-27 ${String(Math.floor(i/60)).padStart(2,'0')}:${String(i%60).padStart(2,'0')}:00`);
  d=await get('local-a');assert.equal(d.incidents.alarms,71);assert.equal(d.errors.length,50);
  r=await h.request(base+'/notifications',{user:'local-a',method:'POST',body:{action:'seen',ids:d.errors.filter(e=>!e.seen).map(e=>e.id)}});assert.equal((await r.json()).incidents.alarms,0);
  run.run('55555555-5555-4555-8555-555555555555','company-a','shop-a1','orders','failed','Ny fejl','2026-09-29 12:00:00');
  assert.equal((await get('local-a')).incidents.alarms,1);
  assert.equal(h.sql.prepare("SELECT count(*) n FROM operation_acknowledgements a JOIN operation_runs r ON r.id=a.run_id WHERE r.webshop_id='shop-a2'").get().n,0);
 }finally{h.close();}
});

test('stocktakes reread quantity and cost, isolate IDs, expire approvals and cannot mutate providers',async()=>{
 let quantity=5,cost='10.00',truncated=false;const network=async(url,opt)=>{if(url.endsWith('/oauth/access_token'))return Response.json({access_token:'fixture'});const {query}=JSON.parse(opt.body);assert.match(query,/^query /);assert.doesNotMatch(query,/mutation/);return Response.json({data:{inventoryItems:{nodes:[{id:'gid://shopify/InventoryItem/1',tracked:true,unitCost:{amount:cost,currencyCode:'DKK'},variant:{title:'Test',sku:'SKU',product:{title:'Vare',status:'ACTIVE'}},inventoryLevels:{nodes:[{location:{id:'gid://shopify/Location/1',name:'Lager',isActive:true},quantities:[{name:'on_hand',quantity}]}],pageInfo:{hasNextPage:truncated}}}],pageInfo:{hasNextPage:false,endCursor:null}}}});};
 const h=harness(jose,network),env={PLATFORM_CREDENTIALS_KEY:'ab'.repeat(32)},base='/api/platform/companies/company-a/webshops/shop-a1/stocktake';
 try{await testShopConnections(h,env);h.sql.prepare('INSERT INTO accounting_connections(company_id,organization_id,credentials_encrypted,revision,chart_json) VALUES(?,?,?,?,?)').run('company-a','123','unused','r1',JSON.stringify([{number:'5500',kind:'entry',vatCode:'',hidden:false},{number:'2000',kind:'entry',vatCode:'',hidden:false}]));h.sql.prepare('INSERT INTO accounting_mapping(company_id,accounts_json) VALUES(?,?)').run('company-a',JSON.stringify({inventory:'5500 - Lager',inventoryAdjustment:'2000 - Regulering'}));
 const changes=[{inventoryItemId:'gid://shopify/InventoryItem/1',locationId:'gid://shopify/Location/1',compareQuantity:5,quantity:3}];
 const post=body=>h.request(base,{user:'local-a',env,method:'POST',body});
 let r=await post({action:'prepare',changes});assert.equal(r.status,200,await r.clone().text());const prepared=await r.json();assert.equal(prepared.adjustmentMinor,-2000);assert.equal(prepared.voucher.Lines[0].Amount,20);assert.doesNotMatch(prepared.voucher.ExternalReference,/sablen/);
 assert.equal((await h.request(base,{user:'local-b',env})).status,403);assert.equal((await h.request(base,{user:'local-reader',env,method:'POST',body:{action:'prepare',changes}})).status,403);
 const body={action:'simulate',id:prepared.id,version:prepared.version,confirmation:true};cost='11.00';assert.equal((await post(body)).status,409);cost='10.00';quantity=4;assert.equal((await post(body)).status,409);quantity=5;
 assert.equal((await h.request(base.replace('shop-a1','shop-a2'),{user:'local-a',env,method:'POST',body})).status,409);
 assert.equal((await post({...body,action:'commit'})).status,403);assert.equal((await post(body)).status,200);assert.equal((await post(body)).status,409);
 truncated=true;assert.equal((await h.request(base,{user:'local-a',env})).status,409);
 assert.equal(h.sql.prepare('SELECT phase FROM stocktakes').get().phase,'simulated');
 }finally{h.close();}
});

test('Lager compares the webshop value with the Dinero inventory account and regulates the difference only after approval',async()=>{
 const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Copenhagen',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date()),year=today.slice(0,4);
 let ledger=4000,draft='Draft',missingCost=false,edited=false;const dineroCalls=[];
 const network=async(input,opt)=>{const url=new URL(input);
  if(url.hostname.endsWith('dinero.dk')){dineroCalls.push([opt.method||'GET',url.pathname]);if(url.pathname.endsWith('/oauth/token'))return Response.json({access_token:'fixture'});assert.ok(!opt.method||opt.method==='GET');
   if(url.pathname.endsWith('/accountingyears'))return Response.json([{FromDate:year+'-01-01',ToDate:year+'-12-31'}]);
   if(url.pathname.endsWith('/entries')){assert.equal(url.searchParams.get('toDate'),today);return Response.json([{EntryGuid:'00000000-0000-4000-8000-000000000001',AccountNumber:5500,Amount:ledger/100-10,Date:year+'-01-01',Type:'Primo'},{EntryGuid:'00000000-0000-4000-8000-000000000002',AccountNumber:5500,Amount:10,Date:today,Type:'Normal'},{EntryGuid:'00000000-0000-4000-8000-000000000003',AccountNumber:5500,Amount:999,Date:year+'-12-31',Type:'Ultimo'},{EntryGuid:'00000000-0000-4000-8000-000000000004',AccountNumber:1000,Amount:-77,Date:today,Type:'Normal'}].filter(e=>e.Date<=today));}
   if(/\/vouchers\/manuel\/[\da-f-]{36}$/.test(url.pathname))return Response.json({guid:'11111111-1111-4111-8111-111111111111',status:draft,timestamp:'v1',voucherDate:'2026-09-28',externalReference:'wtb:stocktake:known',lines:[{description:'Lagerregulering · 1 lagerlinjer',accountNumber:2000,balancingAccountNumber:5500,amount:edited?-20:-10,accountVatCode:'none',balancingAccountVatCode:'none',amountExclVatValue:edited?-20:-10,vatAmountValue:0,amountInclVatValue:edited?-20:-10}]});
   throw Error('unexpected '+url.pathname);}
  if(url.pathname.endsWith('/oauth/access_token'))return Response.json({access_token:'fixture'});const {query}=JSON.parse(opt.body);assert.match(query,/^query /);
  const cost=missingCost&&url.hostname.startsWith('shop-a2')?null:{amount:'10.00',currencyCode:'DKK'};
  return Response.json({data:{inventoryItems:{nodes:[{id:'gid://shopify/InventoryItem/1',tracked:true,unitCost:cost,variant:{title:'Test',sku:'SKU',product:{title:'Vare',status:'ACTIVE'}},inventoryLevels:{nodes:[{location:{id:'gid://shopify/Location/1',name:'Lager',isActive:true},quantities:[{name:'on_hand',quantity:5}]}],pageInfo:{hasNextPage:false}}}],pageInfo:{hasNextPage:false,endCursor:null}}}});};
 const h=harness(jose,network),env={PLATFORM_CREDENTIALS_KEY:'ab'.repeat(32)},base='/api/platform/companies/company-a/webshops/shop-a1/stocktake';
 try{await testShopConnections(h,env);const {seal}=loader()('platform/connections.ts');
 h.sql.prepare('INSERT INTO accounting_connections(company_id,organization_id,credentials_encrypted,revision,chart_json) VALUES(?,?,?,?,?)').run('company-a','123',await seal({...h.env,...env},['company-a','dinero','123'],{organizationId:'123',clientId:'test',clientSecret:'secret',apiKey:'key'}),'r1',JSON.stringify([{number:'5500',kind:'entry',vatCode:'',hidden:false},{number:'2000',kind:'entry',vatCode:'',hidden:false}]));
 h.sql.prepare('INSERT INTO accounting_mapping(company_id,accounts_json) VALUES(?,?)').run('company-a',JSON.stringify({inventory:'5500 - Lager',inventoryAdjustment:'2000 - Regulering'}));
 // The Dinero account is company-wide: both connected webshops (5000 each) are compared with it.
 let status=await(await h.request(base,{user:'local-a',env})).json();assert.equal(status.totalValueMinor,5000);assert.deepEqual(status.company,{shops:2,valueMinor:10000,incomplete:0,dkk:true});assert.deepEqual(status.dinero,{account:5500,valueMinor:4000,from:year+'-01-01',to:today});
 const post=body=>h.request(base,{user:'local-a',env,method:'POST',body});
 assert.equal((await post({action:'prepare-reconcile',shopifyValueMinor:5000,dineroValueMinor:4000})).status,409);
 missingCost=true;status=await(await h.request(base,{user:'local-a',env})).json();assert.deepEqual(status.company,{shops:2,valueMinor:5000,incomplete:1,dkk:true});
 let refused=await post({action:'prepare-reconcile',shopifyValueMinor:5000,dineroValueMinor:4000});assert.equal(refused.status,409);assert.match((await refused.json()).error,/mangler lagerantal eller kostpris/);missingCost=false;
 assert.equal((await h.request(base,{user:'local-reader',env,method:'POST',body:{action:'prepare-reconcile',shopifyValueMinor:10000,dineroValueMinor:4000}})).status,403);
 let r=await post({action:'prepare-reconcile',shopifyValueMinor:10000,dineroValueMinor:4000});assert.equal(r.status,200,await r.clone().text());const prepared=await r.json();
 assert.equal(prepared.kind,'reconcile');assert.equal(prepared.adjustmentMinor,6000);assert.equal(prepared.webshops,2);assert.deepEqual(prepared.changes,[]);assert.equal(prepared.voucher.VoucherDate,today);
 assert.deepEqual(prepared.voucher.Lines[0],{Description:'Lagerafstemning mod webshoppens lagerværdi',AccountNumber:2000,BalancingAccountNumber:5500,Amount:-60,AccountVatCode:'none',BalancingAccountVatCode:'none'});
 const body={action:'simulate',id:prepared.id,version:prepared.version,confirmation:true};
 ledger=4100;assert.equal((await post(body)).status,409);ledger=4000;
 assert.equal((await post({...body,action:'commit'})).status,403);assert.equal((await post(body)).status,200);assert.equal((await post(body)).status,409);
 ledger=10000;assert.equal((await post({action:'prepare-reconcile',shopifyValueMinor:10000,dineroValueMinor:10000})).status,409);ledger=4000;
 // An earlier regulation that is uncertain, or still a draft in Dinero, blocks a second one; a booked or deleted one does not.
 const receipt=h.sql.prepare("INSERT INTO production_receipts(company_id,webshop_id,provider,module,external_id,destination,phase,version,payload_json) VALUES('company-a','shop-a2','shopify','stocktake',?,'123',?,'v',?)");
 receipt.run('earlier','draft',JSON.stringify({guid:'11111111-1111-4111-8111-111111111111'}));
 assert.equal((await post({action:'prepare-reconcile',shopifyValueMinor:10000,dineroValueMinor:4000})).status,409);
 draft='Booked';assert.equal((await post({action:'prepare-reconcile',shopifyValueMinor:10000,dineroValueMinor:4000})).status,200);
 // A reconciliation that never reached Dinero (no voucher ID) is listed and can be released by a company admin after checking Dinero.
 const lost='22222222-2222-4222-8222-222222222222';receipt.run(lost,'uncertain',JSON.stringify({kind:'reconcile',adjustmentMinor:6000,dineroError:{status:400,detail:'ExternalReference: for lang'}}));
 status=await(await h.request(base,{user:'local-a',env})).json();assert.deepEqual(status.pending.map(p=>[p.id,p.kind,p.releasable,p.dineroError?.status]),[[lost,'reconcile',true,400]]);
 assert.equal(status.pending[0].version,undefined);const readerView=await h.request(base,{user:'local-reader',env});assert.equal(readerView.status,200);assert.equal((await readerView.json()).pending,undefined);
 assert.equal((await post({action:'prepare-reconcile',shopifyValueMinor:10000,dineroValueMinor:4000})).status,409);
 assert.equal((await post({action:'release',externalId:lost,confirmation:'yes'})).status,400);
 assert.equal((await h.request(base,{user:'local-reader',env,method:'POST',body:{action:'release',externalId:lost,confirmation:'no-draft-in-dinero'}})).status,403);
 assert.equal((await h.request(base.replace('company-a','company-b').replace('shop-a1','shop-b1'),{user:'local-b',env,method:'POST',body:{action:'release',externalId:lost,confirmation:'no-draft-in-dinero'}})).status!==200,true);
 r=await post({action:'release',externalId:lost,confirmation:'no-draft-in-dinero'});assert.equal(r.status,200,await r.clone().text());
 assert.equal(h.sql.prepare('SELECT count(*) n FROM production_receipts WHERE external_id=?').get(lost).n,0);
 assert.equal(h.sql.prepare("SELECT count(*) n FROM record_events WHERE external_id=? AND event='cleanup.receipt_cleared'").get(lost).n,1);
 assert.equal(h.sql.prepare("SELECT count(*) n FROM audit_events WHERE action='stocktake.released' AND resource_id=?").get(lost).n,1);
 assert.equal((await post({action:'release',externalId:lost,confirmation:'no-draft-in-dinero'})).status,409);
 assert.equal((await post({action:'prepare-reconcile',shopifyValueMinor:10000,dineroValueMinor:4000})).status,200);
 // An old count regulation without a voucher ID is clarified the same way: a new reconciliation reads both values live.
 const stuck='33333333-3333-4333-8333-333333333333';receipt.run(stuck,'uncertain',JSON.stringify({adjustmentMinor:-15000}));
 status=await(await h.request(base,{user:'local-a',env})).json();assert.deepEqual(status.pending.map(p=>[p.kind,p.voucher,p.releasable,p.adjustmentMinor]),[['count',false,true,-15000]]);
 assert.equal((await post({action:'release',externalId:stuck,confirmation:'no-draft-in-dinero'})).status,200);
 // With a voucher ID Dinero decides: a draft keeps it blocked, a booked voucher settles the receipt as booked.
 const known='44444444-4444-4444-8444-444444444444',knownVoucher={VoucherDate:'2026-09-28',ExternalReference:'wtb:stocktake:known',Lines:[{Description:'Lagerregulering · 1 lagerlinjer',AccountNumber:2000,BalancingAccountNumber:5500,Amount:-10,AccountVatCode:'none',BalancingAccountVatCode:'none'}]};
 receipt.run(known,'uncertain',JSON.stringify({guid:'11111111-1111-4111-8111-111111111111',voucher:knownVoucher,expected:[{net:-1000,tax:0,gross:-1000}],adjustmentMinor:1000}));
 draft='Draft';let answer=await post({action:'release',externalId:known});assert.equal(answer.status,409);assert.match((await answer.json()).error,/kladde/);
 assert.equal((await post({action:'prepare-reconcile',shopifyValueMinor:10000,dineroValueMinor:4000})).status,409);
 // A booked voucher that was edited as a draft no longer matches the regulation and is not accepted as its receipt.
 draft='Booked';edited=true;answer=await post({action:'release',externalId:known});assert.equal(answer.status,409);assert.match((await answer.json()).error,/afviger/);edited=false;
 answer=await post({action:'release',externalId:known});assert.equal(answer.status,200,await answer.clone().text());
 assert.equal(h.sql.prepare('SELECT phase FROM production_receipts WHERE external_id=?').get(known).phase,'booked');
 assert.equal((await post({action:'prepare-reconcile',shopifyValueMinor:10000,dineroValueMinor:4000})).status,200);
 assert.ok(dineroCalls.every(([method,path])=>method==='GET'||path.endsWith('/oauth/token')));
 }finally{h.close();}
});

test('packaging fulfillment import preserves historical weights and isolates overlapping event IDs',async()=>{
 let weight='100',business=false,broken=false;
 const fulfillment={id:'gid://shopify/Fulfillment/1',createdAt:new Date().toISOString(),status:'SUCCESS',fulfillmentLineItems:{nodes:[{id:'gid://shopify/FulfillmentLineItem/1',quantity:2,lineItem:{title:'Vare',variant:{id:'gid://shopify/ProductVariant/1',title:'Variant',product:{id:'gid://shopify/Product/1',title:'Vare'}}}}],pageInfo:{hasNextPage:false,endCursor:null}}};
 const h=harness(jose,async(url,opt)=>{if(url.endsWith('/oauth/access_token'))return Response.json({access_token:'fixture'});const {query}=JSON.parse(opt.body);assert.doesNotMatch(query,/mutation/);
 if(query.includes('PackagingOrders'))return Response.json({data:{orders:{nodes:[{id:'gid://shopify/Order/1',name:'#1',test:false,billingAddress:{company:business?'Test ApS':''},fulfillments:[fulfillment]}],pageInfo:broken?{}:{hasNextPage:false,endCursor:null}}}});
 if(query.includes('PackagingProducts'))return Response.json({data:{nodes:[{id:'gid://shopify/Product/1',title:'Vare',packagingWeight:{value:weight},packagingReportable:{value:'ja'}}]}});throw Error('unexpected request');});
 const env={PLATFORM_CREDENTIALS_KEY:'ab'.repeat(32)},day=danishToday(),base=shop=>'/api/platform/companies/company-a/webshops/'+shop+'/packaging';
 try{await testShopConnections(h,env);for(const shop of ['shop-a1','shop-a2']){const r=await h.request(base(shop),{user:'local-a',env,method:'POST',body:{action:'sync',start:day,end:day}});assert.equal(r.status,200,await r.text());}
 weight='900';business=true;let r=await h.request(base('shop-a1'),{user:'local-a',env,method:'POST',body:{action:'sync',start:day,end:day}});assert.equal(r.status,200,await r.text());
 const a=await(await h.request(base('shop-a1'),{user:'local-a'})).json(),b=await(await h.request(base('shop-a2'),{user:'local-a'})).json();assert.equal(a.period.commercialGrams,200);assert.equal(b.period.householdGrams,200);assert.equal(a.period.products[0].grams,200);
 broken=true;r=await h.request(base('shop-a1'),{user:'local-a',env,method:'POST',body:{action:'sync',start:day,end:day}});assert.equal(r.status,409);assert.equal(h.sql.prepare('SELECT count(*) n FROM packaging_snapshots').get().n,2);
 }finally{h.close();}
});


test('finance dashboard isolates overlapping organization and entry IDs and imports only by GET',async()=>{
 const year=new Date().getUTCFullYear(),today=new Date().toISOString().slice(0,10),calls=[];
 const h=harness(jose,async(input,opt)=>{const url=new URL(input);calls.push(url.pathname);assert.equal(opt.redirect,'manual');if(url.pathname.endsWith('/oauth/token'))return Response.json({access_token:'fixture'});assert.ok(!opt.method||opt.method==='GET');
 if(url.pathname.endsWith('/accountingyears'))return Response.json([{FromDate:year+'-01-01',ToDate:year+'-12-31'}]);
 if(url.pathname.endsWith('/accounts/entry'))return Response.json([{AccountNumber:1000,Category:'Turnover'}]);
 if(url.pathname.endsWith('/entries'))return Response.json([{EntryGuid:'00000000-0000-4000-8000-000000000001',AccountNumber:1000,Amount:-100,Date:today,Type:'Normal'}]);throw Error('unexpected');});const env={PLATFORM_CREDENTIALS_KEY:'ab'.repeat(32)};
 try{const {seal}=loader()('platform/connections.ts');for(const [company,user] of [['company-a','local-a'],['company-b','local-b']]){
 const credentials={organizationId:'123',clientId:'test',clientSecret:'secret',apiKey:'key'},encrypted=await seal({...h.env,...env},[company,'dinero','123'],credentials);h.sql.prepare('INSERT INTO accounting_connections(company_id,organization_id,credentials_encrypted,revision,chart_json) VALUES(?,?,?,?,?)').run(company,'123',encrypted,'r','[]');
 let r=await h.request('/api/platform/companies/'+company+'/finance',{user,env,method:'POST',body:{}});assert.equal(r.status,200,await r.text());r=await h.request('/api/platform/companies/'+company+'/finance',{user,env});assert.equal(r.status,200);const result=await r.json();assert.equal(result.ready,true);assert.equal(result.data.revenueYtd,10000);assert.equal(result.data.previousYtd,null);
 }
 assert.equal(h.sql.prepare('SELECT count(*) n FROM finance_ledger').get().n,2);
 assert.equal((await h.request('/api/platform/companies/company-a/finance',{user:'local-b',env})).status,403);assert.equal((await h.request('/api/platform/companies/company-a/finance',{user:'local-reader',env})).status,403);
 assert.equal(calls.filter(p=>p.endsWith('/entries')).length,2);
 }finally{h.close();}
});


test('Tier 1 history drives order import and display, isolates shops, and preserves stored data',async()=>{
 const queries=[];const today=danishToday(),recent=today+'T12:00:00Z';
 const h=harness(jose,async(url,opt)=>{if(url.endsWith('/oauth/access_token'))return Response.json({access_token:'test'});const b=JSON.parse(opt.body);queries.push(b);return Response.json({data:{orders:{nodes:[{id:'gid://shopify/Order/991',name:'#991',test:true,createdAt:recent,currentTotalPriceSet:{shopMoney:{amount:'100.00',currencyCode:'DKK'}}},{id:'gid://shopify/Order/990',name:'#990',createdAt:'2020-01-01T12:00:00Z',currentTotalPriceSet:{shopMoney:{amount:'50.00',currencyCode:'DKK'}}}],pageInfo:{hasNextPage:false,endCursor:null}}}});});
 const env={PLATFORM_CREDENTIALS_KEY:'ab'.repeat(32)},base='/api/platform/tier1/shops/shop-a1';
 const post=(path,body,user='local-a')=>h.request(base+path,{user,env,method:'POST',body});
 try{
  await testShopConnections(h,env);
  assert.equal((await post('/integrations/start-date',{provider:'shopify',startDate:today},'local-reader')).status,403);
  assert.equal((await post('/integrations/start-date',{provider:'shopify',startDate:'2026-02-30'})).status,400);
  assert.equal((await post('/integrations/start-date',{provider:'shopify',startDate:today})).status,200);
  assert.equal((await(await h.request(base+'/integrations/start-date?provider=shopify',{user:'local-a'})).json()).startDate,today);
  assert.equal((await(await h.request(base.replace('shop-a1','shop-a2')+'/integrations/start-date?provider=shopify',{user:'local-a'})).json()).startDate,'');
  const response=await post('/shopify/orders',{});assert.equal(response.status,200,await response.clone().text());assert.equal((await response.json()).synced,1);assert.match(queries[0].variables.query,/created_at:>=/);
  const list=await(await h.request(base+'/shopify/orders?period=today',{user:'local-a'})).json();assert.equal(list.total,1);assert.equal(list.orders[0].externalId,'gid://shopify/Order/991');assert.equal(h.sql.prepare('SELECT count(*) n FROM invoice_orders').get().n,1);
  assert.equal((await h.request(base+'/shopify/orders',{user:'local-b'})).status,404);
  assert.equal((await post('/admin/history',{months:12,startDate:'2025-01-01'})).status,400);
  assert.equal((await post('/admin/history',{months:12,startDate:'2025-01-01',confirmStartDateChange:true})).status,200);
  assert.equal(h.sql.prepare('SELECT count(*) n FROM operation_snapshots').get().n,1);
  assert.equal((await post('/bookkeeping/manual',{action:'retry'})).status,403);
 }finally{h.close();}
});

test('Tier 1 data views render truthful empty state and restrict job errors to Tier 0',async()=>{
 const h=harness(),base='/api/platform/tier1/shops/shop-a1';try{
  for(const path of ['/shopify/orders','/invoices','/documents','/payouts/overview','/refunds/overview','/admin/sync-status','/notifications','/dashboard/platform','/shopify/packaging']){
   const response=await h.request(base+path,{user:'local-a'});assert.equal(response.status,200,path+': '+await response.clone().text());
  }
  h.sql.prepare("INSERT INTO operation_runs(id,company_id,webshop_id,module,status,message) VALUES('failed-a','company-a','shop-a1','orders','failed','Testfejl')").run();
  for(const user of ['local-a','local-reader'])for(const method of ['GET','POST'])assert.equal((await h.request(base+'/admin/errors',{user,method,...(method==='POST'?{body:{id:'failed-a'}}:{})})).status,403);
  assert.equal(h.sql.prepare('SELECT count(*) n FROM operation_runs').get().n,1);
  assert.equal((await(await h.request(base+'/admin/sync-status',{user:'local-a'})).json()).automatic,false);
  const entry={date:new Date().toISOString().slice(0,10),description:'Test',supplier:'Test',supplierCountry:'DK',supplierCvr:'',weightGrams:100,reportable:'yes',audience:'household'};
  const save=await h.request(base+'/shopify/packaging',{user:'local-a',method:'POST',body:{action:'upsert',entry}});assert.equal(save.status,200,await save.clone().text());
  const periods=(await save.json()).periods;assert.equal(periods.currentQuarter.manualEntries.length,1);const saved=periods.currentQuarter.manualEntries[0];
  assert.equal((await h.request(base+'/shopify/packaging',{user:'local-a',method:'POST',body:{action:'delete',id:saved.id,version:0}})).status,409);
  assert.equal((await h.request(base+'/shopify/packaging',{user:'local-a',method:'POST',body:{action:'delete',id:saved.id,version:saved.version}})).status,200);
 }finally{h.close();}
});

test('Tier 1 payment views preserve currency precision, provider scope, details and safe write barriers',async()=>{
 const h=harness(),base='/api/platform/tier1/shops/shop-a1';
 try{
  const day=new Date().toISOString().slice(0,10),payment={id:'gid://shopify/ShopifyPaymentsBalanceTransaction/55',type:'REFUND',test:false,transactionDate:day+'T12:00:00Z',amount:{amount:'-123',currencyCode:'JPY'},fee:{amount:'0',currencyCode:'JPY'},net:{amount:'-123',currencyCode:'JPY'},associatedOrder:null,associatedPayout:null};
  h.sql.prepare('INSERT INTO operation_snapshots(company_id,webshop_id,module,external_id,occurred_at,payload_json) VALUES(?,?,?,?,?,?)').run('company-a','shop-a1','refunds',payment.id,payment.transactionDate,JSON.stringify(payment));
  const result=await h.request(base+'/refunds/overview',{user:'local-a'});assert.equal(result.status,200);const body=await result.json();assert.equal(body.summary[0].gross,-123);assert.equal(body.payments[0].bookingStatus,'setup_required');
  const other=await (await h.request(base.replace('shop-a1','shop-a2')+'/refunds/overview',{user:'local-a'})).json();assert.deepEqual(other.payments,[]);
  h.sql.prepare("INSERT INTO payment_connections(company_id,webshop_id,provider,identity,metadata_json,credentials_encrypted,start_date) VALUES(?,?,?,?,?,?,?)").run('company-a','shop-a1','viabill','acc','{}','unused',day);
  h.sql.prepare("INSERT INTO payment_records(company_id,webshop_id,provider,kind,external_id,occurred_at,payload_json,paid) VALUES(?,?,?,?,?,?,?,1)").run('company-a','shop-a1','viabill','payout','entry-1',day,JSON.stringify({id:'viabill:acc:entry-1',entryUUID:'entry-1',date:day,currency:'DKK',amountMinor:321,entries:[]}));
  const detail=await h.request(base+'/viabill/records?kind=payout&id=viabill:acc:entry-1',{user:'local-a'});assert.equal(detail.status,200);assert.equal((await detail.json()).record.amountMinor,321);
  assert.equal((await h.request(base.replace('shop-a1','shop-a2')+'/viabill/records?kind=payout&id=viabill:acc:entry-1',{user:'local-a'})).status,404);
  const log=await h.request(base+'/payouts/log?provider=viabill&externalId=entry-1',{user:'local-a'});assert.equal(log.status,200);const logged=await log.json();assert.equal(logged.nextOffset,null);assert.ok(Array.isArray(logged.details));assert.ok(logged.events.some(e=>e.title==='Hentet ind i WebshopToolbox'));assert.equal(h.sql.prepare('SELECT count(*) n FROM production_receipts').get().n,0);
  for(const path of ['/sales/transfer','/refunds/transfer','/payouts/transfer','/invoices/email','/flatpay/production'])assert.equal((await h.request(base+path,{user:'local-a',method:'POST',body:{}})).status,403);
  const {dataStartDate}=loader({jose,'pdf-lib':pdfLib})('platform/tier1-history.ts');
  await h.request(base+'/integrations/start-date',{user:'local-a',method:'POST',body:{provider:'shopify',startDate:day}});assert.equal(await dataStartDate(h.env,'company-a','shop-a1'),day);
 }finally{h.close();}
});


test('production stocktake claims once before Shopify, retains uncertain writes and validates current quantity',async()=>{
 for(const lost of [false,true]){const h=harness();try{
 const mapping=JSON.stringify({inventory:'5500',inventoryAdjustment:'2000'}),chart=[5500,2000].map(n=>({number:String(n),hidden:false,vatCode:'',kind:'entry'}));
 h.sql.prepare('INSERT INTO accounting_connections(company_id,organization_id,credentials_encrypted,revision,chart_json) VALUES(?,?,?,?,?)').run('company-a','123','synthetic','r1',JSON.stringify(chart));
 h.sql.prepare('INSERT INTO accounting_mapping(company_id,accounts_json) VALUES(?,?)').run('company-a',mapping);
 h.sql.prepare('INSERT INTO tier1_preferences VALUES(?,?,?,?)').run('company-a','shop-a1',JSON.stringify({automation:{inventoryBookDinero:true}}),'r1');
 for(const p of ['shopify','dinero'])h.sql.prepare('INSERT INTO booking_start_dates(company_id,webshop_id,provider,start_date) VALUES(?,?,?,?)').run('company-a','shop-a1',p,'2026-01-01');
 const id=crypto.randomUUID(),version=crypto.randomUUID(),change={inventoryItemId:'gid://shopify/InventoryItem/1',locationId:'gid://shopify/Location/1',compareQuantity:5,quantity:3,unitCostMinor:1000};
 const voucher={VoucherDate:new Date().toISOString().slice(0,10),ExternalReference:'test-stocktake',Lines:[{Description:'Inventory',AccountNumber:2000,BalancingAccountNumber:5500,Amount:20,AccountVatCode:'none',BalancingAccountVatCode:'none'}]};
 const payload={changes:[change],account:{organizationId:'123',revision:'r1',mapping,inventory:5500,adjustment:2000},voucher,adjustmentMinor:-2000,expiresAt:Date.now()+600000};
 h.sql.prepare("INSERT INTO stocktakes(company_id,webshop_id,id,version,phase,payload_json,created_by) VALUES(?,?,?,?,'prepared',?,'local-a')").run('company-a','shop-a1',id,version,JSON.stringify(payload));
 let quantity=4,mutations=0,posts=0,books=0,remote;const guid='12345678-1234-1234-1234-123456789abc';
 const api=loader({jose,'pdf-lib':pdfLib,'./connections':{unseal:async()=>({organizationId:'123'})},'./invoice-source':{shopAccess:async()=>({shop:'test.myshopify.com',accessToken:'synthetic'})},'./inventory-source':{readInventory:async()=>({rows:[{...change,quantity,currency:'DKK'}]})},'./dinero-read':{readDineroAccounts:async()=>chart},'./dinero-write':{dineroClient:async()=>async(path,method,body)=>{if(method==='GET')return remote;if(path.endsWith('/book')){books++;remote.Status='Booked';return remote;}posts++;remote={...body,Guid:guid,Timestamp:'v1',Status:'Draft',Lines:body.Lines.map(l=>({...l,AmountExclVatValue:20,VatAmountValue:0,AmountInclVatValue:20}))};return {Guid:guid};}},fetch:async(url,options)=>{mutations++;const b=JSON.parse(options.body);assert.equal(b.variables.input.quantities[0].changeFromQuantity,5);assert.equal(b.variables.key,id);assert.equal(h.sql.prepare("SELECT phase FROM production_receipts").get().phase,'creating');if(lost)throw Error('lost response');return Response.json({data:{inventorySetQuantities:{inventoryAdjustmentGroup:{createdAt:'now'},userErrors:[]}}});}})('platform/production-stocktake.ts');
 const env={...h.env,PLATFORM_ENV:'production',PLATFORM_EXTERNAL_WRITES:'enabled'},actor={id:'local-a',platformAdmin:false},input={id,version,confirmation:true};
 await assert.rejects(()=>api.commitStocktake(h.env,actor,'company-a','shop-a1',input),/ikke aktiveret/);
 await assert.rejects(()=>api.commitStocktake(env,actor,'company-a','shop-a1',input),/kostpris/);assert.equal(mutations,0);quantity=5;
 const results=await Promise.allSettled([api.commitStocktake(env,actor,'company-a','shop-a1',input),api.commitStocktake(env,actor,'company-a','shop-a1',input)]);
 assert.equal(mutations,1);assert.equal(posts,lost?0:1);assert.equal(books,lost?0:1);assert.equal(h.sql.prepare('SELECT phase FROM production_receipts').get().phase,lost?'uncertain':'booked');
 if(lost)await assert.rejects(()=>api.commitStocktake(env,actor,'company-a','shop-a1',input),/afklaring/);else assert.ok(results.some(r=>r.status==='fulfilled'));assert.equal(mutations,1);
 }finally{h.close();}}
});

test('production inventory reconciliation books one Dinero voucher, never touches Shopify and rechecks both values',async()=>{
 const h=harness();try{
 const mapping=JSON.stringify({inventory:'5500',inventoryAdjustment:'2000'}),chart=[5500,2000].map(n=>({number:String(n),hidden:false,vatCode:'',kind:'entry'}));
 h.sql.prepare('INSERT INTO accounting_connections(company_id,organization_id,credentials_encrypted,revision,chart_json) VALUES(?,?,?,?,?)').run('company-a','123','synthetic','r1',JSON.stringify(chart));
 h.sql.prepare('INSERT INTO accounting_mapping(company_id,accounts_json) VALUES(?,?)').run('company-a',mapping);
 h.sql.prepare('INSERT INTO tier1_preferences VALUES(?,?,?,?)').run('company-a','shop-a1',JSON.stringify({automation:{inventoryBookDinero:true}}),'r1');
 for(const p of ['shopify','dinero'])h.sql.prepare('INSERT INTO booking_start_dates(company_id,webshop_id,provider,start_date) VALUES(?,?,?,?)').run('company-a','shop-a1',p,'2026-01-01');
 const id=crypto.randomUUID(),version=crypto.randomUUID(),today=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Copenhagen',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
 const voucher={VoucherDate:today,ExternalReference:'test-reconcile',Lines:[{Description:'Lagerafstemning mod webshoppens lagerværdi',AccountNumber:2000,BalancingAccountNumber:5500,Amount:-10,AccountVatCode:'none',BalancingAccountVatCode:'none'}]};
 const payload={kind:'reconcile',changes:[],account:{organizationId:'123',revision:'r1',mapping,inventory:5500,adjustment:2000},voucher,adjustmentMinor:1000,shopifyValueMinor:5000,dineroValueMinor:4000,expiresAt:Date.now()+600000};
 h.sql.prepare("INSERT INTO stocktakes(company_id,webshop_id,id,version,phase,payload_json,created_by) VALUES(?,?,?,?,'prepared',?,'local-a')").run('company-a','shop-a1',id,version,JSON.stringify(payload));
 let balance=4100,posts=0,books=0,remote,reject=false;const guid='12345678-1234-1234-1234-123456789abc';class DineroHttpError extends Error{constructor(status,detail){super('HTTP '+status);this.status=status;this.detail=detail;}}
 const api=loader({jose,'pdf-lib':pdfLib,'./connections':{unseal:async()=>({organizationId:'123'})},'./invoice-source':{shopAccess:async()=>({shop:'test.myshopify.com',accessToken:'synthetic'})},'./inventory-source':{readInventory:async()=>({rows:[{inventoryItemId:'gid://shopify/InventoryItem/1',locationId:'gid://shopify/Location/1',quantity:5,unitCostMinor:1000,currency:'DKK'}],totalValueMinor:5000})},'./dinero-read':{readDineroAccounts:async()=>chart,readDineroAccountBalance:async(c,account,day)=>({account,balanceMinor:balance,from:'2026-01-01',to:day})},'./dinero-write':{DineroHttpError,dineroClient:async()=>async(path,method,body)=>{if(method==='GET')return remote;if(path.endsWith('/book')){books++;remote.Status='Booked';return remote;}if(reject)throw new DineroHttpError(400,'ExternalReference: for lang');posts++;remote={...body,Guid:guid,Timestamp:'v1',Status:'Draft',Lines:body.Lines.map(l=>({...l,AmountExclVatValue:-10,VatAmountValue:0,AmountInclVatValue:-10}))};return {Guid:guid};}},fetch:async()=>{throw Error('Shopify must not be called');}})('platform/production-stocktake.ts');
 const env={...h.env,PLATFORM_ENV:'production',PLATFORM_EXTERNAL_WRITES:'enabled'},actor={id:'local-a',platformAdmin:false},input={id,version,confirmation:true};
 await assert.rejects(()=>api.commitStocktake(env,actor,'company-a','shop-a1',input),/Dinero er ændret/);assert.equal(posts,0);assert.equal(h.sql.prepare('SELECT count(*) n FROM production_receipts').get().n,0);
 balance=4000;reject=true;
 // Dinero refusing the voucher (4xx) creates nothing: the claim is released with the reason and the same approval can be retried.
 await assert.rejects(()=>api.commitStocktake(env,actor,'company-a','shop-a1',input),/Dinero afviste finansbilaget \(HTTP 400\): ExternalReference: for lang/);
 assert.equal(h.sql.prepare('SELECT count(*) n FROM production_receipts').get().n,0);assert.equal(h.sql.prepare("SELECT count(*) n FROM record_events WHERE event='cleanup.receipt_cleared'").get().n,1);reject=false;
 const result=await(await api.commitStocktake(env,actor,'company-a','shop-a1',input)).json();
 assert.equal(posts,1);assert.equal(books,1);assert.equal(result.phase,'booked');assert.match(result.message,/reguleret/);assert.equal(h.sql.prepare('SELECT phase FROM production_receipts').get().phase,'booked');
 assert.equal((await(await api.commitStocktake(env,actor,'company-a','shop-a1',input)).json()).phase,'booked');assert.equal(posts,1);
 // A second proposal of the same old balance cannot book after another regulation finished, even with the Dinero balance unchanged.
 const second=crypto.randomUUID(),secondVersion=crypto.randomUUID();h.sql.prepare("INSERT INTO stocktakes(company_id,webshop_id,id,version,phase,payload_json,created_by,created_at) VALUES(?,?,?,?,'prepared',?,'local-a','2000-01-01 00:00:00')").run('company-a','shop-a1',second,secondVersion,JSON.stringify(payload));
 await assert.rejects(()=>api.commitStocktake(env,actor,'company-a','shop-a1',{id:second,version:secondVersion,confirmation:true}),/anden lagerregulering/);assert.equal(posts,1);assert.equal(h.sql.prepare('SELECT count(*) n FROM production_receipts').get().n,1);
 }finally{h.close();}
});

test('production packaging submits approved current scoped quantities once; lost response never resends',async()=>{
 for(const lost of [false,true]){const h=harness();try{
 h.sql.prepare('INSERT INTO emballage_connections(company_id,webshop_id,identity,credentials_encrypted,context_json,config_json) VALUES(?,?,?,?,?,?)').run('company-a','shop-a1','123','synthetic','{}',JSON.stringify({startDate:'2026-01-01',responsibility:'packaging',mappings:{'1':{household:'home',commercial:'business'}}}));
 let quantity=1000,posts=0;
 const report={id:1,status:'draft',accepts_writes:true,period:{start_date:'2026-04-01',end_date:'2026-06-30'},responsibility:{code:'packaging',product_area:{slug:'packaging'}}};
 const api=loader({jose,'pdf-lib':pdfLib,'./connections':{unseal:async()=>({apiKey:'synthetic'})},'./tier1-history':{dataStartDate:async()=> '2026-01-01'},'./packaging':{handlePackaging:async()=>Response.json({period:{householdGrams:quantity,commercialGrams:2000},sync:{coverage_start:'2026-01-01',coverage_end:'2026-09-01'}})},'./emballage-read':{isSubmitted:s=>s==='submitted',eiReports:async()=>[report],eiRequest:async(key,path,method,body,idempotency,env)=>{if(method==='POST'){posts++;assert.equal(env.PLATFORM_ENV,'production');assert.ok(idempotency);assert.equal(body.answers.home,1);if(lost)throw Error('lost response');return {data:{submission_number:'R1',completed_at:'now',report_status:'submitted'}};}return {data:path==='/me'?{organisation:{id:123,name:'Test'},api_key:{is_test:false}}:{form_version_id:1,fields:[{name:'home',type:'number',unit:'kg',required:true},{name:'business',type:'number',unit:'kg',required:true}]}};}}})('platform/production-emballage.ts');
 const actor={id:'local-a',platformAdmin:false},env={...h.env,PLATFORM_ENV:'production',PLATFORM_EXTERNAL_WRITES:'enabled'},req=new Request('https://portal.example.test/emballage'),call=input=>api.productionEmballage(req,env,actor,'company-a','shop-a1',{quarter:'2026-Q2',...input});
 await assert.rejects(()=>api.productionEmballage(req,h.env,actor,'company-a','shop-a1',{action:'preview',quarter:'2026-Q2'}),/ikke aktiveret/);
 const preview=await(await call({action:'preview'})).json();quantity=1100;await assert.rejects(()=>call({action:'submit',token:preview.token}),/ændret/);assert.equal(posts,0);quantity=1000;
 await Promise.allSettled([call({action:'submit',token:preview.token}),call({action:'submit',token:preview.token})]);assert.equal(posts,1);assert.equal(h.sql.prepare('SELECT phase FROM production_receipts').get().phase,lost?'uncertain':'accepted');
 if(lost)await assert.rejects(()=>call({action:'submit',token:preview.token}),/afklaring/);else assert.equal((await(await call({action:'submit',token:preview.token})).json()).receipt.submission_number,'R1');assert.equal(posts,1);
 }finally{h.close();}}
});

test('record history preserves scoped transitions, sanitized errors, invoice generation and mail IDs',async()=>{
 const h=harness();try{
 const id='gid://shopify/Order/42',db=h.sql;
 for(const [company,shop] of [['company-a','shop-a1'],['company-a','shop-a2'],['company-b','shop-b1']])db.prepare('INSERT INTO operation_snapshots(company_id,webshop_id,module,external_id,occurred_at,payload_json) VALUES(?,?,?,?,?,?)').run(company,shop,'orders',id,'2026-09-28','{"name":"Order 42","secret":"never-log-source"}');
 db.prepare('UPDATE operation_snapshots SET payload_json=? WHERE company_id=? AND webshop_id=?').run('{"name":"Changed"}','company-a','shop-a1');
 db.prepare("INSERT INTO platform_invoices VALUES(?,?,?,?,?,'generating',?,?,?,CURRENT_TIMESTAMP)").run('company-a','shop-a1',id,'doc-a1','fingerprint','private/key','{}','{}');
 db.prepare("UPDATE platform_invoices SET status='generated' WHERE id='doc-a1'").run();
 const {saveReceipt}=loader()('platform/production-receipts.ts'),key={company:'company-a',shop:'shop-a1',provider:'shopify',module:'orders',externalId:id,destination:'123'};
 let receipt=null;for(const phase of ['prepared','creating','draft','booking','booked'])receipt=await saveReceipt(h.env,key,receipt,phase,{guid:'voucher-42',voucherNumber:99,secret:'never-log-credentials',voucher:{FileGuid:'file-42',ExternalReference:'toolbox-42'}});
 const mail={...key,provider:'invoice',module:'email',externalId:'doc-a1',destination:'customer'};
 let send=await saveReceipt(h.env,mail,null,'sending',{recipient:'private@example.test'});await saveReceipt(h.env,mail,send,'accepted',{receipt:'cloudflare-message-42',recipient:'private@example.test'});
 const {recordFailure}=loader()('platform/record-history.ts'),{HttpError}=loader()('platform/types.ts');await recordFailure(h.env,'company-a','shop-a1','shopify','orders',id,'Faktura',new HttpError(409,'token=supersecret https://private.test error'));
 const url='/api/platform/tier1/shops/shop-a1/sales/log?externalId='+encodeURIComponent(id);
 const result=await h.request(url,{user:'local-a'});assert.equal(result.status,200,await result.clone().text());const log=await result.json();assert.equal(log.legacy,false);
 for(const title of ['Hentet ind i WebshopToolbox','Faktura genereret','Bogføring bekræftet i Dinero','Fakturamail accepteret af mailtjenesten','Behandling fejlede'])assert.ok(log.events.some(e=>e.title===title),title);
 const content=JSON.stringify(log);for(const value of ['voucher-42','file-42','cloudflare-message-42'])assert.ok(content.includes(value));for(const secret of ['never-log-source','never-log-credentials','private@example','supersecret','https://private'])assert.ok(!content.includes(secret));
 const other=await(await h.request(url.replace('shop-a1','shop-a2'),{user:'local-a'})).json();assert.equal(other.events.some(e=>e.title==='Faktura genereret'),false);
 assert.equal((await h.request(url,{user:'local-b'})).status,404);
 for(let n=0;n<55;n++)await recordFailure(h.env,'company-a','shop-a1','shopify','orders',id,'Retry',new HttpError(409,'Fejl '+n));
 const first=await(await h.request(url,{user:'local-a'})).json(),second=await(await h.request(url+'&offset='+first.nextOffset,{user:'local-a'})).json();assert.equal(first.events.length,50);assert.ok(second.events.length);assert.equal(first.events.some(e=>second.events.some(f=>f.id===e.id)),false);
 const refundId='gid://shopify/ShopifyPaymentsBalanceTransaction/42';db.prepare('INSERT INTO operation_snapshots(company_id,webshop_id,module,external_id,occurred_at,payload_json) VALUES(?,?,?,?,?,?)').run('company-a','shop-a1','refunds',refundId,'2026-09-28','{}');
 assert.equal((await h.request('/api/platform/tier1/shops/shop-a1/refunds/log?externalId='+encodeURIComponent(refundId),{user:'local-a'})).status,200);
 }finally{h.close();}
});

test('dashboard counts today payouts across providers without counting settlements twice',async()=>{
 const h=harness();try{const db=h.sql,today=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Copenhagen',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
 for(const provider of ['flatpay','viabill'])db.prepare('INSERT INTO payment_connections(company_id,webshop_id,provider,identity,metadata_json,credentials_encrypted,start_date) VALUES(?,?,?,?,?,?,?)').run('company-a','shop-a1',provider,provider,'{}','unused','2020-01-01');
 for(const [provider,kind,id,day] of [['flatpay','payments','42',today],['flatpay','settlements','42',today],['viabill','payout','42',today],['flatpay','payments','old','2020-01-01']])db.prepare('INSERT INTO payment_records(company_id,webshop_id,provider,kind,external_id,occurred_at,payload_json,paid) VALUES(?,?,?,?,?,?,?,1)').run('company-a','shop-a1',provider,kind,id,day,'{}');
 db.prepare('INSERT INTO operation_snapshots(company_id,webshop_id,module,external_id,occurred_at,payload_json) VALUES(?,?,?,?,?,?)').run('company-a','shop-a1','payouts','42',new Date(Date.parse(today)-1800000).toISOString(),'{}');
 db.prepare('INSERT INTO accounting_connections(company_id,organization_id,credentials_encrypted,revision,chart_json) VALUES(?,?,?,?,?)').run('company-a','123','unused','r1','[]');
 db.prepare("INSERT INTO production_receipts VALUES(?,?,?,?,?,?,'booked','v',?,CURRENT_TIMESTAMP)").run('company-a','shop-a1','flatpay','payments','42','123',JSON.stringify({sourceJson:'{}'}));
 const r=await h.request('/api/platform/tier1/shops/shop-a1/dashboard/platform',{user:'local-a'});assert.equal(r.status,200,await r.clone().text());const data=await r.json();assert.equal(data.activity.today,today);assert.equal(data.activity.payouts.total,3);assert.equal(data.activity.payouts.synced,1);
 const other=await(await h.request('/api/platform/tier1/shops/shop-a2/dashboard/platform',{user:'local-a'})).json();assert.equal(other.activity.payouts.total,0);
 }finally{h.close();}
});

test('record history migration preserves existing rows and does not invent historic events',()=>{
 const h=harness();try{
 for(const r of h.sql.prepare("SELECT name FROM sqlite_master WHERE type='trigger' AND name LIKE 'record_%'").all())h.sql.exec('DROP TRIGGER '+r.name);
 h.sql.exec('DROP TABLE record_events');
 h.sql.prepare('INSERT INTO operation_snapshots(company_id,webshop_id,module,external_id,occurred_at,payload_json) VALUES(?,?,?,?,?,?)').run('company-a','shop-a1','orders','old','2026-01-01','{}');
 const tables=h.sql.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(r=>r.name);
 const before=tables.map(name=>JSON.stringify(h.sql.prepare('SELECT * FROM '+name+' ORDER BY rowid').all()));
 h.sql.exec(read('platform/migrations/0029_record_events.sql'));
 assert.deepEqual(tables.map(name=>JSON.stringify(h.sql.prepare('SELECT * FROM '+name+' ORDER BY rowid').all())),before);
 assert.equal(h.sql.prepare('SELECT count(*) n FROM record_events').get().n,0);assert.equal(h.sql.prepare('PRAGMA foreign_key_check').all().length,0);
 h.sql.prepare('UPDATE operation_snapshots SET payload_json=? WHERE external_id=?').run('{"name":"Changed"}','old');assert.equal(h.sql.prepare('SELECT event FROM record_events').get().event,'source_changed');
 }finally{h.close();}
});

test('Performance API authorizes company/shop, isolates overlapping data and caches reads per scope', async () => {
  const year = Number(new Intl.DateTimeFormat('en-CA', {timeZone:'Europe/Copenhagen',year:'numeric'}).format(new Date()));
  const id = n => `00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
  let reads = 0;
  const network = async (input, options) => {
    const url = new URL(input); reads++;
    assert.equal(options.redirect, 'manual');
    if (url.hostname === 'authz.dinero.dk') return Response.json({access_token: new URLSearchParams(options.body).get('username')});
    if (url.pathname.endsWith('/admin/oauth/access_token')) return Response.json({access_token:url.hostname});
    if (url.hostname === 'api.dinero.dk') {
      assert.equal(options.method,'GET');
      if (url.pathname.endsWith('/accountingyears')) return Response.json([year-1,year].map(y=>({FromDate:`${y}-01-01`,ToDate:`${y}-12-31`})));
      if (url.pathname.endsWith('/accounts/entry')) return Response.json([{AccountNumber:1000,Category:'Turnover'},{AccountNumber:2000,Category:'Variable Expenses'}]);
      if (url.pathname.endsWith('/entries')) {
        const y = url.searchParams.get('fromDate').slice(0,4), amount = options.headers.Authorization === 'Bearer company-a' ? 100 : 200;
        return Response.json([{EntryGuid:id(Number(y)),AccountNumber:1000,Amount:-amount,Date:`${y}-01-01`,Type:'Normal'}, {EntryGuid:id(Number(y)+10000),AccountNumber:2000,Amount:amount/2,Date:`${y}-01-01`,Type:'Normal',ContactGuid:id(99)}]);
      }
      if (url.pathname.endsWith('/contacts')) return Response.json({Pagination:{Page:0,PageSize:1000,ResultWithoutFilter:1},Collection:[{ContactGuid:id(99),Name: options.headers.Authorization === 'Bearer company-a' ? 'A supplier' : 'B supplier'}]});
    }
    assert.match(url.hostname,/^shop-[ab][12]\.myshopify\.com$/);
    assert.equal(options.method,'POST');
    const {query,variables} = JSON.parse(options.body);
    assert.match(query,/^query /); assert.doesNotMatch(query,/\bmutation\b/);
    if (query.includes('PerformanceShop')) return Response.json({data:{shop:{ianaTimezone:'Europe/Copenhagen'}}});
    const metric = variables.query.includes('FROM sales') ? 'orders' : 'sessions', value = url.hostname === 'shop-a1.myshopify.com' ? 11 : 22;
    return Response.json({data:{shopifyqlQuery:{parseErrors:[],tableData:{columns:[{name:'month'},{name:metric}],rows:[{month:`${year}-01-01`,[metric]:value}]}}}});
  };
  const h = harness(jose, network), env = {PLATFORM_CREDENTIALS_KEY:'ab'.repeat(32)};
  try {
    const {seal} = loader()('platform/connections.ts');
    for (const company of ['company-a','company-b']) {
      const encrypted = await seal({...h.env,...env},[company,'dinero','123'],{organizationId:'123',clientId:'test',clientSecret:'test',apiKey:company});
      h.sql.prepare('INSERT INTO accounting_connections(company_id,organization_id,credentials_encrypted,revision,chart_json) VALUES(?,?,?,?,?)').run(company,'123',encrypted,'r','[]');
    }
    for (const [company,shop] of [['company-a','shop-a1'],['company-a','shop-a2'],['company-b','shop-b1']]) {
      const domain=shop+'.myshopify.com', encrypted=await seal({...h.env,...env},[company,shop,'shopify',domain],{clientId:'test',clientSecret:'test'});
      h.sql.prepare('INSERT INTO webshop_connections(company_id,webshop_id,provider,shop_domain,credentials_encrypted) VALUES(?,?,?,?,?)').run(company,shop,'shopify',domain,encrypted);
    }
    const path=(shop,kind)=>`/api/platform/tier1/shops/${shop}/performance/${kind}?year=${year}`;
    for (const [user,shop,amount,name] of [['local-a','shop-a1',10000,'A supplier'],['local-b','shop-b1',20000,'B supplier']]) {
      const response=await h.request(path(shop,'finance')+'&companyId=company-b',{user,env});
      assert.equal(response.status,200,await response.clone().text()); const data=await response.json();
      assert.equal(data.revenue.months[0].current,amount); assert.equal(data.suppliers[0].name,name);
      const before=reads; assert.equal((await h.request(path(shop,'finance'),{user,env})).status,200); assert.equal(reads,before);
    }
    for (const [shop,expected] of [['shop-a1',11],['shop-a2',22]]) {
      const response=await h.request(path(shop,'shop'),{user:'local-a',env}); assert.equal(response.status,200,await response.clone().text());
      const data=await response.json(); assert.equal(data.orders.months[0].current,expected); assert.equal(data.visits.months[0].current,expected);
      const before=reads; await h.request(path(shop,'shop'),{user:'local-a',env}); assert.equal(reads,before);
    }
    // Opdatér (refresh=1) fetches again, but not more than once a minute.
    let forcedReads=reads; assert.equal((await h.request(path('shop-a1','shop')+'&refresh=1',{user:'local-a',env})).status,200); assert.equal(reads,forcedReads,'numbers fetched within the last minute are reused');
    for (const row of h.sql.prepare("SELECT setting_key,setting_value FROM finance_state WHERE setting_key LIKE 'performance:v2:%'").all()) { const value=JSON.parse(row.setting_value); if (value.data) h.sql.prepare('UPDATE finance_state SET setting_value=? WHERE setting_key=?').run(JSON.stringify({...value,savedAt:Date.now()-120000}),row.setting_key); }
    forcedReads=reads; await h.request(path('shop-a1','shop'),{user:'local-a',env}); assert.equal(reads,forcedReads,'without Opdatér the 15-minute cache is used');
    assert.equal((await h.request(path('shop-a1','shop')+'&refresh=1',{user:'local-a',env})).status,200); assert.ok(reads>forcedReads,'Opdatér fetches fresh numbers');
    // Rotating credentials invalidates the report without accumulating cache rows.
    const cacheCount=h.sql.prepare("SELECT count(*) n FROM finance_state WHERE setting_key LIKE 'performance:v2:%'").get().n;
    const rotated=await seal({...h.env,...env},['company-a','dinero','123'],{organizationId:'123',clientId:'test',clientSecret:'new',apiKey:'company-b'});
    h.sql.prepare("UPDATE accounting_connections SET credentials_encrypted=? WHERE company_id='company-a'").run(rotated);
    const refreshed=await h.request(path('shop-a1','finance'),{user:'local-a',env});
    assert.equal(refreshed.status,200,await refreshed.clone().text());
    assert.equal((await refreshed.json()).revenue.months[0].current,20000);
    assert.equal(h.sql.prepare("SELECT count(*) n FROM finance_state WHERE setting_key LIKE 'performance:v2:%'").get().n,cacheCount);
    const financeCache=h.sql.prepare("SELECT setting_key,setting_value FROM finance_state WHERE tenant='company-a' AND setting_key LIKE 'performance:v2:%'").all().find(row=>JSON.parse(row.setting_value).data?.currency==='DKK');
    h.sql.prepare("UPDATE finance_state SET setting_value=? WHERE tenant='company-a' AND setting_key=?").run(JSON.stringify({leaseUntil:Date.now()+60000,owner:'other-request'}),financeCache.setting_key);
    const lockedReads=reads;
    assert.equal((await h.request(path('shop-a1','finance'),{user:'local-a',env})).status,409);
    assert.equal(reads,lockedReads,'a concurrent request must not repeat source reads');
    const before=reads;
    assert.equal((await h.request(path('shop-a1','finance'),{auth:false,env})).status,401);
    assert.equal((await h.request(path('shop-a1','finance'),{user:'local-b',env})).status,404);
    assert.equal((await h.request(path('shop-a1','finance'),{user:'local-reader',env})).status,403);
    assert.equal((await h.request(path('shop-a2','shop'),{user:'local-reader',env})).status,403);
    assert.equal((await h.request(path('none','shop'),{user:'local-a',env})).status,409);
    assert.equal((await h.request(path('shop-a1','shop').replace(String(year),'2099'),{user:'local-a',env})).status,400);
    assert.equal((await h.request(path('shop-a1','finance'),{user:'local-a',env,method:'POST',body:{}})).status,405);
    h.sql.prepare("UPDATE webshops SET status='inactive' WHERE id='shop-a1'").run();
    assert.equal((await h.request(path('shop-a1','shop'),{user:'local-a',env})).status,403);
    assert.equal(reads,before);
    assert.equal(h.sql.prepare('SELECT count(*) n FROM finance_ledger').get().n,0);
    assert.equal(h.sql.prepare('SELECT count(*) n FROM production_receipts').get().n,0);
  } finally { h.close(); }
});

test('Forsendelser API authorizes company/shop, isolates overlapping order IDs, reads only and caches per shop', async () => {
  let reads = 0;
  const network = async (input, options) => {
    const url = new URL(input); reads++;
    if (url.pathname.endsWith('/admin/oauth/access_token')) return Response.json({access_token:url.hostname});
    assert.match(url.hostname,/^shop-[ab][12]\.myshopify\.com$/);
    const {query,variables} = JSON.parse(options.body);
    assert.doesNotMatch(query,/\bmutation\b/);
    // Every shop answers with the same Shopify order IDs; only the shop's own data may be shown.
    const host = url.hostname.slice(0,7), recent = new Date(Date.now()-2*86400000).toISOString(), old = new Date(Date.now()-90*86400000).toISOString();
    const fulfillment = (n, createdAt = recent) => ({id:'gid://shopify/Fulfillment/'+n,createdAt,status:'SUCCESS',displayStatus:'READY_FOR_PICKUP',trackingInfo:[{company:'GLS',number:n+host,url:'https://gls-group.com/track/'+n}],events:{nodes:[{status:'READY_FOR_PICKUP',happenedAt:recent,message:null}]}});
    const base = {test:false,cancelledAt:null,shippingAddress:{name:'Kunde '+host,city:'By '+host,countryCodeV2:'DK'},shippingLine:{title:'GLS Pakkeshop'}};
    // Order 2 has more partial deliveries than the list query returns; they are read again for that order alone.
    if (query.startsWith('query ShipmentOrder(')) { assert.equal(variables.id,'gid://shopify/Order/2'); return Response.json({data:{order:{...base,id:'gid://shopify/Order/2',name:'#'+host+'-2',fulfillments:[fulfillment(21),fulfillment(22),fulfillment(23),fulfillment(24),fulfillment(25,old)]}}}); }
    assert.match(query,/^query ShipmentOrders/);
    assert.match(variables.query,/^updated_at:>=\d{4}-\d{2}-\d{2} \(fulfillment_status:shipped OR fulfillment_status:partial\)$/);
    return Response.json({data:{orders:{nodes:[{...base,id:'gid://shopify/Order/1',name:'#'+host,fulfillments:[fulfillment(1)]},{...base,id:'gid://shopify/Order/2',name:'#'+host+'-2',fulfillments:[fulfillment(21),fulfillment(22),fulfillment(23)]}],pageInfo:{hasNextPage:false,endCursor:null}}}});
  };
  const h = harness(jose, network), env = {PLATFORM_CREDENTIALS_KEY:'ab'.repeat(32)};
  try {
    const {seal} = loader()('platform/connections.ts');
    for (const [company,shop] of [['company-a','shop-a1'],['company-a','shop-a2'],['company-b','shop-b1']]) {
      const domain=shop+'.myshopify.com', encrypted=await seal({...h.env,...env},[company,shop,'shopify',domain],{clientId:'test',clientSecret:'test'});
      h.sql.prepare('INSERT INTO webshop_connections(company_id,webshop_id,provider,shop_domain,credentials_encrypted) VALUES(?,?,?,?,?)').run(company,shop,'shopify',domain,encrypted);
    }
    const path=(shop,query='days=30')=>`/api/platform/tier1/shops/${shop}/shipments?${query}`;
    for (const [user,shop] of [['local-a','shop-a1'],['local-a','shop-a2'],['local-b','shop-b1']]) {
      const response=await h.request(path(shop)+'&companyId=company-b',{user,env}); assert.equal(response.status,200,await response.clone().text());
      const data=await response.json();
      // Four shipments of order 2 in the period (the fifth is older) plus order 1.
      assert.deepEqual(data.shipments.map(x=>x.trackingNumber).sort(),['1','21','22','23','24'].map(n=>n+shop).sort());
      const s=data.shipments.find(x=>x.orderName==='#'+shop); assert.ok(s); assert.equal(s.customer,'Kunde '+shop); assert.equal(s.carrier,'gls'); assert.equal(s.current,'ready'); assert.equal(s.pickupPoint,true);
      const before=reads; assert.equal((await h.request(path(shop),{user,env})).status,200); assert.equal(reads,before,'cached per shop');
    }
    const before=reads;
    assert.equal((await h.request(path('shop-a1'),{auth:false,env})).status,401);
    assert.equal((await h.request('/api/platform/tier1/shops/shop-a1/shipments/refresh?days=30',{user:'local-b',env,method:'POST',body:{shipmentId:'gid://shopify/Fulfillment/1'}})).status,404);
    assert.equal((await h.request('/api/platform/tier1/shops/shop-a1/shipments/refresh?days=30',{user:'local-a',env,method:'POST',body:{shipmentId:'missing-id',url:'https://untrusted.invalid'}})).status,404);
    assert.equal((await h.request('/api/platform/tier1/shops/shop-a1/shipments/refresh?days=30',{user:'local-a',env})).status,405);
    assert.equal((await h.request(path('shop-a1'),{user:'local-b',env})).status,404);
    assert.equal((await h.request(path('shop-a2'),{user:'local-reader',env})).status,403);
    assert.equal((await h.request(path('none'),{user:'local-a',env})).status,409);
    assert.equal((await h.request(path('shop-a1','days=365'),{user:'local-a',env})).status,400);
    assert.equal((await h.request(path('shop-a1'),{user:'local-a',env,method:'POST',body:{}})).status,405);
    assert.equal(reads,before);
    assert.equal(h.sql.prepare('SELECT count(*) n FROM operation_snapshots').get().n,0);
    assert.equal(h.sql.prepare('SELECT count(*) n FROM production_receipts').get().n,0);
  } finally { h.close(); }
});

test('packaging history syncs more than 1000 lines and does not rewrite unchanged lines without weight',async()=>{
 const lines=Array.from({length:1500},(_,i)=>({id:'gid://shopify/FulfillmentLineItem/'+(i+1),quantity:1,lineItem:{title:'Vare',variant:{id:'gid://shopify/ProductVariant/1',title:'Variant',product:{id:'gid://shopify/Product/1',title:'Vare'}}}}));
 const fulfillment={id:'gid://shopify/Fulfillment/1',createdAt:new Date().toISOString(),status:'SUCCESS',fulfillmentLineItems:{nodes:lines,pageInfo:{hasNextPage:false,endCursor:null}}};
 const h=harness(jose,async(url,opt)=>{if(url.endsWith('/oauth/access_token'))return Response.json({access_token:'fixture'});const {query}=JSON.parse(opt.body);
  if(query.includes('PackagingOrders'))return Response.json({data:{orders:{nodes:[{id:'gid://shopify/Order/1',name:'#1',test:false,billingAddress:{company:''},fulfillments:[fulfillment]}],pageInfo:{hasNextPage:false,endCursor:null}}}});
  // No weight and no reportability yet: the lines stay "unknown" until the product is filled in.
  if(query.includes('PackagingProducts'))return Response.json({data:{nodes:[{id:'gid://shopify/Product/1',title:'Vare',packagingWeight:null,packagingReportable:null}]}});throw Error('unexpected request');});
 const env={PLATFORM_CREDENTIALS_KEY:'ab'.repeat(32)},day=danishToday(),path='/api/platform/companies/company-a/webshops/shop-a1/packaging';
 try{
  await testShopConnections(h,env);
  let r=await h.request(path,{user:'local-a',env,method:'POST',body:{action:'sync',start:day,end:day}});assert.equal(r.status,200,await r.clone().text());
  assert.equal(h.sql.prepare('SELECT count(*) n FROM packaging_snapshots').get().n,1500);
  r=await h.request(path,{user:'local-a',env,method:'POST',body:{action:'sync',start:day,end:day}});assert.equal(r.status,200,await r.clone().text());
  assert.equal(h.sql.prepare("SELECT count(*) n FROM packaging_snapshots WHERE json_extract(payload_json,'$.refreshedAt') IS NOT NULL").get().n,0,'unchanged lines are not rewritten');
 }finally{h.close();}
});

test('a shorter packaging sync never shrinks the covered history that reporting relies on',async()=>{
 const h=harness(jose,async(url,opt)=>{if(url.endsWith('/oauth/access_token'))return Response.json({access_token:'fixture'});const {query}=JSON.parse(opt.body);
  if(query.includes('PackagingOrders'))return Response.json({data:{orders:{nodes:[],pageInfo:{hasNextPage:false,endCursor:null}}}});throw Error('unexpected request');});
 const env={PLATFORM_CREDENTIALS_KEY:'ab'.repeat(32)},path='/api/platform/companies/company-a/webshops/shop-a1/packaging',day=n=>new Date(Date.now()-n*86400000).toISOString().slice(0,10);
 const sync=(start,end)=>h.request(path,{user:'local-a',env,method:'POST',body:{action:'sync',start,end}});
 const coverage=()=>{const r=h.sql.prepare("SELECT coverage_start s,coverage_end e FROM packaging_sync WHERE webshop_id='shop-a1'").get();return [r.s,r.e];};
 try{
  await testShopConnections(h,env);
  assert.equal((await sync(day(30),day(0))).status,200);assert.deepEqual(coverage(),[day(30),day(0)]);
  assert.equal((await sync(day(5),day(2))).status,200);assert.deepEqual(coverage(),[day(30),day(0)],'a custom period inside does not shrink it');
  assert.equal((await sync(day(45),day(31))).status,200);assert.deepEqual(coverage(),[day(45),day(0)],'an adjoining period extends it');
  assert.equal((await sync(day(58),day(50))).status,200);assert.deepEqual(coverage(),[day(45),day(0)],'a separate period does not replace it');
 }finally{h.close();}
});

test('Emballage → Varer lists packaging data per product and saves weight and reportability to Shopify',async()=>{
 const mutations=[];
 const network=async(url,opt)=>{if(url.endsWith('/oauth/access_token'))return Response.json({access_token:'fixture'});const {query,variables}=JSON.parse(opt.body);
  if(query.includes('PackagingProductList'))return Response.json({data:{products:{nodes:[
   {id:'gid://shopify/Product/1',title:'Sabel',status:'ACTIVE',weight:{value:'120'},reportable:{value:'true'}},
   {id:'gid://shopify/Product/2',title:'Gavekort',status:'ACTIVE',weight:{value:'0'},reportable:null},
   {id:'gid://shopify/Product/3',title:'Glas',status:'DRAFT',weight:null,reportable:null}],pageInfo:{hasNextPage:false,endCursor:null}}}});
  if(query.includes('PackagingProductScopes'))return Response.json({data:{currentAppInstallation:{accessScopes:[{handle:'read_products'},{handle:'write_products'}]}}});
  if(query.includes('SetPackagingFields')){mutations.push(variables.metafields);return Response.json({data:{metafieldsSet:{metafields:variables.metafields.map(m=>({key:m.key,value:m.value})),userErrors:[]}}});}
  throw Error('unexpected request');};
 const h=harness(jose,network),handleTier1=loader({jose,'pdf-lib':pdfLib,fetch:network})('platform/tier1-api.ts').handleTier1;
 const env={PLATFORM_CREDENTIALS_KEY:'ab'.repeat(32)},prod={...env,PLATFORM_ENV:'production',PLATFORM_EXTERNAL_WRITES:'enabled'},path='/api/platform/tier1/shops/shop-a1/emballage/products';
 const line=(n,product,weightGrams,reportable)=>h.sql.prepare("INSERT INTO packaging_snapshots(company_id,webshop_id,event_id,payload_json) VALUES('company-a','shop-a1',?,?)").run('gid://shopify/FulfillmentLineItem/'+n,JSON.stringify({eventId:'gid://shopify/FulfillmentLineItem/'+n,productId:product,quantity:1,weightGrams,reportable,date:'2026-09-01'}));
 try{
  await testShopConnections(h,env);
  line(1,'gid://shopify/Product/3',null,'unknown');line(2,'gid://shopify/Product/3',null,'unknown');line(3,'gid://shopify/Product/1',80,'yes');
  const list=await(await h.request(path,{user:'local-a',env})).json();
  assert.deepEqual(list.products.map(p=>[p.title,p.weightGrams,p.reportable,p.openLines]),[['Sabel',120,'yes',0],['Gavekort',0,'unknown',0],['Glas',null,'unknown',2]]);
  assert.equal(list.canWrite,true);assert.equal(list.writes,false); h.sql.exec("DELETE FROM webshop_connections WHERE company_id='company-a'");await testShopConnections(h,prod);
  // Production writes are exercised on the Tier 1 handler directly, as the other production tests do.
  const save=async(body,user='local-a',e=prod)=>{try{return await handleTier1(new Request('https://portal.webshoptoolbox.dk'+path,{method:'POST',headers:{'content-type':'application/json',origin:'https://portal.webshoptoolbox.dk'},body:JSON.stringify(body)}),{...h.env,...e},{id:user,platformAdmin:false});}catch(error){return new Response(JSON.stringify({error:error.message}),{status:error.status||500});}};
  assert.equal((await save({productId:'gid://shopify/Product/3',weightGrams:40},'local-a')).status,400,'a weight above 0 needs reportability');
  assert.equal((await save({productId:'gid://shopify/Product/3',weightGrams:40,reportable:'yes'},'local-a',env)).status,403,'blocked outside production');
  assert.equal((await save({productId:'gid://shopify/Product/3',weightGrams:40,reportable:'yes'},'local-reader')).status,403);
  const saved=await save({productId:'gid://shopify/Product/3',weightGrams:40,reportable:'yes'});assert.equal(saved.status,200,await saved.clone().text());assert.equal((await saved.json()).updatedLines,2);
  assert.deepEqual(mutations[0].map(m=>[m.key,m.type,m.value]),[['emballage_vaegt_gram','number_integer','40'],['emballage_indberetning','boolean','true']]);
  const stored=h.sql.prepare("SELECT json_extract(payload_json,'$.weightGrams') w,json_extract(payload_json,'$.reportable') r FROM packaging_snapshots ORDER BY event_id").all().map(r=>[r.w,r.r]);
  assert.deepEqual(stored,[[40,'yes'],[40,'yes'],[80,'yes']],'waiting lines get the new values; complete lines keep theirs');
  // 0 grams is approved without reportability.
  assert.equal((await save({productId:'gid://shopify/Product/2',weightGrams:0})).status,200);assert.deepEqual(mutations[1].map(m=>m.key),['emballage_vaegt_gram']);
 }finally{h.close();}
});
test('a packaging line with 0 grams counts as approved even without reportability',()=>{
 const {packagingAudienceTotals,ignoredPackaging}=loader()('platform/packaging-calculations.ts');
 const row=(weightGrams,reportable)=>({eventId:'e',fulfillmentId:'f',fulfilledAt:'2026-09-01T10:00:00Z',date:'2026-09-01',orderId:'o',orderName:'#1',productId:'p',product:'P',variantId:null,variant:'',quantity:2,weightGrams,reportable,supplier:'',supplierCountry:'',supplierCvr:'',snapshottedAt:''});
 assert.equal(ignoredPackaging(row(0,'unknown')),false);assert.equal(ignoredPackaging(row(50,'unknown')),true);assert.equal(ignoredPackaging(row(null,'yes')),true);
 const totals=packagingAudienceTotals([row(0,'unknown'),row(50,'yes'),row(10,'unknown')],[]);
 assert.equal(totals.unresolved,1);assert.equal(totals.householdGrams,100);
});

test('Shopify reads wait and retry when Shopify throttles, and name the error code when they give up',async()=>{
 let answers=[];const calls=[];
 const network=async(url,opt)=>{calls.push(url);const next=answers.shift();return next();};
 const {orderQuery}=loader({jose,fetch:network})('platform/invoice-source.ts'),access={shop:'shop-a1.myshopify.com',accessToken:'x'};
 const throttled=()=>Response.json({errors:[{message:'Throttled',extensions:{code:'THROTTLED'}}],extensions:{cost:{requestedQueryCost:120,throttleStatus:{currentlyAvailable:100,restoreRate:50}}}});
 answers=[throttled,()=>Response.json({data:{ok:true}})];
 const started=Date.now();assert.deepEqual(await orderQuery(access,'query X{shop{name}}',{},'Shopify kunne ikke hente emballageordrer.'),{ok:true});
 assert.equal(calls.length,2);assert.ok(Date.now()-started>=1900,'waits before retrying');
 answers=[()=>Response.json({errors:[{message:'Access denied',extensions:{code:'ACCESS_DENIED'}}]})];
 await assert.rejects(()=>orderQuery(access,'query X{shop{name}}',{},'Shopify kunne ikke hente emballageordrer.'),e=>e.message==='Shopify kunne ikke hente emballageordrer. (Shopify: ACCESS_DENIED)');
 assert.equal(calls.length,3,'other errors are not retried');
});
test('a quarter with lines missing packaging data can be reported, but only after accepting the warning',async()=>{
 const lost=false,h=harness();try{
 h.sql.prepare('INSERT INTO emballage_connections(company_id,webshop_id,identity,credentials_encrypted,context_json,config_json) VALUES(?,?,?,?,?,?)').run('company-a','shop-a1','123','synthetic','{}',JSON.stringify({startDate:'2026-01-01',responsibility:'packaging',mappings:{'1':{household:'home',commercial:'business'}}}));
 let quantity=1000,posts=0;
 const report={id:1,status:'draft',accepts_writes:true,period:{start_date:'2026-04-01',end_date:'2026-06-30'},responsibility:{code:'packaging',product_area:{slug:'packaging'}}};
 const api=loader({jose,'pdf-lib':pdfLib,'./connections':{unseal:async()=>({apiKey:'synthetic'})},'./tier1-history':{dataStartDate:async()=> '2026-01-01'},'./packaging':{handlePackaging:async()=>Response.json({period:{householdGrams:quantity,commercialGrams:2000,unresolved:3},sync:{coverage_start:'2026-01-01',coverage_end:'2026-09-01'}})},'./emballage-read':{isSubmitted:s=>s==='submitted',eiReports:async()=>[report],eiRequest:async(key,path,method,body,idempotency,env)=>{if(method==='POST'){posts++;assert.equal(env.PLATFORM_ENV,'production');assert.ok(idempotency);assert.equal(body.answers.home,1);if(lost)throw Error('lost response');return {data:{submission_number:'R1',completed_at:'now',report_status:'submitted'}};}return {data:path==='/me'?{organisation:{id:123,name:'Test'},api_key:{is_test:false}}:{form_version_id:1,fields:[{name:'home',type:'number',unit:'kg',required:true},{name:'business',type:'number',unit:'kg',required:true}]}};}}})('platform/production-emballage.ts');
 const actor={id:'local-a',platformAdmin:false},env={...h.env,PLATFORM_ENV:'production',PLATFORM_EXTERNAL_WRITES:'enabled'},req=new Request('https://portal.example.test/emballage'),call=input=>api.productionEmballage(req,env,actor,'company-a','shop-a1',{quarter:'2026-Q2',...input});
 const preview=await(await call({action:'preview'})).json();assert.equal(preview.ignoredLines,3);
 await assert.rejects(()=>call({action:'submit',token:preview.token}),/Bekræft, at linjer uden emballageoplysninger/);assert.equal(posts,0);
 assert.equal((await(await call({action:'submit',token:preview.token,acceptIncomplete:true})).json()).receipt.submission_number,'R1');assert.equal(posts,1);
 }finally{h.close();}
});

test('Shipmondo connection is encrypted, isolated, read-only and preserves credentials on provider failure',async()=>{
 let fail=false;const calls=[];
 const h=harness(jose,async(url,options)=>{calls.push([String(url),options]);return new Response(JSON.stringify(fail?{secret:'do not echo'}:[]),{status:fail?401:200});});
 const env={PLATFORM_CREDENTIALS_KEY:'ab'.repeat(32)},path='/api/platform/tier1/shops/shop-a1/shipmondo/connection';
 const input={apiUser:'test-api-user',apiKey:'test-api-secret',sandbox:true,revision:null};
 try{
  for(const user of ['local-reader','local-b','local-admin'])assert.ok([403,404].includes((await h.request(path,{user,env,method:'POST',body:input})).status));
  assert.equal(calls.length,0);
  const response=await h.request(path,{user:'local-a',env,method:'POST',body:input});assert.equal(response.status,200,await response.clone().text());
  const saved=await response.json();assert.ok(saved.webhookSecret);assert.match(saved.webhookUrl,/\/webhooks\/shipmondo\//);
  assert.equal(calls.length,1);assert.match(calls[0][0],/^https:\/\/sandbox.shipmondo.com\/api\/public\/v3\/shipments\?/);assert.equal(calls[0][1].method,'GET');assert.equal(calls[0][1].redirect,'manual');
  const encrypted=h.sql.prepare('SELECT credentials_encrypted FROM shipping_connections').get().credentials_encrypted;assert.doesNotMatch(encrypted,/test-api/);
  const get=await(await h.request(path,{user:'local-a',env})).json();assert.equal(get.revision,saved.revision);assert.doesNotMatch(JSON.stringify(get),/test-api-secret|test-api-user/);
  const unseal=loader()('platform/connections.ts').unseal;await assert.rejects(()=>unseal({...h.env,...env},['company-b','shop-b1','shipmondo'],encrypted));
  assert.equal((await h.request(path,{user:'local-a',env,method:'POST',body:input})).status,409);
  fail=true;const failed=await h.request(path,{user:'local-a',env,method:'POST',body:{...input,revision:saved.revision}});assert.equal(failed.status,409);assert.doesNotMatch(await failed.text(),/do not echo/);assert.equal(h.sql.prepare('SELECT revision FROM shipping_connections').get().revision,saved.revision);
  assert.ok([403,404].includes((await h.request('/api/platform/tier1/shops/shop-b1/shipmondo/connection',{user:'local-a',env})).status));
 }finally{h.close();}
});

test('Shipmondo webhook verifies signed destination, is idempotent and enriches only matching webshop parcels',async()=>{
 const h=harness(jose,async()=>new Response('[]')),env={PLATFORM_CREDENTIALS_KEY:'ab'.repeat(32)},base='/api/platform/tier1/shops/shop-a1/shipmondo/connection';
 try{
  const c=await(await h.request(base,{user:'local-a',env,method:'POST',body:{apiUser:'fixture-user',apiKey:'fixture-key',sandbox:true,revision:null}})).json();
  const endpoint=new URL(c.webhookUrl).pathname;
  const data={shipment_id:123,carrier_track_id:'000123',carrier_code:'gls',current_status:'DELIVERED',current_state:'SUCCESS',current_status_text:'Delivered',current_status_registered_at:'2026-01-02T12:00:00Z'};
  const signed=async(payload,key=c.webhookSecret,alg='HS256')=>new jose.CompactSign(new TextEncoder().encode(JSON.stringify(payload))).setProtectedHeader({alg}).sign(new TextEncoder().encode(key));
  const post=async(token)=>h.request(endpoint,{auth:false,env,method:'POST',rawBody:JSON.stringify({data:token}),headers:{'content-type':'application/json'}});
  assert.equal((await post(await signed({url:c.webhookUrl,data},'wrong-key'))).status,401);
  assert.equal((await post(await signed({url:c.webhookUrl+'other',data}))).status,401);
  assert.equal((await post(await signed({url:c.webhookUrl,data},c.webhookSecret,'HS384'))).status,401);
  assert.equal((await post(await signed({url:c.webhookUrl,data:{...data,current_status_registered_at:'invalid'}}))).status,400);
  const token=await signed({url:c.webhookUrl,data});assert.equal((await post(token)).status,200);assert.equal((await post(token)).status,200);
  assert.equal(h.sql.prepare('SELECT count(*) n FROM shipping_events').get().n,1);
  const load=loader({jose}),lib=load('platform/shipmondo.ts'),shipment=load('platform/tier1/src/lib/shipments.ts').buildShipment({id:'o',name:'#1'}, {id:'f',createdAt:'2026-01-01T00:00:00Z',status:'SUCCESS',trackingInfo:[{company:'GLS',number:'000123'}]});
  const list={checkedAt:'2026-01-02T12:00:00Z',days:30,since:'2026-01-01',truncated:false,shipments:[shipment]};
  const enriched=await lib.enrichShipmondo({...h.env,...env},'company-a','shop-a1',list);assert.equal(enriched.shipments[0].delivered,true);assert.equal(enriched.shipments[0].shipmondo.shipmentId,'123');
  assert.equal((await lib.enrichShipmondo({...h.env,...env},'company-b','shop-b1',list)).shipments[0].delivered,false);
  assert.equal((await lib.enrichShipmondo({...h.env,...env},'company-a','shop-a2',list)).shipments[0].delivered,false);
  const event=lib.parseMonitor(data);assert.equal(lib.enrichShipmentList({...list,shipments:[{...shipment,carrier:'dao'}]},[event]).shipments[0].shipmondo,undefined);
  assert.equal(lib.enrichShipmentList(list,[event,{...event,shipment_id:'999'}]).shipments[0].shipmondo,undefined);
  assert.equal(lib.enrichShipmentList(list,[{...event,status:'NEW_UNKNOWN'}]).shipments[0].delivered,false);
  const next=await(await h.request(base,{user:'local-a',env,method:'POST',body:{apiUser:'other-user',apiKey:'other-key',sandbox:true,revision:c.revision}})).json();assert.notEqual(next.webhookUrl,c.webhookUrl);assert.equal((await post(token)).status,404);assert.equal(h.sql.prepare('SELECT count(*) n FROM shipping_events').get().n,0);
 }finally{h.close();}
});


test('Shipmondo rejects redirects without following them or changing an existing connection',async()=>{
 let redirect=false,calls=0;
 const h=harness(jose,async(url,options)=>{
  calls++;
  // Cloudflare rejects redirect:error before making a network request.
  assert.equal(options.redirect,'manual');
  return redirect ? new Response(null,{status:302,headers:{Location:'https://untrusted.invalid/'}}) : new Response('[]');
 });
 const env={PLATFORM_CREDENTIALS_KEY:'ab'.repeat(32)},path='/api/platform/tier1/shops/shop-a1/shipmondo/connection';
 const input={apiUser:'test-api-user',apiKey:'test-api-secret',sandbox:false,revision:null};
 try{
  const first=await h.request(path,{user:'local-a',env,method:'POST',body:input});assert.equal(first.status,200);
  const saved=await first.json();
  redirect=true;
  const failed=await h.request(path,{user:'local-a',env,method:'POST',body:{...input,revision:saved.revision}});
  assert.equal(failed.status,409);assert.equal(calls,2);
  assert.equal(h.sql.prepare('SELECT revision FROM shipping_connections').get().revision,saved.revision);
  assert.doesNotMatch(await failed.text(),/test-api-secret|untrusted/);
 }finally{h.close();}
});

test('public tracking parses DAO, GLS, PostNord and Bring JSON without executing scripts, validates identity and Danish times',()=>{
 const lib=loader()('platform/public-tracking.ts');
 for(const carrier of ['dao','gls','postnord','bring']){
  const target=lib.trackingTarget({trackingNumber:'000123456',carrier,trackingUrl:null});assert.ok(target);assert.equal(new URL(target.url).hostname,'track.shipmondo.com');
  const fixture={tracking:target.number,shipping_agent:target.carrier,status:'EN_ROUTE',statusText:'På vej',shipment_id:123,consignee:'Do not store me',events:[{status:'EN_ROUTE',statusText:'Indleveret',datetime:'2026/01-04 11:10:19'}]};
  const html='<script>window.tracking = '+JSON.stringify(fixture)+';</script>';
  const parsed=lib.parsePublicTracking(html,target,'2026-01-03T12:00:00Z');assert.equal(parsed.events[0].at,'2026-01-04T10:10:19.000Z');assert.doesNotMatch(JSON.stringify(parsed),/consignee|Do not store/);
  assert.throws(()=>lib.parsePublicTracking(html,{...target,number:'000999999'},'2026-01-03T12:00:00Z'));
  assert.throws(()=>lib.parsePublicTracking(html,target,'2026-02-03T12:00:00Z'));
  assert.throws(()=>lib.parsePublicTracking('<script>window.tracking = malicious();</script>',target,'2026-01-03T12:00:00Z'));
 }
 assert.equal(lib.trackingTime('2026/07-04 11:10:19'),'2026-07-04T09:10:19.000Z');
 assert.throws(()=>lib.trackingTime('2026/02-31 12:00:00'));
 assert.throws(()=>lib.trackingTime('2026/03-29 02:30:00'));
 for(const url of ['http://track.shipmondo.com/dao/000123456','https://track.shipmondo.com@evil.test/dao/000123456','https://track.shipmondo.com/dao/other999','https://track.shipmondo.com/gls/000123456','https://track.shipmondo.com:444/dao/000123456']){
  const target=lib.trackingTarget({trackingNumber:'000123456',carrier:'dao',trackingUrl:url});
  if(target)assert.equal(target.url,'https://track.shipmondo.com/dao/000123456');
 }
 assert.equal(lib.trackingTarget({trackingNumber:'../../admin',carrier:'dao',trackingUrl:null}),null);
});

test('public tracking caches per company/shop, preserves good data on failure, leases requests and rejects redirects',async()=>{
 let fail=false,calls=0;
 const network=async(url,options)=>{
  calls++;assert.equal(options.redirect,'manual');assert.equal(options.method,'GET');assert.equal(options.headers.Authorization,undefined);
  if(fail)return new Response(null,{status:302,headers:{Location:'https://untrusted.invalid/'}});
  return new Response('<script>window.tracking = '+JSON.stringify({tracking:'000123456',shipping_agent:'gls',status:'EN_ROUTE',statusText:'Under transport',events:[{status:'EN_ROUTE',statusText:'Under transport',datetime:'2026/10-04 11:10:19'}]})+';</script>',{headers:{'content-type':'text/html'}});
 };
 const h=harness(),lib=loader({fetch:network})('platform/public-tracking.ts'),build=loader()('platform/tier1/src/lib/shipments.ts').buildShipment;
 const s=build({id:'o',name:'#1'},{id:'same',status:'SUCCESS',createdAt:'2026-10-03T12:00:00Z',trackingInfo:[{company:'GLS',number:'000123456'}]});
 const list={checkedAt:new Date().toISOString(),days:30,since:'2026-10-01',truncated:false,shipments:[s]};
 try{
  let out=await lib.enrichPublicTracking(h.env,'company-a','shop-a1',list,'source-a');assert.equal(calls,1);assert.equal(out.shipments[0].current,'transit');assert.equal(out.shipments[0].publicTracking.state,'ok');
  await lib.enrichPublicTracking(h.env,'company-a','shop-a1',list,'source-a');assert.equal(calls,1);
  await lib.enrichPublicTracking(h.env,'company-b','shop-b1',list,'source-b');assert.equal(calls,2);
  await lib.enrichPublicTracking(h.env,'company-a','shop-a2',list,'source-c');assert.equal(calls,3);
  h.sql.exec("UPDATE shipment_tracking_cache SET next_check=0,attempted_at=NULL WHERE webshop_id='shop-a1'");fail=true;
  out=await lib.enrichPublicTracking(h.env,'company-a','shop-a1',list,'source-a');assert.equal(calls,4);assert.equal(out.shipments[0].publicTracking.state,'error');assert.equal(out.shipments[0].current,'transit');assert.ok(out.shipments[0].publicTracking.checkedAt);
  h.sql.exec("UPDATE shipment_tracking_cache SET next_check=0,attempted_at=NULL,lease_until=9999999999999 WHERE webshop_id='shop-a1'");
  await lib.enrichPublicTracking(h.env,'company-a','shop-a1',list,'source-a');assert.equal(calls,4);
  out=await lib.enrichPublicTracking(h.env,'company-a','shop-a1',list,'changed-connection');assert.equal(out.shipments[0].publicTracking.checkedAt,null,'old connection snapshot must not survive');
  assert.equal(h.sql.prepare('SELECT count(*) n FROM production_receipts').get().n,0);
 }finally{h.close();}
});

test('public tracking terminal states stop polling and multiple parcels stay separate',async()=>{
 const h=harness();let calls=0;
 const lib=loader({fetch:async()=>{calls++;return new Response('<script>window.tracking = '+JSON.stringify({tracking:'000123456',shipping_agent:'dao',status:'DELIVERED',statusText:'Leveret',events:[{status:'DELIVERED',statusText:'Leveret',datetime:'2026/10-04 11:10:19'}]})+';</script>',{headers:{'content-type':'text/html'}});}})('platform/public-tracking.ts');
 const shared=loader()('platform/tier1/src/lib/shipments.ts');
 const shipments=shared.orderShipments({id:'o',name:'#1',fulfillments:[{id:'f',status:'SUCCESS',createdAt:'2026-10-03T12:00:00Z',trackingInfo:[{company:'dao',number:'000123456'},{company:'dao',number:'000123457'}]}]});assert.equal(shipments.length,2);assert.notEqual(shipments[0].id,shipments[1].id);
 try{
  const list={checkedAt:new Date().toISOString(),days:30,since:'2026-10-01',truncated:false,shipments:[shipments[0]]};
  let out=await lib.enrichPublicTracking(h.env,'company-a','shop-a1',list,'source');assert.equal(out.shipments[0].delivered,true);
  h.sql.exec('UPDATE shipment_tracking_cache SET next_check=0,attempted_at=NULL');await lib.enrichPublicTracking(h.env,'company-a','shop-a1',list,'source');assert.equal(calls,1);
 }finally{h.close();}
});

test('public tracking schedule skips inactive shops and stale Shopify connections',async()=>{
 const h=harness();let calls=0;
 const lib=loader({fetch:async()=>{calls++;throw Error('fixture unavailable');}})('platform/public-tracking.ts');
 const build=loader()('platform/tier1/src/lib/shipments.ts').buildShipment;
 const source=JSON.stringify(['shop-a1.myshopify.com','encrypted-fixture']);
 const list={checkedAt:new Date().toISOString(),days:30,since:'2026-10-01',truncated:false,shipments:[build({id:'o',name:'#1'},{id:'f',status:'SUCCESS',createdAt:new Date().toISOString(),trackingInfo:[{company:'GLS',number:'000123456'}]})]};
 try{
  h.sql.prepare("INSERT INTO webshop_connections(company_id,webshop_id,provider,shop_domain,credentials_encrypted) VALUES('company-a','shop-a1','shopify','shop-a1.myshopify.com','encrypted-fixture')").run();
  await lib.enrichPublicTracking(h.env,'company-a','shop-a1',list,source);assert.equal(calls,1);
  h.sql.exec("UPDATE shipment_tracking_cache SET next_check=0,attempted_at=NULL; UPDATE webshops SET status='inactive' WHERE id='shop-a1'");
  await lib.refreshPublicTracking(h.env);assert.equal(calls,1);
  h.sql.exec("UPDATE webshops SET status='active' WHERE id='shop-a1'");
  await lib.refreshPublicTracking(h.env);assert.equal(calls,2);
  h.sql.exec("UPDATE shipment_tracking_cache SET next_check=0,attempted_at=NULL; UPDATE webshop_connections SET credentials_encrypted='replacement'");
  await lib.refreshPublicTracking(h.env);assert.equal(calls,2);assert.equal(h.sql.prepare('SELECT count(*) n FROM shipment_tracking_cache').get().n,0);
 }finally{h.close();}
});

test('public tracking treats object-property names and future statuses as unknown provider text',()=>{
 const lib=loader()('platform/public-tracking.ts'),shared=loader()('platform/tier1/src/lib/shipments.ts');
 const s=shared.buildShipment({id:'o',name:'#1'},{id:'f',status:'SUCCESS',createdAt:'2026-01-03T12:00:00Z',trackingInfo:[{company:'GLS',number:'000123456'}]});
 for(const status of ['__proto__','constructor','FUTURE_STATUS']){
  const out=lib.applyPublicTracking(s,{checked_at:'2026-01-04T12:00:00Z',error:null,data_json:JSON.stringify({status,text:'Ukendt status fra kilden',shipmentId:'',events:[{status,label:'Ukendt',at:'2026-01-04T12:00:00Z',message:null}]})});
  assert.equal(out.current,'printed');assert.equal(out.delivered,false);assert.equal(out.publicTracking.text,'Ukendt status fra kilden');assert.ok(out.steps.some(x=>x.key===out.current));
 }
});

test('public tracking waits six hours even for legacy schedules and never rechecks confirmed parcels',async()=>{
 const h=harness();let calls=0;
 const lib=loader({fetch:async()=>{calls++;throw Error('unavailable');}})('platform/public-tracking.ts');
 const build=loader()('platform/tier1/src/lib/shipments.ts').buildShipment;
 const shipment=build({id:'o',name:'#1'},{id:'f',status:'SUCCESS',createdAt:new Date().toISOString(),trackingInfo:[{company:'GLS',number:'000123456'}]});
 const list={checkedAt:new Date().toISOString(),days:30,since:'2026-10-01',truncated:false,shipments:[shipment]};
 const source=JSON.stringify(['shop-a1.myshopify.com','fixture']);
 try{
  h.sql.prepare("INSERT INTO webshop_connections(company_id,webshop_id,provider,shop_domain,credentials_encrypted) VALUES('company-a','shop-a1','shopify','shop-a1.myshopify.com','fixture')").run();
  await lib.enrichPublicTracking(h.env,'company-a','shop-a1',list,source);assert.equal(calls,1);
  const row=h.sql.prepare('SELECT * FROM shipment_tracking_cache').get();assert.ok(row.next_check-Date.parse(row.attempted_at)>=6*3600000-1000);
  h.sql.prepare('UPDATE shipment_tracking_cache SET next_check=0,attempted_at=?').run(new Date(Date.now()-2*3600000).toISOString());
  await lib.enrichPublicTracking(h.env,'company-a','shop-a1',list,source);await lib.refreshPublicTracking(h.env);assert.equal(calls,1,'old one-hour schedules must not bypass new interval');
  h.sql.prepare('UPDATE shipment_tracking_cache SET next_check=0,attempted_at=?').run(new Date(Date.now()-7*3600000).toISOString());
  await lib.refreshPublicTracking(h.env);assert.equal(calls,2);
  const delivered={...list,shipments:[{...shipment,delivered:true,deliveredAt:null,current:'delivered'}]};
  const out=await lib.enrichPublicTracking(h.env,'company-a','shop-a1',delivered,source);assert.equal(calls,2);assert.equal(out.shipments[0].delivered,true);assert.equal(out.shipments[0].deliveredAt,null);
  h.sql.exec('UPDATE shipment_tracking_cache SET next_check=0,attempted_at=NULL,expires_at=1');
  await lib.refreshPublicTracking(h.env);assert.equal(h.sql.prepare('SELECT terminal FROM shipment_tracking_cache').get().terminal,1);
  const again=await lib.enrichPublicTracking(h.env,'company-a','shop-a1',list,'changed-key');assert.equal(again.shipments[0].delivered,true);assert.equal(calls,2);
 }finally{h.close();}
});

test('manual parcel refresh selects one pending parcel, bypasses six hours with a shared minute limit, and skips delivered',async()=>{
 const h=harness(),calls=[];
 const lib=loader({fetch:async(url)=>{const number=new URL(url).pathname.split('/').at(-1);calls.push(number);return new Response('<script>window.tracking = '+JSON.stringify({tracking:number,shipping_agent:'gls',status:'EN_ROUTE',statusText:'Under transport',events:[{status:'EN_ROUTE',statusText:'Under transport',datetime:'2026/10-04 11:10:19'}]})+';</script>',{headers:{'content-type':'text/html'}});}})('platform/public-tracking.ts');
 const build=loader()('platform/tier1/src/lib/shipments.ts').buildShipment;
 const shipments=Array.from({length:9},(_,i)=>build({id:'o'+i,name:'#'+i},{id:'f'+i,status:'SUCCESS',createdAt:'2026-10-03T12:00:00Z',trackingInfo:[{company:'GLS',number:'00012345'+i}]}));
 const list={checkedAt:new Date().toISOString(),days:30,since:'2026-10-01',truncated:false,shipments};
 try{
  const first=await lib.enrichPublicTracking(h.env,'company-a','shop-a1',list,'source');assert.equal(calls.length,8);const pending=first.shipments.find(s=>s.publicTracking.state==='pending');assert.ok(pending);const index=first.shipments.indexOf(pending),number=pending.trackingNumber;
  const updated=await lib.enrichPublicTracking(h.env,'company-a','shop-a1',list,'source',pending.id);assert.equal(calls.length,9);assert.equal(calls.at(-1),number);assert.equal(updated.shipments[index].publicTracking.state,'ok');
  await assert.rejects(()=>lib.enrichPublicTracking(h.env,'company-a','shop-a1',list,'source',pending.id),e=>e.status===429);assert.equal(calls.length,9);
  h.sql.prepare("UPDATE shipment_tracking_cache SET attempted_at=? WHERE tracking_number=?").run(new Date(Date.now()-120000).toISOString(),number);
  await lib.enrichPublicTracking(h.env,'company-a','shop-a1',list,'source',pending.id);assert.equal(calls.length,10);assert.equal(calls.at(-1),number);
  await assert.rejects(()=>lib.enrichPublicTracking(h.env,'company-a','shop-a1',list,'source','untrusted'),e=>e.status===404);assert.equal(calls.length,10);
  const delivered={...list,shipments:shipments.map(s=>s.id===pending.id?{...s,delivered:true}:s)};
  const done=await lib.enrichPublicTracking(h.env,'company-a','shop-a1',delivered,'source',pending.id);assert.equal(done.shipments[index].delivered,true);assert.equal(calls.length,10);
  assert.equal(h.sql.prepare('SELECT count(*) n FROM production_receipts').get().n,0);
 }finally{h.close();}
});
 test('public tracking accepts carrier day-first dates and maps AVAILABLE_FOR_DELIVERY from cached snapshots',()=>{
 const lib=loader()('platform/public-tracking.ts'), build=loader()('platform/tier1/src/lib/shipments.ts').buildShipment;
 assert.equal(lib.trackingTime('02/10/2026 16:44:00'),'2026-10-02T14:44:00.000Z');
 assert.equal(lib.trackingTime('2026/10-02 16:44:00'),lib.trackingTime('02/10/2026 16:44:00'));
 for(const bad of ['31/02/2026 10:00:00','10/14/2026 10:00:00','29/03/2026 02:30:00'])assert.throws(()=>lib.trackingTime(bad));
 const s=build({id:'o',name:'#test'},{id:'f',status:'SUCCESS',createdAt:'2026-09-30T08:00:00Z',trackingInfo:[{company:'GLS',number:'12345678'}]});
 const target=lib.trackingTarget(s);
 for(const status of ['AVAILABLE_FOR_DELIVERY','DELIVERED']){
  const data=lib.parsePublicTracking('<script>window.tracking = '+JSON.stringify({tracking:'12345678',shipping_agent:'gls',status,statusText:'Carrier status',events:[{status:'AVAILABLE_FOR_DELIVERY',statusText:'Ready',datetime:'01/10/2026 09:31:00'},...(status==='DELIVERED'?[{status:'DELIVERED',statusText:'Delivered',datetime:'02/10/2026 16:44:00'}]:[])]})+';</script>',target,s.shippedAt);
  const result=lib.applyPublicTracking(s,{data_json:JSON.stringify(data),checked_at:'2026-10-04T12:00:00Z',error:null});
  assert.equal(result.current,status==='DELIVERED'?'delivered':'ready');assert.equal(result.issue,null);assert.equal(result.readyAt,'2026-10-01T07:31:00.000Z');assert.equal(result.pickupPoint,true);assert.equal(result.delivered,status==='DELIVERED');
 }
 });

test('the printer icon creates the Shipmondo shipment once and prints its label; an uncertain creation is never repeated',async()=>{
 const calls=[];let shipments=[],createFails=null;
 const network=async(url,opt)=>{
  const u=new URL(url),body=opt.body?JSON.parse(opt.body):null;assert.equal(opt.redirect,'manual');assert.match(opt.headers.Authorization,/^Basic /);
  calls.push(opt.method+' '+u.pathname+u.search);
  if(u.pathname.endsWith('/printers'))return Response.json([{name:'Pakkebord',hostname:'PAKKE-PC',printer:'ZD420',label_format:'zpl'}]);
  if(u.pathname.endsWith('/sales_orders')){assert.equal(u.searchParams.get('order_id'),'2701');return Response.json([{id:77,order_id:'2701',order_status:'open',shipment_template_id:5,order_fulfillments:shipments}]);}
  if(u.pathname.endsWith('/sales_orders/77/create_shipment')){if(createFails)return createFails();shipments=[{id:1,shipment_id:9001,cancelled:false,created_at:'2026-10-06T08:00:00Z'}];return Response.json({id:77,order_id:'2701',order_fulfillments:shipments});}
  if(u.pathname.endsWith('/print_jobs')){assert.deepEqual(body,{document_id:9001,document_type:'shipment',host_name:'PAKKE-PC',printer_name:'ZD420',label_format:'10x19_zpl'});return Response.json({id:1});}
  throw Error('unexpected '+url);};
 const h=harness(jose,network),env={...h.env,PLATFORM_CREDENTIALS_KEY:'ab'.repeat(32)};
 try{
  const {seal}=loader()('platform/connections.ts');
  h.sql.prepare("INSERT INTO shipping_connections(company_id,webshop_id,provider,credentials_encrypted,revision,webhook_id,webhook_secret_encrypted) VALUES('company-a','shop-a1','shipmondo',?,'r1','w1','x')").run(await seal(env,['company-a','shop-a1','shipmondo'],{apiUser:'u',apiKey:'k',sandbox:true}));
  const id='gid://shopify/Order/2701';
  h.sql.prepare("INSERT INTO operation_snapshots(company_id,webshop_id,module,external_id,occurred_at,payload_json) VALUES('company-a','shop-a1','orders',?,'2026-10-06T07:00:00Z',?)").run(id,JSON.stringify({id,name:'#2701',cancelledAt:null,currentTotalPriceSet:{shopMoney:{amount:'100.00',currencyCode:'DKK'}}}));
  const call=(path,method='GET',body,user='local-a')=>h.request('/api/platform/tier1/shops/shop-a1'+path,{user,method,...(body?{body}:{}),env});
  // No printer chosen: no icon, and printing is refused.
  const first=await call('/shopify/orders?limit=25');assert.equal(first.status,200,await first.clone().text());assert.equal((await first.json()).labels,false);
  assert.equal((await call('/shipmondo/label','POST',{externalId:id})).status,409);
  const printers=await(await call('/shipmondo/printer')).json();assert.deepEqual(printers.printers.map(p=>[p.name,p.labelFormat]),[['Pakkebord','10x19_zpl']]);
  assert.equal((await call('/shipmondo/printer','PUT',{hostname:'PAKKE-PC',printer:'ZD420'})).status,200);
  assert.equal((await(await call('/shopify/orders?limit=25')).json()).labels,true);
  // An uncertain creation (server error) is recorded and never retried by another click.
  createFails=()=>new Response('boom',{status:502});
  const uncertain=await call('/shipmondo/label','POST',{externalId:id});assert.equal(uncertain.status,409);assert.match((await uncertain.json()).error,/Kontrollér ordre #2701 i Shipmondo/);
  assert.equal((await call('/shipmondo/label','POST',{externalId:id})).status,409,'not retried without confirming');
  assert.equal(calls.filter(c=>c.includes('create_shipment')).length,1);
  // After checking Shipmondo, the user confirms there is no shipment: created once and printed.
  createFails=null;
  const printed=await call('/shipmondo/label','POST',{externalId:id,confirmedNoShipment:true});assert.equal(printed.status,200,await printed.clone().text());
  assert.deepEqual(await printed.json(),{printed:true,shipmentId:9001,reprint:false,printer:'Pakkebord',printCount:1});
  // A second click only prints the existing label again.
  const again=await(await call('/shipmondo/label','POST',{externalId:id})).json();assert.deepEqual([again.reprint,again.printCount],[true,2]);
  assert.equal(calls.filter(c=>c.includes('create_shipment')).length,2,'one failed and one successful creation, never more');
  const listed=(await(await call('/shopify/orders?limit=25')).json()).orders[0].label;assert.deepEqual([listed.phase,listed.printCount],['created',2]);
  assert.ok(h.sql.prepare("SELECT count(*) n FROM record_events WHERE event='label.printed'").get().n===2);
  // Outside production a real (non-sandbox) Shipmondo account is never used.
  h.sql.prepare("UPDATE shipping_connections SET credentials_encrypted=?").run(await seal(env,['company-a','shop-a1','shipmondo'],{apiUser:'u',apiKey:'k',sandbox:false}));
  assert.equal((await call('/shipmondo/label','POST',{externalId:id})).status,403);
 }finally{h.close();}
});
