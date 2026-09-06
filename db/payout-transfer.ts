import { database } from './database';
import { readDineroAccounts } from './dinero-accounts';
import { validateSettings } from '@/lib/admin-settings';
import { rejectTransfer, TransferError, type Voucher, type Expected } from '@/lib/dinero-sale';
import { payoutBreakdown, type PayoutSummary } from '@/lib/shopify-payout';
import { ensurePayoutReport } from '@/lib/payout-report';

const tenant='sablen.dk';
const number=(value:string)=>{const n=Number(value.match(/^\d+/)?.[0]);if(!Number.isSafeInteger(n)||n<=0)rejectTransfer('Vælg gyldige udbetalingskonti under Administration.');return n;};
export async function payoutProposal(id:string,credentials:Record<string,string>,test=false){
 const report=await ensurePayoutReport(database(),id);
 const row=await database().prepare("SELECT payload_json,amount_minor,currency FROM integration_records WHERE tenant=? AND record_type='payout' AND external_id=?").bind(tenant,id).first<{payload_json:string;amount_minor:number;currency:string}>();
 if(!row)throw new TransferError('Udbetalingen findes ikke.');const payout=JSON.parse(row.payload_json);
 if(payout.provider!=='shopify_payments'||payout.status!=='PAID'||payout.transactionType!=='DEPOSIT'||row.currency!=='DKK'||!Number.isSafeInteger(row.amount_minor)||row.amount_minor<=0)rejectTransfer('Kun en gennemført Shopify Payments-udbetaling i DKK kan bogføres.');
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
