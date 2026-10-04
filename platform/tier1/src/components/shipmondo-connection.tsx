'use client';
import { useEffect, useState } from 'react';
import { Truck } from 'lucide-react';
import { tier1Fetch } from '@/platform/transport';
import { IntegrationCard } from './integration-card';
import { Button } from './ui/button';
import { Input } from './ui/input';
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
  return <IntegrationCard name="Shipmondo" description="Valgfri API-forbindelse. Tracking fungerer automatisk uden denne." icon={Truck} connected={Boolean(state?.connected)} expanded={open} onToggle={()=>setOpen(!open)} panelId="shipmondo-connection-panel">
    <div className="space-y-3">
      <p className="text-sm">Tracking på Forsendelser hentes automatisk fra de offentlige trackinglinks, også uden API-adgang og Pro. API-forbindelsen her er valgfri; oplysningerne gemmes krypteret.</p>
      <label className="block text-sm">API-bruger<Input value={apiUser} onChange={e=>setUser(e.target.value)} autoComplete="off" /></label>
      <label className="block text-sm">API-nøgle<Input type="password" value={apiKey} onChange={e=>setKey(e.target.value)} autoComplete="off" /></label>
      <label className="flex gap-2 text-sm"><input type="checkbox" checked={sandbox} onChange={e=>setSandbox(e.target.checked)} />Brug Shipmondos sandbox-konto</label>
      <Button disabled={busy||!state||!apiUser||!apiKey} onClick={()=>void save()}>{busy?'Arbejder…':state?.connected?'Test og udskift forbindelse':'Test og forbind'}</Button>
      {state?.connected && <>
        <p className="text-sm text-emerald-800">✓ API-forbindelse kontrolleret{state.sandbox?' (sandbox)':''}.</p>
        <Button variant="outline" disabled={busy} onClick={()=>{if(window.confirm('Afbryd API-forbindelsen til Shipmondo? Automatisk tracking via de offentlige links fortsætter.'))void save(true);}}>Afbryd forbindelse</Button>
      </>}
      <p className="text-xs text-muted-foreground">Oprettelse af forsendelser og køb af labels kommer senere. Webhooks bruges ikke længere til visningen på Forsendelser.</p>
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
    </div>
  </IntegrationCard>;
}
