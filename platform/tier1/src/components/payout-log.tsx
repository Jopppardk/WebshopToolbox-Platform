'use client';
import { tier1Fetch as fetch, tier1Url } from '@/platform/transport';
import {useEffect,useState} from 'react';
import {Button} from '@/components/ui/button';
import {Dialog,DialogContent,DialogHeader,DialogTitle,DialogDescription} from '@/components/ui/dialog';
import type {PayoutLogData} from '@/lib/payout-log';
export function PayoutLog({externalId,provider}:{externalId:string;provider:string}){
 const [open,setOpen]=useState(false),[data,setData]=useState<PayoutLogData|null>(null),[error,setError]=useState(''),[offset,setOffset]=useState(0),[loading,setLoading]=useState(false),[revision,setRevision]=useState(0);
 useEffect(()=>{
  if(!open)return;
  const controller=new AbortController();setLoading(true);setError('');
  void(async()=>{try{
   const response=await fetch('/api/payouts/log?externalId='+encodeURIComponent(externalId)+'&provider='+encodeURIComponent(provider)+'&offset='+offset,{cache:'no-store',signal:controller.signal});
   const body=await response.json() as PayoutLogData&{error?:string};if(!response.ok)throw Error(body.error||'Udbetalingsloggen kunne ikke hentes.');
   if(!controller.signal.aborted)setData(previous=>offset&&previous?{...body,events:[...previous.events,...body.events.filter(e=>!previous.events.some(p=>p.id===e.id))]}:body);
  }catch(e){if(!controller.signal.aborted)setError(e instanceof Error?e.message:'Udbetalingsloggen kunne ikke hentes.');}finally{if(!controller.signal.aborted)setLoading(false);}})();
  return()=>controller.abort();
 },[open,externalId,provider,offset,revision]);
 return <><Button size="sm" variant="outline" onClick={()=>{setData(null);setOffset(0);setOpen(true);}}>Log</Button>
 <Dialog open={open} onOpenChange={setOpen}><DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
 <DialogHeader><DialogTitle>Udbetalingslog</DialogTitle><DialogDescription>{data?.name||'Hændelser for den valgte udbetaling'} · Alle tider vises i dansk tid. Nyeste hændelser først.</DialogDescription></DialogHeader>
 {error&&<div role="alert" className="text-sm text-red-700">{error} <Button size="sm" variant="outline" onClick={()=>setRevision(v=>v+1)}>Prøv igen</Button></div>}
 {loading&&!data&&<p role="status" className="text-sm text-muted-foreground">Henter udbetalingslog…</p>}
 {data&&<>
 {data.legacy&&<p className="rounded-lg bg-muted/60 p-3 text-xs text-muted-foreground">Ældre hændelser er kun med, hvor oplysningerne er bevaret. Nye statusændringer registreres, når Toolbox modtager dem; udbyderens præcise ændringstidspunkt kan være tidligere.</p>}
 <ol className="ml-2 space-y-5 border-l py-2">{data.events.map(event=><li key={event.id} className="relative pl-5"><span className={'absolute -left-1.5 top-1.5 size-3 rounded-full border-2 border-white '+(event.tone==='success'?'bg-emerald-500':event.tone==='warning'?'bg-amber-500':'bg-slate-400')}/><p className="text-sm font-medium">{event.title}</p><p className="text-xs text-muted-foreground">{event.at?<time dateTime={event.at}>{new Intl.DateTimeFormat('da-DK',{dateStyle:'medium',timeStyle:'medium',timeZone:'Europe/Copenhagen'}).format(new Date(event.at))}</time>:'Intet registreret tidspunkt'}</p>{event.detail&&<p className="mt-1 text-sm text-muted-foreground">{event.detail}</p>}</li>)}</ol>
 {data.nextOffset!==null&&<Button variant="outline" disabled={loading} onClick={()=>setOffset(data.nextOffset!)}>{loading?'Henter…':'Vis ældre hændelser'}</Button>}
 <div className="border-t pt-4"><h3 className="mb-3 text-sm font-semibold">Oplysninger om udbetalingen</h3><dl className="space-y-3 text-sm">{data.details.map((item,i)=><div key={i} className="grid grid-cols-[minmax(0,1fr)_minmax(0,2fr)] gap-4"><dt className="text-muted-foreground">{item.label}</dt><dd className="break-words text-right">{item.value}</dd></div>)}</dl></div>
 </>}
 </DialogContent></Dialog></>;
}
