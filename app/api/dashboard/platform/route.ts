import { NextResponse } from 'next/server';
import { prepareDatabase } from '@/db/database';
import { integrationHealth, successRate, type RecentJob } from '@/lib/dashboard-platform';
import { normalizeSyncInterval } from '@/lib/sync-schedule';
export async function GET() {
  try {
    const db=await prepareDatabase(),now=Date.now(),since=new Date(now-86400000).toISOString();
    const [credentials,via,settings,counts,jobs]=await Promise.all([
      db.prepare("SELECT provider,display_name,verified_at FROM integration_credentials WHERE tenant='sablen.dk'").all<{provider:string;display_name:string;verified_at:string}>(),
      db.prepare("SELECT json_extract(setting_value,'$.displayName') name,json_extract(setting_value,'$.verifiedAt') checked FROM app_settings WHERE tenant='sablen.dk' AND setting_key='viabill_credentials'").first<{name:string;checked:string}>(),
      db.prepare("SELECT setting_value FROM app_settings WHERE tenant='sablen.dk' AND setting_key='admin_settings'").first<{setting_value:string}>(),
      db.prepare("SELECT status,COUNT(*) count FROM job_runs WHERE tenant='sablen.dk' AND started_at>=? AND started_at<=? GROUP BY status").bind(since,new Date(now).toISOString()).all<{status:string;count:number}>(),
      db.prepare("SELECT job_key,status,started_at,finished_at FROM (SELECT job_key,status,started_at,finished_at,ROW_NUMBER() OVER(PARTITION BY job_key ORDER BY started_at DESC,id DESC) position FROM job_runs WHERE tenant='sablen.dk' AND status!='skipped') WHERE position=1").all<RecentJob>(),
    ]);
    const interval=normalizeSyncInterval(JSON.parse(settings?.setting_value || '{}').syncIntervalMinutes);
    const summary=Object.fromEntries(counts.results.map(c=>[c.status,c.count]));
    const providers=[{key:'shopify',name:'Shopify'},{key:'dinero',name:'Dinero'},{key:'viabill',name:'ViaBill'}].map(p=>{
      const credential=credentials.results.find(c=>c.provider===p.key);
      const connected=p.key==='viabill'?Boolean(via):Boolean(credential);
      const latest=jobs.results.filter(j=>j.job_key.startsWith(p.key+'-'));
      return {...p,connected,health:connected?integrationHealth(latest,interval,now):'disconnected', checkedAt:latest.length?latest.map(j=>j.finished_at || j.started_at).sort().at(-1):null};
    });
    return NextResponse.json({providers,connected:providers.filter(p=>p.connected).length,failed:summary.failed || 0,succeeded:summary.succeeded || 0,skipped:summary.skipped || 0,running:summary.running || 0,successRate:successRate(summary.succeeded || 0,summary.failed || 0),since,checkedAt:new Date(now).toISOString()}, {headers:{'Cache-Control':'no-store'}});
  } catch { return NextResponse.json({error:'Platformstatus kunne ikke hentes.'},{status:503,headers:{'Cache-Control':'no-store'}}); }
}
