'use client';
import { supportedModules } from '@/lib/integration-visibility';
import { tier1Fetch as fetch } from '@/platform/transport';
import { IntegrationStartDate } from '@/components/integration-start-date';
import { useEffect, useState, type ReactNode } from 'react';
import { CreditCard } from 'lucide-react';
import { IntegrationCard } from '@/components/integration-card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { FlatpayAgreement } from '@/lib/flatpay-api';
export function FlatpayConnection({
  initialExpanded = false,
  onConnected,
  footer,
  accountField,
}: {
  initialExpanded?: boolean;
  onConnected: () => void;
  footer?: ReactNode;
  accountField?: ReactNode;
}) {
  const [revision, setRevision] = useState<number | undefined>(undefined);
  const [open, setOpen] = useState(initialExpanded),
    [connected, setConnected] = useState<boolean | null>(null),
    [username, setUsername] = useState(''),
    [password, setPassword] = useState(''),
    [agreementNumber, setAgreement] = useState(''),
    [agreements, setAgreements] = useState<FlatpayAgreement[]>([]),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState('');
  useEffect(() => {
    void fetch('/api/flatpay/connection', { cache: 'no-store' })
      .then(async (r) => {
        const d = (await r.json()) as {
          connected: boolean;
          agreementNumber?: string;
          startDate?: string;
          revision?: number;
          error?: string;
        };
        if (!r.ok) throw Error(d.error);
        setRevision(d.revision);
        setConnected(d.connected);
        setAgreement(d.agreementNumber || '');
      })
      .catch(() => setMessage('Forbindelsesstatus kunne ikke hentes.'));
  }, []);
  async function act(action: string) {
    setBusy(true);
    setMessage('');
    try {
      const r = await fetch('/api/flatpay/connection', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action,
          username,
          password,
          agreementNumber,
          revision,
        }),
      });
      const d = (await r.json()) as {
        agreements?: FlatpayAgreement[];
        error?: string;
      };
      if (!r.ok) throw Error(d.error);
      if (action === 'validate') {
        setAgreements(d.agreements || []);
        if (d.agreements?.length === 1)
          setAgreement(d.agreements[0].agreementNumber);
        setMessage(
          'API-adgangen virker. Vælg aftale, og gem forbindelsen. Den gemte historikdato ovenfor bruges.',
        );
      } else {
        setConnected(true);
        setPassword('');
        setUsername('');
        setAgreements([]);
        setMessage('Flatpay er verificeret og forbundet med læseadgang.');
        const fresh = await fetch('/api/flatpay/connection');
        if (fresh.ok)
          setRevision(((await fresh.json()) as { revision: number }).revision);
        onConnected();
      }
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Forbindelsen fejlede.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <IntegrationCard
      name="Flatpay"
      description={supportedModules('flatpay')}
      icon={CreditCard}
      connected={connected}
      expanded={open}
      onToggle={() => setOpen(!open)}
      panelId="flatpay-connection-panel"
      footer={footer}
    >
      <p className="text-sm">
        Testmiljø · bogføring og automatiske kørsler er blokeret.
      </p>
      <p className="text-sm">
        Brug API-adgangen til jeres testkonto. Forbindelsen kontrolleres med
        læseadgang; ingen bogføring aktiveres.
      </p>
      {connected && (
        <p className="my-3 text-sm">Gemt aftale: {agreementNumber}</p>
      )}
      <IntegrationStartDate
        provider="flatpay"
        onSaved={async () => {
          const r = await fetch('/api/flatpay/connection');
          if (!r.ok)
            throw Error('Datoerne er gemt. Genindlæs før forbindelsen ændres.');
          setRevision(((await r.json()) as { revision?: number }).revision);
        }}
      />
      <p className="text-xs text-muted-foreground">
        Gem startdatoerne ovenfor, før du gemmer forbindelsen. Der skal ikke
        angives en ekstra dato ved valg af aftale.
      </p>
      {accountField}
      <label className="block text-sm">
        API-brugernavn
        <Input
          value={username}
          autoComplete="off"
          onChange={(e) => {
            setUsername(e.target.value);
            setAgreements([]);
          }}
        />
      </label>
      <label className="block text-sm">
        API-adgangskode
        <Input
          type="password"
          value={password}
          autoComplete="new-password"
          onChange={(e) => {
            setPassword(e.target.value);
            setAgreements([]);
          }}
        />
      </label>
      <Button
        variant="outline"
        disabled={busy || !username || !password}
        onClick={() => void act('validate')}
      >
        Kontrollér adgang og hent aftaler
      </Button>
      {agreements.length > 0 && (
        <>
          <label className="block text-sm">
            Aftale
            <select
              className="mt-1 w-full rounded-lg border p-2"
              value={agreementNumber}
              onChange={(e) => setAgreement(e.target.value)}
            >
              <option value="">Vælg aftale</option>
              {agreements.map((a) => (
                <option key={a.id} value={a.agreementNumber}>
                  {a.agreementNumber} · {a.currency} · {a.status}
                </option>
              ))}
            </select>
          </label>
          <Button
            disabled={busy || !agreementNumber}
            onClick={() => void act('save')}
          >
            Validér og gem forbindelse
          </Button>
        </>
      )}
      {message && <output className="text-sm">{message}</output>}
    </IntegrationCard>
  );
}
