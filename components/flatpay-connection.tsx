'use client';
import {useEffect,useState,type ReactNode} from 'react';
import {CreditCard} from 'lucide-react';
import {IntegrationCard} from '@/components/integration-card';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import type {FlatpayAgreement} from '@/lib/flatpay-api';
export function FlatpayConnection({initialExpanded=false,onConnected,footer,accountField}:{initialExpanded?:boolean;onConnected:()=>void;footer?:ReactNode;accountField?:ReactNode}){
 const[open,setOpen]=useState(initialExpanded),[connected,setConnected]=useState<boolean|null>(null),[username,setUsername]=useState(''),[password,setPassword]=useState(''),[agreementNumber,setAgreement]=useState(''),[startDate,setStart]=useState(''),[agreements,setAgreements]=useState<FlatpayAgreement[]>([]),[busy,setBusy]=useState(false),[message,setMessage]=useState('');
 useEffect(()=>{void fetch('/api/flatpay/connection',{cache:'no-store'}).then(async r=>{const d=await r.json() as {connected:boolean;agreementNumber?:string;startDate?:string;error?:string};if(!r.ok)throw Error(d.error);setConnected(d.connected);setAgreement(d.agreementNumber||'');setStart(d.startDate||'');}).catch(()=>setMessage('Forbindelsesstatus kunne ikke hentes.'));},[]);
 async function act(action:string){setBusy(true);setMessage('');try{const r=await fetch('/api/flatpay/connection',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action,username,password,agreementNumber,startDate})});const d=await r.json() as {agreements?:FlatpayAgreement[];error?:string};if(!r.ok)throw Error(d.error);if(action==='start-date'){setMessage('Startdato gemt. Gælder fra næste hentning.');}else if(action==='validate'){setAgreements(d.agreements||[]);if(d.agreements?.length===1)setAgreement(d.agreements[0].agreementNumber);setMessage('API-adgangen virker. Vælg aftale og startdato, og gem forbindelsen.');}else{setConnected(true);setPassword('');setUsername('');setAgreements([]);setMessage('Forbundet. Flatpay er klar til synkronisering af udbetalinger og refunderinger.');onConnected();}}catch(e){setMessage(e instanceof Error?e.message:'Forbindelsen fejlede.');}finally{setBusy(false);}}
 return <IntegrationCard name="Flatpay" description="Saga/Valitor · udbetalinger og refunderinger" icon={CreditCard} connected={connected} expanded={open} onToggle={()=>setOpen(!open)} panelId="flatpay-connection-panel" footer={footer}>
 <p className="text-sm">Brug API-adgangen fra Flatpay til jeres rigtige konto. Automatisk hentning følger modulvalg og synkroniseringsinterval. Tilbagebetalinger hentes til oversigten; de bogføres endnu ikke automatisk.</p>
 {connected&&<div className="my-4 space-y-3 rounded-xl border p-4"><p className="text-sm">Gemt aftale: {agreementNumber}</p><label className="block text-sm">Hent data fra<Input type="date" value={startDate} onChange={e=>setStart(e.target.value)}/></label><Button variant="outline" disabled={busy||!startDate} onClick={()=>void act('start-date')}>Gem startdato</Button></div>}
 {accountField}
 <label className="block text-sm">API-brugernavn<Input value={username} autoComplete="off" onChange={e=>{setUsername(e.target.value);setAgreements([]);}}/></label>
 <label className="block text-sm">API-adgangskode<Input type="password" value={password} autoComplete="new-password" onChange={e=>{setPassword(e.target.value);setAgreements([]);}}/></label>
 <Button variant="outline" disabled={busy||!username||!password} onClick={()=>void act('validate')}>Kontrollér adgang og hent aftaler</Button>
 {agreements.length>0&&<><label className="block text-sm">Aftale<select className="mt-1 w-full rounded-lg border p-2" value={agreementNumber} onChange={e=>setAgreement(e.target.value)}><option value="">Vælg aftale</option>{agreements.map(a=><option key={a.id} value={a.agreementNumber}>{a.agreementNumber} · {a.currency} · {a.status}</option>)}</select></label><label className="block text-sm">Startdato<Input type="date" value={startDate} onChange={e=>setStart(e.target.value)}/></label><Button disabled={busy||!agreementNumber||!startDate} onClick={()=>void act('save')}>Validér og gem forbindelse</Button></>}
 {message&&<output className="text-sm">{message}</output>}
 </IntegrationCard>;
}
