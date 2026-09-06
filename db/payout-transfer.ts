import { env } from 'cloudflare:workers';
import { database } from './database';
import { loadCredentials } from './credentials';
import { readDineroAccounts } from './dinero-accounts';
import { dineroClient } from './dinero-client';
import { validateSettings } from '@/lib/admin-settings';
import { rejectTransfer, TransferError, verifyVoucher, type Voucher, type Expected } from '@/lib/dinero-sale';
import { recordFailure } from './errors';
import { payoutBreakdown, type PayoutSummary } from '@/lib/shopify-payout';
import { ensurePayoutReport } from '@/lib/payout-report';

type State = { phase: 'prepared'|'creating'|'draft'|'uncertain'; version: string; updatedAt: string; externalId: string; organizationId: string; guid?: string; message?: string; snapshot: { payoutId: string; amount: number; currency: string; voucher: Voucher; expected: Expected } };
const tenant='sablen.dk', key=(id:string)=>`payout_transfer:${id}`;
const runtime=()=>env as unknown as { DINERO_PAYOUT_TEST_ID?: string };
async function read(id:string){const row=await database().prepare('SELECT setting_value FROM app_settings WHERE tenant=? AND setting_key=?').bind(tenant,key(id)).first<{setting_value:string}>();return row?{raw:row.setting_value,state:JSON.parse(row.setting_value) as State}:null;}
async function save(id:string,previous:Awaited<ReturnType<typeof read>>,value:Omit<State,'version'|'updatedAt'>){const state={...value,version:crypto.randomUUID(),updatedAt:new Date().toISOString()} as State,raw=JSON.stringify(state);const result=previous?await database().prepare('UPDATE app_settings SET setting_value=?,updated_at=CURRENT_TIMESTAMP WHERE tenant=? AND setting_key=? AND setting_value=?').bind(raw,tenant,key(id),previous.raw).run():await database().prepare('INSERT INTO app_settings(tenant,setting_key,setting_value) VALUES(?,?,?) ON CONFLICT DO NOTHING').bind(tenant,key(id),raw).run();if(result.meta.changes!==1)rejectTransfer('En anden handling har ændret testen. Hent status igen.');return{raw,state};}
const number=(value:string)=>{const n=Number(value.match(/^\d+/)?.[0]);if(!Number.isSafeInteger(n)||n<=0)rejectTransfer('Vælg gyldige udbetalingskonti under Administration.');return n;};
export async function payoutProposal(id:string,credentials:Record<string,string>,test=true){
 const report=await ensurePayoutReport(database(),id);
 const row=await database().prepare("SELECT payload_json,amount_minor,currency FROM integration_records WHERE tenant=? AND record_type='payout' AND external_id=?").bind(tenant,id).first<{payload_json:string;amount_minor:number;currency:string}>();
 if(!row)throw new TransferError('Udbetalingen findes ikke.');const payout=JSON.parse(row.payload_json);
 if(payout.provider!=='shopify_payments'||payout.status!=='PAID'||payout.transactionType!=='DEPOSIT'||row.currency!=='DKK'||!Number.isSafeInteger(row.amount_minor)||row.amount_minor<=0)rejectTransfer('Kun en gennemført Shopify Payments-udbetaling i DKK kan testes.');
 const settingsRow=await database().prepare("SELECT setting_value FROM app_settings WHERE tenant=? AND setting_key='admin_settings'").bind(tenant).first<{setting_value:string}>();if(!settingsRow)throw new TransferError('Gem udbetalingskontiene under Administration.');
 if(!payout.summary)rejectTransfer('Synkronisér udbetalingerne igen, så Shopify-afregningen bliver hentet.');
 let breakdown:ReturnType<typeof payoutBreakdown>;try{breakdown=payoutBreakdown(payout.summary as PayoutSummary,payout.net);}catch(error){return rejectTransfer(error instanceof Error?error.message:'Shopify-afregningen kunne ikke afstemmes.');}
 if(breakdown.net!==row.amount_minor||breakdown.currency!==row.currency)rejectTransfer('Den gemte udbetaling stemmer ikke med Shopify-afregningen.');
 const settings=validateSettings(JSON.parse(settingsRow.setting_value)),bank=number(settings.accounts.bank),shopify=number(settings.accounts.shopifyPaymentsClearing),distribution=number(settings.accounts.clearing),fees=number(settings.accounts.fees);
 if(new Set([bank,shopify,distribution,fees]).size!==4)rejectTransfer('Bank-, Shopify-, fordelings- og gebyrkonto skal være forskellige.');
 const chart=await readDineroAccounts(credentials);for(const n of [bank,shopify,distribution,fees]){const a=chart.find(x=>Number(x.number)===n&&!x.hidden);if(!a||a.vatCode)rejectTransfer(`Konto ${n} skal være aktiv og uden moms i Dinero.`);}
 const payoutId=id.split('/').pop()!,marker=test?`TESTKLADDE - MÅ IKKE BOGFØRES · Shopify Payments ${payoutId}`:`Shopify Payments udbetaling ${payoutId}`;
 const movements=[
  {label:'Betalinger',amount:breakdown.charges,account:shopify,balancing:distribution},
  {label:'Refunderinger',amount:breakdown.refunds,account:shopify,balancing:distribution},
  {label:'Shopify-gebyrer',amount:breakdown.fees,account:fees,balancing:shopify},
  {label:'Udbetaling til bank',amount:breakdown.net,account:bank,balancing:shopify},
 ].filter(item=>item.amount!==0);
 const voucher:Voucher={VoucherDate:String(payout.issuedAt).slice(0,10),ExternalReference:`sablen:${test?'test-':''}payout:${payoutId}`,Lines:movements.map(item=>({Description:`${marker} · ${item.label}`,AccountNumber:item.account,BalancingAccountNumber:item.balancing,Amount:item.amount/100,AccountVatCode:'none',BalancingAccountVatCode:'none'}))};
 return {payoutId,amount:row.amount_minor,currency:row.currency,reportKey:report.key,reportEtag:report.etag,reportFilename:report.filename,attach:settings.automation.attachments,voucher,expected:movements.map(item=>({net:item.amount,tax:0,gross:item.amount}))};
}
export async function runPayoutTransfer(body:{externalId:string;action:string;version?:string;ack?:boolean},actor:string){
 let current=await read(body.externalId);const allowed=runtime().DINERO_PAYOUT_TEST_ID===body.externalId;
 if(body.action==='status')return{state:current?.state??null,testAllowed:allowed};if(!allowed)rejectTransfer('Denne udbetaling er ikke åbnet til test.');
 const credentials=await loadCredentials('dinero',true);if(!credentials?.organizationId)throw new TransferError('Forbind Dinero først.');
 if(body.action==='prepare'){if(current?.state.phase==='draft'||current?.state.phase==='creating'||current?.state.phase==='uncertain')return{state:current.state,testAllowed:allowed};const snapshot=await payoutProposal(body.externalId,credentials);current=await save(body.externalId,current,{phase:'prepared',externalId:body.externalId,organizationId:credentials.organizationId,snapshot});return{state:current.state,testAllowed:allowed};}
 if(body.action!=='create'||!current||current.state.phase!=='prepared'||body.version!==current.state.version||body.ack!==true)throw new TransferError('Hent og godkend det aktuelle testforslag først.');
 const fresh=await payoutProposal(body.externalId,credentials);if(JSON.stringify(fresh)!==JSON.stringify(current.state.snapshot))rejectTransfer('Udbetalingen eller kontoopsætningen er ændret. Forbered testen igen.');
 current=await save(body.externalId,current,{...current.state,phase:'creating'});
 try{const client=await dineroClient(credentials);if(fresh.attach){const object=await (env as unknown as {INVOICES:R2Bucket}).INVOICES.get(fresh.reportKey);if(!object||object.etag!==fresh.reportEtag)rejectTransfer('Udbetalingsrapporten blev ændret under overførslen.');const form=new FormData();form.append('file',new Blob([await object!.arrayBuffer()],{type:'application/pdf'}),fresh.reportFilename);const uploaded=await client('files','POST',form) as {FileGuid?:string};if(!uploaded?.FileGuid||!/^[-\w]{10,128}$/.test(uploaded.FileGuid))rejectTransfer('Dinero returnerede ikke et sikkert fil-ID.');fresh.voucher.FileGuid=uploaded.FileGuid;current=await save(body.externalId,current,{...current.state,snapshot:fresh});}const raw=await client('vouchers/manuel','POST',fresh.voucher) as {Guid?:string};if(raw.Guid&&/^[\da-f]{8}(-[\da-f]{4}){3}-[\da-f]{12}$/i.test(raw.Guid))current=await save(body.externalId,current,{...current.state,guid:raw.Guid});const remote=verifyVoucher(raw,fresh.voucher,fresh.expected);if(remote.Status!=='Draft')rejectTransfer('Testbilaget havde uventet status.');current=await save(body.externalId,current,{...current.state,phase:'draft'});}
 catch(error){const message=error instanceof TransferError?error.message:'Testoverførslen blev afbrudt. Kontrollér Dinero før nyt forsøg.';try{await save(body.externalId,current,{...current.state,phase:'uncertain',message});}catch{}await recordFailure('Dinero · udbetalingstest');throw new TransferError(message);}
 return{state:current.state,testAllowed:allowed};
}
