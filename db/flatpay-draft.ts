import {database} from './database';
import {loadCredentials} from './credentials';
import {readDineroAccounts} from './dinero-accounts';
import {dineroClient} from './dinero-client';
import {env} from 'cloudflare:workers';
import {ensureFlatpayReport} from './flatpay-report';
import {flatpayDraft} from '@/lib/flatpay-draft';
import {TransferError,verifyVoucher} from '@/lib/dinero-sale';
import {validateSettings} from '@/lib/admin-settings';
const tenant='sablen.dk';
type Proposal=ReturnType<typeof flatpayDraft>&{report?:{key:string;etag:string;filename:string;fingerprint:string}};
type State={phase:'prepared'|'creating'|'draft'|'booking'|'booked'|'uncertain';version:string;organizationId:string;proposal:Proposal;guid?:string;updatedAt:string};
export async function flatpayDraftAction(body:{externalId:string;action:string;flatpayAccount?:number;version?:string}){
 if(!['preview','create','status'].includes(body.action)||typeof body.externalId!=='string'||body.externalId.length>300)throw new TransferError('Ugyldig kladdehandling.');
 const db=database(),c=await loadCredentials('flatpay',true),dinero=await loadCredentials('dinero',true);
 if(!c||!dinero?.organizationId)throw new TransferError('Forbind Flatpay og Dinero først.');
 const row=await db.prepare('SELECT setting_value FROM app_settings WHERE tenant=? AND setting_key=?').bind(tenant,body.externalId).first<{setting_value:string}>();
 if(!row||!body.externalId.startsWith(`flatpay:payout:${c.merchantID}:${c.agreementId}:`))throw new TransferError('Udbetalingen findes ikke på den valgte Flatpay-aftale.');
 const p=JSON.parse(row.setting_value) as Record<string,unknown>;
 if(p.merchantID!==c.merchantID||p.agreementID!==c.agreementId||typeof p.paidDate!=='string'||p.paidDate.slice(0,10)<c.startDate||typeof p.settlements!=='string'||!/^\d{1,30}$/.test(p.settlements))throw new TransferError('Overførslen kræver en gennemført udbetaling med én afregning fra integrationens startdato.');
 const key=`flatpay_draft:${dinero.organizationId}:${body.externalId}`;
 let stored=await db.prepare('SELECT setting_value FROM app_settings WHERE tenant=? AND setting_key=?').bind(tenant,key).first<{setting_value:string}>();
 let state:State|null=stored?JSON.parse(stored.setting_value):null;
 const publicState=()=>state?.phase==='prepared'&&!state.proposal.report?{}:({phase:state?.phase,version:state?.version,guid:state?.guid,proposal:state?.proposal});
 if(state&&state.phase!=='prepared')return publicState();
 if(body.action==='status')return publicState();
 const chart=await readDineroAccounts(dinero);
 const settingsRow=await db.prepare("SELECT setting_value FROM app_settings WHERE tenant=? AND setting_key='admin_settings'").bind(tenant).first<{setting_value:string}>();
 if(!settingsRow)throw new TransferError('Gem bank-, gebyr- og fordelingskonto under Indstillinger først.');
 const settings=validateSettings(JSON.parse(settingsRow.setting_value));
 const flatpay=body.action==='create'?state?.proposal.voucher.Lines[0].AccountNumber:body.flatpayAccount;
 if(!flatpay)return {accounts:chart.filter(a=>!a.hidden&&!a.vatCode),phase:'select-account'};
 const accounts={flatpay,bank:Number(settings.accounts.bank.match(/^\d+/)?.[0]),fees:Number(settings.accounts.fees.match(/^\d+/)?.[0]),clearing:Number(settings.accounts.clearing.match(/^\d+/)?.[0])};
 for(const n of Object.values(accounts))if(!chart.some(a=>Number(a.number)===n&&!a.hidden&&!a.vatCode))throw new TransferError(`Konto ${n} skal være aktiv og uden moms i Dinero.`);
 let generated:Awaited<ReturnType<typeof ensureFlatpayReport>>;
 try{generated=await ensureFlatpayReport(db,body.externalId);}catch(e){throw new TransferError(e instanceof Error?e.message:'Rapporten kunne ikke dannes.');}
 if(generated.source.settlements.length!==1)throw new TransferError('Kladden kræver én afregning.');
 const proposal:Proposal={...flatpayDraft(generated.source.payment,generated.source.settlements[0],accounts),report:generated.report};
 async function save(next:State){const raw=JSON.stringify(next);const result=stored?await db.prepare('UPDATE app_settings SET setting_value=?,updated_at=CURRENT_TIMESTAMP WHERE tenant=? AND setting_key=? AND setting_value=?').bind(raw,tenant,key,stored.setting_value).run():await db.prepare('INSERT INTO app_settings(tenant,setting_key,setting_value) VALUES(?,?,?) ON CONFLICT DO NOTHING').bind(tenant,key,raw).run();if(result.meta.changes!==1)throw new TransferError('Kladdestatus blev ændret. Hent status igen.');stored={setting_value:raw};state=next;}
 if(body.action==='preview'){await save({phase:'prepared',version:crypto.randomUUID(),organizationId:dinero.organizationId,proposal,updatedAt:new Date().toISOString()});return publicState();}
 if(!state||state.phase!=='prepared'||body.version!==state.version||JSON.stringify(state.proposal)!==JSON.stringify(proposal))throw new TransferError('Forslaget er ændret. Kontrollér en ny forhåndsvisning.');
 const client=await dineroClient(dinero);
 await save({...state,phase:'creating',version:crypto.randomUUID(),updatedAt:new Date().toISOString()});
 try{
  const report=proposal.report!;
  const object=await (env as unknown as {INVOICES:R2Bucket}).INVOICES.get(report.key);
  if(!object||object.etag!==report.etag)throw new TransferError('Rapporten mangler eller er ændret.');
  const form=new FormData();form.append('file',new Blob([await object.arrayBuffer()],{type:'application/pdf'}),report.filename);
  const upload=await client('files','POST',form) as {FileGuid?:string};
  if(!upload.FileGuid||!/^[\da-f]{8}(-[\da-f]{4}){3}-[\da-f]{12}$/i.test(upload.FileGuid))throw new TransferError('Dinero bekræftede ikke PDF-upload.');
  proposal.voucher.FileGuid=upload.FileGuid;
  await save({...state!,proposal});
  const raw=await client('vouchers/manuel','POST',proposal.voucher) as {Guid?:string};
  if(raw.Guid&&/^[\da-f]{8}(-[\da-f]{4}){3}-[\da-f]{12}$/i.test(raw.Guid))await save({...state!,guid:raw.Guid});
  const verified=verifyVoucher(raw,proposal.voucher,proposal.expected);
  if(verified.Status!=='Draft'||!state!.guid)throw new TransferError('Dinero bekræftede ikke kladden.');
  await save({...state!,phase:'draft',updatedAt:new Date().toISOString()});return publicState();
 }catch{try{await save({...state!,phase:'uncertain'});}catch{}throw new TransferError('Dinero-status er usikker. Kontrollér Dinero før yderligere handling; automatisk genforsøg er blokeret.');}
}
