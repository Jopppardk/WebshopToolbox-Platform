import { useEffect, useState } from 'react';
import { Play, RotateCcw, Save, Search, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  NativeSelect,
  NativeSelectOption,
} from '@/components/ui/native-select';
import { tier1Fetch as fetch } from '@/platform/transport';
import { formatDateTime } from '@/lib/format';

// Custom app "Webshop-synkronisering" (platform/shop-sync.ts).
type Pick = { id: string; title: string };
type Result = {
  dryRun: boolean;
  finishedAt: string;
  created: number;
  updated: number;
  removed: number;
  stock: number;
  collections: number;
  waiting: number;
  errors: string[];
  actions: string[];
  prices: boolean;
};
type Settings = {
  sourceWebshopId: string;
  targetWebshopId: string;
  sourceLocationId: string;
  targetLocationId: string;
  intervalMinutes: number;
  enabled: boolean;
  selection: { collections: Pick[]; products: Pick[] };
  revision: string;
  lastRunAt: string | null;
  nextRunAt: string | null;
  lastResult: Result | null;
};
type Loaded = {
  settings: Settings | null;
  webshops: Array<{ id: string; name: string }>;
  canManage: boolean;
  writes: boolean;
  intervals: number[];
};
type Status = {
  products: Array<{
    source_product_id: string;
    state: 'creating' | 'linked' | 'removed';
    title: string;
    synced_at: string | null;
    error: string | null;
  }>;
  collections: Array<{
    source_collection_id: string;
    title: string;
    synced_at: string | null;
    error: string | null;
  }>;
  uncertain: Array<{
    source_variant_id: string;
    title: string;
    error: string | null;
  }>;
};
const base = '/api/custom-apps/webshop-sync';
async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(base + path, {
    cache: 'no-store',
    ...init,
    headers: init?.body ? { 'Content-Type': 'application/json' } : undefined,
  });
  const data = (await response.json()) as T & { error?: string };
  if (!response.ok)
    throw new Error(data.error || 'Handlingen kunne ikke gennemføres.');
  return data;
}
const intervalName = (minutes: number) =>
  minutes < 60
    ? `Hvert ${minutes}. minut`
    : minutes === 60
      ? 'Hver time'
      : minutes === 1440
        ? 'Én gang i døgnet'
        : `Hver ${minutes / 60}. time`;
const stateName = {
  creating: 'Oprettes',
  linked: 'Synkroniseret',
  removed: 'Ikke længere valgt · kladde',
};

function Locations({
  shop,
  value,
  onChange,
  label,
  disabled,
}: {
  shop: string;
  value: string;
  onChange: (id: string) => void;
  label: string;
  disabled: boolean;
}) {
  const [locations, setLocations] = useState<Pick[]>([]);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!shop) return;
    call<{ locations: Array<{ id: string; name: string }>; error?: string }>(
      '/locations?shop=' + encodeURIComponent(shop),
    )
      .then((d) => {
        setLocations(d.locations.map((l) => ({ id: l.id, title: l.name })));
        setError(d.error || '');
      })
      .catch((e: Error) => setError(e.message));
  }, [shop]);
  return (
    <label className="grid gap-1.5 text-sm">
      {label}
      <NativeSelect
        value={value}
        disabled={disabled || !shop}
        onChange={(e) => onChange(e.target.value)}
      >
        <NativeSelectOption value="">Vælg lokation</NativeSelectOption>
        {locations.map((l) => (
          <NativeSelectOption key={l.id} value={l.id}>
            {l.title}
          </NativeSelectOption>
        ))}
      </NativeSelect>
      {error && <span className="text-xs text-destructive">{error}</span>}
    </label>
  );
}

export function ShopSync() {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [status, setStatus] = useState<Status | null>(null);
  const [draft, setDraft] = useState<Omit<
    Settings,
    'revision' | 'lastRunAt' | 'nextRunAt' | 'lastResult'
  > | null>(null);
  const [catalog, setCatalog] = useState<{
    collections: Array<Pick & { products: number | null }>;
    products: Array<Pick & { status: string }>;
  } | null>(null);
  const [query, setQuery] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const load = () =>
    Promise.all([call<Loaded>('/settings'), call<Status>('/status')]).then(
      ([d, s]) => {
        setLoaded(d);
        setStatus(s);
        setResult(d.settings?.lastResult ?? null);
        setDraft(
          d.settings
            ? {
                sourceWebshopId: d.settings.sourceWebshopId,
                targetWebshopId: d.settings.targetWebshopId,
                sourceLocationId: d.settings.sourceLocationId,
                targetLocationId: d.settings.targetLocationId,
                intervalMinutes: d.settings.intervalMinutes,
                enabled: d.settings.enabled,
                selection: d.settings.selection,
              }
            : {
                sourceWebshopId: '',
                targetWebshopId: '',
                sourceLocationId: '',
                targetLocationId: '',
                intervalMinutes: 60,
                enabled: false,
                selection: { collections: [], products: [] },
              },
        );
      },
    );
  useEffect(() => {
    load().catch((e: Error) => setMessage(e.message));
  }, []);
  const source = draft?.sourceWebshopId || '';
  const search = (q: string) =>
    call<NonNullable<typeof catalog>>(
      `/catalog?shop=${encodeURIComponent(source)}&q=${encodeURIComponent(q)}`,
    );
  useEffect(() => {
    if (!source) return;
    call<NonNullable<typeof catalog>>(
      `/catalog?shop=${encodeURIComponent(source)}&q=`,
    )
      .then(setCatalog)
      .catch((e: Error) => setMessage(e.message));
  }, [source]);
  if (!loaded || !draft)
    return (
      <p className="text-sm text-muted-foreground">{message || 'Indlæser…'}</p>
    );
  const edit = loaded.canManage && !busy;
  const set = (patch: Partial<typeof draft>) =>
    setDraft({ ...draft, ...patch });
  const chosen = (list: Pick[], id: string) => list.some((p) => p.id === id);
  const toggle = (key: 'collections' | 'products', item: Pick) => {
    const list = draft.selection[key];
    set({
      selection: {
        ...draft.selection,
        [key]: chosen(list, item.id)
          ? list.filter((p) => p.id !== item.id)
          : [...list, { id: item.id, title: item.title }],
      },
    });
  };
  const save = async () => {
    setBusy(true);
    setMessage('');
    try {
      await call('/settings', {
        method: 'PUT',
        body: JSON.stringify({
          ...draft,
          revision: loaded.settings?.revision ?? null,
        }),
      });
      await load();
      setMessage('Opsætningen er gemt.');
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const run = async () => {
    setBusy(true);
    setMessage('');
    try {
      const d = await call<{ result: Result }>('/run', {
        method: 'POST',
        body: '{}',
      });
      setResult(d.result);
      if (!d.result.dryRun) await load();
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const reset = async (variant: string) => {
    setBusy(true);
    try {
      await call('/reset', {
        method: 'POST',
        body: JSON.stringify({ sourceVariantId: variant }),
      });
      setStatus(await call<Status>('/status'));
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const shopName = (id: string) =>
    loaded.webshops.find((w) => w.id === id)?.name || 'webshoppen';
  if (loaded.webshops.length < 2)
    return (
      <p className="text-sm">
        Virksomheden skal have mindst to webshops forbundet til Shopify, før der
        kan synkroniseres.
      </p>
    );
  return (
    <div className="grid gap-6">
      <section className="rounded-2xl border bg-white p-5 text-sm">
        <h2 className="mb-2 font-semibold">Sådan virker det</h2>
        <ul className="grid list-disc gap-1 pl-5 text-muted-foreground">
          <li>
            De valgte kollektioner og produkter oprettes i modtagerwebshoppen og
            holdes opdateret: tekster, billeder, varianter, priser, kostpris,
            vægt og emballagefelter. Priser kopieres kun mellem webshops med
            samme valuta; ellers oprettes produkterne som kladde uden pris.
          </li>
          <li>
            Lageret følges ad begge veje: det, modtagerwebshoppen sælger,
            trækkes fra kildens lager, og modtageren får derefter kildens antal.
          </li>
          <li>
            Synkroniserede produkter tælles ikke med i modtagerens lagerværdi og
            vises på Lager under «Synkroniseret fra en anden webshop». Emballage
            indberettes af den webshop, der sælger varen.
          </li>
          <li>
            Fravalgte produkter sættes til kladde i modtagerwebshoppen; intet
            slettes.
          </li>
        </ul>
      </section>
      <section className="grid gap-4 rounded-2xl border bg-white p-5">
        <h2 className="font-semibold">Opsætning</h2>
        <div className="grid gap-4 md:grid-cols-2">
          <label className="grid gap-1.5 text-sm">
            Kildewebshop (hvor produkterne vedligeholdes)
            <NativeSelect
              value={draft.sourceWebshopId}
              disabled={!edit}
              onChange={(e) =>
                set({
                  sourceWebshopId: e.target.value,
                  sourceLocationId: '',
                  selection: { collections: [], products: [] },
                })
              }
            >
              <NativeSelectOption value="">Vælg webshop</NativeSelectOption>
              {loaded.webshops.map((w) => (
                <NativeSelectOption key={w.id} value={w.id}>
                  {w.name}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </label>
          <label className="grid gap-1.5 text-sm">
            Modtagerwebshop (hvor kopierne oprettes)
            <NativeSelect
              value={draft.targetWebshopId}
              disabled={!edit}
              onChange={(e) =>
                set({ targetWebshopId: e.target.value, targetLocationId: '' })
              }
            >
              <NativeSelectOption value="">Vælg webshop</NativeSelectOption>
              {loaded.webshops
                .filter((w) => w.id !== draft.sourceWebshopId)
                .map((w) => (
                  <NativeSelectOption key={w.id} value={w.id}>
                    {w.name}
                  </NativeSelectOption>
                ))}
            </NativeSelect>
          </label>
          <Locations
            label="Lagerlokation i kilden"
            shop={draft.sourceWebshopId}
            value={draft.sourceLocationId}
            disabled={!edit}
            onChange={(id) => set({ sourceLocationId: id })}
          />
          <Locations
            label="Lagerlokation i modtageren"
            shop={draft.targetWebshopId}
            value={draft.targetLocationId}
            disabled={!edit}
            onChange={(id) => set({ targetLocationId: id })}
          />
          <label className="grid gap-1.5 text-sm">
            Synkroniseringsinterval
            <NativeSelect
              value={String(draft.intervalMinutes)}
              disabled={!edit}
              onChange={(e) => set({ intervalMinutes: Number(e.target.value) })}
            >
              {loaded.intervals.map((m) => (
                <NativeSelectOption key={m} value={String(m)}>
                  {intervalName(m)}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </label>
          <label className="flex items-center gap-2 self-end text-sm">
            <input
              type="checkbox"
              checked={draft.enabled}
              disabled={!edit}
              onChange={(e) => set({ enabled: e.target.checked })}
            />
            Synkronisér automatisk med det valgte interval
          </label>
        </div>
        {source && catalog && (
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <h3 className="mb-2 text-sm font-semibold">
                Kollektioner i {shopName(source)} (
                {draft.selection.collections.length} valgt)
              </h3>
              <div className="max-h-72 overflow-y-auto rounded-xl border p-2">
                {catalog.collections.map((c) => (
                  <label key={c.id} className="flex gap-2 p-1 text-sm">
                    <input
                      type="checkbox"
                      disabled={!edit}
                      checked={chosen(draft.selection.collections, c.id)}
                      onChange={() => toggle('collections', c)}
                    />
                    {c.title}
                    {c.products !== null && (
                      <span className="text-muted-foreground">
                        ({c.products})
                      </span>
                    )}
                  </label>
                ))}
              </div>
            </div>
            <div>
              <h3 className="mb-2 text-sm font-semibold">
                Enkelte produkter ({draft.selection.products.length} valgt)
              </h3>
              <form
                className="mb-2 flex gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  search(query)
                    .then(setCatalog)
                    .catch((e: Error) => setMessage(e.message));
                }}
              >
                <Input
                  value={query}
                  placeholder="Søg på produktnavn"
                  onChange={(e) => setQuery(e.target.value)}
                />
                <Button type="submit" variant="outline" aria-label="Søg">
                  <Search />
                </Button>
              </form>
              <div className="max-h-40 overflow-y-auto rounded-xl border p-2">
                {catalog.products.map((p) => (
                  <label key={p.id} className="flex gap-2 p-1 text-sm">
                    <input
                      type="checkbox"
                      disabled={!edit}
                      checked={chosen(draft.selection.products, p.id)}
                      onChange={() => toggle('products', p)}
                    />
                    {p.title}
                    {p.status !== 'ACTIVE' && (
                      <span className="text-muted-foreground">(kladde)</span>
                    )}
                  </label>
                ))}
              </div>
              {draft.selection.products.length > 0 && (
                <ul className="mt-2 grid gap-1 text-sm">
                  {draft.selection.products.map((p) => (
                    <li key={p.id} className="flex items-center gap-2">
                      {edit && (
                        <button
                          type="button"
                          aria-label={'Fjern ' + p.title}
                          onClick={() => toggle('products', p)}
                        >
                          <X className="size-4" />
                        </button>
                      )}
                      {p.title}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}
        {loaded.canManage && (
          <div className="flex flex-wrap gap-3">
            <Button disabled={busy} onClick={() => void save()}>
              <Save />
              Gem opsætning
            </Button>
            {loaded.settings && (
              <Button
                variant="outline"
                disabled={busy}
                onClick={() => void run()}
              >
                <Play />
                {loaded.writes ? 'Synkronisér nu' : 'Vis hvad der vil ske'}
              </Button>
            )}
          </div>
        )}
        {!loaded.writes && (
          <p className="text-xs text-muted-foreground">
            Testmiljø: ændringer i Shopify er blokeret, så en kørsel viser kun,
            hvad den ville gøre.
          </p>
        )}
        {message && (
          <p aria-live="polite" className="text-sm">
            {message}
          </p>
        )}
      </section>
      {result && (
        <section className="rounded-2xl border bg-white p-5 text-sm">
          <h2 className="mb-2 font-semibold">
            {result.dryRun ? 'Hvad en kørsel vil gøre' : 'Seneste kørsel'} ·{' '}
            {formatDateTime(result.finishedAt)}
          </h2>
          <p>
            {result.created} oprettet · {result.updated} opdateret ·{' '}
            {result.removed} sat til kladde · {result.stock} lagerændringer ·{' '}
            {result.collections} kollektioner
            {result.waiting
              ? ` · ${result.waiting} venter til næste kørsel`
              : ''}
          </p>
          {!result.prices && (
            <p className="mt-1 text-muted-foreground">
              Webshoppene har forskellig valuta, så priser kopieres ikke.
            </p>
          )}
          {!!result.errors.length && (
            <ul className="mt-2 grid list-disc gap-1 pl-5 text-destructive">
              {result.errors.map((e, i) => (
                <li key={i}>{e}</li>
              ))}
            </ul>
          )}
          {!!result.actions.length && (
            <ul className="mt-2 grid list-disc gap-1 pl-5">
              {result.actions.map((a, i) => (
                <li key={i}>{a}</li>
              ))}
            </ul>
          )}
        </section>
      )}
      {loaded.settings && (
        <p className="text-sm text-muted-foreground">
          Seneste kørsel: {formatDateTime(loaded.settings.lastRunAt)} · Næste:{' '}
          {loaded.settings.enabled
            ? formatDateTime(loaded.settings.nextRunAt)
            : 'automatisk synkronisering er slået fra'}
        </p>
      )}
      {!!status?.uncertain.length && (
        <section className="rounded-2xl border border-destructive bg-white p-5 text-sm">
          <h2 className="mb-2 font-semibold">Lager, der kræver kontrol</h2>
          <p className="mb-2 text-muted-foreground">
            En lagerændring blev sendt uden sikkert svar fra Shopify. Kontrollér
            antallet i begge webshops; ved nulstilling får modtageren kildens
            antal ved næste kørsel.
          </p>
          <ul className="grid gap-2">
            {status.uncertain.map((u) => (
              <li key={u.source_variant_id} className="flex items-center gap-3">
                {u.title}
                {loaded.canManage && (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy}
                    onClick={() => void reset(u.source_variant_id)}
                  >
                    <RotateCcw />
                    Nulstil
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
      {!!status?.products.length && (
        <section className="overflow-x-auto rounded-2xl border bg-white">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="border-b text-left">
                <th className="p-4">
                  Produkt fra {shopName(loaded.settings?.sourceWebshopId || '')}
                </th>
                <th>Status</th>
                <th>Senest</th>
                <th className="pr-4">Fejl</th>
              </tr>
            </thead>
            <tbody>
              {status.products.map((p) => (
                <tr
                  key={p.source_product_id}
                  className="border-b last:border-0"
                >
                  <td className="p-4 font-medium">{p.title}</td>
                  <td>{stateName[p.state]}</td>
                  <td>{formatDateTime(p.synced_at)}</td>
                  <td className="pr-4 text-destructive">{p.error || ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </div>
  );
}
