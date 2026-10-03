'use client';
import { useState } from 'react';
import { tier1Fetch as fetch } from '@/platform/transport';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

export function Reconciliation() {
  const [provider, setProvider] = useState('shopify'),
    [module, setModule] = useState('orders'),
    [externalId, setId] = useState(''),
    [guid, setGuid] = useState('');
  const [preview, setPreview] = useState<any>(null),
    [confirmed, setConfirmed] = useState(false),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState('');
  const reset = () => {
    setPreview(null);
    setConfirmed(false);
    setMessage('');
  };
  async function run(action: 'preview' | 'confirm') {
    setBusy(true);
    setMessage('');
    try {
      const r = await fetch('/api/integrations/reconciliation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action,
          provider,
          module,
          externalId,
          guid,
          confirmation: preview?.confirmation,
          confirmMatch: confirmed,
        }),
      });
      const data = (await r.json()) as any;
      if (!r.ok) throw Error(data.error || 'Kontrollen mislykkedes.');
      if (action === 'preview') {
        setPreview(data);
        setConfirmed(false);
      } else {
        setPreview(null);
        setConfirmed(false);
        setMessage(data.message + ' Genindlæs ordrelisten for at se status.');
      }
    } catch (e) {
      setPreview(null);
      setConfirmed(false);
      setMessage(e instanceof Error ? e.message : 'Kontrollen mislykkedes.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <details className="border-t pt-4">
      <summary className="cursor-pointer font-medium">
        Afstem eksisterende Dinero-bilag
      </summary>
      <div className="space-y-3 pt-3">
        <p className="text-sm">
          Har du allerede bogført via en anden løsning? Tilknyt et eksisterende
          manuelt Dinero-bilag til en hentet post. Kontrollér dato, reference,
          beløb og valuta i begge poster før du bekræfter. Der søges ikke
          automatisk efter match, og intet oprettes i Dinero. Kun bogførte bilag
          kan gemmes som afstemt. Kvitteringen bevares, også hvis posten senere
          ændres.
        </p>
        <fieldset disabled={busy} className="space-y-3">
          <label className="block text-sm">
            Datakilde
            <select
              className="block rounded border p-2"
              value={provider}
              onChange={(e) => {
                reset();
                setProvider(e.target.value);
                setModule(
                  e.target.value === 'shopify'
                    ? 'orders'
                    : e.target.value === 'flatpay'
                      ? 'payments'
                      : 'payout',
                );
              }}
            >
              <option value="shopify">Shopify</option>
              <option value="flatpay">Flatpay</option>
              <option value="viabill">ViaBill</option>
            </select>
          </label>
          <label className="block text-sm">
            Posttype
            <select
              className="block rounded border p-2"
              value={module}
              onChange={(e) => {
                reset();
                setModule(e.target.value);
              }}
            >
              {(provider === 'shopify'
                ? [
                    ['orders', 'Ordre'],
                    ['refunds', 'Refundering'],
                    ['payouts', 'Udbetaling'],
                  ]
                : provider === 'flatpay'
                  ? [
                      ['payments', 'Udbetaling'],
                      ['transactions', 'Transaktion'],
                    ]
                  : [['payout', 'Udbetaling']]
              ).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-sm">
            Postens eksterne ID
            <Input
              value={externalId}
              placeholder="Fx gid://shopify/Order/123456"
              onChange={(e) => {
                reset();
                setId(e.target.value);
              }}
            />
          </label>
          <label className="block text-sm">
            Bilagets GUID i Dinero
            <Input
              value={guid}
              placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
              onChange={(e) => {
                reset();
                setGuid(e.target.value);
              }}
            />
          </label>
          <Button
            variant="outline"
            disabled={!externalId || !guid}
            onClick={() => void run('preview')}
          >
            Kontrollér bilag i Dinero
          </Button>
        </fieldset>
        {preview && (
          <div className="space-y-3 rounded border p-3">
            <p>
              Dinero-organisation: {preview.organization} · Bilag:{' '}
              {preview.voucher.number ?? 'kladde'} ·{' '}
              {preview.voucher.status === 'Booked' ? 'Bogført' : 'Kladde'}
            </p>
            {preview.voucher.status === 'Draft' && (
              <p>
                Bilaget er stadig en kladde. Kontrollér igen, når det er bogført
                i Dinero.
              </p>
            )}
            <p>
              Dato: {preview.voucher.date} · Reference:{' '}
              {preview.voucher.reference || 'Ingen reference'}
            </p>
            <details>
              <summary>Se post og bilagslinjer til sammenligning</summary>
              <p>Webshoppost ({preview.sourceDate})</p>
              <pre className="max-h-64 overflow-auto whitespace-pre-wrap text-xs">
                {JSON.stringify(preview.source, null, 2)}
              </pre>
              <p>Dinero-bilagslinjer</p>
              <pre className="max-h-64 overflow-auto whitespace-pre-wrap text-xs">
                {JSON.stringify(preview.voucher.lines, null, 2)}
              </pre>
            </details>
            <label className="flex gap-2 text-sm">
              <input
                type="checkbox"
                checked={confirmed}
                disabled={busy}
                onChange={(e) => setConfirmed(e.target.checked)}
              />
              Jeg har kontrolleret, at dette bilag dækker præcis denne post i
              den valgte webshop.
            </label>
            <Button
              disabled={
                !confirmed || busy || preview.voucher.status !== 'Booked'
              }
              onClick={() => void run('confirm')}
            >
              Gem afstemning
            </Button>
          </div>
        )}
        {message && (
          <p role="status" className="text-sm">
            {message}
          </p>
        )}
      </div>
    </details>
  );
}
