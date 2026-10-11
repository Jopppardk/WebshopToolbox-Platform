'use client';
// Dashboard → Økonomi: a card per webshop (Shopify) and one for the whole company (Dinero), each with revenue
// month and year to date against the same days last year, and the inventory value. Each webshop card reads its
// own webshop; the server checks access to it as for any other request.
import { useEffect, useState, type ReactNode } from 'react';
import { ArrowDownRight, ArrowUpRight, Building2 } from 'lucide-react';
import { formatDate } from '@/lib/format';
import {
  percentageChange,
  type financePeriods,
  type ShopFinance,
} from '@/lib/dashboard-finance';
import { tier1FetchFor } from '@/platform/transport';
import { ShopBadge, useWorkspace } from '@/platform/workspace';

type Periods = ReturnType<typeof financePeriods>;
export type FinanceFigures = {
  periods: Periods | null;
  revenueMtd: number | null;
  revenueYtd: number | null;
  previousMtd: number | null;
  previousYtd: number | null;
  inventory: number | null;
  // Only the company card (Dinero): result before tax after booked costs.
  profitMtd?: number | null;
  profitYtd?: number | null;
};

export const money = (value: number | null | undefined, currency = 'DKK') =>
  value == null
    ? '—'
    : new Intl.NumberFormat('da-DK', {
        style: 'currency',
        currency,
        maximumFractionDigits: 0,
      }).format(value / 100);

export function ShopFinanceCards({ revision }: { revision: number }) {
  const { webshops } = useWorkspace();
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {webshops.map((shop) => (
        <ShopFinanceCard key={shop.id} shop={shop} revision={revision} />
      ))}
    </div>
  );
}

function ShopFinanceCard({
  shop,
  revision,
}: {
  shop: { id: string; name: string };
  revision: number;
}) {
  const [data, setData] = useState<ShopFinance | null>(null),
    [error, setError] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    // Opdatér asks for new numbers; the server still reuses numbers less than a minute old.
    const force = revision > 0;
    let running = false;
    const load = async (refresh: boolean) => {
      if (running) return;
      running = true;
      try {
        let response: Response, value: ShopFinance & { error?: string };
        // Another tab may be reading the same webshop; wait for it instead of failing.
        for (let attempt = 0; ; attempt++) {
          response = await tier1FetchFor(
            shop.id,
            '/api/dashboard/shop' + (refresh ? '?refresh=1' : ''),
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
          throw new Error(value.error || 'Tallene kunne ikke hentes.');
        if (controller.signal.aborted) return;
        setData(value);
        setError('');
      } catch (reason) {
        if (!controller.signal.aborted)
          setError(
            reason instanceof Error
              ? reason.message
              : 'Tallene kunne ikke hentes.',
          );
      } finally {
        running = false;
      }
    };
    void load(force);
    const timer = window.setInterval(() => {
      if (!document.hidden) void load(false);
    }, 15 * 60000);
    return () => {
      controller.abort();
      window.clearInterval(timer);
    };
  }, [shop.id, revision]);
  const revenue = data?.revenue;
  const notes = [
    error,
    data?.revenueError,
    data?.inventoryError,
    data?.inventory?.incomplete
      ? `${data.inventory.incomplete} lagerstyrede varer mangler lagerantal eller kostpris og indgår ikke i lagerværdien.`
      : '',
  ].filter((note): note is string => Boolean(note));
  return (
    <FinanceCard
      title={shop.name}
      badge={<ShopBadge id={shop.id} name={shop.name} />}
      source="Shopify"
      currency={data?.currency || 'DKK'}
      inventoryCurrency={data?.inventory?.currency || data?.currency || 'DKK'}
      notes={notes}
      inventoryNote="Kostpris × lager i Shopify"
      figures={{
        periods: data?.periods ?? null,
        revenueMtd: revenue?.revenueMtd ?? null,
        revenueYtd: revenue?.revenueYtd ?? null,
        previousMtd: revenue?.previousMtd ?? null,
        previousYtd: revenue?.previousYtd ?? null,
        inventory: data?.inventory?.valueMinor ?? null,
      }}
    />
  );
}

export function CompanyFinanceCard({
  name,
  figures,
  notes,
}: {
  name: string;
  figures: FinanceFigures;
  notes: string[];
}) {
  return (
    <FinanceCard
      title={name}
      subtitle="Samlet for alle webshops"
      badge={
        <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-[#ead9bd] text-[#765523]">
          <Building2 className="size-4" aria-hidden="true" />
        </span>
      }
      source="Dinero"
      currency="DKK"
      notes={notes}
      inventoryNote="Bogført saldo på lagerkontoen"
      figures={figures}
      accent
    />
  );
}

function FinanceCard({
  title,
  subtitle,
  badge,
  source,
  currency,
  notes,
  inventoryNote,
  inventoryCurrency,
  figures,
  accent = false,
}: {
  title: string;
  subtitle?: string;
  badge: ReactNode;
  source: string;
  currency: string;
  notes: string[];
  inventoryNote: string;
  inventoryCurrency?: string;
  figures: FinanceFigures;
  accent?: boolean;
}) {
  const p = figures.periods;
  const range = (from?: string, to?: string) =>
    from && to ? formatDate(from) + ' – ' + formatDate(to) : undefined;
  return (
    <article
      aria-label={'Økonomi for ' + title}
      className={
        'flex flex-col overflow-hidden rounded-2xl border shadow-[0_8px_30px_rgba(70,50,20,0.05)] ' +
        (accent ? 'border-[#d9c4a2] bg-[#f7efe3]' : 'border-[#e3d8c7] bg-white')
      }
    >
      <header
        className={
          'flex items-center gap-3 border-b px-4 py-3.5 md:px-5 ' +
          (accent ? 'border-[#e6d6bb]' : 'border-[#eee8df]')
        }
      >
        {badge}
        <div className="min-w-0 flex-1">
          <h3 className="truncate font-semibold">{title}</h3>
          {subtitle && (
            <p className="text-xs text-muted-foreground">{subtitle}</p>
          )}
        </div>
        <span className="rounded-full border bg-white/70 px-2.5 py-1 text-[11px] text-muted-foreground">
          {source}
        </span>
      </header>
      {notes.length > 0 && (
        <div className="space-y-1 bg-amber-50/70 px-4 py-2.5 text-xs text-amber-900 md:px-5">
          {notes.map((note) => (
            <p key={note}>{note}</p>
          ))}
        </div>
      )}
      <div className="grid gap-3 p-4 sm:grid-cols-3 md:px-5">
        <Figure
          label="Omsætning måned til dato"
          period={range(p?.monthStart, p?.today)}
          current={figures.revenueMtd}
          previous={figures.previousMtd}
          priorPeriod={range(p?.priorMonthStart, p?.previous)}
          currency={currency}
        />
        <Figure
          label="Omsætning år til dato"
          period={range(p?.yearStart, p?.today)}
          current={figures.revenueYtd}
          previous={figures.previousYtd}
          priorPeriod={range(p?.priorYearStart, p?.previous)}
          currency={currency}
        />
        <div className="rounded-xl bg-white/80 p-3.5 ring-1 ring-black/5">
          <h4 className="text-xs font-medium text-muted-foreground">
            Lagerværdi
          </h4>
          <p className="mt-2 text-2xl font-semibold tracking-tight tabular-nums">
            {money(figures.inventory, inventoryCurrency || currency)}
          </p>
          <p className="mt-2 text-[11px] text-muted-foreground">
            {inventoryNote}
          </p>
        </div>
      </div>
      {'profitMtd' in figures && (
        <div className="grid gap-3 px-4 pb-4 sm:grid-cols-2 md:px-5">
          <Plain
            label="Overskud måned til dato"
            title={range(p?.monthStart, p?.today)}
            value={money(figures.profitMtd, currency)}
            note="Før skat"
          />
          <Plain
            label="Overskud år til dato"
            title={range(p?.yearStart, p?.today)}
            value={money(figures.profitYtd, currency)}
            note="Før skat"
          />
        </div>
      )}
    </article>
  );
}

function Figure({
  label,
  period,
  current,
  previous,
  priorPeriod,
  currency,
}: {
  label: string;
  period?: string;
  current: number | null;
  previous: number | null;
  priorPeriod?: string;
  currency: string;
}) {
  const change = percentageChange(current, previous);
  return (
    <div className="rounded-xl bg-white/80 p-3.5 ring-1 ring-black/5">
      <h4 className="text-xs font-medium text-muted-foreground" title={period}>
        {label}
      </h4>
      <p className="mt-2 text-2xl font-semibold tracking-tight tabular-nums">
        {money(current, currency)}
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
        {change !== null && (
          <span
            className={
              'inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 font-semibold ' +
              (change >= 0
                ? 'bg-emerald-100 text-emerald-800'
                : 'bg-red-100 text-red-800')
            }
          >
            {change >= 0 ? (
              <ArrowUpRight className="size-3" />
            ) : (
              <ArrowDownRight className="size-3" />
            )}
            {change > 0 ? '+' : ''}
            {change.toLocaleString('da-DK', { maximumFractionDigits: 1 })} %
          </span>
        )}
        <span title={priorPeriod}>
          Sidste år{' '}
          <span className="font-medium text-foreground tabular-nums">
            {money(previous, currency)}
          </span>
        </span>
      </div>
    </div>
  );
}

function Plain({
  label,
  title,
  value,
  note,
}: {
  label: string;
  title?: string;
  value: string;
  note: string;
}) {
  return (
    <div className="rounded-xl bg-white/80 p-3.5 ring-1 ring-black/5">
      <h4 className="text-xs font-medium text-muted-foreground" title={title}>
        {label}
      </h4>
      <p className="mt-2 text-2xl font-semibold tracking-tight tabular-nums">
        {value}
      </p>
      <p className="mt-2 text-[11px] text-muted-foreground">{note}</p>
    </div>
  );
}
