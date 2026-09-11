'use client';
import { useEffect, useState } from 'react';
import { Bell } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
type Notice = {id:string;title:string;message:string;createdAt:string};
export function NotificationBell({errorCount,onErrors,onReporting}:{errorCount:number;onErrors:()=>void;onReporting:()=>void}) {
  const [open,setOpen]=useState(false),[notices,setNotices]=useState<Notice[]>([]),[error,setError]=useState(''),[busy,setBusy]=useState(false),[incidents,setIncidents]=useState<{warnings:number;alarms:number}|null>(null);
  useEffect(()=>{
    const controller=new AbortController(); let running=false;
    const refresh=async()=>{if(running)return;running=true;try{const r=await fetch('/api/notifications',{cache:'no-store',signal:controller.signal});const d=await r.json() as {notifications:Notice[];incidents?:{warnings:number;alarms:number};error?:string};if(!r.ok)throw Error(d.error);if(!controller.signal.aborted){setNotices(d.notifications);if(d.incidents)setIncidents(d.incidents);setError('');}}catch{if(!controller.signal.aborted)setError('Beskeder kunne ikke hentes. Der forsøges igen automatisk.');}finally{running=false;}};
    void refresh();const timer=window.setInterval(()=>{if(!document.hidden)void refresh();},60000);
    return()=>{controller.abort();window.clearInterval(timer);};
  },[open]);
  const read=async(id:string)=>{setBusy(true);try{const r=await fetch('/api/notifications',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id})});if(!r.ok)throw Error();setNotices(current=>current.filter(n=>n.id!==id));setError('');}catch{setError('Beskeden kunne ikke markeres læst. Prøv igen.');}finally{setBusy(false);}};
  const warnings=incidents?.warnings||0,alarms=incidents?.alarms??errorCount;
  const count=warnings+alarms+notices.length;
  return <><button type="button" className="relative grid size-10 place-items-center rounded-full border bg-white hover:bg-muted" onClick={()=>setOpen(true)} aria-label={`Åbn notifikationer${count ? ': '+count+' ulæste beskeder, advarsler og alarmer' : ''}`}><Bell className="size-5"/>{count>0&&<span className={`absolute -right-1 -top-1 grid min-h-5 min-w-5 place-items-center rounded-full px-1 text-[11px] font-bold text-white ${alarms?'bg-red-600':'bg-amber-600'}`}>{count>99?'99+':count}</span>}</button>
    <Dialog open={open} onOpenChange={setOpen}><DialogContent className="max-h-[80vh] overflow-y-auto"><DialogHeader><DialogTitle>Notifikationer</DialogTitle><DialogDescription>Advarsler genforsøges automatisk. Alarmer kræver manuel handling. Åbn oversigten for årsag og næste skridt.</DialogDescription></DialogHeader>
      {error&&<p role="alert" className="text-sm text-red-700">{error}</p>}
      {warnings+alarms>0&&<Button variant="outline" onClick={()=>{setOpen(false);onErrors();}}>{warnings} advarsler · {alarms} alarmer · Se beskeder</Button>}
      {!notices.length&&!error&&<p className="text-sm text-muted-foreground">Ingen nye beskeder om indberetning.</p>}
      {notices.map(n=><article key={n.id} className="rounded-xl border bg-amber-50/50 p-4"><h3 className="font-medium">{n.title}</h3><p className="mt-1 text-sm">{n.message}</p><p className="mt-2 text-xs text-muted-foreground">Opdaget {new Intl.DateTimeFormat('da-DK',{dateStyle:'short',timeStyle:'short',timeZone:'Europe/Copenhagen'}).format(new Date(n.createdAt))}</p><div className="mt-3 flex gap-2"><Button size="sm" onClick={()=>{setOpen(false);onReporting();}}>Åbn Indberetning</Button><Button size="sm" variant="ghost" disabled={busy} onClick={()=>void read(n.id)}>Markér læst</Button></div></article>)}
    </DialogContent></Dialog></>;
}
