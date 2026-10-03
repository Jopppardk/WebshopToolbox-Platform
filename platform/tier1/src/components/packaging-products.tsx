'use client';
import { useEffect, useMemo, useState } from 'react';
import {
  CircleAlert,
  CircleCheck,
  Search,
  LoaderCircle,
  Save,
} from 'lucide-react';
import { tier1Fetch as fetch } from '@/platform/transport';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

type Product = {
  id: string;
  title: string;
  status: string;
  weightGrams: number | null;
  reportable: 'yes' | 'no' | 'unknown';
  openLines: number;
};
type Draft = { weight: string; reportable: 'yes' | 'no' | 'unknown' };
type Filter = 'all' | 'missing' | 'complete';
const pageSize = 25;
// Complete: a weight, and for a weight above 0 also whether it is reportable. 0 grams is an approved product.
const complete = (p: { weightGrams: number | null; reportable: string }) =>
  p.weightGrams !== null && (p.weightGrams === 0 || p.reportable !== 'unknown');

export function PackagingProducts({ onSaved }: { onSaved: () => void }) {
  const [products, setProducts] = useState<Product[] | null>(null),
    [writes, setWrites] = useState(false),
    [canWrite, setCanWrite] = useState(false);
  const [filter, setFilter] = useState<Filter>('missing'),
    [query, setQuery] = useState(''),
    [page, setPage] = useState(0);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({}),
    [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState(''),
    [message, setMessage] = useState('');
  const load = async () => {
    setError('');
    try {
      const r = await fetch('/api/emballage/products', { cache: 'no-store' });
      const d = (await r.json()) as {
        products: Product[];
        writes: boolean;
        canWrite: boolean;
        error?: string;
      };
      if (!r.ok) throw Error(d.error);
      setProducts(d.products);
      setWrites(d.writes);
      setCanWrite(d.canWrite);
    } catch (e) {
      setError(
        e instanceof Error ? e.message : 'Produkterne kunne ikke hentes.',
      );
      setProducts([]);
    }
  };
  useEffect(() => {
    void load();
  }, []);
  const counts = useMemo(
    () => ({
      all: products?.length || 0,
      missing: products?.filter((p) => !complete(p)).length || 0,
      complete: products?.filter(complete).length || 0,
    }),
    [products],
  );
  const visible = useMemo(
    () =>
      (products || [])
        .filter(
          (p) =>
            (filter === 'all' || (filter === 'missing') !== complete(p)) &&
            p.title
              .toLocaleLowerCase('da')
              .includes(query.toLocaleLowerCase('da')),
        )
        .sort(
          (a, b) =>
            b.openLines - a.openLines || a.title.localeCompare(b.title, 'da'),
        ),
    [products, filter, query],
  );
  useEffect(() => setPage(0), [filter, query]);
  const draftOf = (p: Product): Draft =>
    drafts[p.id] || {
      weight: p.weightGrams === null ? '' : String(p.weightGrams),
      reportable: p.reportable,
    };
  const change = (p: Product, next: Partial<Draft>) =>
    setDrafts((d) => ({ ...d, [p.id]: { ...draftOf(p), ...next } }));
  const changed = (p: Product) => {
    const d = draftOf(p);
    return (
      d.weight !== (p.weightGrams === null ? '' : String(p.weightGrams)) ||
      d.reportable !== p.reportable
    );
  };
  const problem = (d: Draft) =>
    !/^\d{1,6}$/.test(d.weight)
      ? 'Angiv vægt i hele gram'
      : Number(d.weight) > 0 && d.reportable === 'unknown'
        ? 'Vælg indberetningspligt'
        : '';
  async function save(p: Product) {
    const d = draftOf(p);
    setSaving(p.id);
    setError('');
    setMessage('');
    try {
      const r = await fetch('/api/emballage/products', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          productId: p.id,
          weightGrams: Number(d.weight),
          reportable: d.reportable === 'unknown' ? null : d.reportable,
        }),
      });
      const v = (await r.json()) as { updatedLines?: number; error?: string };
      if (!r.ok) throw Error(v.error);
      setProducts((list) =>
        list!.map((x) =>
          x.id === p.id
            ? {
                ...x,
                weightGrams: Number(d.weight),
                reportable: d.reportable,
                openLines: 0,
              }
            : x,
        ),
      );
      setDrafts(({ [p.id]: _, ...rest }) => rest);
      setMessage(
        `${p.title} er opdateret i Shopify${v.updatedLines ? ` · ${v.updatedLines} leveringslinjer er nu med i beregningen` : ''}.`,
      );
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Varen kunne ikke gemmes.');
    } finally {
      setSaving(null);
    }
  }
  const editable = writes && canWrite,
    rows = visible.slice(page * pageSize, page * pageSize + pageSize);
  return (
    <section className="overflow-hidden rounded-2xl border bg-white">
      <div className="flex flex-wrap items-end gap-3 border-b p-5">
        <div
          className="flex flex-wrap gap-2"
          role="group"
          aria-label="Filtrér varer"
        >
          {(
            [
              ['missing', 'Mangler oplysninger'],
              ['complete', 'Godkendt'],
              ['all', 'Alle'],
            ] as const
          ).map(([key, label]) => (
            <Button
              key={key}
              size="sm"
              variant={filter === key ? 'default' : 'outline'}
              aria-pressed={filter === key}
              onClick={() => setFilter(key)}
            >
              {label} ({counts[key]})
            </Button>
          ))}
        </div>
        <div className="relative ml-auto w-full sm:w-72">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="pl-9"
            aria-label="Søg vare"
            placeholder="Søg vare"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
      </div>
      <p className="border-b bg-[#fcfbf9] px-5 py-3 text-xs text-muted-foreground">
        Emballagevægt pr. solgt enhed i hele gram. <strong>0 gram</strong>{' '}
        betyder, at varen ikke har emballage, og den er dermed godkendt.
        Ændringer gemmes på produktet i Shopify og bruges straks for
        leveringslinjer, der mangler oplysningerne. Allerede registrerede linjer
        bevares uændret.
      </p>
      {!editable && products && (
        <p className="mx-5 mt-4 rounded-xl bg-amber-50 p-3 text-sm text-amber-900">
          {!writes
            ? 'Ændringer i Shopify er blokeret i testmiljøet. Brug produktionsportalen for at gemme.'
            : 'Shopify-appen mangler rettigheden write_products, så vægten kan ikke gemmes herfra. Tilføj rettigheden under appens adgang i Shopify.'}
        </p>
      )}
      {error && (
        <p
          role="alert"
          className="mx-5 mt-4 flex items-center gap-2 rounded-xl bg-red-50 p-3 text-sm text-red-800"
        >
          <CircleAlert className="size-4 shrink-0" />
          {error}
        </p>
      )}
      {message && (
        <p
          role="status"
          className="mx-5 mt-4 flex items-center gap-2 rounded-xl bg-emerald-50 p-3 text-sm text-emerald-900"
        >
          <CircleCheck className="size-4 shrink-0" />
          {message}
        </p>
      )}
      {!products ? (
        <p
          role="status"
          className="flex items-center gap-2 p-5 text-sm text-muted-foreground"
        >
          <LoaderCircle className="size-4 animate-spin" />
          Henter varer fra Shopify…
        </p>
      ) : !visible.length ? (
        <p className="p-5 text-sm text-muted-foreground">
          {filter === 'missing' && !query
            ? 'Alle varer har emballageoplysninger.'
            : 'Ingen varer matcher.'}
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="stack-table w-full min-w-[760px] text-sm">
            <thead>
              <tr className="border-b bg-muted/30 text-left">
                <th className="p-3 pl-5">Vare</th>
                <th className="p-3">Status</th>
                <th className="p-3">Emballagevægt (g)</th>
                <th className="p-3">Indberetningspligtig</th>
                <th className="p-3">Venter i leveringslinjer</th>
                <th className="p-3 pr-5" />
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => {
                const d = draftOf(p),
                  issue = problem(d),
                  dirty = changed(p);
                return (
                  <tr key={p.id} className="border-b last:border-0">
                    <td className="p-3 pl-5 font-medium" data-label="Vare">
                      {p.title}
                      {p.status !== 'ACTIVE' && (
                        <span className="ml-2 text-xs font-normal text-muted-foreground">
                          Kladde
                        </span>
                      )}
                    </td>
                    <td className="p-3" data-label="Status">
                      {complete(p) ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-800">
                          <CircleCheck className="size-3.5" />
                          {p.weightGrams === 0
                            ? 'Godkendt · uden emballage'
                            : 'Godkendt'}
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-900">
                          <CircleAlert className="size-3.5" />
                          {p.weightGrams === null
                            ? 'Mangler vægt'
                            : 'Mangler indberetningspligt'}
                        </span>
                      )}
                    </td>
                    <td className="p-3" data-label="Emballagevægt (g)">
                      <Input
                        className="h-9 w-28"
                        inputMode="numeric"
                        aria-label={'Emballagevægt i gram for ' + p.title}
                        disabled={!editable}
                        value={d.weight}
                        placeholder="—"
                        onChange={(e) =>
                          change(p, {
                            weight: e.target.value.replace(/\D/g, ''),
                          })
                        }
                      />
                    </td>
                    <td className="p-3" data-label="Indberetningspligtig">
                      <select
                        className="h-9 rounded-lg border bg-white px-2"
                        aria-label={'Indberetningspligtig for ' + p.title}
                        disabled={!editable}
                        value={d.reportable}
                        onChange={(e) =>
                          change(p, {
                            reportable: e.target.value as Draft['reportable'],
                          })
                        }
                      >
                        <option value="unknown">—</option>
                        <option value="yes">Ja</option>
                        <option value="no">Nej</option>
                      </select>
                    </td>
                    <td
                      className="p-3 tabular-nums"
                      data-label="Venter i leveringslinjer"
                    >
                      {p.openLines || '—'}
                    </td>
                    <td className="p-3 pr-5 text-right">
                      {dirty && (
                        <span className="inline-flex items-center gap-2">
                          {issue && (
                            <span className="text-xs text-red-700">
                              {issue}
                            </span>
                          )}
                          <Button
                            size="sm"
                            disabled={!editable || !!issue || saving !== null}
                            onClick={() => void save(p)}
                          >
                            <Save className="size-3.5" />
                            {saving === p.id ? 'Gemmer…' : 'Gem'}
                          </Button>
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {visible.length > pageSize && (
        <div className="flex items-center justify-between border-t p-4 text-sm">
          <span className="text-muted-foreground">
            {page * pageSize + 1}–
            {Math.min(visible.length, (page + 1) * pageSize)} af{' '}
            {visible.length}
          </span>
          <span className="flex gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={page === 0}
              onClick={() => setPage((p) => p - 1)}
            >
              Forrige
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={(page + 1) * pageSize >= visible.length}
              onClick={() => setPage((p) => p + 1)}
            >
              Næste
            </Button>
          </span>
        </div>
      )}
    </section>
  );
}
