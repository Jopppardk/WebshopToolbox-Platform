import {recordFailure} from './record-history';
import {syncPackaging} from './packaging-source';
import {handleOperations} from './operations';
import {handleInvoices} from './invoices';
import {handlePayments} from './payments';
import {handleProductionSale} from './production-sales';
import {handleProductionOther} from './production-proposals';
import {generatePayoutReport} from './documents';
import {productionWrites,bookingDate} from './production-policy';
import {dataStartDate,historyPolicy,providerStart} from './tier1-history';
import {HttpError,type Actor,type PlatformEnv} from './types';
const request=(body:unknown)=>new Request('https://portal.webshoptoolbox.dk/internal-job',{method:'POST',headers:{origin:'https://portal.webshoptoolbox.dk','content-type':'application/json'},body:JSON.stringify(body)});
const plusDay=(value:string,days:number)=>new Date(Date.parse(value+'T12:00:00Z')+days*86400000).toISOString().slice(0,10);
async function responseValue(response:Response){const value=await response.json() as any;if(!response.ok)throw new HttpError(response.status,value.error||'Jobbet kunne ikke gennemfoeres.');return value;}
export async function runProductionJobs(env:PlatformEnv){
 if(!productionWrites(env))return {status:'disabled',processed:0};
 const db=env.PLATFORM_DB,deadline=Date.now()+240000;
 // A live company administrator is selected server-side. No client supplied tenant
 // or identity is used, and all adapters recheck company and webshop permissions.
 const shops=(await db.prepare(`SELECT w.company_id,w.id,COALESCE(p.preferences_json,'{}') preferences_json,p.revision,u.id actor_id,u.email,EXISTS(SELECT 1 FROM webshop_connections k WHERE k.company_id=w.company_id AND k.webshop_id=w.id AND k.provider='shopify' AND k.verified_at IS NOT NULL) shopify
 FROM webshops w JOIN companies c ON c.id=w.company_id AND c.status='active'
 LEFT JOIN tier1_preferences p ON p.company_id=w.company_id AND p.webshop_id=w.id
 JOIN users u ON u.id=(SELECT m.user_id FROM company_memberships m JOIN users a ON a.id=m.user_id
 WHERE m.company_id=w.company_id AND m.role='admin' AND a.status='active'
 AND NOT EXISTS(SELECT 1 FROM platform_admins pa WHERE pa.user_id=a.id) ORDER BY m.user_id LIMIT 1)
 LEFT JOIN production_jobs j ON j.company_id=w.company_id AND j.webshop_id=w.id AND j.job='runtime'
 WHERE w.status='active' AND NOT EXISTS(SELECT 1 FROM public_signups ps WHERE ps.company_id=w.company_id AND ps.trial_ends_at<=unixepoch()) ORDER BY COALESCE(j.next_run_at,0),w.id LIMIT 10`).all<any>()).results;
 let processed=0;
 for(const shop of shops){
  if(Date.now()>deadline)break;
  const company=shop.company_id,id=shop.id,actor:Actor={id:shop.actor_id,email:shop.email,platformAdmin:false};
  const owner=crypto.randomUUID(),now=Date.now(),prefs=JSON.parse(shop.preferences_json),automation=prefs.automation||{};
  const interval=Math.max(15,Math.min(1440,Number(prefs.syncIntervalMinutes)||15))*60000;
  const claim=await db.prepare(`INSERT INTO production_jobs(company_id,webshop_id,job,lease_owner,lease_until) VALUES(?,?,'runtime',?,?)
 ON CONFLICT(company_id,webshop_id,job) DO UPDATE SET lease_owner=excluded.lease_owner,lease_until=excluded.lease_until
 WHERE production_jobs.lease_until<? AND production_jobs.next_run_at<=?`).bind(company,id,owner,now+300000,now,now).run();
  if(claim.meta.changes!==1)continue;
  const owns=async()=>{if(Date.now()>deadline)throw new HttpError(409,'Jobbet fortsaetter ved naeste koersel.');const active=await db.prepare("SELECT 1 FROM production_jobs WHERE company_id=? AND webshop_id=? AND job='runtime' AND lease_owner=? AND lease_until>? AND (CASE WHEN ? IS NULL THEN NOT EXISTS(SELECT 1 FROM tier1_preferences p WHERE p.company_id=production_jobs.company_id AND p.webshop_id=production_jobs.webshop_id) ELSE EXISTS(SELECT 1 FROM tier1_preferences p WHERE p.company_id=production_jobs.company_id AND p.webshop_id=production_jobs.webshop_id AND p.revision=?) END) AND NOT EXISTS(SELECT 1 FROM public_signups ps WHERE ps.company_id=production_jobs.company_id AND ps.trial_ends_at<=unixepoch())").bind(company,id,owner,Date.now(),shop.revision,shop.revision).first();if(!active)throw new HttpError(409,'Joblaasen er udloebet.');};
  const run=async(name:string,work:()=>Promise<void>)=>{
   const runId=crypto.randomUUID();await db.prepare("INSERT INTO operation_runs(id,company_id,webshop_id,module,status) VALUES(?,?,?,?,'running')").bind(runId,company,id,name).run();
   try{await owns();await work();await db.prepare("UPDATE operation_runs SET status='success',finished_at=CURRENT_TIMESTAMP WHERE id=?").bind(runId).run();}
   catch(error){const message=error instanceof HttpError?error.message:'Integrationen kunne ikke behandles. Kontrollér forbindelse og postens detaljer.';await db.prepare("UPDATE operation_runs SET status='failed',message=?,finished_at=CURRENT_TIMESTAMP WHERE id=?").bind(message.slice(0,600),runId).run();}
  };
  const cursor=async(job:string)=>{const row=await db.prepare('SELECT cursor_json FROM production_jobs WHERE company_id=? AND webshop_id=? AND job=?').bind(company,id,job).first<{cursor_json:string}>();return row?JSON.parse(row.cursor_json):{};};
  const saveCursor=async(job:string,value:unknown)=>{await owns();await db.prepare('INSERT INTO production_jobs(company_id,webshop_id,job,cursor_json) VALUES(?,?,?,?) ON CONFLICT(company_id,webshop_id,job) DO UPDATE SET cursor_json=excluded.cursor_json').bind(company,id,job,JSON.stringify(value)).run();};
  try{
   const policy=await historyPolicy(env,company),start=await providerStart(env,company,id,'shopify'),scope=JSON.stringify([policy,start]);
   // Imports are read-only and run whenever Shopify is connected; automation switches only
   // control bookkeeping. Inventory is a full item list and stays behind its own switch.
   const imports=shop.shopify?['orders','payments','refunds','payouts',...(automation.inventory?['inventory']:[])]:[];
   const importModule=(module:string,body:Record<string,unknown>)=>handleOperations(request(body),env,actor,company,id,module).then(responseValue);
   for(const module of imports){
    await run('auto.import.'+module,async()=>{
     const state=await cursor('import.'+module),current=state.scope===scope?state:{};
     if(module==='orders'){
      // Orders sync by change time from a watermark, oldest change first, so new orders and later
      // changes (fulfilment, cancellation) arrive every run however long the history is. The first
      // sync walks the whole history in bounded portions; a 10-minute overlap covers late writes.
      // Shops already synced by the earlier backwards walk resume 30 days back instead of from scratch.
      const migrated=!current.since&&state.scope===scope&&'after' in state?new Date(Date.now()-30*86400000).toISOString():null;
      let since:string=current.since||migrated||'2000-01-01T00:00:00Z',after:string|null=current.since?current.after||null:null,newest:string|null=current.since?current.newest||null:null;
      for(let page=0;page<20;page++){
       const result=await importModule('orders',{after,since});
       if(result.maxUpdatedAt&&(!newest||result.maxUpdatedAt>newest))newest=result.maxUpdatedAt;
       if(result.hasNextPage){after=result.endCursor;await saveCursor('import.orders',{scope,since,after,newest});continue;}
       if(newest)since=new Date(Date.parse(newest)-600000).toISOString();
       await saveCursor('import.orders',{scope,since,after:null,newest:null});return;
      }
      return;
     }
     // Newest page every run (new items and recent status changes), then one page of history
     // until the history has been walked once.
     const head=await importModule(module,{after:null});
     if(current.done||!head.hasNextPage){await saveCursor('import.'+module,{scope,done:current.done||!head.hasNextPage});return;}
     const next=await importModule(module,{after:current.after||head.endCursor});
     await saveCursor('import.'+module,next.hasNextPage?{scope,after:next.endCursor}:{scope,done:true});
    });
   }
   const connections=(await db.prepare('SELECT provider,start_date,revision FROM payment_connections WHERE company_id=? AND webshop_id=?').bind(company,id).all<any>()).results;
   // Payment provider imports are read-only and run for every connection; switches only control bookkeeping.
   for(const connection of connections){
    const provider=connection.provider;
    for(const kind of provider==='flatpay'?['payments','settlements','transactions']:provider==='pensopay'?['payments','settlements']:['payment','payout']){
     await run('auto.import.'+provider+'.'+kind,async()=>{
      const job=provider+'.'+kind,stored=await cursor(job),today=new Date().toISOString().slice(0,10),boundary=[connection.start_date,await dataStartDate(env,company,id,provider)].sort().at(-1)!;
      const signature=JSON.stringify([connection.revision,boundary]),state=stored.scope===signature?stored:{};
      const from=state.start||boundary,end=[plusDay(from,30),today].sort()[0];if(from>today)return;
      const result=await responseValue(await handlePayments(request({kind,start:from,end,cursor:state.cursor,includeUpcoming:true}),env,actor,company,id,provider,'sync'));
      const next=result.next||null;await saveCursor(job,{scope:signature,start:next?from:end<today?plusDay(end,1):boundary,cursor:next});
     });
    }
   }
   const packaging=await db.prepare('SELECT config_json FROM emballage_connections WHERE company_id=? AND webshop_id=?').bind(company,id).first<{config_json:string}>();
   if(packaging){const config=JSON.parse(packaging.config_json),today=new Date().toISOString().slice(0,10),state=await cursor('packaging.history');if(config.startDate&&state.day!==today)await run('auto.packaging.history',async()=>{await syncPackaging(env,company,id,[config.startDate,await dataStartDate(env,company,id)].sort()[1],today);await saveCursor('packaging.history',{day:today});});}
   // Payout reports for every paid payout, whether or not bookkeeping is on. Newest first, a few per
   // run; a failed report waits six hours before the next attempt instead of blocking the others.
   await run('auto.reports',async()=>{
    const pending=(await db.prepare(`SELECT external_id FROM (
 SELECT s.external_id,s.occurred_at FROM operation_snapshots s WHERE s.company_id=? AND s.webshop_id=? AND s.module='payouts' AND json_extract(s.payload_json,'$.status')='PAID' AND json_extract(s.payload_json,'$.transactionType')='DEPOSIT'
 UNION ALL SELECT 'flatpay:'||p.external_id,p.occurred_at FROM payment_records p WHERE p.company_id=? AND p.webshop_id=? AND p.provider='flatpay' AND p.kind='payments' AND p.paid=1) c
 WHERE NOT EXISTS(SELECT 1 FROM platform_payout_documents d WHERE d.company_id=? AND d.webshop_id=? AND d.external_id=c.external_id)
 AND NOT EXISTS(SELECT 1 FROM production_attempts a WHERE a.company_id=? AND a.webshop_id=? AND a.job='reports' AND a.external_id=c.external_id AND a.next_attempt_at>?)
 ORDER BY c.occurred_at DESC LIMIT 5`).bind(company,id,company,id,company,id,company,id,Date.now()).all<{external_id:string}>()).results;
    const failed:string[]=[];
    for(const row of pending){await owns();
     try{await generatePayoutReport(env,company,id,row.external_id);}
     catch{failed.push(row.external_id);await db.prepare("INSERT INTO production_attempts(company_id,webshop_id,job,external_id,attempted_at,next_attempt_at,failures) VALUES(?,?,'reports',?,?,?,1) ON CONFLICT(company_id,webshop_id,job,external_id) DO UPDATE SET attempted_at=excluded.attempted_at,next_attempt_at=excluded.next_attempt_at,failures=production_attempts.failures+1").bind(company,id,row.external_id,Date.now(),Date.now()+6*3600000).run();}
    }
    if(failed.length)throw new HttpError(409,`${failed.length} udbetalingsrapport${failed.length===1?'':'er'} kunne ikke dannes automatisk. Prøv Generér rapport under Udbetalingsrapporter.`);
   });
   const processRows=async(job:string,provider:string,module:string,kind:string,book:boolean,email=false)=>{
    const dates=(await db.prepare('SELECT provider,start_date FROM booking_start_dates WHERE company_id=? AND webshop_id=?').bind(company,id).all<{provider:string;start_date:string}>()).results;
    const sourceDate=dates.find(d=>d.provider===provider)?.start_date,dineroDate=dates.find(d=>d.provider==='dinero')?.start_date;
    if(!sourceDate||!dineroDate)throw new HttpError(409,'Gem bogfoeringsstart for integrationen og Dinero.');
    const boundary=[sourceDate,dineroDate].sort()[1];
    const table=provider==='shopify'?'operation_snapshots':'payment_records',filter=provider==='shopify'?'s.module=?':'s.kind=? AND s.provider=?';
    const eligible=module==='orders'?" AND COALESCE(json_extract(s.payload_json,'$.test'),0)=0 AND json_extract(s.payload_json,'$.cancelledAt') IS NULL AND json_extract(s.payload_json,'$.displayFulfillmentStatus')='FULFILLED' AND substr((SELECT max(json_extract(f.value,'$.createdAt')) FROM json_each(s.payload_json,'$.fulfillments') f WHERE json_extract(f.value,'$.status')='SUCCESS'),1,10)>=?"
     // Payouts are only booked once paid out; upcoming ones are skipped instead of counted as failures.
     :module==='payouts'?" AND json_extract(s.payload_json,'$.status')='PAID'":provider==='flatpay'&&module==='payments'?" AND json_extract(s.payload_json,'$.paidDate') IS NOT NULL":'';
    const rows=(await db.prepare(`SELECT s.external_id,s.occurred_at FROM ${table} s
 LEFT JOIN production_attempts a ON a.company_id=s.company_id AND a.webshop_id=s.webshop_id AND a.job=? AND a.external_id=s.external_id
 WHERE s.company_id=? AND s.webshop_id=? AND ${filter}${eligible} AND substr(s.occurred_at,1,10)>=? AND COALESCE(a.next_attempt_at,0)<=?
 ORDER BY COALESCE(a.attempted_at,0),s.occurred_at,s.external_id LIMIT 10`).bind(job,company,id,...(provider==='shopify'?[module]:[module,provider]),...(module==='orders'?[plusDay(boundary,-1)]:[]),module==='orders'?'1970-01-01':plusDay(boundary,-1),Date.now()).all<any>()).results;
    for(const row of rows){await owns();const externalId=row.external_id;
     await run('auto.'+job,async()=>{
      let succeeded=false;
      try{
       if(kind==='sale'||email){const checked=await responseValue(await handleInvoices(request({webshopId:id,externalId}),env,actor,company,'check'));const day=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Copenhagen',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(checked.invoice.date));if(day<boundary){succeeded=true;return;}await bookingDate(env,company,id,provider,checked.invoice.date);}
       else await bookingDate(env,company,id,provider,row.occurred_at);
       if(kind==='sale'||email)await responseValue(await handleInvoices(request({webshopId:id,externalId}),env,actor,company,'generate'));
       if(email){await responseValue(await handleInvoices(request({webshopId:id,externalId}),env,actor,company,'send'));}
       else{
        const invoke=(body:unknown)=>kind==='sale'?handleProductionSale(request(body),env,actor,company,id):handleProductionOther(request(body),env,actor,company,id,kind);
        const inspected=await responseValue(await invoke({kind,externalId,action:'inspect'}));
        if(inspected.phase!=='booked'&&!(inspected.phase==='draft'&&!book))await responseValue(await invoke({kind,externalId,action:'retry',version:inspected.version,confirmed:true}));
       }
       succeeded=true;
      }catch(error){
       try{await recordFailure(env,company,id,provider,module,externalId,'Automatisk behandling: '+job,error);}catch{/* Keep original error and durable claims. */}
       throw error;
      }finally{
       // Failed sources get a bounded cooldown instead of starving later orders.
       await db.prepare('INSERT INTO production_attempts(company_id,webshop_id,job,external_id,attempted_at,next_attempt_at,failures) VALUES(?,?,?,?,?,?,?) ON CONFLICT(company_id,webshop_id,job,external_id) DO UPDATE SET attempted_at=excluded.attempted_at,next_attempt_at=excluded.next_attempt_at,failures=CASE WHEN excluded.failures=0 THEN 0 ELSE production_attempts.failures+1 END').bind(company,id,job,externalId,Date.now(),Date.now()+(succeeded?86400000:900000),succeeded?0:1).run();
      }
     });
    }
   };
   if(automation.sales)await run('auto.sales.queue',()=>processRows('sales','shopify','orders','sale',automation.salesBookDinero));
   if(automation.refunds)await run('auto.refunds.queue',()=>processRows('refunds','shopify','refunds','refund',automation.refundsBookDinero));
   if(automation.payouts){await run('auto.payouts.queue',()=>processRows('payouts','shopify','payouts','payout',automation.payoutsBookDinero));if(connections.some(c=>c.provider==='flatpay'))await run('auto.flatpay.queue',()=>processRows('flatpay','flatpay','payments','flatpay',automation.payoutsBookDinero));}
   if(automation.invoiceEmails&&env.PLATFORM_CUSTOMER_EMAIL==='enabled')await run('auto.invoice.queue',()=>processRows('invoice','shopify','orders','sale',false,true));
   processed++;
  }finally{await db.prepare("UPDATE production_jobs SET lease_owner=NULL,lease_until=0,next_run_at=? WHERE company_id=? AND webshop_id=? AND job='runtime' AND lease_owner=?").bind(Date.now()+interval,company,id,owner).run();}
 }
 return {status:'completed',processed};
}
