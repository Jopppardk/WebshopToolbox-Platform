import {database} from './database';
import {loadCredentials} from './credentials';
import {readDineroAccounts} from './dinero-accounts';
import {dineroClient} from './dinero-client';
import {flatpayRead} from '@/lib/flatpay-api';
import {flatpayDraft} from '@/lib/flatpay-draft';
import {TransferError,verifyVoucher} from '@/lib/dinero-sale';
import {validateSettings} from '@/lib/admin-settings';
const tenant='sablen.dk';
type Proposal=ReturnType<typeof flatpayDraft>;
type State={phase:'prepared'|'creating'|'draft'|'uncertain';version:string;organizationId:string;proposal:Proposal;guid?:string;updatedAt:string};
export async function flatpayDraftAction(body:{externalId:string;action:string;flatpayAccount?:number;version?:string}){
 if(!['preview','create','status'].includes(body.action)||typeof body.externalId!=='string'||body.externalId.length>300)throw new TransferError('Ugyldig kladdehandling.');
 const db=database(),c=await loadCredentials('flatpay',true),dinero=await loadCredentials('dinero',true);
 if(!c||!dinero?.organizationId)throw new TransferError('Forbind Flatpay og Dinero først.');
 const row=await db.prepare('SELECT setting_value FROM app_settings WHERE tenant=? AND setting_key=?').bind(tenant,body.externalId).first<{setting_value:string}>();
 if(!row||!body.externalId.startsWith(`flatpay:payout:${c.merchantID}:${c.agreementId}:`))throw new TransferError('Udbetalingen findes ikke på den valgte Flatpay-aftale.');
 const p=JSON.parse(row.setting_value) as Record<string,unknown>;
 if(p.merchantID!==c.merchantID||p.agreementID!==c.agreementId||typeof p.paidDate!=='string'||p.paidDate.slice(0,10)<c.startDate||typeof p.settlements!=='string'||!/^\d{1,30}$/.test(p.settlements))throw new TransferError('Kladdetesten kræver en gennemført udbetaling med én afregning fra integrationens startdato.');
 const key=`flatpay_draft:${dinero.organizationId}:${body.externalId}`;
 let stored=await db.prepare('SELECT setting_value FROM app_settings WHERE tenant=? AND setting_key=?').bind(tenant,key).first<{setting_value:string}>();
 let state:State|null=stored?JSON.parse(stored.setting_value):null;
 const publicState=()=>({phase:state?.phase,version:state?.version,guid:state?.guid,proposal:state?.proposal});
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
 const payments=await flatpayRead(c as {username:string;password:string},'payments',{SettlementNumber:p.settlements});
 const matches=payments.filter(x=>x.paymentID===p.paymentID&&x.merchantID===c.merchantID&&x.agreementNumber===c.agreementNumber);
 if(matches.length!==1||matches[0].payoutAmount!==p.payoutAmount||matches[0].paidDate!==p.paidDate||matches[0].settlements!==p.settlements)throw new TransferError('Udbetalingen er ændret hos Flatpay. Hent udbetalingerne igen.');
 const settlements=await flatpayRead(c as {username:string;password:string},'settlements',{SettlementNumber:p.settlements,AgreementNumber:c.agreementNumber});
 const selected=settlements.filter(x=>x.settlementNumber===p.settlements&&x.merchantID===c.merchantID&&(x.agreementNumber===c.agreementNumber||x.agreementID===c.agreementId)&&(x.agreementNumber==null||x.agreementNumber===c.agreementNumber)&&(x.agreementID==null||x.agreementID===c.agreementId));
 if(selected.length!==1)throw new TransferError('Afregningen kunne ikke knyttes entydigt til Flatpay-aftalen.');
 const proposal=flatpayDraft(matches[0],selected[0],accounts);
 async function save(next:State){const raw=JSON.stringify(next);const result=stored?await db.prepare('UPDATE app_settings SET setting_value=?,updated_at=CURRENT_TIMESTAMP WHERE tenant=? AND setting_key=? AND setting_value=?').bind(raw,tenant,key,stored.setting_value).run():await db.prepare('INSERT INTO app_settings(tenant,setting_key,setting_value) VALUES(?,?,?) ON CONFLICT DO NOTHING').bind(tenant,key,raw).run();if(result.meta.changes!==1)throw new TransferError('Kladdestatus blev ændret. Hent status igen.');stored={setting_value:raw};state=next;}
 if(body.action==='preview'){await save({phase:'prepared',version:crypto.randomUUID(),organizationId:dinero.organizationId,proposal,updatedAt:new Date().toISOString()});return publicState();}
 if(!state||state.phase!=='prepared'||body.version!==state.version||JSON.stringify(state.proposal)!==JSON.stringify(proposal))throw new TransferError('Forslaget er ændret. Kontrollér en ny forhåndsvisning.');
 const client=await dineroClient(dinero);
 await save({...state,phase:'creating',version:crypto.randomUUID(),updatedAt:new Date().toISOString()});
 try{
  const raw=await client('vouchers/manuel','POST',proposal.voucher) as {Guid?:string};
  if(raw.Guid&&/^[\da-f]{8}(-[\da-f]{4}){3}-[\da-f]{12}$/i.test(raw.Guid))await save({...state!,guid:raw.Guid});
  const verified=verifyVoucher(raw,proposal.voucher,proposal.expected);
  if(verified.Status!=='Draft'||!state!.guid)throw new TransferError('Dinero bekræftede ikke kladden.');
  await save({...state!,phase:'draft',updatedAt:new Date().toISOString()});return publicState();
 }catch{try{await save({...state!,phase:'uncertain'});}catch{}throw new TransferError('Dinero-status er usikker. Kontrollér Dinero før yderligere handling; automatisk genforsøg er blokeret.');}
}
