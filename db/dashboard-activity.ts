import { danishDate,midnight } from '@/lib/history-policy';

export async function dashboardActivity(db:D1Database,now=new Date()) {
  const today=danishDate(now);
  const tomorrow=new Date(Date.parse(today+'T00:00:00Z')+86400000).toISOString().slice(0,10);
  const from=midnight(today),until=midnight(tomorrow);
  const [rows,updates,packaging]=await Promise.all([
    db.prepare(`SELECT r.record_type,
      COUNT(*) total,
      SUM(CASE WHEN r.booking_status='booked' OR json_extract(t.setting_value,'$.phase') IN ('booked','draft') THEN 1 ELSE 0 END) synced,
      SUM(CASE WHEN r.booking_status!='booked' AND COALESCE(json_extract(t.setting_value,'$.phase'),'') NOT IN ('booked','draft') AND (r.booking_status='failed' OR json_extract(t.setting_value,'$.phase') IN ('failed','uncertain')) THEN 1 ELSE 0 END) failed
      FROM integration_records r LEFT JOIN app_settings t ON t.tenant=r.tenant AND t.setting_key=(CASE WHEN r.record_type='order' THEN 'sales_transfer:' ELSE 'payout_production:' END)||r.external_id
      WHERE r.tenant='sablen.dk' AND r.record_type IN ('order','payout') AND r.occurred_at>=? AND r.occurred_at<?
      GROUP BY r.record_type`).bind(from,until).all<{record_type:string;total:number;synced:number;failed:number}>(),
    db.prepare("SELECT job_key,MAX(finished_at) updated FROM job_runs WHERE tenant='sablen.dk' AND status='succeeded' AND job_key IN ('shopify-orders','shopify-refunds') GROUP BY job_key").all<{job_key:string;updated:string}>(),
    db.prepare("SELECT setting_value FROM app_settings WHERE tenant='sablen.dk' AND setting_key='packaging:last-sync'").first<{setting_value:string}>(),
  ]);
  const count=(kind:string)=>{const row=rows.results.find(r=>r.record_type===kind);return {total:row?.total || 0,synced:row?.synced || 0,failed:row?.failed || 0};};
  return {today,orders:count('order'),payouts:count('payout'),updated:{sales:updates.results.find(r=>r.job_key==='shopify-orders')?.updated || null,refunds:updates.results.find(r=>r.job_key==='shopify-refunds')?.updated || null,packaging:packaging?JSON.parse(packaging.setting_value) as string:null}};
}
