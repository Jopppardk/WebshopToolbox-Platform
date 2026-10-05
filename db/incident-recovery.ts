// Resolve only from a persisted, confirmed booking in the specified ledger.
// History remains stored; neither drafts nor successful unrelated jobs qualify.
export async function recoverConfirmedBookings(db:D1Database,organizationId:string){
 if(!organizationId)return;
 await db.prepare(`UPDATE system_errors SET resolved_at=CURRENT_TIMESTAMP,
 details_json=json_set(details_json,'$.resolution','automatic','$.resolutionMessage','Bogføring bekræftet i Dinero. Ingen handling nødvendig.')
 WHERE tenant='sablen.dk' AND resolved_at IS NULL AND json_valid(details_json)
 AND json_extract(details_json,'$.category')='dinero'
 AND (json_extract(details_json,'$.organizationId')=? OR (json_extract(details_json,'$.organizationId') IS NULL AND source='Dinero · Flatpay-udbetaling'))
 AND EXISTS(SELECT 1 FROM app_settings s WHERE s.tenant=system_errors.tenant
 AND s.setting_key IN ('flatpay_draft:'||?||':'||json_extract(system_errors.details_json,'$.reference'),
 'payout_production:'||json_extract(system_errors.details_json,'$.reference'),
 'refund_production:'||json_extract(system_errors.details_json,'$.reference'),
 'sales_transfer:'||json_extract(system_errors.details_json,'$.reference'))
 AND json_extract(s.setting_value,'$.phase')='booked'
 AND json_extract(s.setting_value,'$.organizationId')=?
 AND length(json_extract(s.setting_value,'$.guid'))>0)`).bind(organizationId,organizationId,organizationId).run();
}
