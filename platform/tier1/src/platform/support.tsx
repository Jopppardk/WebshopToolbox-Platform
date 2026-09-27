import { useEffect, useState, type FormEvent } from 'react';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Textarea } from '../components/ui/textarea';
import { platformApi } from './transport';
import { useWorkspace } from './workspace';
type Ticket={id:string;subject:string;status:string;version:number};
type Detail={ticket:Ticket;messages:Array<{id:string;body:string;author_name:string;created_at:string}>};
const labels:Record<string,string>={open:'Åben',waiting_customer:'Afventer dit svar',resolved:'Lukket'};
export function Support() {
  const {company}=useWorkspace(),base=`/api/platform/companies/${company.id}/tickets`;
  const [tickets,setTickets]=useState<Ticket[]>([]),[detail,setDetail]=useState<Detail|null>(null);
  const [error,setError]=useState(''),[busy,setBusy]=useState(false),[revision,setRevision]=useState(0);
  const [offset,setOffset]=useState(0),[hasMore,setHasMore]=useState(false);
  useEffect(()=>{let active=true;platformApi<{tickets:Ticket[];hasMore:boolean}>(base+'?offset='+offset).then(data=>{if(active){setTickets(data.tickets);setHasMore(data.hasMore);setError('');}}).catch(e=>{if(active)setError(e.message);});return()=>{active=false;};},[base,revision,offset]);
  async function open(id:string){setBusy(true);try{setDetail(await platformApi<Detail>(base+'/'+id));setError('');}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
  async function save(event:FormEvent<HTMLFormElement>) {
    event.preventDefault();const form=event.currentTarget,values=new FormData(form);setBusy(true);setError('');
    try {
      if(detail){await platformApi(base+'/'+detail.ticket.id,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({version:detail.ticket.version,message:values.get('message')})});setDetail(await platformApi<Detail>(base+'/'+detail.ticket.id));}
      else {const created=await platformApi<{id:string}>(base,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({subject:values.get('subject'),message:values.get('message')})});setDetail(await platformApi<Detail>(base+'/'+created.id));setOffset(0);}
      form.reset();setRevision(v=>v+1);
    } catch(e){setError((e as Error).message);}finally{setBusy(false);}
  }
  return <div className="mx-auto max-w-[1440px] px-5 py-7 md:px-8 md:py-9"><header className="mb-8"><p className="eyebrow">Hjælp</p><h1 className="page-title">Support</h1><p className="mt-2 text-sm text-muted-foreground">Opret en supportsag, og følg dialogen med WebshopToolbox.</p></header>{error&&<p role="alert" className="mb-4 rounded-xl bg-red-50 p-4 text-red-800">{error}</p>}<div className="grid gap-6 lg:grid-cols-[320px_1fr]"><section className="rounded-2xl border bg-white p-5"><Button disabled={busy} onClick={()=>setDetail(null)}>Ny supportsag</Button><ul className="mt-4 divide-y">{tickets.map(t=><li key={t.id}><button disabled={busy} className="w-full py-4 text-left" onClick={()=>void open(t.id)}><span className="block font-medium">{t.subject}</span><span className="text-xs text-muted-foreground">{labels[t.status]}</span></button></li>)}</ul>{!tickets.length&&<p className="mt-4 text-sm text-muted-foreground">Ingen supportsager endnu.</p>}<div className="mt-4 flex gap-2"><Button variant="outline" disabled={!offset||busy} onClick={()=>setOffset(v=>Math.max(0,v-50))}>Forrige</Button><Button variant="outline" disabled={!hasMore||busy} onClick={()=>setOffset(v=>v+50)}>Næste</Button></div></section><section className="rounded-2xl border bg-white p-5">{detail&&<><h2 className="text-lg font-semibold">{detail.ticket.subject}</h2><p className="mt-1 text-sm text-muted-foreground">{labels[detail.ticket.status]}</p><ol className="my-5 space-y-4">{detail.messages.map(m=><li key={m.id} className="rounded-xl bg-muted p-4"><p className="mb-2 text-xs text-muted-foreground">{m.author_name} · {new Date(m.created_at).toLocaleString('da-DK')}</p><p className="whitespace-pre-wrap text-sm">{m.body}</p></li>)}</ol></>}<form key={detail?.ticket.id||'new'} onSubmit={save} className="space-y-4">{!detail&&<label className="block text-sm">Emne<Input name="subject" required maxLength={160}/></label>}<label className="block text-sm">{detail?'Dit svar':'Beskriv problemet'}<Textarea name="message" required maxLength={6000} rows={6}/></label><Button disabled={busy} type="submit">{busy?'Sender…':detail?'Send svar':'Opret supportsag'}</Button></form></section></div></div>;
}
