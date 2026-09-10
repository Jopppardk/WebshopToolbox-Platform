import {loadCredentials} from './credentials';
import {danishDate,midnight} from '@/lib/history-policy';
export async function flatpayActivity(db:D1Database,now=new Date()){
 const c=await loadCredentials('flatpay',true),dinero=await loadCredentials('dinero',true),today=danishDate(now);
 const empty={total:0,synced:0,failed:0,pending:0};if(!c)return empty;
 const tomorrow=new Date(Date.parse(today+'T00:00:00Z')+86400000).toISOString().slice(0,10);
 const result=await db.prepare("SELECT COUNT(*) total,COALESCE(SUM(CASE WHEN json_extract(s.setting_value,'$.phase') IN ('draft','booked') THEN 1 ELSE 0 END),0) synced,COALESCE(SUM(CASE WHEN json_extract(s.setting_value,'$.phase')='uncertain' THEN 1 ELSE 0 END),0) failed,COALESCE(SUM(CASE WHEN COALESCE(json_extract(s.setting_value,'$.phase'),'') NOT IN ('draft','booked','uncertain') THEN 1 ELSE 0 END),0) pending FROM app_settings p LEFT JOIN app_settings s ON s.tenant=p.tenant AND s.setting_key=?||p.setting_key WHERE p.tenant='sablen.dk' AND substr(p.setting_key,1,15)='flatpay:payout:' AND json_extract(p.setting_value,'$.merchantID')=? AND json_extract(p.setting_value,'$.agreementID')=? AND substr(COALESCE(json_extract(p.setting_value,'$.paidDate'),json_extract(p.setting_value,'$.scheduledDate')),1,10)>=? AND julianday(COALESCE(json_extract(p.setting_value,'$.paidDate'),json_extract(p.setting_value,'$.scheduledDate')))>=julianday(?) AND julianday(COALESCE(json_extract(p.setting_value,'$.paidDate'),json_extract(p.setting_value,'$.scheduledDate')))<julianday(?)").bind(`flatpay_draft:${dinero?.organizationId||''}:`,c.merchantID,c.agreementId,c.startDate,midnight(today),midnight(tomorrow)).first<typeof empty>();
 return result||empty;
}
