'use client';
import { useEffect, useState } from 'react';
import { CheckCircle2, Mail, RefreshCw, Trash2 } from 'lucide-react';
import { tier1Fetch } from '@/platform/transport';
import { IntegrationCard } from './integration-card';
import { Button } from './ui/button';
import { Input } from './ui/input';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from './ui/dialog';
type Domain = { domain: string; source: string; verified_at: string };
type State = {
  connected: boolean;
  revision: string | null;
  accountId: string;
  source: 'token' | 'migrated' | null;
  discovery: boolean;
  domains: Domain[];
  testRecipient: string;
  localPreview: boolean;
};
const sourceLabel: Record<string, string> = {
  cloudflare: 'fundet i Cloudflare',
  test: 'godkendt med testmail',
  migrated: 'flyttet fra Faktura-afsendelse',
};
/**
 * Integrationer → Cloudflare E-mail: the company's Cloudflare account and API token, and the domains mails may be sent
 * from. Faktura-afsendelse and Anmeldelser only choose an address and a name on one of these domains.
 */
export function MailConnection({
  initialExpanded = false,
  onConnected,
}: {
  initialExpanded?: boolean;
  onConnected: () => void;
}) {
  const [open, setOpen] = useState(initialExpanded),
    [state, setState] = useState<State | null>(null),
    [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [busy, setBusy] = useState(false),
    [guide, setGuide] = useState(false);
  const [accountId, setAccountId] = useState(''),
    [apiToken, setToken] = useState(''),
    [testFrom, setTestFrom] = useState('');
  const load = async () => {
    const r = await tier1Fetch('/api/mail/connection'),
      d = (await r.json()) as State & { error?: string };
    if (!r.ok) throw Error(d.error);
    setState(d);
    setAccountId((v) => v || d.accountId);
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
        .getElementById('mail-connection-panel')
        ?.scrollIntoView({ block: 'center' });
  }, [initialExpanded]);
  const send = async (
    path: string,
    method: string,
    body: Record<string, unknown> = {},
  ) => {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const r = await tier1Fetch('/api/mail/connection' + path, {
          method,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ revision: state?.revision ?? null, ...body }),
        }),
        d = (await r.json()) as State & { error?: string; status?: string };
      if (!r.ok) throw Error(d.error);
      setState(d);
      onConnected();
      return d;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Handlingen mislykkedes.');
      return null;
    } finally {
      setBusy(false);
    }
  };
  const save = async () => {
    const d = await send('', 'PUT', { accountId, apiToken });
    if (!d) return;
    setToken('');
    setNotice(
      d.discovery
        ? d.domains.length
          ? 'Forbundet. Cloudflare har oplyst jeres afsenderdomæner.'
          : 'Forbundet, men Cloudflare har ingen domæner med Email Sending på kontoen endnu.'
        : 'Forbundet. Godkend et domæne ved at sende en testmail fra en adresse på det.',
    );
  };
  const test = async () => {
    const d = await send('/test', 'POST', {
      requestId: crypto.randomUUID(),
      from: testFrom,
    });
    if (!d) return;
    setNotice(
      d.status === 'accepted' || d.status === 'preview'
        ? `Cloudflare har accepteret testmailen til ${d.testRecipient}. Domænet er nu godkendt.`
        : 'Cloudflare bekræftede ikke testmailen, så domænet er ikke godkendt. Kontrollér domænets opsætning i Cloudflare, og prøv igen om et minut.',
    );
    if (d.status !== 'uncertain') setTestFrom('');
  };
  const connected = Boolean(state?.connected);
  return (
    <IntegrationCard
      name="Cloudflare E-mail"
      description="Mails fra jeres egne domæner, fx kontakt@jeresbutik.dk."
      icon={Mail}
      connected={connected}
      expanded={open}
      onToggle={() => setOpen(!open)}
      panelId="mail-connection-panel"
    >
      <div className="space-y-4">
        <p className="text-sm">
          Fakturaer, kreditnotaer og anmeldelsesmails kan sendes fra jeres egne
          adresser med Cloudflare Email Sending. Her forbinder I kontoen én gang
          for hele virksomheden. Selve adressen og afsendernavnet vælges under
          Faktura-afsendelse og Anmeldelser.{' '}
          <button
            type="button"
            className="underline"
            onClick={() => setGuide(true)}
          >
            Vis opsætningsguide
          </button>
        </p>
        {state?.source === 'migrated' && (
          <p className="rounded-xl bg-muted/40 p-3 text-sm">
            Forbindelsen er flyttet hertil fra jeres afsendere under
            Faktura-afsendelse. Der skal ikke gøres mere.
          </p>
        )}
        {connected && (
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-sm font-semibold">Godkendte domæner</h3>
              {state?.discovery && (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  onClick={() => void send('/refresh', 'POST')}
                >
                  <RefreshCw />
                  Hent igen
                </Button>
              )}
            </div>
            {state?.domains.length ? (
              <ul className="divide-y rounded-xl border">
                {state.domains.map((d) => (
                  <li
                    key={d.domain}
                    className="flex items-center gap-2 px-3 py-2 text-sm"
                  >
                    <CheckCircle2
                      aria-hidden="true"
                      className="size-4 text-green-700"
                    />
                    <span className="flex-1 font-medium">{d.domain}</span>
                    <span className="text-xs text-muted-foreground">
                      {sourceLabel[d.source] || d.source}
                    </span>
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      aria-label={'Fjern ' + d.domain}
                      disabled={busy}
                      onClick={() => {
                        if (
                          window.confirm(
                            `Fjern ${d.domain}? Mails fra adresser på domænet sendes så fra standardafsenderen.`,
                          )
                        )
                          void send('/domain', 'DELETE', { domain: d.domain });
                      }}
                    >
                      <Trash2 />
                    </Button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">
                Ingen domæner er godkendt endnu.
              </p>
            )}
            <div className="space-y-2 rounded-xl border bg-[#fcfbf9] p-3">
              <p className="text-sm font-medium">Godkend et domæne</p>
              <p className="text-xs text-muted-foreground">
                Send en testmail fra en adresse på domænet til{' '}
                {state?.testRecipient}. Når Cloudflare accepterer den, kan
                adresser på domænet vælges som afsender.
              </p>
              <div className="flex flex-wrap gap-2">
                <Input
                  type="email"
                  aria-label="Afsenderadresse til test"
                  className="max-w-xs"
                  placeholder="kontakt@jeresbutik.dk"
                  value={testFrom}
                  onChange={(e) => setTestFrom(e.target.value)}
                />
                <Button
                  variant="outline"
                  disabled={busy || !testFrom.includes('@')}
                  onClick={() => void test()}
                >
                  Send testmail
                </Button>
              </div>
            </div>
          </div>
        )}
        <div className="space-y-3 border-t pt-4">
          <h3 className="text-sm font-semibold">
            {connected ? 'Skift konto eller token' : 'Forbind Cloudflare'}
          </h3>
          <label className="block text-sm">
            Cloudflare Account ID
            <Input
              value={accountId}
              autoComplete="off"
              onChange={(e) => setAccountId(e.target.value.trim())}
            />
          </label>
          <label className="block text-sm">
            API-token
            <Input
              type="password"
              autoComplete="new-password"
              value={apiToken}
              placeholder={
                connected ? 'Gemt sikkert' : 'Email Sending: Edit (Account)'
              }
              onChange={(e) => setToken(e.target.value.trim())}
            />
          </label>
          <div className="flex flex-wrap gap-2">
            <Button
              disabled={busy || !state || !accountId || !apiToken}
              onClick={() => void save()}
            >
              {busy
                ? 'Arbejder…'
                : connected
                  ? 'Test og gem'
                  : 'Test og forbind'}
            </Button>
            {connected && (
              <Button
                variant="outline"
                disabled={busy}
                onClick={() => {
                  if (
                    window.confirm(
                      'Afbryd Cloudflare E-mail? Alle mails sendes så fra standardafsenderen, også fakturaer og anmeldelser.',
                    )
                  )
                    void send('', 'DELETE');
                }}
              >
                Afbryd forbindelse
              </Button>
            )}
          </div>
        </div>
        {notice && (
          <p role="status" className="text-sm text-emerald-800">
            {notice}
          </p>
        )}
        {error && (
          <p role="alert" className="text-sm text-red-700">
            {error}
          </p>
        )}
      </div>
      <Dialog open={guide} onOpenChange={setGuide}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Send fra jeres eget domæne</DialogTitle>
            <DialogDescription>
              I skal bruge Cloudflare Account ID og et API-token med Email
              Sending: Edit på den konto, hvor jeres domæner ligger.
            </DialogDescription>
          </DialogHeader>
          <ol className="list-decimal space-y-4 pl-5 text-sm leading-relaxed">
            <li>
              <strong>Aktivér mailafsendelse for domænerne.</strong> Domænet
              skal bruge Cloudflare DNS. Åbn Cloudflare → Compute → Email
              Service → Email Sending → Onboard Domain for hvert domæne, fx både
              det danske og det svenske. Har domænet allerede mail, bør jeres
              mailansvarlige kontrollere DNS-posterne.
            </li>
            <li>
              <strong>Find Cloudflare Account ID.</strong> Åbn søgningen med
              Ctrl+K (⌘K på Mac), skriv{' '}
              <span className="font-medium">Copy account ID</span>, og vælg
              resultatet. Det er kontoens ID, ikke domænets Zone ID.
            </li>
            <li>
              <strong>Opret et token.</strong> Åbn{' '}
              <a
                className="underline"
                href="https://dash.cloudflare.com/profile/api-tokens"
                target="_blank"
                rel="noreferrer"
              >
                My Profile → API Tokens ↗
              </a>{' '}
              → Create Custom Token, og giv det rettigheden{' '}
              <span className="font-semibold">
                Account → Email Sending → Edit
              </span>
              , afgrænset til kontoen.
            </li>
            <li>
              <strong>Valgfrit: lad Toolbox finde domænerne selv.</strong>{' '}
              Tilføjer I også{' '}
              <span className="font-semibold">Zone → Zone → Read</span>, henter
              Toolbox listen over domæner med Email Sending fra Cloudflare. Uden
              den godkender I et domæne ved at sende en testmail fra det.
            </li>
            <li>
              <strong>Forbind her.</strong> Indsæt Account ID og tokenværdien,
              og vælg Test og forbind. Toolbox kontrollerer tokenet hos
              Cloudflare og gemmer det krypteret.
            </li>
            <li>
              <strong>Vælg afsendere.</strong> Under Faktura-afsendelse og
              Anmeldelser vælger I derefter adresse og afsendernavn på et af de
              godkendte domæner.
            </li>
          </ol>
          <p className="text-sm">
            Toolbox ændrer ikke jeres DNS. Standardafsenderen bruges, så længe
            der ikke er valgt en adresse på et godkendt domæne.
          </p>
        </DialogContent>
      </Dialog>
    </IntegrationCard>
  );
}
