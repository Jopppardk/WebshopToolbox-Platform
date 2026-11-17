import { useEffect, useState } from 'react';
import { CheckCircle2, Mail } from 'lucide-react';
import { tier1Fetch as fetch } from '@/platform/transport';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
type Sender = {
  senderName: string;
  replyTo: string;
  customFrom: string;
  accountId: string;
  credentialsSaved: boolean;
  status: string;
  standardFrom: string;
  effectiveFrom: string;
  testRecipient: string;
  testEnabled: boolean;
  localPreview: boolean;
  inherited?: boolean;
  // Domains approved in Integrationer → Cloudflare E-mail.
  connected: boolean;
  domains: string[];
};
const split = (address: string) => {
  const at = address.lastIndexOf('@');
  return at < 0
    ? { local: address, domain: '' }
    : { local: address.slice(0, at), domain: address.slice(at + 1) };
};
// Danmark's sender (the company's, or the webshop's own), or a market's own (marketId). A market, and a webshop
// with its own invoice settings, send from the standard sender until their own is saved.
export function InvoiceSender({
  marketId,
  onSaved,
}: { marketId?: string; onSaved?: () => void } = {}) {
  const withQ = (path: string) =>
    marketId ? path + '?marketId=' + encodeURIComponent(marketId) : path;
  const [saved, setSaved] = useState<Sender | null>(null),
    [form, setForm] = useState<Sender | null>(null),
    [custom, setCustom] = useState(false),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(''),
    [dirty, setDirty] = useState(false);
  const [recipient, setRecipient] = useState(''),
    [testMessage, setTestMessage] = useState('');
  async function load() {
    const r = await fetch(withQ('/api/invoices/sender'));
    const d = (await r.json()) as Sender & { error?: string };
    if (!r.ok) throw Error(d.error);
    setSaved(d);
    setForm(d);
    setCustom(!!d.customFrom);
    setDirty(false);
  }
  useEffect(() => {
    void load().catch((e) => setMessage(e.message));
  }, []);
  const change = (patch: Partial<Sender>) => {
    setForm((v) => (v ? { ...v, ...patch } : v));
    setDirty(true);
    setMessage('');
  };
  async function save() {
    setBusy(true);
    setMessage('');
    try {
      const r = await fetch(withQ('/api/invoices/sender'), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          senderName: form?.senderName,
          replyTo: form?.replyTo,
          customFrom: custom ? form?.customFrom : '',
        }),
      });
      const d = (await r.json()) as Sender & { error?: string };
      if (!r.ok) throw Error(d.error);
      await load();
      onSaved?.();
      setMessage(
        custom
          ? 'Gemt. Mails sendes nu fra ' + form?.customFrom + '.'
          : 'Standardafsender valgt.',
      );
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Kunne ikke gemmes.');
    } finally {
      setBusy(false);
    }
  }
  async function test() {
    setBusy(true);
    setTestMessage('');
    try {
      const r = await fetch('/api/invoices/email-test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          recipient,
          requestId: crypto.randomUUID(),
          ...(marketId ? { marketId } : {}),
        }),
      });
      const d = (await r.json()) as { recipient?: string; error?: string };
      if (!r.ok) throw Error(d.error || 'Testmailen kunne ikke bekræftes.');
      setTestMessage(
        `Mailtjenesten har accepteret eksempelfakturaen til ${d.recipient}. Kontrollér indbakke og uønsket mail; accept er ikke en garanti for levering i indbakken.`,
      );
    } catch (e) {
      setTestMessage(e instanceof Error ? e.message : 'Testen fejlede.');
    } finally {
      try {
        await load();
      } catch {
        setSaved(null);
        setMessage('Forbindelsesstatus kunne ikke opdateres. Genindlæs siden.');
      }
      setBusy(false);
    }
  }
  const verified = saved?.status === 'verified' && custom && !dirty;
  const address = split(form?.customFrom || '');
  // An older own address keeps its domain in the list until it is moved to the integration.
  const domains = [
    ...(saved?.domains || []),
    ...(saved?.customFrom &&
    saved.credentialsSaved &&
    !saved.domains.includes(split(saved.customFrom).domain)
      ? [split(saved.customFrom).domain]
      : []),
  ];
  return (
    <section className="mb-6 rounded-2xl border bg-white p-5 sm:p-6">
      <h2 className="text-lg font-semibold">3. Afsender og testmail</h2>
      <p className="mt-2 text-sm text-muted-foreground">
        Vælg, hvem kunden ser som afsender, og prøv den færdige mail med en
        eksempelfaktura.
      </p>
      {saved && (
        <p className="my-4 rounded-xl bg-muted/40 p-4 text-sm">
          Aktiv afsender: <strong>{saved.effectiveFrom}</strong>
          {saved.inherited && (
            <span className="mt-1 block text-xs text-muted-foreground">
              Sender fra standardafsenderen, indtil du gemmer en afsender her.
              {marketId
                ? 'Tilknyt jeres eget domæne nedenfor, typisk et svensk.'
                : 'Tilknyt webshoppens eget domæne nedenfor.'}
            </span>
          )}
        </p>
      )}
      <fieldset disabled={!form || busy} className="mt-4 space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="text-sm">
            Afsendernavn
            <Input
              value={form?.senderName || ''}
              onChange={(e) => change({ senderName: e.target.value })}
            />
          </label>
          <label className="text-sm">
            Svaradresse (valgfri)
            <Input
              type="email"
              value={form?.replyTo || ''}
              placeholder="faktura@ditfirma.dk"
              onChange={(e) => change({ replyTo: e.target.value })}
            />
          </label>
        </div>
        <div className="space-y-3 rounded-xl border p-4">
          <div className="flex flex-wrap items-center gap-3">
            <span className="flex-1 text-sm font-semibold">
              Egen afsenderadresse{' '}
              <span className="font-normal text-muted-foreground">
                · valgfrit
              </span>
            </span>
            {verified ? (
              <span className="inline-flex items-center gap-1 text-sm font-medium text-green-700">
                <CheckCircle2 aria-hidden="true" className="size-4" />
                Godkendt domæne
              </span>
            ) : (
              <span className="text-sm text-muted-foreground">
                {dirty
                  ? 'Ændringer ikke gemt'
                  : saved?.status === 'pending'
                    ? 'Domænet er ikke godkendt'
                    : saved
                      ? 'Standardafsender'
                      : 'Henter status…'}
              </span>
            )}
          </div>
          {!domains.length ? (
            <p className="text-sm text-muted-foreground">
              Forbind Cloudflare E-mail under Indstillinger → Integrationer for
              at sende fra jeres eget domæne, fx faktura@jeresbutik.dk. Indtil
              da bruges standardafsenderen.
            </p>
          ) : (
            <>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={custom}
                  onChange={(e) => {
                    setCustom(e.target.checked);
                    if (e.target.checked && !form?.customFrom)
                      change({ customFrom: 'faktura@' + domains[0] });
                    setDirty(true);
                  }}
                />
                Send fra en adresse på et af jeres domæner
              </label>
              {custom && (
                <div className="flex flex-wrap items-center gap-1 text-sm">
                  <Input
                    aria-label="Adresse før @"
                    className="max-w-48"
                    value={address.local}
                    placeholder="faktura"
                    onChange={(e) =>
                      change({
                        customFrom:
                          e.target.value.trim() + '@' + address.domain,
                      })
                    }
                  />
                  <span>@</span>
                  <select
                    aria-label="Domæne"
                    className="h-8 rounded-lg border bg-white px-2"
                    value={address.domain}
                    onChange={(e) =>
                      change({
                        customFrom: address.local + '@' + e.target.value,
                      })
                    }
                  >
                    {domains.map((d) => (
                      <option key={d} value={d}>
                        {d}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              <p className="text-xs text-muted-foreground">
                Domænerne er godkendt under Indstillinger → Integrationer →
                Cloudflare E-mail.
              </p>
            </>
          )}
        </div>
        <Button onClick={() => void save()} disabled={!dirty}>
          {busy ? 'Arbejder…' : 'Gem afsender'}
        </Button>
        {dirty && (
          <p className="text-xs text-amber-700">
            Gem afsenderændringerne før test.
          </p>
        )}
      </fieldset>
      {message && (
        <p role="status" className="mt-3 text-sm">
          {message}
        </p>
      )}
      <div className="mt-6 space-y-3 border-t pt-5">
        <h3 className="text-sm font-semibold">Prøv den færdige fakturamail</h3>
        <p className="text-sm text-muted-foreground">
          Gem først fakturadesign og mailtekst. Testen bruger samme demo-PDF som
          “Se gemt eksempel” og opretter ingen rigtig faktura.
        </p>
        {saved?.customFrom && (
          <p className="text-sm">
            Testen sendes fra <strong>{saved.effectiveFrom}</strong>.
          </p>
        )}
        <label className="block max-w-md text-sm">
          Modtager
          <Input
            type="email"
            autoComplete="email"
            value={recipient}
            onChange={(e) => setRecipient(e.target.value)}
            placeholder="navn@eksempel.dk"
            disabled={busy}
          />
        </label>
        <Button
          type="button"
          disabled={busy || dirty || !saved || !recipient.trim()}
          onClick={() => void test()}
        >
          <Mail />
          {busy ? 'Arbejder…' : 'Send testmail med eksempelfaktura'}
        </Button>
        {testMessage && (
          <p role="status" className="rounded-xl border p-3 text-sm">
            {testMessage}
          </p>
        )}
      </div>
    </section>
  );
}
