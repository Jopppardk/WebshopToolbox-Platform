import {sanitizeDiagnostic} from '@/lib/diagnostics';
const tenant='sablen.dk';
export function payoutEventStatement(db:D1Database,id:string,kind:string,data:Record<string,unknown>={},organizationId=''){
 return db.prepare('INSERT INTO payout_events(id,tenant,external_id,organization_id,kind,at,data_json) VALUES(?,?,?,?,?,?,?)').bind(crypto.randomUUID(),tenant,id,organizationId,kind,new Date().toISOString(),JSON.stringify(data));
}
// Import journal and source mutation run in one D1 batch. No triggers: D1's
// change counts are used by the booking compare-and-swap locks.
export function payoutImportStatements(db:D1Database,id:string,provider:string,payload:Record<string,unknown>,write:D1PreparedStatement){
 const flat=provider==='flatpay';
 const table=flat?'app_settings':'integration_records',field=flat?'setting_value':'payload_json';
 const where=flat?'tenant=? AND setting_key=?':"tenant=? AND record_type='payout' AND external_id=?";
 const status=provider==='shopify_payments'?String(payload.status):provider==='viabill'?(payload.reconciled===false?'Beløbsdifference':'Afregnet'):payload.paidDate?'Udbetalt':'Kommende';
 const oldStatus=provider==='shopify_payments'?`json_extract(${field},'$.status')`:provider==='viabill'?`CASE WHEN json_extract(${field},'$.reconciled')=0 THEN 'Beløbsdifference' ELSE 'Afregnet' END`:`CASE WHEN json_extract(${field},'$.paidDate') IS NOT NULL THEN 'Udbetalt' ELSE 'Kommende' END`;
 const guard=flat&&payload.paidDate==null?` AND json_extract(${field},'$.paidDate') IS NULL`:'';
 const at=new Date().toISOString();
 return [
 db.prepare(`INSERT INTO payout_events(id,tenant,external_id,kind,at,data_json) SELECT ?,?,?,'received',?,? WHERE NOT EXISTS(SELECT 1 FROM ${table} WHERE ${where}) AND NOT EXISTS(SELECT 1 FROM payout_events WHERE tenant=? AND external_id=? AND kind='received')`).bind(crypto.randomUUID(),tenant,id,at,JSON.stringify({status}),tenant,id,tenant,id),
 db.prepare(`INSERT INTO payout_events(id,tenant,external_id,kind,at,data_json) SELECT ?,?,?,'status',?,json_object('from',${oldStatus},'status',?) FROM ${table} WHERE ${where} AND ${oldStatus} IS NOT ?${guard}`).bind(crypto.randomUUID(),tenant,id,at,status,tenant,id,status),
 write];
}
type Receipt={phase:string;organizationId:string;guid?:string;message?:string;voucherNumber?:number;proposal?:{voucher:{FileGuid?:string}};snapshot?:{voucher:{FileGuid?:string}}};
export async function savePayoutReceipt(db:D1Database,write:D1PreparedStatement,key:string,id:string,previous:Receipt|null,next:Receipt,raw:string){
 const changes:Array<[string,Record<string,unknown>]> = [];
 if(previous?.phase!==next.phase)changes.push(['phase',{phase:next.phase,message:sanitizeDiagnostic(next.message),guid:next.guid,voucherNumber:next.voucherNumber}]);
 const file=(r:Receipt|null)=>r?.proposal?.voucher.FileGuid||r?.snapshot?.voucher.FileGuid;
 if(file(next)&&file(previous)!==file(next))changes.push(['attachment',{}]);
 const statements=changes.map(([kind,data])=>db.prepare(`INSERT INTO payout_events(id,tenant,external_id,organization_id,kind,at,data_json) SELECT ?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM app_settings WHERE tenant=? AND setting_key=? AND setting_value=?)`).bind(crypto.randomUUID(),tenant,id,next.organizationId,kind,new Date().toISOString(),JSON.stringify(data),tenant,key,raw));
 return (await db.batch([write,...statements]))[0];
}
export async function payoutAttemptFailed(db:D1Database,id:string,error:unknown,organizationId:string){
 await payoutEventStatement(db,id,'failed',{message:sanitizeDiagnostic(error instanceof Error?error.message:'Forsøget blev afbrudt.')},organizationId).run();
}
