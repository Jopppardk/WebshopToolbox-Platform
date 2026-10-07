// "Kræver handling" on the dashboard: everything the customer has to look at, grouped, each with a link to the page
// where it is handled (GET /attention, platform/attention.ts). Failed posts have "Prøv igen nu" (one or all shown):
// the next automatic run, within 5 minutes, processes them with the usual checks and settings (POST /attention).
import { ArrowRight, Check, TriangleAlert } from 'lucide-react';
import { useEffect, useState } from 'react';
import { formatDateTime } from '@/lib/format';
import { tier1Fetch as fetch } from '@/platform/transport';
import { useCapabilities } from '@/platform/capabilities';
import { Button } from '@/components/ui/button';

export type AttentionView =
  | 'orders'
  | 'refunds'
  | 'payouts'
  | 'inventory'
  | 'settings';
type Kind = 'failed' | 'uncertain' | 'market' | 'waiting';
type Item = {
  kind: Kind;
  job?: string;
  title: string;
  detail: string;
  view: AttentionView;
  externalId: string;
  at: string | null;
};
type Attention = { total: number; counts: Record<Kind, number>; items: Item[] };

const groups: { kind: Kind; label: string }[] = [
  { kind: 'failed', label: 'Fejlede poster' },
  { kind: 'uncertain', label: 'Uafklarede i Dinero' },
  { kind: 'market', label: 'Venter på opsætning af marked' },
  { kind: 'waiting', label: 'Tilbagebetalinger, der venter på salget' },
];
const shown = 5;

export function AttentionList({
  onOpen,
  revision,
}: {
  onOpen: (view: AttentionView) => void;
  revision: number;
}) {
  const capabilities = useCapabilities();
  const [data, setData] = useState<Attention | null>(null),
    [error, setError] = useState(''),
    [queued, setQueued] = useState<Set<string>>(new Set()),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState('');
  async function retry(items: Item[]) {
    setBusy(true);
    setNotice('');
    try {
      const response = await fetch('/api/attention', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          items: items.map((i) => ({ job: i.job, externalId: i.externalId })),
        }),
      });
      const value = (await response.json()) as { error?: string };
      if (!response.ok)
        throw new Error(value.error || 'Posterne kunne ikke sættes i kø.');
      setQueued(
        (previous) =>
          new Set([...previous, ...items.map((i) => i.job + i.externalId)]),
      );
      setNotice(
        `${items.length === 1 ? 'Posten prøves' : items.length + ' poster prøves'} igen inden for 5 minutter. Listen opdateres, når de er behandlet.`,
      );
    } catch (reason) {
      setNotice(
        reason instanceof Error
          ? reason.message
          : 'Posterne kunne ikke sættes i kø.',
      );
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/attention', { cache: 'no-store', signal: controller.signal })
      .then(async (response) => {
        const value = (await response.json()) as Attention & { error?: string };
        if (!response.ok)
          throw new Error(value.error || 'Listen kunne ikke hentes.');
        setData(value);
        setError('');
      })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted)
          setError(
            reason instanceof Error
              ? reason.message
              : 'Listen kunne ikke hentes.',
          );
      });
    return () => controller.abort();
  }, [revision]);

  return (
    <section
      aria-labelledby="attention-heading"
      className="mb-8 rounded-2xl border border-[#e3d8c7] bg-white p-4 shadow-[0_8px_30px_rgba(70,50,20,0.05)] md:p-5"
    >
      <h2
        id="attention-heading"
        className="flex items-center gap-2 text-sm font-semibold"
      >
        {data && data.total === 0 ? (
          <Check className="size-4 text-emerald-700" />
        ) : (
          <TriangleAlert className="size-4 text-amber-700" />
        )}
        Kræver handling
        {data && data.total > 0 && (
          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-900">
            {data.total}
          </span>
        )}
      </h2>
      {error && (
        <p role="alert" className="mt-3 text-sm text-red-700">
          {error}
        </p>
      )}
      {!data && !error && (
        <p className="mt-3 text-sm text-muted-foreground">Henter…</p>
      )}
      {data && data.total === 0 && (
        <p className="mt-2 text-sm text-muted-foreground">
          Intet kræver din handling lige nu.
        </p>
      )}
      {notice && (
        <p role="status" className="mt-3 text-sm">
          {notice}
        </p>
      )}
      {data &&
        groups
          .filter((group) => data.counts[group.kind] > 0)
          .map((group) => {
            const items = data.items.filter((i) => i.kind === group.kind);
            const more =
              data.counts[group.kind] - Math.min(shown, items.length);
            return (
              <div key={group.kind} className="mt-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    {group.label} · {data.counts[group.kind]}
                  </h3>
                  {group.kind === 'failed' && items.length > 1 && (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy || !capabilities.bookkeeping}
                      onClick={() => void retry(items)}
                    >
                      Prøv alle igen nu
                    </Button>
                  )}
                </div>
                <ul className="mt-2 divide-y divide-[#efe8dc] rounded-xl border border-[#e9e2d7]">
                  {items.slice(0, shown).map((item) => (
                    <li
                      key={item.kind + item.externalId}
                      className="flex items-center gap-2 pr-3"
                    >
                      <button
                        type="button"
                        onClick={() => onOpen(item.view)}
                        className="group flex min-w-0 flex-1 items-start justify-between gap-3 p-3 text-left transition hover:bg-[#faf8f5] focus-visible:outline-2 focus-visible:outline-[#c09960]"
                      >
                        <span className="min-w-0">
                          <span className="block text-sm font-medium">
                            {item.title}
                          </span>
                          <span className="block text-xs text-muted-foreground">
                            {item.detail}
                          </span>
                        </span>
                        <span className="flex shrink-0 items-center gap-2 text-[11px] text-muted-foreground">
                          {item.at ? formatDateTime(item.at) : ''}
                          <ArrowRight className="size-3.5 text-stone-400 transition group-hover:translate-x-0.5" />
                        </span>
                      </button>
                      {item.kind === 'failed' &&
                        item.job &&
                        (queued.has(item.job + item.externalId) ? (
                          <span className="shrink-0 text-xs text-muted-foreground">
                            I kø
                          </span>
                        ) : (
                          <Button
                            size="sm"
                            variant="outline"
                            className="shrink-0"
                            disabled={busy || !capabilities.bookkeeping}
                            title={
                              capabilities.bookkeeping
                                ? undefined
                                : 'Bogføring er blokeret i testmiljøet'
                            }
                            onClick={() => void retry([item])}
                          >
                            Prøv igen nu
                          </Button>
                        ))}
                    </li>
                  ))}
                </ul>
                {more > 0 && (
                  <p className="mt-1.5 text-xs text-muted-foreground">
                    og {more} mere.
                  </p>
                )}
              </div>
            );
          })}
    </section>
  );
}
