'use client';
import { tier1Fetch as fetch } from '@/platform/transport';
import { IntegrationStartDate } from '@/components/integration-start-date';
import { useEffect, useState } from 'react';
import { CreditCard } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { IntegrationCard } from '@/components/integration-card';
import type { ReactNode } from 'react';

type Status = { connected: boolean; name?: string; revision?: number; startDate?: string };

export function PensopayConnection({ initialExpanded = false, onConnected, footer }: { footer?: ReactNode; initialExpanded?: boolean; onConnected?: () => void }) {
  const [expanded, setExpanded] = useState(initialExpanded);
  const [status, setStatus] = useState<Status | null>(null);
  const [startDate, setStartDate] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [account, setAccount] = useState<{ id: string; name: string } | null>(null);
  const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [notice, setNotice] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/pensopay/connection', { signal: controller.signal })
      .then(async response => { if (!response.ok) throw new Error('Forbindelsesstatus kunne ikke hentes.'); const data = await response.json() as Status; setStatus(data); setStartDate(data.startDate || ''); })
      .catch(error => { if (!controller.signal.aborted) setError(error instanceof Error ? error.message : 'Forbindelsesstatus kunne ikke hentes.'); });
    return () => controller.abort();
  }, []);
  async function connect(action: 'discover' | 'connect') {
    setBusy(true); setError(''); setNotice('');
    try {
      const response = await fetch('/api/pensopay/connection', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, apiKey, accountName: account?.name, startDate, revision: status?.revision }) });
      const data = await response.json() as { accounts?: Array<{ id: string; name: string }>; error?: string };
      if (!response.ok) { if (action === 'discover') setAccount(null); throw new Error(data.error || 'Pensopay kunne ikke forbindes.'); }
      if (action === 'discover') { setAccount(data.accounts?.[0] || null); setNotice(`Adgangen er testet. Nøglen hører til ${data.accounts?.[0]?.name || 'Pensopay-kontoen'}. Vælg startdato og forbind.`); }
      else {
        const fresh = await fetch('/api/pensopay/connection'); if (fresh.ok) setStatus(await fresh.json() as Status);
        onConnected?.(); setApiKey(''); setAccount(null); setNotice('Pensopay er verificeret og forbundet med læseadgang.');
      }
    } catch (error) { setError(error instanceof Error ? error.message : 'Pensopay kunne ikke forbindes.'); }
    finally { setBusy(false); }
  }
  return <IntegrationCard name="Pensopay" description="Betalinger og afregninger" icon={CreditCard} connected={status?.connected ?? null} expanded={expanded} onToggle={() => setExpanded(value => !value)} panelId="pensopay-connection-panel" footer={footer}>
    <p className="text-sm text-muted-foreground">Kun læsning af betalinger og afregninger. Der kan ikke capture, refunderes eller annulleres noget hos Pensopay. API-nøglen gemmes krypteret og vises ikke igen. Bogføring i Dinero er endnu ikke aktiveret for Pensopay.</p>
    <IntegrationStartDate provider="pensopay" />
    <label className="block text-sm">Forbindelsens startdato<Input type="date" value={startDate} onChange={event => setStartDate(event.target.value)} /></label>
    {status?.connected && <p className="text-sm">Forbundet til {status.name}. Indsæt nøglen igen for at ændre forbindelsen.</p>}
    <fieldset disabled={busy} className="space-y-3">
      <label className="block text-sm">API-nøgle<Input type="password" autoComplete="off" className="mt-1" value={apiKey} onChange={event => { setApiKey(event.target.value); setAccount(null); setNotice(''); }} /></label>
      <p className="text-xs text-muted-foreground">Opret nøglen hos Pensopay under Indstillinger → Keys → Create New token. Nøglen vises kun én gang hos Pensopay.</p>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" onClick={() => connect('discover')} disabled={!apiKey.trim()}>{busy && !account ? 'Kontakter Pensopay…' : 'Test nøglen'}</Button>
        {account && <Button onClick={() => connect('connect')} disabled={!startDate}>{busy ? 'Forbinder…' : `Forbind ${account.name}`}</Button>}
      </div>
    </fieldset>
    {error && <p role="alert" className="text-sm text-red-800">{error}</p>}{notice && <p role="status" className="text-sm">{notice}</p>}
  </IntegrationCard>;
}
