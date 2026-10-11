'use client';
// Dashboard: one card per webshop with today's activity and the latest updates, two side by side. Each card
// reads its own webshop; the server checks access to it as for any other request.
import { useEffect, useState, type ReactNode } from 'react';
import { ArrowRight, Link2, Package, Truck, Wallet } from 'lucide-react';
import { formatDate, formatTime } from '@/lib/format';
import { danishDate } from '@/lib/history-policy';
import { shipmentCounts, type ShipmentList } from '@/lib/shipments';
import { tier1FetchFor } from '@/platform/transport';
import { ShopBadge, useWorkspace } from '@/platform/workspace';

type ActivityCount = {
  total: number;
  synced: number;
  failed: number;
  pending: number;
};
export type ShopActivity = {
  inactive: number;
  connected: number;
  activity: {
    today: string;
    orders: ActivityCount;
    payouts: ActivityCount;
    updated: {
      sales: string | null;
      refunds: string | null;
      packaging: string | null;
    };
  };
};

export function WebshopCards({
  revision,
  onIntegrations,
}: {
  revision: number;
  onIntegrations: () => void;
}) {
  const { webshops } = useWorkspace();
  return (
    <section aria-labelledby="webshops-heading" className="mb-8">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h2 id="webshops-heading" className="text-lg font-semibold">
          {webshops.length > 1 ? 'Dine webshops' : 'Din webshop'}
        </h2>
        <span className="rounded-full border bg-white px-3 py-1 text-xs text-muted-foreground">
          Dagens aktivitet · {formatDate(danishDate())}
        </span>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        {webshops.map((shop) => (
          <WebshopCard
            key={shop.id}
            shop={shop}
            revision={revision}
            onIntegrations={onIntegrations}
          />
        ))}
      </div>
      <p className="mt-3 text-[11px] text-muted-foreground">
        Registrerede ordrer og udbetalinger fra alle betalingsudbydere med
        dagens dato i dansk tid. Forsendelser er pakker fra de seneste 30 dage
        som på Forsendelser: oprettet i dag, under transport og klar til
        afhentning i pakkeshop. Dinero = kladde eller bogført i Dinero. Afventer
        = endnu ikke overført, inkl. igangværende overførsler. Fejlede
        inkluderer overførsler, der kræver kontrol.
      </p>
    </section>
  );
}

function WebshopCard({
  shop,
  revision,
  onIntegrations,
}: {
  shop: { id: string; name: string };
  revision: number;
  onIntegrations: () => void;
}) {
  const { webshopId, webshops, choose } = useWorkspace();
  const selected = shop.id === webshopId;
  const [stats, setStats] = useState<ShopActivity | null>(null),
    [error, setError] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    let running = false;
    const load = async () => {
      if (running) return;
      running = true;
      try {
        const response = await tier1FetchFor(
          shop.id,
          '/api/dashboard/platform',
          {
            cache: 'no-store',
            signal: AbortSignal.any([
              controller.signal,
              AbortSignal.timeout(90000),
            ]),
          },
        );
        const value = (await response.json()) as ShopActivity & {
          error?: string;
        };
        if (!response.ok)
          throw new Error(value.error || 'Data kunne ikke hentes.');
        if (controller.signal.aborted) return;
        setStats(value);
        setError('');
      } catch (reason) {
        if (!controller.signal.aborted)
          setError(
            reason instanceof Error
              ? reason.message
              : 'Data kunne ikke hentes.',
          );
      } finally {
        running = false;
      }
    };
    void load();
    const timer = window.setInterval(() => {
      if (!document.hidden) void load();
    }, 60000);
    return () => {
      controller.abort();
      window.clearInterval(timer);
    };
  }, [shop.id, revision]);
  const shipments = useShipmentCounts(shop.id, revision);
  const updated = stats?.activity.updated;
  return (
    <article
      aria-label={shop.name}
      className={
        'flex flex-col overflow-hidden rounded-2xl border bg-white shadow-[0_8px_30px_rgba(70,50,20,0.05)] ' +
        (selected && webshops.length > 1
          ? 'border-[#d9c4a2]'
          : 'border-[#e3d8c7]')
      }
    >
      <header className="flex items-center gap-3 border-b border-[#eee8df] px-4 py-3.5 md:px-5">
        <ShopBadge id={shop.id} name={shop.name} />
        <h3 className="min-w-0 flex-1 truncate font-semibold">{shop.name}</h3>
        {webshops.length > 1 &&
          (selected ? (
            <span className="rounded-full bg-[#f4eadc] px-2.5 py-1 text-[11px] font-semibold text-[#765523]">
              Valgt
            </span>
          ) : (
            <button
              type="button"
              onClick={() => choose(shop.id)}
              className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium text-[#9a7440] hover:bg-[#f7efe3]"
            >
              Skift hertil
              <ArrowRight className="size-3.5" />
            </button>
          ))}
      </header>
      {error && (
        <p role="alert" className="bg-red-50 px-5 py-3 text-sm text-red-700">
          {error}
        </p>
      )}
      <div className="grid gap-2 p-4 md:px-5">
        <ActivityLine
          icon={<Package className="size-4" />}
          label="Salg"
          counts={stats?.activity.orders}
        />
        <ActivityLine
          icon={<Wallet className="size-4" />}
          label="Udbetalinger"
          counts={stats?.activity.payouts}
        />
        <ShipmentLine {...shipments} />
      </div>
      <div className="mt-auto flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t border-[#e9e2d7] bg-[#faf8f5] px-4 py-3 text-[11px] text-muted-foreground md:px-5">
        <span className="font-medium text-foreground">Senest opdateret</span>
        <Updated label="Salg" value={updated?.sales} />
        <Updated label="Tilbagebetalinger" value={updated?.refunds} />
        <Updated label="Emballage" value={updated?.packaging} />
        {selected ? (
          <button
            type="button"
            onClick={onIntegrations}
            className="ml-auto inline-flex items-center gap-1 font-medium text-[#9a7440] hover:underline"
          >
            <Link2 className="size-3.5" />
            {integrations(stats)}
          </button>
        ) : (
          <span className="ml-auto inline-flex items-center gap-1">
            <Link2 className="size-3.5" />
            {integrations(stats)}
          </span>
        )}
      </div>
    </article>
  );
}

function integrations(stats: ShopActivity | null) {
  if (!stats) return 'Integrationer —';
  return (
    stats.connected +
    ' tilsluttet' +
    (stats.inactive ? ' · ' + stats.inactive + ' mangler' : '')
  );
}

function ActivityLine({
  icon,
  label,
  counts,
}: {
  icon: ReactNode;
  label: string;
  counts?: ActivityCount;
}) {
  const cell = (name: string, value: number | undefined, tone: string) => (
    <div className={'rounded-lg px-2 py-1.5 text-center ' + tone}>
      <p className="text-[10px] leading-tight font-medium opacity-80">{name}</p>
      <p className="mt-0.5 text-xl font-semibold tracking-tight tabular-nums">
        {value ?? '—'}
      </p>
    </div>
  );
  return (
    <div className="grid grid-cols-4 items-center gap-1.5 sm:grid-cols-[132px_repeat(4,minmax(0,1fr))]">
      <div className="col-span-4 flex items-center gap-2 sm:col-span-1">
        <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-[#f4eadc] text-[#8a6636]">
          {icon}
        </span>
        <span className="text-sm font-semibold">{label}</span>
      </div>
      {cell('I dag', counts?.total, 'bg-stone-50')}
      {cell('Dinero', counts?.synced, 'bg-emerald-50/70 text-emerald-800')}
      {cell('Afventer', counts?.pending, 'bg-amber-50/70 text-amber-800')}
      {cell(
        'Fejlede',
        counts?.failed,
        counts?.failed
          ? 'bg-red-50 text-red-700'
          : 'bg-stone-50 text-stone-500',
      )}
    </div>
  );
}

function Updated({ label, value }: { label: string; value?: string | null }) {
  const today = Boolean(value && danishDate(new Date(value)) === danishDate());
  return (
    <span>
      {label}{' '}
      <span className="font-medium text-foreground tabular-nums">
        {value ? (today ? 'kl. ' + formatTime(value) : formatDate(value)) : '—'}
      </span>
    </span>
  );
}

type ShipmentCounts = ReturnType<typeof shipmentCounts>;
// Forsendelser for the last 30 days, as on the Forsendelser page (which shares the server's five-minute cache).
function useShipmentCounts(shop: string, revision: number) {
  const [counts, setCounts] = useState<ShipmentCounts | null>(null),
    [truncated, setTruncated] = useState(false),
    [error, setError] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    // Opdatér asks for a new list; the server still reuses a list less than a minute old.
    const force = revision > 0;
    let running = false;
    const load = async (refresh: boolean) => {
      if (running) return;
      running = true;
      try {
        let response: Response, value: ShipmentList & { error?: string };
        // Another tab may be reading the same list; wait for it instead of failing.
        for (let attempt = 0; ; attempt++) {
          response = await tier1FetchFor(
            shop,
            '/api/shipments?days=30' + (refresh ? '&refresh=1' : ''),
            {
              cache: 'no-store',
              signal: AbortSignal.any([
                controller.signal,
                AbortSignal.timeout(120000),
              ]),
            },
          );
          value = await response.json();
          if (
            response.status !== 409 ||
            !/hentes allerede/.test(value.error || '') ||
            attempt >= 10
          )
            break;
          await new Promise((resolve) => setTimeout(resolve, 3000));
          if (controller.signal.aborted) return;
        }
        if (!response.ok)
          throw new Error(value.error || 'Forsendelserne kunne ikke hentes.');
        if (controller.signal.aborted) return;
        setCounts(shipmentCounts(value.shipments, danishDate()));
        setTruncated(value.truncated);
        setError('');
      } catch (reason) {
        if (!controller.signal.aborted)
          setError(
            reason instanceof Error
              ? reason.message
              : 'Forsendelserne kunne ikke hentes.',
          );
      } finally {
        running = false;
      }
    };
    void load(force);
    const timer = window.setInterval(() => {
      if (!document.hidden) void load(false);
    }, 5 * 60000);
    return () => {
      controller.abort();
      window.clearInterval(timer);
    };
  }, [shop, revision]);
  return { counts, truncated, error };
}

function ShipmentLine({
  counts,
  truncated,
  error,
}: {
  counts: ShipmentCounts | null;
  truncated: boolean;
  error: string;
}) {
  const cell = (name: string, value: number | undefined, tone: string) => (
    <div className={'rounded-lg px-2 py-1.5 text-center ' + tone}>
      <p className="text-[10px] leading-tight font-medium opacity-80">{name}</p>
      <p className="mt-0.5 text-xl font-semibold tracking-tight tabular-nums">
        {value ?? '—'}
      </p>
    </div>
  );
  return (
    <div className="grid grid-cols-3 items-center gap-1.5 sm:grid-cols-[132px_repeat(3,minmax(0,1fr))]">
      <div className="col-span-3 flex items-center gap-2 sm:col-span-1">
        <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-[#f4eadc] text-[#8a6636]">
          <Truck className="size-4" />
        </span>
        <span className="text-sm font-semibold">Forsendelser</span>
      </div>
      {cell('Oprettet i dag', counts?.created, 'bg-stone-50')}
      {cell('Under transport', counts?.moving, 'bg-sky-50/70 text-sky-800')}
      {cell(
        'Afventer afhentning',
        counts?.waiting,
        'bg-amber-50/70 text-amber-800',
      )}
      {(error || truncated) && (
        <p className="col-span-3 text-[11px] text-muted-foreground sm:col-span-4">
          {error ||
            'Ufuldstændigt: der er flere forsendelser i perioden, end der kan hentes på én gang, så tallene kan være for lave.'}
        </p>
      )}
    </div>
  );
}
