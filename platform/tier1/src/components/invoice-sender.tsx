import { useEffect, useState } from 'react';
import { CheckCircle2, ChevronDown, Mail } from 'lucide-react';
import { tier1Fetch as fetch } from '@/platform/transport';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
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
    [token, setToken] = useState(''),
    [guide, setGuide] = useState(false),
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
          accountId: custom ? form?.accountId : '',
          apiToken: custom ? token : '',
        }),
      });
      const d = (await r.json()) as Sender & { error?: string };
      if (!r.ok) throw Error(d.error);
      setToken('');
      await load();
      onSaved?.();
      setMessage(
        custom
          ? 'Gemt. Send testmailen nedenfor for at kontrollere din egen adresse.'
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
        <details className="group rounded-xl border">
          <summary className="flex cursor-pointer list-none flex-wrap items-center gap-3 p-4 [&::-webkit-details-marker]:hidden">
            <ChevronDown
              aria-hidden="true"
              className="size-4 transition-transform group-open:rotate-180"
            />
            <span className="flex-1 text-sm font-semibold">
              Eget maildomæne via Cloudflare{' '}
              <span className="font-normal text-muted-foreground">
                · valgfrit
              </span>
            </span>
            {verified ? (
              <span className="inline-flex items-center gap-1 text-sm font-medium text-green-700">
                <CheckCircle2 aria-hidden="true" className="size-4" />
                Forbundet
              </span>
            ) : (
              <span className="text-sm text-muted-foreground">
                {dirty
                  ? 'Ændringer ikke gemt'
                  : saved?.status === 'pending'
                    ? 'Afventer testmail'
                    : saved
                      ? 'Ikke tilknyttet'
                      : 'Henter status…'}
              </span>
            )}
          </summary>
          <div className="space-y-4 border-t p-4">
            <p className="text-sm text-muted-foreground">
              Du kan bruge standardafsenderen uden opsætning. Tilføj kun
              Cloudflare, hvis du vil sende fra din egen fakturaadresse.
            </p>
            {!verified && (
              <p className="text-sm font-medium text-red-700">
                Eget maildomæne kræver, at dit domæne bruger Cloudflare DNS og
                har Email Sending aktiveret.
              </p>
            )}
            <Button
              type="button"
              variant="outline"
              onClick={() => setGuide(true)}
            >
              Vis opsætningsguide
            </Button>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={custom}
                onChange={(e) => {
                  setCustom(e.target.checked);
                  setDirty(true);
                }}
              />
              Brug mit eget afsenderdomæne
            </label>
            {custom && (
              <div className="space-y-3">
                <label className="block text-sm">
                  Din fakturaadresse
                  <Input
                    type="email"
                    value={form?.customFrom || ''}
                    placeholder="faktura@ditfirma.dk"
                    onChange={(e) => change({ customFrom: e.target.value })}
                  />
                </label>
                <label className="block text-sm">
                  Cloudflare Account ID
                  <Input
                    value={form?.accountId || ''}
                    autoComplete="off"
                    onChange={(e) => change({ accountId: e.target.value })}
                  />
                </label>
                <label className="block text-sm">
                  API-token
                  <Input
                    type="password"
                    autoComplete="new-password"
                    value={token}
                    placeholder={
                      form?.credentialsSaved
                        ? 'Gemt sikkert · lad stå tomt for at bevare'
                        : 'Email Sending: Edit'
                    }
                    onChange={(e) => {
                      setToken(e.target.value);
                      setDirty(true);
                    }}
                  />
                </label>
              </div>
            )}
            <p className="text-xs text-muted-foreground">
              Gem opsætningen, og brug testmailen nedenfor. Fluebenet vises, når
              Cloudflare har accepteret en test med de gemte oplysninger.
            </p>
          </div>
        </details>
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
            Testen sendes fra <strong>{saved.customFrom}</strong> og
            kontrollerer samtidig Cloudflare-forbindelsen.
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
      <Dialog open={guide} onOpenChange={setGuide}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Send fra dit eget domæne</DialogTitle>
            <DialogDescription>
              Du skal bruge din fakturaadresse, Cloudflare Account ID og et
              API-token med Email Sending: Edit. Brug den Cloudflare-konto, som
              dit afsenderdomæne ligger på.
            </DialogDescription>
          </DialogHeader>
          <ol className="list-decimal space-y-4 pl-5 text-sm leading-relaxed">
            <li>
              <strong>Aktivér mailafsendelse for domænet.</strong> Domænet skal
              bruge Cloudflare DNS. Åbn Cloudflare → Compute → Email Service →
              Email Sending → Onboard Domain, og vælg domænet til din
              fakturaadresse. Gennemgå DNS-posterne til MX, SPF, DKIM og DMARC,
              og vent på godkendelsen. Har domænet allerede mail, bør din
              mailansvarlige kontrollere posterne, så den eksisterende
              mailopsætning bevares.
            </li>
            <li>
              <strong>Find Cloudflare Account ID.</strong> Vælg den rigtige
              konto i Cloudflare. Åbn søgningen med Ctrl+K (⌘K på Mac), skriv{' '}
              <span className="font-medium">Copy account ID</span>, og vælg
              resultatet. Indsæt værdien i feltet{' '}
              <span className="font-medium">Cloudflare Account ID</span> her på
              siden. Det er kontoens ID, ikke domænets Zone ID.{' '}
              <a
                className="underline"
                href="https://developers.cloudflare.com/fundamentals/account/find-account-and-zone-ids/"
                target="_blank"
                rel="noreferrer"
              >
                Se, hvor du finder ID’et ↗
              </a>
            </li>
            <li>
              <strong>Opret et separat token.</strong> Åbn{' '}
              <a
                className="underline"
                href="https://dash.cloudflare.com/profile/api-tokens"
                target="_blank"
                rel="noreferrer"
              >
                My Profile → API Tokens ↗
              </a>
              . Vælg{' '}
              <span className="font-medium">
                Create Token → Create Custom Token
              </span>
              . Giv det fx navnet{' '}
              <span className="font-medium">WebshopToolbox mail</span>.
            </li>
            <li>
              <strong>Vælg den præcise rettighed.</strong> Under{' '}
              <span className="font-medium">Permissions</span> vælger du de tre
              felter:{' '}
              <span className="block rounded-lg bg-muted px-3 py-2 font-semibold">
                Account → Email Sending → Edit
              </span>{' '}
              Det er Email Sending, ikke Email Routing. Denne opsætning kræver
              ingen DNS- eller Worker-rettigheder på tokenet.
            </li>
            <li>
              <strong>Afgræns tokenet til kontoen.</strong> Under{' '}
              <span className="font-medium">Account Resources</span> vælger du{' '}
              <span className="font-medium">Include → Specific account</span> og
              kontoen fra trin 2. Den skal være den samme konto, som har fået
              afsenderdomænet godkendt.
            </li>
            <li>
              <strong>Opret og kopiér tokenværdien.</strong> Vælg{' '}
              <span className="font-medium">
                Continue to summary → Create Token
              </span>
              . Kopiér selve tokenværdien til feltet{' '}
              <span className="font-medium">API-token</span> her på siden.
              Cloudflare viser værdien én gang; har du ikke gemt den, skal du
              oprette et nyt token. Tokenets navn eller ID kan ikke bruges som
              tokenværdi.
            </li>
            <li>
              <strong>Gem afsenderen i WebshopToolbox.</strong> Luk guiden,
              markér{' '}
              <span className="font-medium">Brug mit eget afsenderdomæne</span>,
              og udfyld fakturaadresse, Account ID og API-token. Vælg{' '}
              <span className="font-medium">Gem afsender</span>. Et allerede
              gemt token bevares, når tokenfeltet står tomt.
            </li>
            <li>
              <strong>Kontrollér med en testmail.</strong> Vælg{' '}
              <span className="font-medium">
                Send testmail med eksempelfaktura
              </span>
              . Når Cloudflare accepterer testen, vises egen afsender som
              godkendt. Kontrollér også din indbakke og spammappe. Hvis testen
              fejler, kontrollér konto, tokenrettighed og domænets godkendelse.
              Testen indeholder kun demo-data.
            </li>
          </ol>
          <p className="text-sm">
            Toolbox ændrer ikke din DNS. Standardafsenderen bruges, indtil egen
            afsender er godkendt. Du kan også bruge standardafsenderen med din
            egen svaradresse.
          </p>
          <div className="flex flex-wrap gap-x-4 gap-y-2 text-sm">
            <a
              className="underline"
              href="https://developers.cloudflare.com/fundamentals/api/get-started/create-token/"
              target="_blank"
              rel="noreferrer"
            >
              Cloudflares tokenvejledning ↗
            </a>
            <a
              className="underline"
              href="https://developers.cloudflare.com/email-service/get-started/send-emails/"
              target="_blank"
              rel="noreferrer"
            >
              Cloudflares mailvejledning ↗
            </a>
          </div>
        </DialogContent>
      </Dialog>
    </section>
  );
}
