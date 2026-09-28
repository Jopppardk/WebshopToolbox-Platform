'use client';
import { tier1Fetch as fetch } from '@/platform/transport';
import { useEffect, useState } from 'react';
import { Bell } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
type Notice = {id:string;title:string;message:string;createdAt:string};
type Failure = {id:string;source:string;message:string;created_at:string;seen:boolean};
type Payload = {notifications:Notice[];incidents?:{warnings:number;alarms:number};errors?:Failure[];error?:string};
const sources:Record<string,string>={orders:'Salg',payments:'Betalinger',refunds:'Tilbagebetalinger',payouts:'Udbetalinger',inventory:'Lager',packaging:'Emballage'};
function sourceLabel(source:string){
  const parts=source.replace(/^auto\.(import\.)?/,'').split('.');
  const name=parts.map(p=>sources[p]||({flatpay:'Flatpay',viabill:'ViaBill',history:'historik',payment:'betalinger',payout:'udbetalinger',settlements:'afregninger',transactions:'transaktioner'} as Record<string,string>)[p]||p).join(' · ');
  return (source.startsWith('auto.')?'Automatisk: ':'')+name;
}
function when(value:string){const date=new Date(value.includes('T')?value:value.replace(' ','T')+'Z');return Number.isNaN(date.getTime())?value:new Intl.DateTimeFormat('da-DK',{dateStyle:'short',timeStyle:'short',timeZone:'Europe/Copenhagen'}).format(date);}
export function NotificationBell({onReporting}:{onReporting:()=>void}) {
  const [open,setOpen]=useState(false),[notices,setNotices]=useState<Notice[]>([]),[failures,setFailures]=useState<Failure[]>([]),[error,setError]=useState(''),[unseen,setUnseen]=useState(0),[loaded,setLoaded]=useState(false);
  const apply=(d:Payload)=>{setNotices(d.notifications);setUnseen((d.incidents?.warnings||0)+(d.incidents?.alarms||0));if(d.errors)setFailures(d.errors);setError('');setLoaded(true);};
  useEffect(()=>{
    const controller=new AbortController(); let running=false;
    const refresh=async()=>{if(running)return;running=true;try{const r=await fetch('/api/notifications',{cache:'no-store',signal:controller.signal});const d=await r.json() as Payload;if(!r.ok)throw Error(d.error);if(!controller.signal.aborted)apply(d);}catch{if(!controller.signal.aborted)setError('Beskeder kunne ikke hentes. Der forsøges igen automatisk.');}finally{running=false;}};
    void refresh();const timer=window.setInterval(()=>{if(!document.hidden)void refresh();},60000);
    return()=>{controller.abort();window.clearInterval(timer);};
  },[open]);
  // Showing the list counts as seeing it: the badge resets, while the failures stay listed as seen.
  useEffect(()=>{
    if(!open||!loaded)return;
    const ids=failures.filter(f=>!f.seen).map(f=>f.id);if(!ids.length)return;
    let cancelled=false;
    void (async()=>{try{const r=await fetch('/api/notifications',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'seen',ids})});const d=await r.json() as Payload;if(!r.ok)throw Error(d.error);if(!cancelled)setUnseen((d.incidents?.warnings||0)+(d.incidents?.alarms||0));}catch{if(!cancelled)setError('Fejlene kunne ikke markeres som set. Klokken nulstilles ved næste forsøg.');}})();
    return()=>{cancelled=true;};
  },[open,loaded,failures]);
  const close=(next:boolean)=>{setOpen(next);if(!next)setFailures(current=>current.map(f=>({...f,seen:true})));};
  const count=unseen+notices.length,fresh=failures.filter(f=>!f.seen),earlier=failures.filter(f=>f.seen);
  const row=(f:Failure,highlight:boolean)=><li key={f.id} className={`rounded-xl border p-3 ${highlight?'border-red-200 bg-red-50/60':'bg-muted/20'}`}><div className="flex items-baseline justify-between gap-3"><p className="text-sm font-medium">{sourceLabel(f.source)}</p><time className="shrink-0 text-xs text-muted-foreground" dateTime={f.created_at}>{when(f.created_at)}</time></div><p className="mt-1 text-sm text-muted-foreground">{f.message||'Kørslen fejlede uden en nærmere besked.'}</p></li>;
  return <><button type="button" className="relative grid size-10 place-items-center rounded-full border bg-white hover:bg-muted" onClick={()=>setOpen(true)} aria-label={`Åbn notifikationer${count ? ': '+count+' nye fejl og beskeder' : ''}`}><Bell className="size-5"/>{count>0&&<span className="absolute -right-1 -top-1 grid min-h-5 min-w-5 place-items-center rounded-full bg-red-600 px-1 text-[11px] font-bold text-white">{count>99?'99+':count}</span>}</button>
    <Dialog open={open} onOpenChange={close}><DialogContent className="max-h-[80vh] overflow-y-auto"><DialogHeader><DialogTitle>Notifikationer</DialogTitle><DialogDescription>Fejlede kørsler for webshoppen. Automatiske kørsler forsøges igen ved næste interval.</DialogDescription></DialogHeader>
      {error&&<p role="alert" className="text-sm text-red-700">{error}</p>}
      {!loaded&&!error&&<p role="status" className="text-sm text-muted-foreground">Henter beskeder…</p>}
      {loaded&&<section aria-labelledby="new-failures"><h3 id="new-failures" className="text-sm font-semibold">Nye fejl{fresh.length?` (${fresh.length})`:''}</h3>{fresh.length?<ul className="mt-2 grid gap-2">{fresh.map(f=>row(f,true))}</ul>:<p className="mt-1 text-sm text-muted-foreground">Ingen nye fejl.</p>}</section>}
      {earlier.length>0&&<details className="group"><summary className="cursor-pointer text-sm font-semibold">Tidligere sete fejl ({earlier.length})</summary><ul className="mt-2 grid gap-2">{earlier.map(f=>row(f,false))}</ul></details>}
      {notices.map(n=><article key={n.id} className="rounded-xl border bg-amber-50/50 p-4"><h3 className="font-medium">{n.title}</h3><p className="mt-1 text-sm">{n.message}</p><p className="mt-2 text-xs text-muted-foreground">Opdaget {when(n.createdAt)}</p><div className="mt-3 flex gap-2"><Button size="sm" onClick={()=>{setOpen(false);onReporting();}}>Åbn Indberetning</Button></div></article>)}
    </DialogContent></Dialog></>;
}
