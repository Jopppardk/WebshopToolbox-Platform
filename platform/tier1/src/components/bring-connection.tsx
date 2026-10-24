'use client';
import { useEffect, useState } from 'react';
import { Truck } from 'lucide-react';
import { tier1Fetch } from '@/platform/transport';
import { IntegrationCard } from './integration-card';
import { Button } from './ui/button';
import { Input } from './ui/input';
type State = {
  connected: boolean;
  revision: string | null;
  uid?: string;
  // The company's other webshops with Bring; their key can be used here too.
  reusable?: Array<{ id: string; name: string }>;
};
// Bring parcels are tracked through the Mybring API; Shipmondo's public pages only redirect them to Bring.
export function BringConnection({
  initialExpanded = false,
  onConnected,
}: {
  initialExpanded?: boolean;
  onConnected: () => void;
}) {
  const [open, setOpen] = useState(initialExpanded),
    [state, setState] = useState<State | null>(null),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const [uid, setUid] = useState(''),
    [apiKey, setKey] = useState(''),
    [copyFrom, setCopyFrom] = useState('');
  const load = async () => {
    const r = await tier1Fetch('/api/bring/connection'),
      d = (await r.json()) as State & { error?: string };
    if (!r.ok) throw Error(d.error);
    setState(d);
    setCopyFrom(d.reusable?.[0]?.id || '');
  };
  useEffect(() => {
    const timer = window.setTimeout(() => {
      void load().catch((e) => setError(e.message));
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);
  // Just added from the library: bring the card into view once it renders.
  useEffect(() => {
    if (initialExpanded)
      document
        .getElementById('bring-connection-panel')
        ?.scrollIntoView({ block: 'center' });
  }, [initialExpanded]);
  const save = async (disconnect = false, reuse = false) => {
    setBusy(true);
    setError('');
    try {
      const r = await tier1Fetch('/api/bring/connection', {
          method: disconnect ? 'DELETE' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(
            reuse
              ? { revision: state?.revision ?? null, copyFrom }
              : { revision: state?.revision ?? null, uid, apiKey },
          ),
        }),
        d = (await r.json()) as { error?: string };
      if (!r.ok) throw Error(d.error);
      setUid('');
      setKey('');
      await load();
      onConnected();
    } catch (e) {
      setError(
        e instanceof Error ? e.message : 'Forbindelsen kunne ikke gemmes.',
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <IntegrationCard
      name="Bring"
      description="Tracking på Bring-pakker via Mybring."
      icon={Truck}
      connected={Boolean(state?.connected)}
      expanded={open}
      onToggle={() => setOpen(!open)}
      panelId="bring-connection-panel"
    >
      <div className="space-y-3">
        <p className="text-sm">
          Shipmondos trackingsider viser ikke Bring-pakker, så Forsendelser
          henter dem direkte hos Bring. Det kræver en gratis Mybring-konto, men
          ingen aftale med Bring; det virker også for pakker bestilt via
          Shipmondo. Opret en API-nøgle i Mybrings API-indstillinger, og indtast
          den her. Oplysningerne gemmes krypteret.
        </p>
        {!!state?.reusable?.length && (
          <div className="space-y-2 rounded-xl border bg-[#fcfbf9] p-3">
            <p className="text-sm font-medium">
              Brug samme Mybring-nøgle som en anden webshop
            </p>
            <div className="flex flex-wrap gap-2">
              <select
                aria-label="Webshop med Bring"
                className="rounded border bg-white px-2 py-1 text-sm"
                value={copyFrom}
                onChange={(e) => setCopyFrom(e.target.value)}
              >
                {state.reusable.map((shop) => (
                  <option key={shop.id} value={shop.id}>
                    {shop.name}
                  </option>
                ))}
              </select>
              <Button
                variant="outline"
                disabled={busy || !copyFrom}
                onClick={() => void save(false, true)}
              >
                Brug samme nøgle
              </Button>
            </div>
          </div>
        )}
        <label className="block text-sm">
          Mybring-login (e-mail)
          <Input
            type="email"
            value={uid}
            onChange={(e) => setUid(e.target.value)}
            autoComplete="off"
          />
        </label>
        <label className="block text-sm">
          API-nøgle
          <Input
            type="password"
            value={apiKey}
            onChange={(e) => setKey(e.target.value)}
            autoComplete="off"
          />
        </label>
        <Button
          disabled={busy || !state || !uid || !apiKey}
          onClick={() => void save()}
        >
          {busy
            ? 'Arbejder…'
            : state?.connected
              ? 'Test og udskift forbindelse'
              : 'Test og forbind'}
        </Button>
        {state?.connected && (
          <>
            <p className="text-sm text-emerald-800">
              ✓ Forbundet som {state.uid}. Bring-pakker hentes ved næste besøg
              på Forsendelser.
            </p>
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => {
                if (
                  window.confirm(
                    'Afbryd forbindelsen til Bring? Bring-pakker viser så kun Shopify-oplysninger.',
                  )
                )
                  void save(true);
              }}
            >
              Afbryd forbindelse
            </Button>
          </>
        )}
        {error && (
          <p role="alert" className="text-sm text-red-700">
            {error}
          </p>
        )}
      </div>
    </IntegrationCard>
  );
}
