'use client';
// Emballage → Forbrug: one card per webshop for the chosen period, two side by side, like the dashboard. The
// selected webshop's card shows the data already on the page; the others read their own webshop, which the
// server checks access to as always.
import { useEffect, useState } from 'react';
import { ArrowRight } from 'lucide-react';
import { packagingEstimate, type PackagingPeriod } from '@/lib/packaging';
import { tier1FetchFor } from '@/platform/transport';
import { ShopBadge, useWorkspace } from '@/platform/workspace';

type ShopPackaging = {
  pricePerKg: number;
  commercialPricePerKg: number | null;
  periods: Record<string, PackagingPeriod>;
};
const kg = (g: number) =>
    new Intl.NumberFormat('da-DK', {
      minimumFractionDigits: 3,
      maximumFractionDigits: 3,
    }).format(g / 1000) + ' kg',
  money = (n: number) =>
    new Intl.NumberFormat('da-DK', {
      style: 'currency',
      currency: 'DKK',
    }).format(n);

export function PackagingCards({
  period,
  query,
  revision,
  selected,
  price,
  commercialPrice,
}: {
  period: string;
  query: string;
  revision: number;
  // The selected webshop's period and the prices as typed on the page.
  selected: PackagingPeriod;
  price: number;
  commercialPrice: number | null;
}) {
  const { webshops, webshopId } = useWorkspace();
  return (
    <div className="mb-5 grid gap-4 lg:grid-cols-2">
      {webshops.map((shop) =>
        shop.id === webshopId ? (
          <Card
            key={shop.id}
            shop={shop}
            period={selected}
            price={price}
            commercialPrice={commercialPrice}
          />
        ) : (
          <OtherShop
            key={shop.id}
            shop={shop}
            period={period}
            query={query}
            revision={revision}
          />
        ),
      )}
    </div>
  );
}

function OtherShop({
  shop,
  period,
  query,
  revision,
}: {
  shop: { id: string; name: string };
  period: string;
  query: string;
  revision: number;
}) {
  const [data, setData] = useState<ShopPackaging | null>(null),
    [error, setError] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    tier1FetchFor(shop.id, `/api/shopify/packaging${query}`, {
      cache: 'no-store',
      signal: controller.signal,
    })
      .then(async (r) => {
        const v = (await r.json()) as ShopPackaging & { error?: string };
        if (!r.ok) throw Error(v.error || 'Emballagedata kunne ikke hentes.');
        setData(v);
        setError('');
      })
      .catch((e) => {
        if (!controller.signal.aborted)
          setError(
            e instanceof Error ? e.message : 'Emballagedata kunne ikke hentes.',
          );
      });
    return () => controller.abort();
  }, [shop.id, query, revision]);
  const selected = data?.periods[period] || data?.periods.currentQuarter;
  return (
    <Card
      shop={shop}
      period={selected}
      price={data?.pricePerKg ?? 0}
      commercialPrice={data?.commercialPricePerKg ?? null}
      error={error}
    />
  );
}

function Card({
  shop,
  period,
  price,
  commercialPrice,
  error,
}: {
  shop: { id: string; name: string };
  period?: PackagingPeriod;
  price: number;
  commercialPrice: number | null;
  error?: string;
}) {
  const { webshopId, webshops, choose } = useWorkspace();
  const selected = shop.id === webshopId;
  const estimate = period
    ? packagingEstimate(period, price, commercialPrice)
    : undefined;
  const cell = (label: string, value: string, tone = 'bg-stone-50') => (
    <div className={'rounded-lg px-2.5 py-2 ' + tone}>
      <p className="text-[10px] leading-tight font-medium text-muted-foreground">
        {label}
      </p>
      <p className="mt-1 text-base font-semibold tracking-tight tabular-nums">
        {value}
      </p>
    </div>
  );
  return (
    <article
      aria-label={shop.name}
      className={
        'overflow-hidden rounded-2xl border bg-white ' +
        (selected && webshops.length > 1 ? 'border-[#d9c4a2]' : '')
      }
    >
      <header className="flex items-center gap-3 border-b border-[#eee8df] px-4 py-3 md:px-5">
        <ShopBadge id={shop.id} name={shop.name} small />
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
      {error ? (
        <p className="px-5 py-4 text-sm text-muted-foreground">{error}</p>
      ) : (
        <div className="grid gap-2 p-4 md:px-5">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {cell('Samlet', period ? kg(period.totalGrams) : '—')}
            {cell(
              'Indberetningspligtig',
              period ? kg(period.reportableGrams) : '—',
              'bg-[#f7efe3]',
            )}
            {cell(
              'Anslået pris',
              estimate === undefined
                ? '—'
                : estimate === null
                  ? 'Pris mangler'
                  : money(estimate),
            )}
            {cell(
              'Ignorerede linjer',
              period ? String(period.unresolved) : '—',
              period?.unresolved ? 'bg-amber-50/70' : 'bg-stone-50',
            )}
          </div>
          <p className="text-[11px] text-muted-foreground">
            Privat{' '}
            <span className="font-medium text-foreground tabular-nums">
              {period
                ? `${kg(period.householdTotalGrams)} / ${kg(period.householdGrams)}`
                : '—'}
            </span>{' '}
            · Erhverv{' '}
            <span className="font-medium text-foreground tabular-nums">
              {period
                ? `${kg(period.commercialTotalGrams)} / ${kg(period.commercialGrams)}`
                : '—'}
            </span>{' '}
            (samlet / indberetningspligtig)
          </p>
        </div>
      )}
    </article>
  );
}
