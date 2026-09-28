'use client';
import { tier1Fetch as fetch, tier1Url } from '@/platform/transport';
import {useCapabilities} from '@/platform/capabilities';
import {useState} from 'react';
import {Button} from '@/components/ui/button';
import {Checkbox} from '@/components/ui/checkbox';
import {Dialog,DialogContent,DialogHeader,DialogTitle,DialogDescription} from '@/components/ui/dialog';
type Result={version?:string;phase?:string;guid?:string;reference?:string;organizationId?:string;message?:string};
export function ManualBookingAction({kind,externalId,onDone}:{kind:'sale'|'payout'|'refund'|'flatpay';externalId:string;onDone:()=>void}){
 const capabilities=useCapabilities();
 const[open,setOpen]=useState(false),[busy,setBusy]=useState(false),[confirmed,setConfirmed]=useState(false),[result,setResult]=useState<Result|null>(null),[error,setError]=useState(''),[done,setDone]=useState(false);
 async function request(action:'inspect'|'retry'){
  setBusy(true);setError('');
  try{
   const response=await fetch('/api/bookkeeping/manual',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({kind,externalId,action,confirmed,version:result?.version})});
   const data=await response.json() as Result&{error?:string};
   if(!response.ok)throw Error(data.error||'Handlingen kunne ikke gennemføres.');
   setResult(data);if(action==='retry'||data.phase==='booked'){setDone(true);onDone();}
  }catch(e){setError(e instanceof Error?e.message:'Handlingen kunne ikke gennemføres.');if(action==='retry'){setResult(null);setConfirmed(false);onDone();}}
  finally{setBusy(false);}
 }
 return <><Button disabled={!capabilities.bookkeeping} title={capabilities.bookkeeping?undefined:"Bogføring er blokeret i testmiljøet"} size="sm" variant="outline" onClick={()=>{setOpen(true);setResult(null);setConfirmed(false);setDone(false);void request('inspect');}}>Bogfør manuelt</Button>
 <Dialog open={open} onOpenChange={v=>{if(!busy)setOpen(v);}}><DialogContent showCloseButton={!busy} className="max-h-[85vh] overflow-y-auto sm:max-w-xl">
 <DialogHeader><DialogTitle>Manuel bogføring</DialogTitle><DialogDescription>Kontrollér posten i Dinero før et nyt forsøg. Et eksisterende bilag kontrolleres og genbruges. Behandlingen følger valget om kladde eller bogføring under Indstillinger.</DialogDescription></DialogHeader>
 <p className="break-all text-xs text-muted-foreground">{externalId}</p>
 {error&&<p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-800">{error}</p>}
 {done?<output className="text-sm text-emerald-800">{result?.message}</output>:<>
 {result?.version&&<><p className="text-sm">Dinero-regnskab: {result.organizationId}{result.reference&&<> · Reference: {result.reference}</>}</p>
 <p className="break-all text-sm">{result.guid?`Gemte bilags-ID: ${result.guid}`:'Intet sikkert bilags-ID er gemt. Kontrollér også, om et tidligere forsøg har oprettet en kladde uden at returnere et svar.'}</p>
 {result.message&&<p className="text-sm text-muted-foreground">{result.message}</p>}
 <label className="flex items-start gap-3 rounded-xl border p-4 text-sm"><Checkbox checked={confirmed} disabled={busy} onCheckedChange={v=>setConfirmed(v===true)}/><span>Jeg har kontrolleret både kladder og bogførte bilag i Dinero og sikret, at denne post ikke bogføres dobbelt. Et eventuelt tidligere bilag uden reference her er slettet eller afklaret. For salg er bogføring fra andre integrationer stoppet.</span></label>
 <Button disabled={busy||!confirmed} onClick={()=>void request('retry')}>Kontrollér og bogfør</Button></>}
 {!result?.version&&<Button variant="outline" disabled={busy} onClick={()=>void request('inspect')}>Hent status igen</Button>}
 </>}{busy&&<output className="text-sm">Kontrollerer… Luk ikke siden, mens handlingen kører.</output>}
 </DialogContent></Dialog></>;
}
