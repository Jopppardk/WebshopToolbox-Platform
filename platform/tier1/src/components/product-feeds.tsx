import { formatDateTime } from '@/lib/format';
import { PageTitle } from '@/platform/workspace';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { tier1Fetch, tier1Url } from '@/platform/transport';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Rss,
  Plus,
  Copy,
  Check,
  RefreshCw,
  ExternalLink,
  Pencil,
  Trash2,
  Link2,
  Info,
  Search,
  X,
  CircleAlert,
  CircleCheck,
  LoaderCircle,
} from 'lucide-react';
import { useConfirm } from '@/components/confirm-dialog';
import { feedFileNamePattern, slugify } from '@/lib/feed-name';
import { CountryFlag, countryName } from '@/components/country-flag';
type Pick = { id: string; title: string };
/** An active Shopify market, and the market chosen for a feed. */
type Market = {
  id: string;
  name: string;
  countries: string[];
  currency: string;
  url: string;
  locale: string | null;
  primary: boolean;
};
type MarketChoice = {
  id: string;
  country: string;
  name: string;
  currency: string;
};
const choiceOf = (m: Market): MarketChoice => ({
  id: m.id,
  country: m.countries[0],
  name: m.name,
  currency: m.currency,
});
const refreshOptions: Array<[number, string]> = [
  [15, 'Hvert 15. minut'],
  [60, 'Hver time'],
  [360, 'Hver 6. time'],
  [1440, 'Dagligt'],
];
const refreshLabel = (minutes?: number) =>
  (
    refreshOptions.find(([m]) => m === (minutes || 15))?.[1] ||
    'Hvert 15. minut'
  ).toLocaleLowerCase('da');
type Feed = {
  market?: MarketChoice | null;
  refreshMinutes?: number;
  id?: string;
  revision?: number;
  name: string;
  fileName: string;
  service: 'partnerads';
  enabled: boolean;
  allProducts: boolean;
  collections: Pick[];
  products: Pick[];
  shippingCost: string;
  freeShippingFrom: string | null;
  deliveryTime: string;
  category: string;
  url?: string;
  itemCount?: number | null;
  generatedAt?: number | null;
  lastError?: string | null;
};
const blank = (): Feed => ({
  name: 'PartnerAds',
  fileName: 'partnerads',
  service: 'partnerads',
  enabled: true,
  refreshMinutes: 15,
  allProducts: false,
  collections: [],
  products: [],
  shippingCost: '0.00',
  freeShippingFrom: null,
  deliveryTime: '1-3 hverdage',
  category: '',
});
async function api<T>(
  path: string,
  method = 'GET',
  body?: unknown,
): Promise<T> {
  const r = await tier1Fetch('/api/feeds' + path, {
    method,
    ...(body
      ? {
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        }
      : {}),
  });
  const d = (await r.json()) as T & { error?: string };
  if (!r.ok) throw Error(d.error || 'Handlingen kunne ikke gennemføres.');
  return d;
}
const variants = (n: number) =>
  `${n.toLocaleString('da-DK')} ${n === 1 ? 'variant' : 'varianter'}`;

function Step({
  number,
  title,
  description,
  children,
}: {
  number: number;
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <section className="grid gap-4 border-t border-[#f0ece6] px-5 py-6 first:border-t-0 sm:px-6 lg:grid-cols-[220px_1fr] lg:gap-8">
      <div>
        <p className="flex items-center gap-2 text-sm font-semibold">
          <span className="grid size-6 place-items-center rounded-full bg-[#f4efe7] text-xs text-[#7a5c30]">
            {number}
          </span>
          {title}
        </p>
        {description && (
          <p className="mt-1.5 text-xs leading-5 text-muted-foreground">
            {description}
          </p>
        )}
      </div>
      <div className="min-w-0 space-y-4">{children}</div>
    </section>
  );
}
function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <label className="block text-sm">
      <span className="mb-1.5 block text-xs font-medium">{label}</span>
      {children}
      {hint && (
        <span className="mt-1.5 block text-xs text-muted-foreground">
          {hint}
        </span>
      )}
    </label>
  );
}

function Picker({
  kind,
  selected,
  onChange,
}: {
  kind: 'collections' | 'products';
  selected: Pick[];
  onChange: (items: Pick[]) => void;
}) {
  const [q, setQ] = useState(''),
    [items, setItems] = useState<Pick[]>([]),
    [cursor, setCursor] = useState<string | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [searched, setSearched] = useState(false);
  async function search(after: string | null = null) {
    setBusy(true);
    setError('');
    try {
      const d = await api<{ items: Pick[]; nextCursor: string | null }>(
        '/catalog?' +
          new URLSearchParams({ kind, q, ...(after ? { after } : {}) }),
      );
      setItems((old) =>
        after
          ? [...new Map([...old, ...d.items].map((x) => [x.id, x])).values()]
          : d.items,
      );
      setCursor(d.nextCursor);
      setSearched(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const label = kind === 'collections' ? 'Kollektioner' : 'Enkeltprodukter';
  return (
    <div className="flex min-w-0 flex-col rounded-xl border bg-white">
      <div className="flex items-center justify-between gap-2 border-b px-4 py-3">
        <h3 className="text-sm font-semibold">{label}</h3>
        <span className="text-xs text-muted-foreground">
          {selected.length} valgt
        </span>
      </div>
      <div className="space-y-3 p-4">
        <div className="flex gap-2">
          <div className="relative min-w-0 flex-1">
            <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="pl-9"
              aria-label={
                kind === 'collections' ? 'Søg kollektioner' : 'Søg produkter'
              }
              placeholder="Søg efter navn"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  void search();
                }
              }}
            />
          </div>
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => void search()}
          >
            {busy ? 'Henter…' : 'Søg'}
          </Button>
        </div>
        {selected.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {selected.map((p) => (
              <button
                type="button"
                key={p.id}
                className="inline-flex max-w-full items-center gap-1 rounded-full bg-[#f4efe7] px-2.5 py-1 text-xs text-[#5c4524] hover:bg-[#ebe2d4]"
                aria-label={'Fjern ' + p.title}
                onClick={() => onChange(selected.filter((x) => x.id !== p.id))}
              >
                <span className="truncate">{p.title}</span>
                <X className="size-3 shrink-0" />
              </button>
            ))}
          </div>
        )}
        {items.length > 0 && (
          <div className="max-h-60 divide-y overflow-y-auto rounded-lg border">
            {items.map((p) => {
              const checked = selected.some((x) => x.id === p.id);
              return (
                <label
                  key={p.id}
                  className="flex cursor-pointer items-center gap-3 px-3 py-2 text-sm hover:bg-muted/40"
                >
                  <Checkbox
                    checked={checked}
                    onCheckedChange={(value) =>
                      onChange(
                        value
                          ? [...selected, p]
                          : selected.filter((x) => x.id !== p.id),
                      )
                    }
                  />
                  <span className="min-w-0 truncate">{p.title}</span>
                </label>
              );
            })}
          </div>
        )}
        {searched && !items.length && !busy && (
          <p className="text-xs text-muted-foreground">
            Ingen {label.toLocaleLowerCase('da')} matcher søgningen.
          </p>
        )}
        {!searched && !selected.length && (
          <p className="text-xs text-muted-foreground">
            Søg, eller tryk Søg uden tekst for at se alle.
          </p>
        )}
        {cursor && (
          <Button
            variant="ghost"
            size="sm"
            disabled={busy}
            onClick={() => void search(cursor)}
          >
            Hent flere
          </Button>
        )}
        {error && (
          <p role="alert" className="text-xs text-red-700">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}

function FileNameField({
  feed,
  folderUrl,
  onChange,
  onStatus,
}: {
  feed: Feed;
  folderUrl: string;
  onChange: (fileName: string) => void;
  onStatus: (ok: boolean) => void;
}) {
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(
    null,
  );
  const name = feed.fileName;
  useEffect(() => {
    if (!feedFileNamePattern.test(name)) {
      setStatus({
        ok: false,
        text: 'Brug små bogstaver, tal og bindestreger (højst 60 tegn).',
      });
      onStatus(false);
      return;
    }
    let active = true;
    setStatus(null);
    onStatus(false);
    const timer = setTimeout(() => {
      void api<{ available: boolean; reason?: string }>(
        '/file-name?' +
          new URLSearchParams({ name, ...(feed.id ? { feed: feed.id } : {}) }),
      )
        .then((d) => {
          if (!active) return;
          setStatus(
            d.available
              ? { ok: true, text: 'Navnet er ledigt.' }
              : { ok: false, text: d.reason || 'Navnet er optaget.' },
          );
          onStatus(d.available);
        })
        .catch((e) => {
          if (active) {
            setStatus({ ok: false, text: (e as Error).message });
            onStatus(false);
          }
        });
    }, 350);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [name, feed.id]);
  const Icon =
    status === null ? LoaderCircle : status.ok ? CircleCheck : CircleAlert;
  return (
    <div className="text-sm">
      <span className="mb-1.5 block text-xs font-medium">Link til feedet</span>
      <div
        className={
          'flex min-w-0 items-center overflow-hidden rounded-lg border bg-white focus-within:ring-2 focus-within:ring-ring/40 ' +
          (status && !status.ok ? 'border-red-300' : '')
        }
      >
        <span
          className="hidden truncate border-r bg-muted/40 px-3 py-2 font-mono text-xs text-muted-foreground sm:block"
          title={folderUrl}
        >
          {folderUrl}
        </span>
        <input
          aria-label="Filnavn i feedlinket"
          className="min-w-0 flex-1 bg-transparent px-3 py-2 font-mono text-sm outline-none"
          value={name}
          maxLength={60}
          onChange={(e) =>
            onChange(
              e.target.value.toLocaleLowerCase('da').replace(/\s+/g, '-'),
            )
          }
        />
        <span className="px-3 font-mono text-xs text-muted-foreground">
          .xml
        </span>
      </div>
      <span className="mt-1 block truncate font-mono text-[11px] text-muted-foreground sm:hidden">
        {folderUrl}
        {name}.xml
      </span>
      <span
        role="status"
        className={
          'mt-1.5 flex items-center gap-1.5 text-xs ' +
          (status?.ok
            ? 'text-emerald-700'
            : status
              ? 'text-red-700'
              : 'text-muted-foreground')
        }
      >
        <Icon
          className={'size-3.5 ' + (status === null ? 'animate-spin' : '')}
        />
        {status?.text || 'Kontrollerer navnet…'}
      </span>
    </div>
  );
}

// One card per active market, with its flag, currency and storefront. Only markets active in Shopify are offered.
function MarketPicker({
  markets,
  error,
  value,
  onChange,
}: {
  markets: Market[] | null;
  error: string;
  value: MarketChoice | null | undefined;
  onChange: (m: MarketChoice) => void;
}) {
  if (error)
    return (
      <p
        role="alert"
        className="flex items-start gap-2 rounded-xl bg-red-50 p-3 text-sm text-red-800"
      >
        <CircleAlert className="mt-0.5 size-4 shrink-0" />
        {error}
      </p>
    );
  if (!markets)
    return (
      <p
        role="status"
        className="flex items-center gap-2 text-sm text-muted-foreground"
      >
        <LoaderCircle className="size-4 animate-spin" />
        Henter markeder fra Shopify…
      </p>
    );
  if (!markets.length)
    return (
      <p className="text-sm text-muted-foreground">
        Der er ingen aktive markeder i Shopify.
      </p>
    );
  return (
    <div
      role="radiogroup"
      aria-label="Marked"
      className="grid gap-3 sm:grid-cols-2"
    >
      {markets.map((m) => {
        const chosen = value?.id === m.id;
        return (
          <button
            type="button"
            role="radio"
            aria-checked={chosen}
            key={m.id}
            onClick={() => onChange(choiceOf(m))}
            className={
              'flex items-start gap-3 rounded-xl border px-4 py-3 text-left text-sm transition ' +
              (chosen
                ? 'border-[#9a7440] bg-[#fbf7f0] ring-2 ring-[#9a7440]/25'
                : 'bg-white hover:bg-muted/40')
            }
          >
            <span className="mt-0.5 flex shrink-0 gap-1">
              {m.countries.slice(0, 3).map((c) => (
                <CountryFlag key={c} code={c} className="h-4 w-6" />
              ))}
            </span>
            <span className="min-w-0">
              <span className="block font-medium">
                {m.name}
                {m.primary && (
                  <span className="ml-2 text-xs font-normal text-muted-foreground">
                    Primært marked
                  </span>
                )}
              </span>
              <span className="block truncate text-xs text-muted-foreground">
                {m.currency} · {m.url.replace(/^https:\/\//, '')}
                {m.countries.length > 3 ? ` · ${m.countries.length} lande` : ''}
              </span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

function FeedEditor({
  feed,
  folderUrl,
  busy,
  markets,
  marketsError,
  onChange,
  onSave,
  onCancel,
}: {
  feed: Feed;
  folderUrl: string;
  busy: boolean;
  markets: Market[] | null;
  marketsError: string;
  onChange: (p: Partial<Feed>) => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  const [nameOk, setNameOk] = useState(false),
    top = useRef<HTMLElement>(null),
    currency = feed.market?.currency || 'DKK';
  // A market must be chosen whenever Shopify's markets could be read.
  const marketOk = !!feed.market || !!marketsError;
  useEffect(() => {
    top.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [feed.id]);
  const selection = feed.allProducts
    ? 'Alle aktive produkter'
    : [
        feed.collections.length &&
          `${feed.collections.length} ${feed.collections.length === 1 ? 'kollektion' : 'kollektioner'}`,
        feed.products.length &&
          `${feed.products.length} ${feed.products.length === 1 ? 'produkt' : 'produkter'}`,
      ]
        .filter(Boolean)
        .join(' og ') || 'Intet valgt endnu';
  return (
    <section
      ref={top}
      aria-label={feed.id ? 'Redigér feed' : 'Nyt feed'}
      className="scroll-mt-6 overflow-hidden rounded-2xl border border-[#e9e2d7] bg-white shadow-[0_8px_30px_rgba(70,50,20,0.05)]"
    >
      <header className="flex flex-wrap items-center justify-between gap-3 border-b bg-[#fcfbf9] px-5 py-4 sm:px-6">
        <div>
          <p className="eyebrow">{feed.id ? 'Redigér feed' : 'Nyt feed'}</p>
          <h2 className="text-lg font-semibold">{feed.name || 'Uden navn'}</h2>
        </div>
        <Button variant="ghost" size="sm" onClick={onCancel}>
          <X className="size-4" />
          Luk
        </Button>
      </header>
      <fieldset disabled={busy}>
        <Step
          number={1}
          title="Marked"
          description="Feedet får markedets priser, valuta, sprog og webshopadresse fra Shopify. Kun aktive markeder kan vælges."
        >
          <MarketPicker
            markets={markets}
            error={marketsError}
            value={feed.market}
            onChange={(market) => onChange({ market })}
          />
        </Step>
        <Step
          number={2}
          title="Navn og link"
          description="Navnet ses kun i WebshopToolbox. Linket er det, du giver til PartnerAds."
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Feednavn">
              <Input
                value={feed.name}
                maxLength={100}
                onChange={(e) => onChange({ name: e.target.value })}
              />
            </Field>
            <Field label="Tjeneste">
              <Input value="PartnerAds" readOnly disabled />
            </Field>
          </div>
          <FileNameField
            feed={feed}
            folderUrl={folderUrl}
            onChange={(fileName) => onChange({ fileName })}
            onStatus={setNameOk}
          />
        </Step>
        <Step
          number={3}
          title="Produkter"
          description={`Kun aktive produkter og salgbare varianter, der sælges på markedet, kommer med. Valgt: ${selection}.`}
        >
          <label className="flex items-center justify-between gap-4 rounded-xl border bg-[#fcfbf9] px-4 py-3 text-sm">
            <span>
              <span className="block font-medium">
                Medtag alle aktive produkter
              </span>
              <span className="text-xs text-muted-foreground">
                Slå fra for at vælge kollektioner og enkeltprodukter.
              </span>
            </span>
            <Switch
              checked={feed.allProducts}
              onCheckedChange={(value) => onChange({ allProducts: value })}
              aria-label="Medtag alle aktive produkter"
            />
          </label>
          {!feed.allProducts && (
            <>
              <div className="grid gap-4 xl:grid-cols-2">
                <Picker
                  key={'c' + (feed.id || 'new')}
                  kind="collections"
                  selected={feed.collections}
                  onChange={(collections) => onChange({ collections })}
                />
                <Picker
                  key={'p' + (feed.id || 'new')}
                  kind="products"
                  selected={feed.products}
                  onChange={(products) => onChange({ products })}
                />
              </div>
              <p className="text-xs text-muted-foreground">
                Kollektioner og enkeltprodukter lægges sammen uden dubletter.
              </p>
            </>
          )}
          <Field
            label="Kategorinavn i feedet (valgfrit)"
            hint="Tomt felt bruger kollektionens navn eller Shopifys produkttype. Indgår et produkt flere steder, bruges den første valgte kollektion."
          >
            <Input
              value={feed.category}
              maxLength={200}
              placeholder="Fx Champagnesabler"
              onChange={(e) => onChange({ category: e.target.value })}
            />
          </Field>
        </Step>
        <Step
          number={4}
          title="Fragt og levering"
          description="Gælder kun feedet og ændrer ikke checkout i Shopify."
        >
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Fragtpris inkl. moms">
              <div className="relative">
                <Input
                  inputMode="decimal"
                  className="pr-12"
                  value={feed.shippingCost}
                  onChange={(e) =>
                    onChange({ shippingCost: e.target.value.replace(',', '.') })
                  }
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
                  {currency}
                </span>
              </div>
            </Field>
            <Field
              label="Fri fragt fra (valgfrit)"
              hint="Beregnes pr. variant."
            >
              <div className="relative">
                <Input
                  inputMode="decimal"
                  className="pr-12"
                  placeholder="Ingen grænse"
                  value={feed.freeShippingFrom ?? ''}
                  onChange={(e) =>
                    onChange({
                      freeShippingFrom: e.target.value
                        ? e.target.value.replace(',', '.')
                        : null,
                    })
                  }
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
                  {currency}
                </span>
              </div>
            </Field>
            <Field label="Leveringstid">
              <Input
                maxLength={100}
                value={feed.deliveryTime}
                onChange={(e) => onChange({ deliveryTime: e.target.value })}
              />
            </Field>
          </div>
        </Step>
        <Step
          number={5}
          title="Opdatering og offentliggørelse"
          description="Feedet hentes på ny fra Shopify, når PartnerAds henter linket, og data er ældre end den valgte frekvens. Alle med linket kan læse produktdata; linket indeholder ingen Shopify-adgangsnøgle."
        >
          <Field
            label="Opdatér produktdata"
            hint="Oftere giver mere aktuelle priser og lager. Sjældnere belaster Shopify mindre ved store feeds. Opdatér produkter henter altid med det samme."
          >
            <select
              className="h-9 w-full rounded-lg border bg-white px-3 text-sm sm:w-64"
              value={feed.refreshMinutes || 15}
              onChange={(e) =>
                onChange({ refreshMinutes: Number(e.target.value) })
              }
            >
              {refreshOptions.map(([m, label]) => (
                <option key={m} value={m}>
                  {label}
                </option>
              ))}
            </select>
          </Field>
          <label className="flex items-center justify-between gap-4 rounded-xl border bg-[#fcfbf9] px-4 py-3 text-sm">
            <span>
              <span className="block font-medium">Feedet er aktivt</span>
              <span className="text-xs text-muted-foreground">
                Slå fra for at sætte linket på pause uden at slette feedet.
              </span>
            </span>
            <Switch
              checked={feed.enabled}
              onCheckedChange={(value) => onChange({ enabled: value })}
              aria-label="Feedet er aktivt"
            />
          </label>
        </Step>
        <footer className="flex flex-wrap items-center justify-end gap-3 border-t bg-[#fcfbf9] px-5 py-4 sm:px-6">
          {(!nameOk || !marketOk) && (
            <span className="mr-auto text-xs text-muted-foreground">
              {marketOk
                ? 'Vælg et ledigt filnavn for at gemme.'
                : 'Vælg et marked for at gemme.'}
            </span>
          )}
          <Button variant="outline" type="button" onClick={onCancel}>
            Annullér
          </Button>
          <Button
            type="button"
            disabled={!nameOk || !marketOk}
            onClick={onSave}
          >
            {busy ? 'Gemmer…' : feed.id ? 'Gem ændringer' : 'Opret feed'}
          </Button>
        </footer>
      </fieldset>
    </section>
  );
}

// The market's flag and name; feeds made before markets could be chosen are for the primary market.
function MarketBadge({
  feed,
  primary,
}: {
  feed: Feed;
  primary: Market | null;
}) {
  const country = feed.market?.country || primary?.countries[0],
    name = feed.market?.name || primary?.name || 'Primært marked';
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full border bg-white px-2 py-0.5 text-xs font-medium"
      title={
        country
          ? 'Marked: ' + name + ' (' + countryName(country) + ')'
          : 'Marked: ' + name
      }
    >
      {country && <CountryFlag code={country} />}
      {name}
      {feed.market?.currency && (
        <span className="text-muted-foreground">· {feed.market.currency}</span>
      )}
    </span>
  );
}

function FeedCard({
  feed,
  primary,
  busy,
  onEdit,
  onAction,
  onCopied,
  onCopyFailed,
}: {
  feed: Feed;
  primary: Market | null;
  busy: boolean;
  onEdit: () => void;
  onAction: (type: 'refresh' | 'rotate' | 'delete') => void;
  onCopied: () => void;
  onCopyFailed: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const copy = () =>
    void navigator.clipboard
      .writeText(feed.url || '')
      .then(() => {
        setCopied(true);
        onCopied();
        setTimeout(() => setCopied(false), 2000);
      })
      .catch(onCopyFailed);
  return (
    <article className="overflow-hidden rounded-2xl border border-[#e9e2d7] bg-white shadow-[0_8px_30px_rgba(70,50,20,0.04)]">
      <div className="flex flex-wrap items-start justify-between gap-3 p-5 sm:p-6">
        <div className="flex min-w-0 items-start gap-3">
          <span className="relative grid size-10 shrink-0 place-items-center rounded-xl bg-[#f4efe7] text-[#9a7440]">
            <Rss className="size-5" />
            {(feed.market?.country || primary?.countries[0]) && (
              <CountryFlag
                code={feed.market?.country || primary!.countries[0]}
                className="absolute -bottom-1 -right-1.5 ring-2 ring-white"
              />
            )}
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="truncate text-base font-semibold">{feed.name}</h2>
              <MarketBadge feed={feed} primary={primary} />
              <Badge
                variant="outline"
                className={
                  feed.enabled
                    ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                    : 'border-slate-200 bg-slate-50 text-slate-600'
                }
              >
                {feed.enabled ? 'Aktivt' : 'På pause'}
              </Badge>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              PartnerAds ·{' '}
              {feed.itemCount == null
                ? 'Ikke hentet endnu'
                : variants(feed.itemCount)}{' '}
              ·{' '}
              {feed.generatedAt
                ? 'Opdateret ' + formatDateTime(feed.generatedAt * 1000)
                : 'Aldrig opdateret'}{' '}
              · Opdateres {refreshLabel(feed.refreshMinutes)}
            </p>
          </div>
        </div>
        <Button variant="outline" size="sm" disabled={busy} onClick={onEdit}>
          <Pencil className="size-3.5" />
          Redigér
        </Button>
      </div>
      {feed.lastError && (
        <p
          role="alert"
          className="mx-5 mb-4 flex items-start gap-2 rounded-xl bg-red-50 p-3 text-sm text-red-800 sm:mx-6"
        >
          <CircleAlert className="mt-0.5 size-4 shrink-0" />
          {feed.lastError}
        </p>
      )}
      <div className="mx-5 mb-5 flex min-w-0 items-center gap-2 rounded-xl border bg-[#fcfbf9] py-1.5 pl-3 pr-1.5 sm:mx-6">
        <Link2 className="size-4 shrink-0 text-muted-foreground" />
        <input
          aria-label={'Feedlink til ' + feed.name}
          readOnly
          value={feed.url || ''}
          onFocus={(e) => e.currentTarget.select()}
          className="min-w-0 flex-1 truncate bg-transparent font-mono text-xs outline-none"
        />
        <Button
          variant="ghost"
          size="sm"
          aria-label="Kopiér feedlink"
          onClick={copy}
        >
          {copied ? (
            <Check className="size-3.5 text-emerald-700" />
          ) : (
            <Copy className="size-3.5" />
          )}
          <span className="hidden sm:inline">
            {copied ? 'Kopieret' : 'Kopiér'}
          </span>
        </Button>
      </div>
      <div className="flex flex-wrap items-center gap-2 border-t bg-[#fcfbf9] px-5 py-3 sm:px-6">
        <Button size="sm" disabled={busy} onClick={() => onAction('refresh')}>
          <RefreshCw className={'size-3.5 ' + (busy ? 'animate-spin' : '')} />
          Opdatér produkter
        </Button>
        {feed.generatedAt && (
          <a
            className="inline-flex h-8 items-center gap-1.5 rounded-lg border bg-white px-3 text-sm hover:bg-muted/40"
            href={tier1Url('/api/feeds/' + feed.id + '/preview')}
            target="_blank"
            rel="noreferrer"
          >
            <ExternalLink className="size-3.5" />
            Se XML
          </a>
        )}
        {!feed.fileName && (
          <Button
            variant="ghost"
            size="sm"
            disabled={busy}
            onClick={() => onAction('rotate')}
          >
            Skift link
          </Button>
        )}
        <Button
          variant="ghost"
          size="sm"
          className="ml-auto text-red-700 hover:bg-red-50 hover:text-red-800"
          disabled={busy}
          onClick={() => onAction('delete')}
        >
          <Trash2 className="size-3.5" />
          Slet
        </Button>
      </div>
    </article>
  );
}

export function ProductFeeds() {
  const { confirm: ask, dialog } = useConfirm(),
    [folderUrl, setFolderUrl] = useState('');
  const [feeds, setFeeds] = useState<Feed[]>([]),
    [edit, setEdit] = useState<Feed | null>(null),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(''),
    [error, setError] = useState(''),
    [loaded, setLoaded] = useState(false);
  const [markets, setMarkets] = useState<Market[] | null>(null),
    [marketsError, setMarketsError] = useState('');
  const primary = markets?.find((m) => m.primary) || null;
  async function load() {
    const d = await api<{ feeds: Feed[]; folderUrl: string }>('');
    setFeeds(d.feeds);
    setFolderUrl(d.folderUrl);
    setLoaded(true);
  }
  useEffect(() => {
    void load().catch((e) => {
      setError(e.message);
      setLoaded(true);
    });
    void api<{ markets: Market[] }>('/markets')
      .then((d) => setMarkets(d.markets))
      .catch((e) => setMarketsError((e as Error).message));
  }, []);
  // A new feed starts on the primary market.
  const create = () => {
    setEdit({ ...blank(), market: primary ? choiceOf(primary) : null });
    setError('');
    setMessage('');
  };
  function change(p: Partial<Feed>) {
    setEdit((v) => (v ? { ...v, ...p } : v));
  }
  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      await fn();
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function save() {
    if (!edit) return;
    await run(async () => {
      await api(edit.id ? '/' + edit.id : '', edit.id ? 'PUT' : 'POST', edit);
      setEdit(null);
      setMessage(
        edit.enabled
          ? 'Feedet er gemt og aktivt. Vælg Opdatér produkter for at hente produktdata.'
          : 'Feedet er gemt, men sat på pause: linket svarer først, når du slår "Feedet er aktivt" til.',
      );
    });
  }
  async function action(f: Feed, type: 'refresh' | 'rotate' | 'delete') {
    if (
      type === 'delete' &&
      !(await ask({
        title: 'Slet feed',
        message: `Slet feedet “${f.name}”? Linket stopper med at virke.`,
        confirmLabel: 'Slet feed',
      }))
    )
      return;
    if (
      type === 'rotate' &&
      !(await ask({
        title: 'Skift link',
        message:
          'Opret et nyt link? Det gamle link stopper straks med at virke og skal erstattes hos PartnerAds.',
        confirmLabel: 'Skift link',
      }))
    )
      return;
    await run(async () => {
      await api(
        '/' + f.id + (type === 'delete' ? '' : '/' + type),
        type === 'delete' ? 'DELETE' : 'POST',
        { revision: f.revision },
      );
      setMessage(
        type === 'refresh'
          ? 'Produktdata er opdateret.'
          : type === 'rotate'
            ? 'Nyt link oprettet. Opdatér linket hos PartnerAds.'
            : 'Feedet er slettet.',
      );
    });
  }
  return (
    <div className="mx-auto max-w-[1100px] px-5 py-7 md:px-8 md:py-9">
      {dialog}
      <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="eyebrow">Tools · PartnerAds</p>
          <PageTitle title="Produktfeeds" />
          <p className="mt-2 text-sm text-muted-foreground">
            Del webshoppens produkter med PartnerAds som et XML-feed.
          </p>
        </div>
        {!edit && (
          <Button
            className="h-10 rounded-xl px-4"
            disabled={busy}
            onClick={create}
          >
            <Plus className="size-4" />
            Opret feed
          </Button>
        )}
      </header>
      <p className="mb-6 flex items-start gap-2 rounded-xl border border-[#e9e2d7] bg-[#faf8f5] px-4 py-3 text-xs leading-5 text-muted-foreground">
        <Info className="mt-0.5 size-4 shrink-0" />
        Feeds opdateres automatisk, når PartnerAds henter dem, og data er ældre
        end feedets valgte frekvens (standard hvert 15. minut). Hvert feed er
        til ét marked med markedets priser inkl. moms i markedets valuta.
      </p>
      {error && (
        <div
          role="alert"
          className="mb-5 flex flex-wrap items-center gap-2 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800"
        >
          <CircleAlert className="size-4" />
          {error}
          <button className="ml-auto underline" onClick={() => void run(load)}>
            Hent igen
          </button>
        </div>
      )}
      {message && (
        <p
          role="status"
          className="mb-5 flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900"
        >
          <CircleCheck className="size-4" />
          {message}
        </p>
      )}
      {edit && (
        <div className="mb-8">
          <FeedEditor
            feed={edit}
            folderUrl={folderUrl}
            busy={busy}
            markets={markets}
            marketsError={marketsError}
            onChange={change}
            onSave={() => void save()}
            onCancel={() => setEdit(null)}
          />
        </div>
      )}
      {!loaded && (
        <p
          role="status"
          className="flex items-center gap-2 text-sm text-muted-foreground"
        >
          <LoaderCircle className="size-4 animate-spin" />
          Henter feeds…
        </p>
      )}
      {loaded && !feeds.length && !error && !edit && (
        <div className="rounded-2xl border border-dashed border-[#e0d6c6] bg-white px-6 py-14 text-center">
          <span className="mx-auto mb-4 grid size-12 place-items-center rounded-2xl bg-[#f4efe7] text-[#9a7440]">
            <Rss className="size-6" />
          </span>
          <h2 className="text-lg font-semibold">Dit første produktfeed</h2>
          <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
            Vælg produkter, giv feedet et navn, og kopiér linket til PartnerAds.
          </p>
          <Button className="mt-5 rounded-xl" onClick={create}>
            <Plus className="size-4" />
            Opret feed
          </Button>
        </div>
      )}
      <div className="space-y-4">
        {feeds
          .filter((f) => f.id !== edit?.id)
          .map((f) => (
            <FeedCard
              key={f.id}
              feed={f}
              primary={primary}
              busy={busy}
              onEdit={() => {
                setEdit({
                  ...structuredClone(f),
                  market: f.market ?? (primary ? choiceOf(primary) : null),
                  fileName: f.fileName || slugify(f.name) || 'feed',
                });
                setError('');
                setMessage('');
              }}
              onAction={(type) => void action(f, type)}
              onCopied={() => setMessage('Feedlink kopieret.')}
              onCopyFailed={() =>
                setError(
                  'Linket kunne ikke kopieres. Markér og kopiér det fra feltet.',
                )
              }
            />
          ))}
      </div>
    </div>
  );
}
