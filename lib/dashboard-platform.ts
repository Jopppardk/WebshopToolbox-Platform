export type RecentJob = { job_key:string;status:string;started_at:string;finished_at:string|null };
export function integrationHealth(jobs:RecentJob[], interval:number, now=Date.now()) {
  const relevant=jobs.filter(j=>j.status!=='skipped');
  if (!relevant.length) return 'unknown';
  if (relevant.some(j=>j.status==='failed' || (j.status==='running' && now-Date.parse(j.started_at)>15*60000))) return 'attention';
  if (relevant.some(j=>j.status==='running')) return 'running';
  const newest=Math.max(...relevant.map(j=>Date.parse(j.finished_at || j.started_at)));
  return now-newest <= Math.max(interval*3,20)*60000 ? 'healthy' : 'stale';
}
export function successRate(succeeded:number,failed:number) {
  return succeeded+failed ? succeeded/(succeeded+failed)*100 : null;
}
