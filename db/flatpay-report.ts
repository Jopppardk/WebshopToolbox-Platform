import {env} from 'cloudflare:workers';
import {loadHistory} from './history';
import {historyWindow} from '@/lib/history-policy';
import {loadCredentials} from './credentials';
import {flatpayRead} from '@/lib/flatpay-api';
import {buildFlatpayReport,checkFlatpayReport,type FlatpayReportSource} from '@/lib/flatpay-report';
export const flatpayReportStateKey=(id:string)=>'flatpay_report:'+id;
export async function ensureFlatpayReport(db:D1Database,id:string){
 const c=await loadCredentials('flatpay',true);if(!c)throw Error('Forbind Flatpay først.');
 const row=await db.prepare("SELECT setting_value FROM app_settings WHERE tenant='sablen.dk' AND setting_key=?").bind(id).first<{setting_value:string}>();
 if(!row||!id.startsWith(`flatpay:payout:${c.merchantID}:${c.agreementId}:`))throw Error('Udbetalingen tilhører ikke den valgte Flatpay-aftale.');
 const saved=JSON.parse(row.setting_value) as FlatpayReportSource['payment']&{merchantID:string;agreementID:string};
 if(saved.merchantID!==c.merchantID||saved.agreementID!==c.agreementId||typeof saved.paidDate!=='string'||saved.paidDate.slice(0,10)<c.startDate||typeof saved.settlements!=='string')throw Error('Rapporten kræver en gennemført udbetaling fra integrationens startdato.');
 if(new Date(saved.paidDate).toISOString()<historyWindow(await loadHistory(db)).cutoff)throw Error('Udbetalingen ligger før den valgte historik.');
 const ids=saved.settlements.split(/[,;\s]+/).filter(Boolean);if(!ids.length||ids.length>30||ids.some(n=>!/^\d{1,30}$/.test(n))||new Set(ids).size!==ids.length)throw Error('Udbetalingens afregningsnumre kunne ikke læses sikkert.');
 const access={username:c.username,password:c.password};
 const payments=await flatpayRead(access,'payments',{SettlementNumber:ids[0]});const matches=payments.filter(p=>p.paymentID===saved.paymentID&&p.merchantID===c.merchantID&&p.agreementNumber===c.agreementNumber);
 if(matches.length!==1||['paidDate','settlements','payoutAmount','currency'].some(k=>matches[0][k]!==saved[k as keyof typeof saved]))throw Error('Udbetalingen er ændret hos Flatpay. Hent udbetalingerne igen.');
 const payment={paymentID:saved.paymentID,paidDate:saved.paidDate,currency:saved.currency,payoutAmount:saved.payoutAmount,settlements:saved.settlements};
 const settlements:Record<string,unknown>[]=[],transactions:Record<string,unknown>[]=[];
 for(const number of ids){
  const list=await flatpayRead(access,'settlements',{SettlementNumber:number,AgreementNumber:c.agreementNumber});
  const scoped=list.filter(s=>s.settlementNumber===number&&s.merchantID===c.merchantID&&(s.agreementNumber===c.agreementNumber||s.agreementID===c.agreementId)&&(s.agreementNumber==null||s.agreementNumber===c.agreementNumber)&&(s.agreementID==null||s.agreementID===c.agreementId));
  if(scoped.length!==1)throw Error('Afregningen kunne ikke knyttes entydigt til Flatpay-aftalen.');
  const raw=scoped[0];settlements.push({...Object.fromEntries(Object.entries(raw).filter(([k,v])=>typeof v==='number'&&!['transactions','batches'].includes(k))),settlementNumber:number,currency:raw.currency,transactions:String(raw.transactions),preArbitration:raw.preArbitration});
  const tx=await flatpayRead(access,'transactions',{SettlementNumber:number});
  for(const t of tx.filter(t=>t.settlementNumber===number&&t.merchantID===c.merchantID&&t.agreementID===c.agreementId))transactions.push(Object.fromEntries(['transactionID','settlementNumber','purchaseDate','transactionCode','currency','grossAmount','fees','netAmount'].map(k=>[k,t[k]])));
 }
 settlements.sort((a,b)=>String(a.settlementNumber).localeCompare(String(b.settlementNumber)));transactions.sort((a,b)=>String(a.transactionID).localeCompare(String(b.transactionID)));
 const source={payment,settlements,transactions};checkFlatpayReport(source);
 const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify({version:1,source}))))).map(b=>b.toString(16).padStart(2,'0')).join('');
 const key=`payout-reports/flatpay/${hash}.pdf`,filename=`Flatpay-${payment.paymentID}.pdf`,runtime=env as unknown as {INVOICES:R2Bucket;ASSETS:Fetcher};
 let object=await runtime.INVOICES.head(key);
 if(!object){const logo=await runtime.ASSETS.fetch(new Request('https://assets.local/sablen-logo.png'));if(!logo.ok)throw Error('Logoet til udbetalingsrapporten kunne ikke hentes.');const bytes=await buildFlatpayReport(source,await logo.arrayBuffer());await runtime.INVOICES.put(key,bytes,{httpMetadata:{contentType:'application/pdf',contentDisposition:`inline; filename="${filename}"`}});object=await runtime.INVOICES.head(key);}
 if(!object)throw Error('Udbetalingsrapporten kunne ikke kontrolleres efter lagring.');
 const report={key,etag:object.etag,filename,fingerprint:hash};
 // Only point the archive at this version if the cached payout has not changed.
 const result=await db.prepare("INSERT INTO app_settings(tenant,setting_key,setting_value) SELECT 'sablen.dk',?,? WHERE EXISTS(SELECT 1 FROM app_settings WHERE tenant='sablen.dk' AND setting_key=? AND setting_value=?) ON CONFLICT(tenant,setting_key) DO UPDATE SET setting_value=excluded.setting_value,updated_at=CURRENT_TIMESTAMP").bind(flatpayReportStateKey(id),JSON.stringify({...report,payment,merchantID:c.merchantID,agreementID:c.agreementId}),id,row.setting_value).run();
 if(result.meta.changes!==1)throw Error('Udbetalingen blev ændret under rapportgenereringen. Prøv igen.');
 return {report,source};
}
