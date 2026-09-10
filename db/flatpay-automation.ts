import {database} from './database';
import {loadCredentials} from './credentials';
import {flatpayDraftAction} from './flatpay-draft';
import {dineroClient} from './dinero-client';
import {validateSettings} from '@/lib/admin-settings';
import {verifyVoucher} from '@/lib/dinero-sale';
import {recordFailure} from './errors';

// Use the same receipt as the manual flow. A missing response never authorizes a
// second creation or booking. Activation is scoped to both merchant and ledger.
export async function runFlatpayAutomation(){
 const db=database(),c=await loadCredentials('flatpay',true),dinero=await loadCredentials('dinero',true);
 if(!c||!dinero?.organizationId)return {status:'skipped' as const,message:'Forbind Flatpay og Dinero først.'};
 const configRow=await db.prepare("SELECT setting_value FROM app_settings WHERE tenant='sablen.dk' AND setting_key='flatpay_production'").first<{setting_value:string}>();
 const config=configRow?JSON.parse(configRow.setting_value):null;
 if(config?.enabled!==true||config.merchantID!==c.merchantID||config.agreementId!==c.agreementId||config.organizationId!==dinero.organizationId)return {status:'skipped' as const,message:'Flatpay-overførsel til Dinero afventer driftsaktivering for denne konto.'};
 const row=await db.prepare("SELECT setting_value FROM app_settings WHERE tenant='sablen.dk' AND setting_key='admin_settings'").first<{setting_value:string}>();
 if(!row)return {status:'skipped' as const,message:'Kontoopsætningen mangler.'};
 const settings=validateSettings(JSON.parse(row.setting_value));
 if(!settings.automation.payouts)return {status:'skipped' as const,message:'Udbetalingsautomatikken er fravalgt.'};
 const account=Number(settings.accounts.flatpayClearing.match(/^\d+/)?.[0]);
 if(!Number.isSafeInteger(account)||account<=0)throw Error('Vælg Flatpays mellemregningskonto under Indstillinger.');
 const prefix=`flatpay_draft:${dinero.organizationId}:`;
 const rows=await db.prepare("SELECT p.setting_key FROM app_settings p LEFT JOIN app_settings s ON s.tenant=p.tenant AND s.setting_key=?||p.setting_key WHERE p.tenant='sablen.dk' AND substr(p.setting_key,1,15)='flatpay:payout:' AND json_extract(p.setting_value,'$.merchantID')=? AND json_extract(p.setting_value,'$.agreementID')=? AND substr(json_extract(p.setting_value,'$.paidDate'),1,10)>=? AND (s.setting_key IS NULL OR json_extract(s.setting_value,'$.phase')='prepared' OR (?=1 AND json_extract(s.setting_value,'$.phase')='draft')) ORDER BY p.updated_at,p.setting_key LIMIT 3").bind(prefix,c.merchantID,c.agreementId,c.startDate,settings.automation.payoutsBookDinero?1:0).all<{setting_key:string}>();
 let completed=0,failed=0,held=0;
 for(const payout of rows.results){
  if(Array.isArray(config.holdIds)&&config.holdIds.includes(payout.setting_key)){held++;continue;}
  try{
   const preview=await flatpayDraftAction({externalId:payout.setting_key,action:'preview',flatpayAccount:account});
   if(preview.phase==='prepared'&&'version' in preview)await flatpayDraftAction({externalId:payout.setting_key,action:'create',version:preview.version});
   const state=await flatpayDraftAction({externalId:payout.setting_key,action:'status'});
   if(state.phase!=='draft'&&state.phase!=='booked')throw Error('Flatpay-overførslen har en igangværende eller usikker status.');
   if(state.phase==='draft'&&settings.automation.payoutsBookDinero)await bookFlatpay(payout.setting_key,dinero);
   completed++;
  }catch(error){failed++;await recordFailure('Dinero · Flatpay-udbetaling',{category:'dinero',reference:payout.setting_key,cause:error instanceof Error?error.message:'Overførslen fejlede.',action:'Kontrollér afregningsgrundlaget og Dinero før et nyt forsøg.'});await db.prepare("UPDATE app_settings SET updated_at=CURRENT_TIMESTAMP WHERE tenant='sablen.dk' AND setting_key=?").bind(payout.setting_key).run();}
 }
 if(failed)throw Error(`${failed} Flatpay-udbetalinger kræver kontrol af afregning, konti eller Dinero-status; ${completed} gennemført. Vælg Bogfør manuelt på udbetalingen efter kontrol af Dinero.`);
 if(held&&!completed)return {status:'skipped' as const,message:`${held} tidligere testudbetaling afventer afklaring af Dinero-status. Øvrige udbetalinger behandles automatisk.`};
 return {message:`${completed} Flatpay-udbetalinger ${settings.automation.payoutsBookDinero?'bogført':'oprettet som kladde'} med rapport.`};
}

export async function bookFlatpay(id:string,credentials:Record<string,string>){
 const db=database(),key=`flatpay_draft:${credentials.organizationId}:${id}`;
 const row=await db.prepare("SELECT setting_value FROM app_settings WHERE tenant='sablen.dk' AND setting_key=?").bind(key).first<{setting_value:string}>();
 if(!row)throw Error('Kladdereferencen mangler.');
 let raw=row.setting_value,state=JSON.parse(raw);
 if(state.phase==='booked')return;
 if(state.phase!=='draft'||state.organizationId!==credentials.organizationId||!state.guid||!state.proposal?.voucher?.FileGuid)throw Error('Kladden er ikke klar til bogføring med bilag.');
 async function save(phase:string){const next={...state,phase,version:crypto.randomUUID(),updatedAt:new Date().toISOString()},value=JSON.stringify(next);const result=await db.prepare("UPDATE app_settings SET setting_value=?,updated_at=CURRENT_TIMESTAMP WHERE tenant='sablen.dk' AND setting_key=? AND setting_value=?").bind(value,key,raw).run();if(result.meta.changes!==1)throw Error('Kladdestatus blev ændret.');raw=value;state=next;}
 const client=await dineroClient(credentials);
 // Claim before reading so two invocations can never post the same /book request.
 await save('booking');
 try{
  const before=verifyVoucher(await client(`vouchers/manuel/${state.guid}`,'GET'),state.proposal.voucher,state.proposal.expected);
  if(before.Guid.toLowerCase()!==state.guid.toLowerCase())throw Error('Dinero returnerede et andet bilag.');
  if(before.Status==='Booked'){await save('booked');return;}
  if(before.Status!=='Draft')throw Error('Bilaget er ikke en kladde.');
  const result=verifyVoucher(await client(`vouchers/manuel/${state.guid}/book`,'POST',{Timestamp:before.Timestamp}),state.proposal.voucher,state.proposal.expected);
  if(result.Status!=='Booked'||result.Guid.toLowerCase()!==state.guid.toLowerCase())throw Error('Bogføringen blev ikke bekræftet.');
  await save('booked');
 }catch(error){try{await save('uncertain');}catch{}throw error;}
}
