'use client';
import { useEffect, useState } from 'react';
import { Truck } from 'lucide-react';
import { tier1Fetch } from '@/platform/transport';
import { IntegrationCard } from './integration-card';
import { Button } from './ui/button';
import { Input } from './ui/input';
type Printer = { name: string; hostname: string; printer: string; labelFormat: string };
// Labels from Salg are printed on this printer through Shipmondo Print Client.
function LabelPrinterChoice() {
  const [list,setList]=useState<Printer[]|null>(null),[chosen,setChosen]=useState<Printer|null>(null),[error,setError]=useState(''),[saved,setSaved]=useState(''),[busy,setBusy]=useState(false);
  useEffect(()=>{void (async()=>{try{const r=await tier1Fetch('/api/shipmondo/printer'),d=await r.json() as {printers?:Printer[];printer?:Printer|null;error?:string};if(!r.ok)throw Error(d.error);setList(d.printers||[]);setChosen(d.printer||null);}catch(e){setError(e instanceof Error?e.message:'Printerne kunne ikke hentes.');}})();},[]);
  const save=async(value:string)=>{setBusy(true);setError('');setSaved('');const next=list?.find(p=>p.hostname+'|'+p.printer===value)||null;
    try{const r=await tier1Fetch('/api/shipmondo/printer',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(next?{hostname:next.hostname,printer:next.printer}:{hostname:null})}),d=await r.json() as {printer?:Printer|null;error?:string};if(!r.ok)throw Error(d.error);setChosen(d.printer||null);setSaved(d.printer?'Gemt. Printer-ikonet vises nu ud for ordrerne på Salg.':'Label-udskrivning er slået fra.');}
    catch(e){setError(e instanceof Error?e.message:'Printeren kunne ikke gemmes.');}finally{setBusy(false);}};
  return <div className="space-y-2 rounded-xl border bg-[#fcfbf9] p-3">
    <p className="text-sm font-medium">Udskriv labels fra Salg</p>
    <p className="text-xs text-muted-foreground">Vælg printeren fra Shipmondo Print Client. Et klik på printer-ikonet ud for en ordre opretter forsendelsen i Shipmondo med det produkt og den pakkeshop, der er valgt dér, og udskriver labelen.</p>
    {list===null&&!error?<p className="text-xs text-muted-foreground">Henter printere…</p>:<select aria-label="Printer til labels" className="h-9 w-full rounded-lg border bg-white px-3 text-sm" disabled={busy||!list} value={chosen?chosen.hostname+'|'+chosen.printer:''} onChange={e=>void save(e.target.value)}>
      <option value="">Ingen – vis ikke printer-ikonet</option>{(list||[]).map(p=><option key={p.hostname+'|'+p.printer} value={p.hostname+'|'+p.printer}>{p.name} · {p.hostname} ({p.labelFormat.replace('_',' ')})</option>)}</select>}
    {list&&!list.length&&<p className="text-xs text-muted-foreground">Ingen printere fundet. Start Shipmondo Print Client på pakke-pc'en.</p>}
    {saved&&<p role="status" className="text-xs text-emerald-800">{saved}</p>}{error&&<p role="alert" className="text-xs text-red-700">{error}</p>}
  </div>;
}
type State = {connected:boolean;revision:string|null;sandbox?:boolean;webhookUrl?:string;webhookSecret?:string;lastEventAt?:string|null};
export function ShipmondoConnection({initialExpanded=false,onConnected}:{initialExpanded?:boolean;onConnected:()=>void}) {
  const [open,setOpen]=useState(initialExpanded),[state,setState]=useState<State|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  const [apiUser,setUser]=useState(''),[apiKey,setKey]=useState(''),[sandbox,setSandbox]=useState(false);
  const load=async()=>{const r=await tier1Fetch('/api/shipmondo/connection'),d=await r.json() as State & {error?:string};if(!r.ok)throw Error(d.error);setState(d);setSandbox(Boolean(d.sandbox));};
  useEffect(()=>{void load().catch(e=>setError(e.message));},[]);
  useEffect(()=>{if(initialExpanded)setOpen(true);},[initialExpanded]);
  const save=async(disconnect=false)=>{
    setBusy(true);setError('');
    try {const r=await tier1Fetch('/api/shipmondo/connection',{method:disconnect?'DELETE':'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({revision:state?.revision??null,apiUser,apiKey,sandbox})}),d=await r.json() as {error?:string};if(!r.ok)throw Error(d.error);setUser('');setKey('');await load();onConnected();}
    catch(e){setError(e instanceof Error?e.message:'Forbindelsen kunne ikke gemmes.');}finally{setBusy(false);}
  };
  return <IntegrationCard name="Shipmondo" description="Valgfri API-forbindelse til udskrivning af labels. Tracking fungerer automatisk uden denne." icon={Truck} connected={Boolean(state?.connected)} expanded={open} onToggle={()=>setOpen(!open)} panelId="shipmondo-connection-panel">
    <div className="space-y-3">
      <p className="text-sm">Tracking på Forsendelser hentes automatisk fra de offentlige trackinglinks, også uden API-adgang og Pro. API-forbindelsen her er valgfri; oplysningerne gemmes krypteret.</p>
      <label className="block text-sm">API-bruger<Input value={apiUser} onChange={e=>setUser(e.target.value)} autoComplete="off" /></label>
      <label className="block text-sm">API-nøgle<Input type="password" value={apiKey} onChange={e=>setKey(e.target.value)} autoComplete="off" /></label>
      <label className="flex gap-2 text-sm"><input type="checkbox" checked={sandbox} onChange={e=>setSandbox(e.target.checked)} />Brug Shipmondos sandbox-konto</label>
      <Button disabled={busy||!state||!apiUser||!apiKey} onClick={()=>void save()}>{busy?'Arbejder…':state?.connected?'Test og udskift forbindelse':'Test og forbind'}</Button>
      {state?.connected && <>
        <p className="text-sm text-emerald-800">✓ API-forbindelse kontrolleret{state.sandbox?' (sandbox)':''}.</p>
        <LabelPrinterChoice />
        <Button variant="outline" disabled={busy} onClick={()=>{if(window.confirm('Afbryd API-forbindelsen til Shipmondo? Automatisk tracking via de offentlige links fortsætter.'))void save(true);}}>Afbryd forbindelse</Button>
      </>}
      <p className="text-xs text-muted-foreground">Webhooks bruges ikke længere til visningen på Forsendelser.</p>
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
    </div>
  </IntegrationCard>;
}
