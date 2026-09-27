'use client';
import { tier1Fetch as fetch, tier1Url } from '@/platform/transport';
import {IntegrationStartDate} from '@/components/integration-start-date';
import { useEffect, useState } from 'react';
import { CreditCard } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { IntegrationCard } from '@/components/integration-card';
import type { ViaBillAccount } from '@/lib/viabill';
import type { ReactNode } from 'react';

export function ViaBillConnection({ accountField, initialExpanded = false, onConnected, footer }: { accountField?: ReactNode; footer?: ReactNode; initialExpanded?: boolean; onConnected?: () => void }) {
  const [expanded, setExpanded] = useState(initialExpanded);
  const [status, setStatus] = useState<{ connected: boolean; name?: string;revision?:number;startDate?:string } | null>(null);
  const [startDate,setStartDate]=useState('');
  const [apiKey, setApiKey] = useState(''); const [secret, setSecret] = useState('');
  const [accounts, setAccounts] = useState<ViaBillAccount[]>([]); const [accountId, setAccountId] = useState('');
  const [manualAccountId, setManualAccountId] = useState(false);
  const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [notice, setNotice] = useState('');
  useEffect(() => { const controller = new AbortController(); fetch('/api/viabill/connection', { signal: controller.signal }).then(async response => { if (!response.ok) throw new Error('Forbindelsesstatus kunne ikke hentes.'); const data=await response.json() as {connected:boolean;name?:string;revision?:number;startDate?:string};setStatus(data);setStartDate(data.startDate||''); }).catch(error => { if (!controller.signal.aborted) setError(error.message); }); return () => controller.abort(); }, []);
  async function connect(action: 'discover' | 'connect') {
    setBusy(true); setError(''); setNotice('');
    try {
      const selected = accounts.find(account => account.id === accountId);
      const response = await fetch('/api/viabill/connection', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, apiKey, secret, accountId, accountName: selected?.name,startDate,revision:status?.revision }) });
      const data = await response.json() as { accounts?: ViaBillAccount[]; manualAccountIdRequired?: boolean; name?: string; error?: string };
      if (!response.ok) { if (action === 'discover') { setAccounts([]); setAccountId(''); setManualAccountId(Boolean(data.manualAccountIdRequired)); } throw new Error(data.error || 'ViaBill kunne ikke forbindes.'); }
      if (action === 'discover') { setAccounts(data.accounts || []); setManualAccountId(Boolean(data.manualAccountIdRequired)); setAccountId(data.accounts?.length === 1 ? data.accounts[0].id : ''); setNotice(data.manualAccountIdRequired ? 'ViaBill giver ikke nøglen adgang til kontolisten. Indtast Merchant Account ID; forbindelsen valideres direkte mod afregningsdata.' : 'Adgangen er testet. Vælg virksomhedens konto og gem forbindelsen.'); }
      else { const fresh=await fetch('/api/viabill/connection');if(fresh.ok)setStatus(await fresh.json() as {connected:boolean;name?:string;revision?:number;startDate?:string}); onConnected?.(); setApiKey(''); setSecret(''); setAccounts([]); setAccountId(''); setNotice('ViaBill er verificeret og forbundet med læseadgang.'); }
    } catch (error) { setError(error instanceof Error ? error.message : 'ViaBill kunne ikke forbindes.'); }
    finally { setBusy(false); }
  }
  return <IntegrationCard name="ViaBill" description="Betalinger og udbetalinger" icon={CreditCard} connected={status?.connected??null} expanded={expanded} onToggle={()=>setExpanded(v=>!v)} panelId="viabill-connection-panel" footer={footer}>
      <p className="text-sm text-muted-foreground">Kun læsning af afregningsdata. Shopify-appen fortsætter uændret. Nøglerne gemmes krypteret og vises ikke igen.</p>
      <IntegrationStartDate provider="viabill"/><label className="block text-sm">Forbindelsens startdato<Input type="date" value={startDate} onChange={event=>setStartDate(event.target.value)}/></label>{accountField && <div className="rounded-xl border bg-white p-4"><p className="mb-3 text-sm font-semibold">Bogføring</p>{accountField}</div>}
      {status?.connected && <p className="text-sm">Forbundet til {status.name}. Indtast nøgler igen for at ændre forbindelsen.</p>}
      <fieldset disabled={busy} className="space-y-3">
        <label className="block text-sm">API key<Input type="password" autoComplete="off" className="mt-1" value={apiKey} onChange={event => { setApiKey(event.target.value); setAccounts([]); setManualAccountId(false); setAccountId(''); setNotice(''); }} /></label>
        <label className="block text-sm">Secret<Input type="password" autoComplete="off" className="mt-1" value={secret} onChange={event => { setSecret(event.target.value); setAccounts([]); setManualAccountId(false); setAccountId(''); setNotice(''); }} /></label>
        <Button variant="outline" onClick={() => connect('discover')} disabled={!apiKey.trim() || !secret.trim()}>{busy ? 'Kontakter ViaBill…' : 'Test og hent konti'}</Button>
        {(accounts.length > 0 || manualAccountId) && <><label className="block text-sm">Merchant Account ID<Input className="mt-1" value={accountId} onChange={event => setAccountId(event.target.value)} list={accounts.length ? 'viabill-accounts' : undefined} placeholder="ViaBills konto-ID" /></label>{accounts.length > 0 && <datalist id="viabill-accounts">{accounts.map(account => <option key={account.id} value={account.id}>{account.name}</option>)}</datalist>}<Button onClick={() => connect('connect')} disabled={!accountId.trim()||!startDate}>Validér og gem forbindelse</Button></>}
      </fieldset>
      {error && <p role="alert" className="text-sm text-red-800">{error}</p>}{notice && <p role="status" className="text-sm">{notice}</p>}
  </IntegrationCard>;
}
