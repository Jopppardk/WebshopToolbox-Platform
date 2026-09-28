import {handleProductionBooking,type BookingContext,type PreparedBooking} from './production-booking';
import {bookingDate} from './production-policy';
import {shopAccess,orderQuery} from './invoice-source';
import {readDineroAccounts} from './dinero-read';
import {payoutBreakdown,payoutSummaryFields} from './payout-calculations';
import {fetchPayoutTransactions} from './payout-source';
import {buildPayoutReport} from './payout-pdf';
import {minorUnits} from './money';
import {refundVoucher,type RefundPart} from '../lib/refund-voucher';
import {flatpayDraft} from '../lib/flatpay-draft';
import {flatpayRead} from './flatpay-read';
import {buildFlatpayReport,checkFlatpayReport} from './flatpay-report';
import {unseal} from './connections';
import {HttpError,type Actor,type PlatformEnv} from './types';
const fail=(message:string):never=>{throw new HttpError(409,message);};
const num=(value:unknown)=>{const n=Number(String(value||'').match(/^\d+/)?.[0]);if(!Number.isSafeInteger(n)||n<=0)fail('Vaelg gyldige konti i kontoplanen.');return n;};
async function chartFor(ctx:BookingContext,accounts:number[]){
 const chart=await readDineroAccounts(ctx.credentials);
 if(new Set(accounts).size!==accounts.length||accounts.some(n=>!chart.some(a=>Number(a.number)===n&&!a.hidden&&!a.vatCode)))fail('Kontiene skal vaere forskellige, aktive og uden moms i Dinero.');
 return chart;
}
async function reportFile(ctx:BookingContext,source:unknown,bytes:()=>Promise<Uint8Array>){
 const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(source)))),x=>x.toString(16).padStart(2,'0')).join('');
 const key=`companies/${ctx.company}/webshops/${ctx.shop}/production-reports/${digest}.pdf`;
 let file=await ctx.env.PLATFORM_DOCUMENTS.get(key);
 if(!file){await ctx.env.PLATFORM_DOCUMENTS.put(key,await bytes(),{httpMetadata:{contentType:'application/pdf'}});file=await ctx.env.PLATFORM_DOCUMENTS.get(key);}
 if(!file||file.size>6000000)fail('Bilagsrapporten kunne ikke gemmes og kontrolleres.');
 return {file:file!,pdfKey:key,pdfEtag:file!.etag};
}
async function payout(ctx:BookingContext):Promise<PreparedBooking>{
 const {env,company,shop,id}=ctx,access=await shopAccess(env,company,shop);
 const result=await orderQuery<{node:any}>(access,`query ToolboxProductionPayout($id:ID!){node(id:$id){... on ShopifyPaymentsPayout{id issuedAt status transactionType net{amount currencyCode} summary{${payoutSummaryFields.map(f=>f+'{amount currencyCode}').join(' ')}}}}}`,{id});
 const p=result.node;if(p?.id!==id||p.status!=='PAID'||p.transactionType!=='DEPOSIT'||p.net?.currencyCode!=='DKK')fail('Kun gennemfoerte Shopify Payments-udbetalinger i DKK kan bogfoeres.');
 const date=await bookingDate(env,company,shop,'shopify',p.issuedAt),b=payoutBreakdown(p.summary,p.net);
 if(b.net<=0)fail('Udbetalingen skal vaere positiv.');
 const a=JSON.parse(ctx.mapping.accounts_json),prefs=JSON.parse(ctx.prefs.preferences_json).automation;
 const bank=num(a.bank),clearing=num(a.clearing),gateway=num(a.shopifyPaymentsClearing),fees=num(a.fees);await chartFor(ctx,[bank,clearing,gateway,fees]);
 const movements=[{label:'Betalinger',amount:b.charges,account:gateway,balancing:clearing},{label:'Refunderinger',amount:b.refunds,account:gateway,balancing:clearing},{label:'Gebyrer',amount:b.fees,account:fees,balancing:gateway},{label:'Udbetaling',amount:b.net,account:bank,balancing:gateway}].filter(x=>x.amount);
 const voucher={VoucherDate:date,ExternalReference:`wtb:${shop}:payout:${id.split('/').pop()}`,Lines:movements.map(x=>({Description:`Shopify ${id.split('/').pop()} - ${x.label}`,AccountNumber:x.account,BalancingAccountNumber:x.balancing,Amount:x.amount/100,AccountVatCode:'none',BalancingAccountVatCode:'none'}))};
 const source={...p,provider:'shopify_payments',transactions:await fetchPayoutTransactions(id,'DKK',b.net,access)};
 const companyRow=await env.PLATFORM_DB.prepare('SELECT name FROM companies WHERE id=?').bind(company).first<{name:string}>();
 const report=await reportFile(ctx,source,()=>buildPayoutReport(source,companyRow!.name));
 return {file:prefs.attachments?report.file:undefined,snapshot:{voucher,expected:movements.map(x=>({net:x.amount,tax:0,gross:x.amount})),source,pdfKey:report.pdfKey,pdfEtag:report.pdfEtag,book:prefs.payoutsBookDinero===true,attach:prefs.attachments===true}};
}
async function refund(ctx:BookingContext):Promise<PreparedBooking>{
 const {env,company,shop,id}=ctx,access=await shopAccess(env,company,shop);
 const result=await orderQuery<{node:any}>(access,'query ToolboxProductionRefund($id:ID!){node(id:$id){... on ShopifyPaymentsBalanceTransaction{id type test transactionDate amount{amount currencyCode} associatedOrder{id name} sourceOrderTransactionId}}}',{id});
 const item=result.node;if(item?.id!==id||item.type!=='REFUND'||item.test||item.amount?.currencyCode!=='DKK'||!item.associatedOrder?.id||!item.sourceOrderTransactionId)fail('Refunderingen mangler sikre Shopify-kontroldata.');
 const gross=-minorUnits(item.amount.amount,'DKK');if(gross<=0)fail('Ugyldigt refunderingsbeloeb.');
 const sourceId=String(item.sourceOrderTransactionId);if(!/^\d{1,30}$/.test(sourceId)||(typeof item.sourceOrderTransactionId==='number'&&!Number.isSafeInteger(item.sourceOrderTransactionId)))fail('Ugyldigt kilde-ID paa refunderingen.');
 const transactionId='gid://shopify/OrderTransaction/'+sourceId;
 const details=await orderQuery<{order:any}>(access,`query ToolboxRefundDetails($id:ID!){order(id:$id){refunds{id processedAt refundLineItems(first:100){nodes{subtotalSet{shopMoney{amount currencyCode}} totalTaxSet{shopMoney{amount currencyCode}}} pageInfo{hasNextPage}} refundShippingLines(first:100){nodes{subtotalAmountSet{shopMoney{amount currencyCode}} taxAmountSet{shopMoney{amount currencyCode}}} pageInfo{hasNextPage}} orderAdjustments(first:100){nodes{amountSet{shopMoney{amount currencyCode}} taxAmountSet{shopMoney{amount currencyCode}}} pageInfo{hasNextPage}} transactions(first:100){nodes{id kind status test amountSet{shopMoney{amount currencyCode}}} pageInfo{hasNextPage}}}}}`,{id:item.associatedOrder.id});
 const matches=(details.order?.refunds||[]).filter((r:any)=>r.transactions?.nodes?.some((t:any)=>t.id===transactionId&&t.kind==='REFUND'&&t.status==='SUCCESS'&&!t.test));
 if(matches.length!==1)fail('Refunderingen kan ikke knyttes entydigt til ordren.');const r=matches[0];
 for(const field of ['refundLineItems','refundShippingLines','orderAdjustments','transactions'])if(!Array.isArray(r[field]?.nodes)||r[field].pageInfo?.hasNextPage!==false)fail('Refunderingen er ufuldstaendig.');
 const transaction=r.transactions.nodes.find((t:any)=>t.id===transactionId);
 if(transaction.amountSet?.shopMoney?.currencyCode!=='DKK'||Math.abs(minorUnits(transaction.amountSet.shopMoney.amount,'DKK'))!==gross)fail('Transaktionen stemmer ikke med refunderingen.');
 const parts:RefundPart[]=[];
 const add=(kind:RefundPart['kind'],net:any,tax:any)=>{if(net?.currencyCode!=='DKK'||tax?.currencyCode!=='DKK')fail('Uventet valuta.');const n=Math.abs(minorUnits(net.amount,'DKK')),t=Math.abs(minorUnits(tax.amount,'DKK'));if(n||t)parts.push({kind,net:n,tax:t,description:kind});};
 r.refundLineItems.nodes.forEach((x:any)=>add('goods',x.subtotalSet.shopMoney,x.totalTaxSet.shopMoney));r.refundShippingLines.nodes.forEach((x:any)=>add('shipping',x.subtotalAmountSet.shopMoney,x.taxAmountSet.shopMoney));r.orderAdjustments.nodes.forEach((x:any)=>add('services',x.amountSet.shopMoney,x.taxAmountSet.shopMoney));
 const date=await bookingDate(env,company,shop,'shopify',r.processedAt),mapping=JSON.parse(ctx.mapping.accounts_json);
 mapping.vatCode=String(mapping.vatCode||'').split(' ')[0];mapping.noVatCode=String(mapping.noVatCode||'').split(' ')[0].toLowerCase();
 if(parts.some(p=>p.tax>0)&&mapping.vatCode!=='U25'||parts.some(p=>p.tax===0)&&mapping.noVatCode!=='none')fail('Vaelg U25 og eksplicit ingen moms til refunderingerne.');
 const proposal=refundVoucher({transactionId:id,orderName:item.associatedOrder.name,date,gross,parts},mapping);
 const chart=await readDineroAccounts(ctx.credentials);
 for(const line of proposal.voucher.Lines){const account=chart.find(a=>Number(a.number)===line.AccountNumber&&!a.hidden);if(!account||(account.vatCode||'none').toLowerCase()!==line.AccountVatCode.toLowerCase())fail('Refunderingskonto eller momskode stemmer ikke med Dinero.');}
 proposal.voucher.ExternalReference=`wtb:${shop}:refund:${id.split('/').pop()}`;
 return {snapshot:{voucher:proposal.voucher,expected:proposal.expected,source:{item,refund:r},book:JSON.parse(ctx.prefs.preferences_json).automation.refundsBookDinero===true}};
}
async function flatpay(ctx:BookingContext):Promise<PreparedBooking>{
 const {env,company,shop,id}=ctx,saved=JSON.parse(ctx.sourceRow.payload_json);
 const connection=await env.PLATFORM_DB.prepare("SELECT * FROM payment_connections WHERE company_id=? AND webshop_id=? AND provider='flatpay'").bind(company,shop).first<any>();if(!connection)fail('Forbind Flatpay foerst.');
 const metadata=JSON.parse(connection.metadata_json),access=await unseal(env,[company,shop,'flatpay',connection.identity],connection.credentials_encrypted);
 if(!/^\d{1,30}$/.test(saved.settlements||''))fail('Udbetalingen skal indeholde praecis en afregning.');
 const payments=await flatpayRead({username:access.username,password:access.password},'payments',{SettlementNumber:saved.settlements});
 const matches=payments.filter(p=>p.paymentID===id&&p.merchantID===metadata.merchantID&&p.agreementNumber===metadata.agreementNumber);
 if(matches.length!==1)fail('Udbetalingen tilhoerer ikke den gemte Flatpay-aftale.');const p=matches[0];
 const date=await bookingDate(env,company,shop,'flatpay',String(p.paidDate));
 if(date<connection.start_date||p.settlements!==saved.settlements)fail('Udbetalingen er aendret. Hent den igen.');
 const settlements=(await flatpayRead({username:access.username,password:access.password},'settlements',{SettlementNumber:saved.settlements,AgreementNumber:metadata.agreementNumber})).filter(s=>s.settlementNumber===saved.settlements&&s.merchantID===metadata.merchantID&&(s.agreementNumber===metadata.agreementNumber||s.agreementID===metadata.agreementId)&&(s.agreementNumber==null||s.agreementNumber===metadata.agreementNumber)&&(s.agreementID==null||s.agreementID===metadata.agreementId));
 if(settlements.length!==1)fail('Afregningen kan ikke afstemmes entydigt.');
 const raw=settlements[0],settlement={...Object.fromEntries(Object.entries(raw).filter(([k,v])=>typeof v==='number'&&!['transactions','batches'].includes(k))),settlementNumber:saved.settlements,currency:raw.currency,transactions:String(raw.transactions),preArbitration:raw.preArbitration};
 const tx=(await flatpayRead({username:access.username,password:access.password},'transactions',{SettlementNumber:saved.settlements})).filter(t=>t.settlementNumber===saved.settlements&&t.merchantID===metadata.merchantID&&t.agreementID===metadata.agreementId).map(t=>Object.fromEntries(['transactionID','settlementNumber','purchaseDate','transactionCode','currency','grossAmount','fees','netAmount'].map(k=>[k,t[k]]))).sort((a,b)=>String(a.transactionID).localeCompare(String(b.transactionID)));
 const a=JSON.parse(ctx.mapping.accounts_json),accounts={bank:num(a.bank),fees:num(a.fees),clearing:num(a.clearing),flatpay:num(a.flatpayClearing)};await chartFor(ctx,Object.values(accounts));
 const proposal=flatpayDraft(p,settlement,accounts);proposal.voucher.VoucherDate=date;proposal.voucher.ExternalReference=`wtb:${shop}:flatpay:${id}`;
 const source={payment:{paymentID:String(p.paymentID),paidDate:String(p.paidDate),currency:String(p.currency),payoutAmount:Number(p.payoutAmount),settlements:String(p.settlements)},settlements:[settlement],transactions:tx};checkFlatpayReport(source);
 const companyRow=await env.PLATFORM_DB.prepare('SELECT name FROM companies WHERE id=?').bind(company).first<{name:string}>();
 const report=await reportFile(ctx,source,()=>buildFlatpayReport(source,undefined,companyRow!.name));
 return {file:report.file,snapshot:{voucher:proposal.voucher,expected:proposal.expected,source,pdfKey:report.pdfKey,pdfEtag:report.pdfEtag,paymentRevision:connection.revision,book:JSON.parse(ctx.prefs.preferences_json).automation.payoutsBookDinero===true}};
}
export function handleProductionOther(request:Request,env:PlatformEnv,actor:Actor,company:string,shop:string,kind:string){
 if(kind==='payout')return handleProductionBooking(request,env,actor,company,shop,kind,'payouts','shopify',/^gid:\/\/shopify\/ShopifyPaymentsPayout\/\d{1,30}$/,payout);
 if(kind==='refund')return handleProductionBooking(request,env,actor,company,shop,kind,'refunds','shopify',/^gid:\/\/shopify\/ShopifyPaymentsBalanceTransaction\/\d{1,30}$/,refund);
 if(kind==='flatpay')return handleProductionBooking(request,env,actor,company,shop,kind,'payments','flatpay',/^\d{1,30}$/,flatpay);
 throw new HttpError(400,'Ukendt bogfoeringstype.');
}
