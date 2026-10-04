'use client';
import { useEffect, useState } from 'react';
import { Truck } from 'lucide-react';
import { tier1Fetch } from '@/platform/transport';
import { IntegrationCard } from './integration-card';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { formatDateTime } from '@/lib/format';
type State = {connected:boolean;revision:string|null;sandbox?:boolean;webhookUrl?:string;webhookSecret?:string;lastEventAt?:string|null};
export function ShipmondoConnection({initialExpanded=false,onConnected}:{initialExpanded?:boolean;onConnected:()=>void}) {
  const [open,setOpen]=useState(initialExpanded),[state,setState]=useState<State|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  const [apiUser,setUser]=useState(''),[apiKey,setKey]=useState(''),[sandbox,setSandbox]=useState(false),[showKey,setShowKey]=useState(false);
  const load=async()=>{const r=await tier1Fetch('/api/shipmondo/connection'),d=await r.json() as State & {error?:string};if(!r.ok)throw Error(d.error);setState(d);setSandbox(Boolean(d.sandbox));};
  useEffect(()=>{void load().catch(e=>setError(e.message));},[]);
  useEffect(()=>{if(initialExpanded)setOpen(true);},[initialExpanded]);
  const save=async(disconnect=false)=>{
    setBusy(true);setError('');
    try {const r=await tier1Fetch('/api/shipmondo/connection',{method:disconnect?'DELETE':'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({revision:state?.revision??null,apiUser,apiKey,sandbox})}),d=await r.json() as {error?:string};if(!r.ok)throw Error(d.error);setUser('');setKey('');await load();onConnected();}
    catch(e){setError(e instanceof Error?e.message:'Forbindelsen kunne ikke gemmes.');}finally{setBusy(false);}
  };
  return <IntegrationCard name="Shipmondo" description="Trackingstatus og hændelser på Forsendelser." icon={Truck} connected={Boolean(state?.connected)} expanded={open} onToggle={()=>setOpen(!open)} panelId="shipmondo-connection-panel">
    <div className="space-y-3">
      <p className="text-sm">1. Forbind din konto med API-bruger og API-nøgle fra Shipmondo → API-adgang. De gemmes krypteret for denne webshop.</p>
      <label className="block text-sm">API-bruger<Input value={apiUser} onChange={e=>setUser(e.target.value)} autoComplete="off" /></label>
      <label className="block text-sm">API-nøgle<Input type="password" value={apiKey} onChange={e=>setKey(e.target.value)} autoComplete="off" /></label>
      <label className="flex gap-2 text-sm"><input type="checkbox" checked={sandbox} onChange={e=>setSandbox(e.target.checked)} />Brug Shipmondos sandbox-konto</label>
      <Button disabled={busy||!state||!apiUser||!apiKey} onClick={()=>void save()}>{busy?'Arbejder…':state?.connected?'Test og udskift forbindelse':'Test og forbind'}</Button>
      {state?.connected && <>
        <p className="text-sm text-emerald-800">✓ API-forbindelse kontrolleret{state.sandbox?' (sandbox)':''}.</p>
        <p className="text-sm">{state.lastEventAt ? `✓ Tracking modtaget ${formatDateTime(state.lastEventAt)}` : 'Tracking afventer: Opret webhook i trin 2.'}</p>
        <details className="rounded-xl border p-3" open={!state.lastEventAt}>
          <summary className="cursor-pointer font-medium">2. Aktivér tracking fra Shipmondo</summary>
          <ol className="my-3 list-decimal space-y-2 pl-5 text-sm"><li>Åbn Webhooks i Shipmondo, og opret en webhook.</li><li>Vælg ressourcen <strong>Shipment Monitor</strong> og handlingen <strong>latest</strong>.</li><li>Indsæt URL og nøgle nedenfor. Gem og aktivér webhooken.</li></ol>
          <label className="block text-sm">Webhook-URL<Input readOnly value={state.webhookUrl||''} onFocus={e=>e.target.select()} /></label>
          <label className="mt-3 block text-sm">Webhook-nøgle<Input readOnly type={showKey?'text':'password'} value={state.webhookSecret||''} onFocus={e=>e.target.select()} /></label>
          <Button variant="ghost" size="sm" onClick={()=>setShowKey(!showKey)}>{showKey?'Skjul nøgle':'Vis nøgle'}</Button>
          <p className="mt-2 text-xs text-muted-foreground">Shipmondo opdaterer Shipment Monitor én gang dagligt. Hændelser indsamles fra aktiveringstidspunktet; tidligere scans hentes ikke automatisk. Status vises på pakker med samme fragtfirma og trackingnummer i Shopify. Afhentningsfrister er fortsat estimater.</p>
          <a className="text-sm underline" href="https://shipmondo.dev/docs/webhooks/requirements-and-structure/" target="_blank" rel="noreferrer">Shipmondos webhook-guide</a>
        </details>
        <p className="text-xs text-muted-foreground">Ved udskiftning af API-oplysninger får du en ny webhook-URL og nøgle. Opdatér webhooken i Shipmondo. Den tidligere trackinghistorik i Toolbox ryddes.</p>
        <Button variant="outline" disabled={busy} onClick={()=>{if(window.confirm('Afbryd Shipmondo og fjern den indsamlede trackinghistorik fra Toolbox? Shopify-data bevares.'))void save(true);}}>Afbryd forbindelse</Button>
      </>}
      <p className="text-xs text-muted-foreground">Denne integration læser tracking. Oprettelse af forsendelser og køb af labels kommer senere.</p>
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
    </div>
  </IntegrationCard>;
}
