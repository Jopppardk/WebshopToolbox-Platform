// "Kræver handling" on the dashboard: everything the customer has to look at, grouped, each with a link to the page
// where it is handled (GET /attention, platform/attention.ts).
import { ArrowRight, Check, TriangleAlert } from 'lucide-react';
import { useEffect, useState } from 'react';
import { formatDateTime } from '@/lib/format';
import { tier1Fetch as fetch } from '@/platform/transport';

export type AttentionView =
  | 'orders'
  | 'refunds'
  | 'payouts'
  | 'inventory'
  | 'settings';
type Kind = 'failed' | 'uncertain' | 'market' | 'waiting';
type Item = {
  kind: Kind;
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
  const [data, setData] = useState<Attention | null>(null),
    [error, setError] = useState('');
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
      {data &&
        groups
          .filter((group) => data.counts[group.kind] > 0)
          .map((group) => {
            const items = data.items.filter((i) => i.kind === group.kind);
            const more =
              data.counts[group.kind] - Math.min(shown, items.length);
            return (
              <div key={group.kind} className="mt-4">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {group.label} · {data.counts[group.kind]}
                </h3>
                <ul className="mt-2 divide-y divide-[#efe8dc] rounded-xl border border-[#e9e2d7]">
                  {items.slice(0, shown).map((item) => (
                    <li key={item.kind + item.externalId}>
                      <button
                        type="button"
                        onClick={() => onOpen(item.view)}
                        className="group flex w-full items-start justify-between gap-3 p-3 text-left transition hover:bg-[#faf8f5] focus-visible:outline-2 focus-visible:outline-[#c09960]"
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
