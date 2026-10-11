'use client';
// Indstillinger → Faktura-afsendelse, one tab per country. Danmark is the company's invoice settings; every other
// active Shopify market (e.g. Sverige) has exactly the same sections, saved for that market: 1. design and company
// details, 2. invoice and credit-note mail texts, 3. sender and test mail (own domain). Language follows Shopify.
import { useEffect, useState, type ReactNode } from 'react';
import { CircleAlert, CircleCheck, LoaderCircle, Save } from 'lucide-react';
import { tier1Fetch as fetch } from '@/platform/transport';
import { useCapabilities } from '@/platform/capabilities';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { CountryFlag, countryName } from '@/components/country-flag';
import { InvoiceIssuer } from '@/components/invoice-issuer';
import { InvoiceSender } from '@/components/invoice-sender';
import { EditingBar } from '@/components/webshop-invoice-profile';
import { useWebshopName, useWorkspace } from '@/platform/workspace';

type Locale = 'da' | 'sv' | 'en';
type MarketSettings = {
  enabled: boolean;
  locale: Locale;
  storeName: string;
  invoiceSubject: string;
  invoiceBody: string;
  creditSubject: string;
  creditBody: string;
  vatMode: 'domestic';
  revision: number;
  updatedAt: string | null;
};
type Market = {
  id: string;
  name: string;
  countries: string[];
  currency: string;
  url: string;
  active: boolean;
  settings: MarketSettings;
};
type Texts = Record<Locale, { subject: string; body: string }>;
type Payload = {
  home: { name: string; countries: string[]; currency: string } | null;
  markets: Market[];
  templates: Texts;
  creditTemplates: Texts;
  error: string | null;
};
const languageName: Record<Locale, string> = {
  da: 'dansk',
  sv: 'svensk',
  en: 'engelsk',
};
// Shopify's market names are often English ("Sweden"); a one-country market is shown by its Danish country name.
const display = (m: { name: string; countries: string[] }) =>
  m.countries.length === 1 ? countryName(m.countries[0]) : m.name;

function MarketTab({
  market,
  data,
  onSaved,
}: {
  market: Market;
  data: Payload;
  onSaved: () => Promise<void>;
}) {
  const capabilities = useCapabilities();
  const [value, setValue] = useState<MarketSettings>(market.settings),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState<{ ok: boolean; text: string } | null>(
      null,
    ),
    [dirty, setDirty] = useState(false);
  // After another section of this tab saved, the market's version moved on: take it, keeping unsaved text.
  useEffect(() => {
    if (dirty) setValue((v) => ({ ...v, revision: market.settings.revision }));
    else setValue(market.settings);
  }, [market]);
  const change = (patch: Partial<MarketSettings>) => {
    setValue((v) => ({ ...v, ...patch }));
    setDirty(true);
    setMessage(null);
  };
  const { webshops } = useWorkspace(),
    shop = useWebshopName();
  const name = display(market),
    language = languageName[value.locale];
  async function save() {
    setBusy(true);
    setMessage(null);
    try {
      const r = await fetch('/api/markets/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ marketId: market.id, ...value }),
      });
      const d = (await r.json()) as { error?: string };
      if (!r.ok) throw Error(d.error || 'Kunne ikke gemmes.');
      await onSaved();
      setDirty(false);
      setMessage({
        ok: true,
        text: value.enabled
          ? `Gemt. Ordrer fra ${name} faktureres og bogføres.`
          : `Gemt. Ordrer fra ${name} afventer, indtil markedet slås til.`,
      });
    } catch (e) {
      setMessage({
        ok: false,
        text: e instanceof Error ? e.message : 'Kunne ikke gemmes.',
      });
    } finally {
      setBusy(false);
    }
  }
  const saveRow = (label: string) => (
    <div className="flex flex-wrap items-center justify-end gap-3 border-t p-4">
      {message && (
        <p
          role="status"
          className={
            'mr-auto flex items-center gap-2 text-sm ' +
            (message.ok ? 'text-emerald-800' : 'text-red-800')
          }
        >
          {message.ok ? (
            <CircleCheck className="size-4" />
          ) : (
            <CircleAlert className="size-4" />
          )}
          {message.text}
        </p>
      )}
      {dirty && !message && (
        <span className="mr-auto text-xs text-muted-foreground">
          Der er ændringer, som endnu ikke er gemt.
        </span>
      )}
      <Button
        className="h-10 rounded-xl px-4"
        disabled={busy}
        onClick={() => void save()}
      >
        <Save />
        {busy ? 'Gemmer…' : label}
      </Button>
    </div>
  );
  return (
    <>
      {webshops.length > 1 && shop && (
        <EditingBar
          own
          label={`${name} for ${shop}`}
          text={`Markeder hører til den enkelte webshop, så ændringer herunder gælder kun ${shop}.`}
        />
      )}
      <section className="mb-6 overflow-hidden rounded-2xl border bg-white">
        <div className="flex flex-wrap items-start justify-between gap-4 border-b p-5">
          <div className="flex items-start gap-3">
            {market.countries[0] && (
              <CountryFlag
                code={market.countries[0]}
                className="mt-1 h-5 w-7"
              />
            )}
            <div>
              <h2 className="text-lg font-semibold">{name}</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                {market.currency} · fakturaer og mails på {language}
                {market.url && <> · {market.url.replace(/^https:\/\//, '')}</>}
                {!market.active && ' · Ikke længere aktivt i Shopify'}
              </p>
            </div>
          </div>
          <label className="flex items-center gap-3 text-sm font-medium">
            Fakturér og bogfør ordrer herfra
            <Switch
              checked={value.enabled}
              disabled={busy || (!market.active && !value.enabled)}
              onCheckedChange={(enabled) => change({ enabled })}
              aria-label={`Fakturér og bogfør ordrer fra ${name}`}
            />
          </label>
        </div>
        <div className="grid gap-4 p-5 sm:grid-cols-2">
          <label className="block text-sm">
            <span className="mb-1.5 block text-xs font-medium text-muted-foreground">
              Webshop på fakturaen
            </span>
            <Input
              maxLength={80}
              value={value.storeName}
              onChange={(e) => change({ storeName: e.target.value })}
            />
            <span className="mt-1.5 block text-xs text-muted-foreground">
              {'Vises som fx "Order #2690 · Sabeln.se".'}
            </span>
          </label>
          <div className="text-sm">
            <span className="mb-1.5 block text-xs font-medium text-muted-foreground">
              Moms
            </span>
            <div className="grid gap-2">
              <label className="flex items-start gap-3 rounded-xl border border-[#9a7440] bg-[#fbf7f0] p-3">
                <input type="radio" checked readOnly className="mt-1" />
                <span>
                  <span className="block font-medium">Dansk moms</span>
                  <span className="text-xs text-muted-foreground">
                    Ikke OSS-registreret. Bogføres med U25 som danske ordrer.
                  </span>
                </span>
              </label>
              <label className="flex items-start gap-3 rounded-xl border p-3 text-muted-foreground">
                <input type="radio" disabled className="mt-1" />
                <span>
                  <span className="block font-medium">
                    OSS · moms i kundens land
                  </span>
                  <span className="text-xs">Kommer senere.</span>
                </span>
              </label>
            </div>
          </div>
        </div>
        <p className="px-5 pb-4 text-xs text-muted-foreground">
          Fakturaen laves i {market.currency} med de beløb, kunden betalte.
          Bogføringen i Dinero sker i DKK med Shopifys omregnede beløb, ligesom
          danske ordrer.
        </p>
        {saveRow(`Gem ${name}`)}
      </section>
      <InvoiceIssuer
        key={'issuer-' + market.id}
        marketId={market.id}
        onSaved={() => void onSaved()}
      />
      <section className="mb-6 overflow-hidden rounded-2xl border bg-white">
        <div className="border-b p-5">
          <h2 className="text-lg font-semibold">2. Mailtekst</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Tilpas emne og besked til kunder fra {name}.{' '}
            {capabilities.customerEmail
              ? 'Automatisk afsendelse følger valget på fanen Danmark.'
              : 'Automatisk kundemail er deaktiveret i testmiljøet.'}
          </p>
        </div>
        <div className="grid gap-4 p-5">
          <label>
            <span className="text-xs font-medium text-muted-foreground">
              Emne
            </span>
            <Input
              className="mt-1.5"
              value={value.invoiceSubject}
              onChange={(e) => change({ invoiceSubject: e.target.value })}
            />
          </label>
          <label>
            <span className="text-xs font-medium text-muted-foreground">
              Mailtekst
            </span>
            <Textarea
              className="mt-1.5 min-h-40"
              value={value.invoiceBody}
              onChange={(e) => change({ invoiceBody: e.target.value })}
            />
          </label>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs text-muted-foreground">
              Du kan bruge: {'{{kundenavn}}'}, {'{{fakturanummer}}'},{' '}
              {'{{ordrenummer}}'}, {'{{butik}}'} og {'{{virksomhedsnavn}}'}.
            </p>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() =>
                change({
                  invoiceSubject: data.templates[value.locale].subject,
                  invoiceBody: data.templates[value.locale].body,
                })
              }
            >
              Brug standardtekst på {language}
            </Button>
          </div>
          <div className="border-t pt-4">
            <h3 className="text-sm font-semibold">Kreditnota</h3>
            <p className="mt-1 text-xs text-muted-foreground">
              Sendes sammen med kreditnotaen, når en ordre tilbagebetales.
            </p>
          </div>
          <label>
            <span className="text-xs font-medium text-muted-foreground">
              Emne
            </span>
            <Input
              className="mt-1.5"
              value={value.creditSubject}
              onChange={(e) => change({ creditSubject: e.target.value })}
            />
          </label>
          <label>
            <span className="text-xs font-medium text-muted-foreground">
              Mailtekst
            </span>
            <Textarea
              className="mt-1.5 min-h-40"
              value={value.creditBody}
              onChange={(e) => change({ creditBody: e.target.value })}
            />
          </label>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs text-muted-foreground">
              Du kan bruge: {'{{kundenavn}}'}, {'{{kreditnotanummer}}'},{' '}
              {'{{fakturanummer}}'}, {'{{ordrenummer}}'}, {'{{beløb}}'},{' '}
              {'{{butik}}'} og {'{{virksomhedsnavn}}'}.
            </p>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() =>
                change({
                  creditSubject: data.creditTemplates[value.locale].subject,
                  creditBody: data.creditTemplates[value.locale].body,
                })
              }
            >
              Brug standardtekst på {language}
            </Button>
          </div>
        </div>
        {saveRow('Gem mailtekst')}
      </section>
      <InvoiceSender
        key={'sender-' + market.id}
        marketId={market.id}
        onSaved={() => void onSaved()}
      />
    </>
  );
}

export function InvoiceMarkets({ home }: { home: ReactNode }) {
  const [data, setData] = useState<Payload | null>(null),
    [error, setError] = useState(''),
    [tab, setTab] = useState('home');
  async function load() {
    const r = await fetch('/api/markets/settings');
    const d = (await r.json()) as Payload & { error?: string };
    if (!r.ok) throw Error(d.error || 'Markederne kunne ikke hentes.');
    setData(d);
  }
  useEffect(() => {
    void load().catch((e) =>
      setError(
        e instanceof Error ? e.message : 'Markederne kunne ikke hentes.',
      ),
    );
  }, []);
  const markets = data?.markets ?? [],
    selected = markets.find((m) => m.id === tab);
  const homeCountry = data?.home?.countries[0] ?? 'DK';
  const tabClass = (active: boolean) =>
    'inline-flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm font-medium transition ' +
    (active
      ? 'bg-white shadow-sm ring-1 ring-black/5'
      : 'text-muted-foreground hover:text-foreground');
  return (
    <>
      <div className="mb-6">
        <div
          role="tablist"
          aria-label="Land"
          className="inline-flex flex-wrap gap-1 rounded-xl bg-muted/60 p-1"
        >
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'home'}
            className={tabClass(tab === 'home')}
            onClick={() => setTab('home')}
          >
            <CountryFlag code={homeCountry} />
            {data?.home ? display(data.home) : 'Danmark'}
          </button>
          {markets.map((m) => (
            <button
              type="button"
              role="tab"
              key={m.id}
              aria-selected={tab === m.id}
              className={tabClass(tab === m.id)}
              onClick={() => setTab(m.id)}
            >
              {m.countries[0] && <CountryFlag code={m.countries[0]} />}
              {display(m)}
              <span
                className={
                  'size-1.5 rounded-full ' +
                  (m.settings.enabled ? 'bg-emerald-500' : 'bg-slate-300')
                }
                title={
                  m.settings.enabled
                    ? 'Faktureres og bogføres'
                    : 'Ikke slået til'
                }
              />
            </button>
          ))}
          {!data && !error && (
            <span className="inline-flex items-center gap-2 px-3 py-1.5 text-xs text-muted-foreground">
              <LoaderCircle className="size-3.5 animate-spin" />
              Henter markeder…
            </span>
          )}
        </div>
        {(error || data?.error) && (
          <p className="mt-2 text-xs text-muted-foreground">
            Andre markeder kan ikke vises: {error || data?.error}
          </p>
        )}
        {data && !markets.length && !data.error && (
          <p className="mt-2 text-xs text-muted-foreground">
            Der er ingen andre aktive markeder i Shopify. Opret et marked i
            Shopify for at fakturere til andre lande.
          </p>
        )}
      </div>
      {selected && data ? (
        <MarketTab market={selected} data={data} onSaved={load} />
      ) : (
        home
      )}
    </>
  );
}
