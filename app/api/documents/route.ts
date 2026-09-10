import { NextRequest, NextResponse } from 'next/server';
import { env } from 'cloudflare:workers';
import { prepareDatabase } from '@/db/database';
import { recordFailure } from '@/db/errors';
import { loadHistory } from '@/db/history';
import {loadCredentials} from '@/db/credentials';
import {ensureFlatpayReport} from '@/db/flatpay-report';
import { historyWindow } from '@/lib/history-policy';

const reply = (value: unknown, status = 200) => NextResponse.json(value, { status, headers: { 'Cache-Control': 'no-store' } });
export async function GET(request: NextRequest) {
  try {
    const externalId = request.nextUrl.searchParams.get('externalId');
    const db = await prepareDatabase(), { cutoff } = historyWindow(await loadHistory(db));
    const flatpay=await loadCredentials('flatpay',true);
    const flatRows=flatpay?await db.prepare("SELECT p.setting_key,p.setting_value,r.setting_value report FROM app_settings p LEFT JOIN app_settings r ON r.tenant=p.tenant AND r.setting_key='flatpay_report:'||p.setting_key WHERE p.tenant='sablen.dk' AND p.setting_key LIKE 'flatpay:payout:%' AND json_extract(p.setting_value,'$.paidDate')>=? AND substr(json_extract(p.setting_value,'$.paidDate'),1,10)>=? AND json_extract(p.setting_value,'$.merchantID')=? AND json_extract(p.setting_value,'$.agreementID')=? AND (? IS NULL OR p.setting_key=?) ORDER BY json_extract(p.setting_value,'$.paidDate') DESC LIMIT 100").bind(cutoff,flatpay.startDate,flatpay.merchantID,flatpay.agreementId,externalId,externalId).all<{setting_key:string;setting_value:string;report:string|null}>():{results:[]};
    const flatDocuments=flatRows.results.map(r=>{const p=JSON.parse(r.setting_value),report=r.report?JSON.parse(r.report):null;const ready=report&&['paymentID','paidDate','currency','payoutAmount','settlements'].every(k=>report.payment?.[k]===p[k]);return {externalId:r.setting_key,date:p.paidDate,provider:'flatpay',amount:{amount:String(p.payoutAmount),currencyCode:p.currency},filename:`Flatpay-${p.paymentID}.pdf`,ready:!!ready,report:ready?report:null};});
    if(externalId?.startsWith('flatpay:payout:')){
      const document=flatDocuments.find(d=>d.externalId===externalId);if(!document?.report)return reply({error:'Dan rapporten fra dokumentoversigten først.'},404);
      if(!/^payout-reports\/flatpay\/[a-f0-9]{64}\.pdf$/.test(document.report.key))return reply({error:'Ugyldigt dokument.'},400);
      const object=await (env as unknown as {INVOICES:R2Bucket}).INVOICES.get(document.report.key);
      if(!object||object.etag!==document.report.etag)return reply({error:'Rapporten mangler eller er ændret. Dan den igen.'},404);
      return new NextResponse(object.body,{headers:{'Content-Type':'application/pdf','Content-Disposition':`inline; filename="${document.filename}"`,'Cache-Control':'private, no-store'}});
    }
    if (externalId) {
      if (!/^gid:\/\/shopify\/ShopifyPaymentsPayout\/\d+$/.test(externalId)) return reply({ error: 'Ugyldigt dokument-ID.' }, 400);
      const row = await db.prepare("SELECT payload_json FROM integration_records WHERE tenant='sablen.dk' AND record_type='payout' AND external_id=? AND occurred_at>=?").bind(externalId, cutoff).first<{ payload_json: string }>();
      const saved = row ? JSON.parse(row.payload_json) as { reportKey?: string } : null;
      if (!saved?.reportKey) return reply({ error: 'Udbetalingsrapporten findes ikke.' }, 404);
      const object = await (env as unknown as { INVOICES: R2Bucket }).INVOICES.get(saved.reportKey);
      if (!object) return reply({ error: 'Udbetalingsrapportens PDF mangler.' }, 404);
      return new NextResponse(object.body, { headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename="${externalId.split('/').pop()}.pdf"`, 'Cache-Control': 'private, no-store' } });
    }
    const rows = await db.prepare("SELECT external_id, occurred_at, payload_json FROM integration_records WHERE tenant='sablen.dk' AND record_type='payout' AND occurred_at>=? AND json_extract(payload_json,'$.reportKey') IS NOT NULL ORDER BY occurred_at DESC LIMIT 100").bind(cutoff).all<{ external_id: string; occurred_at: string; payload_json: string }>();
    const shopDocuments=rows.results.map(row => { const value = JSON.parse(row.payload_json); return { externalId: row.external_id, date: row.occurred_at, provider: value.provider, amount: value.net, filename: `${row.external_id.split('/').pop()}.pdf`,ready:true }; });
    return reply({documents:[...shopDocuments,...flatDocuments.map(({report: _report,...d})=>d)].sort((a,b)=>Date.parse(b.date)-Date.parse(a.date)||a.externalId.localeCompare(b.externalId)).slice(0,100)});
  } catch { await recordFailure('Udbetalingsrapporter'); return reply({ error: 'Dokumenterne kunne ikke indlæses.' }, 503); }
}


export async function POST(request:Request){
 if(request.headers.get('origin')!==new URL(request.url).origin||!request.headers.get('content-type')?.startsWith('application/json'))return reply({error:'Start handlingen fra Toolbox.'},403);
 try{const b=await request.json() as {externalId:string};if(typeof b.externalId!=='string'||b.externalId.length>300||!b.externalId.startsWith('flatpay:payout:'))return reply({error:'Ugyldigt dokument-ID.'},400);await ensureFlatpayReport(await prepareDatabase(),b.externalId);return reply({message:'Udbetalingsrapporten er klar.'});}catch(e){return reply({error:e instanceof Error?e.message:'Rapporten kunne ikke dannes.'},422);}
}
