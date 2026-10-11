// "Kræver handling" on the dashboard: everything the customer has to look at, grouped, each with a link to the page
// where it is handled (GET /attention, platform/attention.ts).
// - "Prøv igen nu" (failed posts, one or all shown): the next automatic run, within 5 minutes, processes them with
//   the usual checks and settings.
// - "Afvis": the post has been checked; it leaves the list and its automatic attempts stop. "Vis afviste" lists the
//   dismissed posts with "Fortryd", which puts them back and queues them again.
import { ArrowRight, Check, TriangleAlert } from 'lucide-react';
import { useEffect, useState } from 'react';
import { formatDateTime } from '@/lib/format';
import { tier1Fetch as fetch } from '@/platform/transport';
import { useCapabilities } from '@/platform/capabilities';
import { useWebshopName, useWorkspace } from '@/platform/workspace';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/confirm-dialog';

export type AttentionView =
  | 'orders'
  | 'refunds'
  | 'payouts'
  | 'inventory'
  | 'settings';
type Kind = 'failed' | 'uncertain' | 'market' | 'waiting';
type Item = {
  kind: Kind;
  job: string;
  title: string;
  detail: string;
  view: AttentionView;
  externalId: string;
  at: string | null;
};
type Attention = {
  total: number;
  counts: Record<Kind, number>;
  dismissed: number;
  items: Item[];
};
type Dismissed = {
  kind: Kind;
  job: string;
  externalId: string;
  title: string;
  dismissedAt: string;
  dismissedBy: string | null;
};

const groups: { kind: Kind; label: string }[] = [
  { kind: 'failed', label: 'Fejlede poster' },
  { kind: 'uncertain', label: 'Uafklarede i Dinero' },
  { kind: 'market', label: 'Venter på opsætning af marked' },
  { kind: 'waiting', label: 'Tilbagebetalinger, der venter på salget' },
];
const shown = 5;
// What "Afvis" means for each kind, said in the confirmation.
const dismissText: Record<Kind, string> = {
  failed:
    'Posten fjernes fra listen, og den automatiske behandling stopper for den. Den kan stadig bogføres med "Bogfør manuelt".',
  uncertain:
    'Posten fjernes fra listen. Gør det kun, når du har kontrolleret i Dinero, at den er bogført rigtigt.',
  market:
    'Ordren fjernes fra listen, og den bliver hverken bogført eller faktureret automatisk.',
  waiting: 'Tilbagebetalingen fjernes fra listen og bogføres ikke automatisk.',
};
const pick = (i: { kind: Kind; job: string; externalId: string }) => ({
  kind: i.kind,
  job: i.job,
  externalId: i.externalId,
});

export function AttentionList({
  onOpen,
  revision,
}: {
  onOpen: (view: AttentionView) => void;
  revision: number;
}) {
  const capabilities = useCapabilities();
  const { webshops } = useWorkspace(),
    shopName = useWebshopName();
  const { confirm, dialog } = useConfirm();
  const [data, setData] = useState<Attention | null>(null),
    [error, setError] = useState(''),
    [queued, setQueued] = useState<Set<string>>(new Set()),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState(''),
    [reload, setReload] = useState(0),
    [dismissed, setDismissed] = useState<Dismissed[] | null>(null);

  async function post(
    action: 'retry' | 'dismiss' | 'restore',
    items: object[],
  ) {
    const response = await fetch('/api/attention', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, items }),
    });
    const value = (await response.json()) as { error?: string };
    if (!response.ok)
      throw new Error(value.error || 'Handlingen kunne ikke gennemføres.');
  }
  async function act(work: () => Promise<string>) {
    setBusy(true);
    setNotice('');
    try {
      setNotice(await work());
    } catch (reason) {
      setNotice(
        reason instanceof Error
          ? reason.message
          : 'Handlingen kunne ikke gennemføres.',
      );
    } finally {
      setBusy(false);
    }
  }
  const retry = (items: Item[]) =>
    act(async () => {
      await post('retry', items.map(pick));
      setQueued(
        (previous) =>
          new Set([...previous, ...items.map((i) => i.job + i.externalId)]),
      );
      return `${items.length === 1 ? 'Posten prøves' : items.length + ' poster prøves'} igen inden for 5 minutter. Listen opdateres, når de er behandlet.`;
    });
  async function dismiss(item: Item) {
    if (
      !(await confirm({
        title: 'Afvis ' + item.title,
        message:
          dismissText[item.kind] + ' Du kan fortryde under "Vis afviste".',
        confirmLabel: 'Afvis',
      }))
    )
      return;
    await act(async () => {
      await post('dismiss', [pick(item)]);
      setReload((n) => n + 1);
      return `${item.title} er afvist.`;
    });
  }
  const restore = (item: Dismissed) =>
    act(async () => {
      await post('restore', [pick(item)]);
      setDismissed((list) => list?.filter((d) => d !== item) ?? null);
      setReload((n) => n + 1);
      return `${item.title} er tilbage på listen.`;
    });
  async function showDismissed() {
    if (dismissed) return setDismissed(null);
    await act(async () => {
      const response = await fetch('/api/attention?dismissed=1', {
        cache: 'no-store',
      });
      const value = (await response.json()) as {
        dismissed?: Dismissed[];
        error?: string;
      };
      if (!response.ok)
        throw new Error(value.error || 'De afviste poster kunne ikke hentes.');
      setDismissed(value.dismissed ?? []);
      return '';
    });
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
  }, [revision, reload]);

  return (
    <section
      aria-labelledby="attention-heading"
      className="mb-8 rounded-2xl border border-[#e3d8c7] bg-white p-4 shadow-[0_8px_30px_rgba(70,50,20,0.05)] md:p-5"
    >
      {dialog}
      <div className="flex flex-wrap items-center justify-between gap-2">
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
          {webshops.length > 1 && shopName && (
            <span className="font-normal text-muted-foreground">
              · {shopName}
            </span>
          )}
          {data && data.total > 0 && (
            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-900">
              {data.total}
            </span>
          )}
        </h2>
        {data && data.dismissed > 0 && (
          <button
            type="button"
            className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
            onClick={() => void showDismissed()}
          >
            {dismissed ? 'Skjul afviste' : `Vis afviste (${data.dismissed})`}
          </button>
        )}
      </div>
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
                      key={item.kind + item.job + item.externalId}
                      className="flex flex-wrap items-center gap-2 pr-3 sm:flex-nowrap"
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
                      <span className="flex shrink-0 items-center gap-2 pb-3 pl-3 sm:p-0">
                        {item.kind === 'failed' &&
                          (queued.has(item.job + item.externalId) ? (
                            <span className="text-xs text-muted-foreground">
                              I kø
                            </span>
                          ) : (
                            <Button
                              size="sm"
                              variant="outline"
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
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={busy}
                          onClick={() => void dismiss(item)}
                        >
                          Afvis
                        </Button>
                      </span>
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
      {dismissed && (
        <div className="mt-4">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Afviste poster · {dismissed.length}
          </h3>
          {dismissed.length === 0 ? (
            <p className="mt-2 text-sm text-muted-foreground">
              Ingen afviste poster.
            </p>
          ) : (
            <ul className="mt-2 divide-y divide-[#efe8dc] rounded-xl border border-[#e9e2d7]">
              {dismissed.map((item) => (
                <li
                  key={item.kind + item.job + item.externalId}
                  className="flex items-center justify-between gap-3 p-3"
                >
                  <span className="min-w-0">
                    <span className="block text-sm font-medium">
                      {item.title}
                    </span>
                    <span className="block text-xs text-muted-foreground">
                      Afvist {formatDateTime(item.dismissedAt)}
                      {item.dismissedBy ? ' af ' + item.dismissedBy : ''}
                    </span>
                  </span>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy}
                    onClick={() => void restore(item)}
                  >
                    Fortryd
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
