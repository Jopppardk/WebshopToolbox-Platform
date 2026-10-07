'use client';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  ArrowUpRight,
  Banknote,
  Eye,
  ShoppingBag,
  RefreshCw,
  Info,
  Wallet,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { RefreshButton } from '@/components/refresh-button';
import { tier1Fetch } from '@/platform/transport';
import { useWorkspace } from '@/platform/workspace';
import { danishDate } from '@/lib/history-policy';
import { formatDate, formatDateTime } from '@/lib/format';
import {
  performanceMonths,
  type MonthComparison,
  type PerformanceFinance,
  type PerformanceMetric,
  type PerformanceShop,
} from '@/lib/performance';

const number = new Intl.NumberFormat('da-DK', { maximumFractionDigits: 0 });
const money = new Intl.NumberFormat('da-DK', {
  style: 'currency',
  currency: 'DKK',
  maximumFractionDigits: 2,
});
const total = (months: MonthComparison[], key: 'current' | 'previous') => {
  const known = months
    .map((m) => m[key])
    .filter((value): value is number => value !== null);
  return known.length ? known.reduce((sum, value) => sum + value, 0) : null;
};

export function Performance({
  onIntegrations,
}: {
  onIntegrations: () => void;
}) {
  const { company, webshopId, webshops } = useWorkspace();
  const currentYear = Number(danishDate().slice(0, 4));
  const [year, setYear] = useState(currentYear),
    [supplier, setSupplier] = useState('all');
  const [revision, setRevision] = useState(0),
    [loading, setLoading] = useState(true),
    refresh = useRef(false);
  // Revenue and costs cover the whole company's bookkeeping and are only for company administrators.
  const admin = company.role === 'admin';
  const [finance, setFinance] = useState<PerformanceFinance | null>(null),
    [shop, setShop] = useState<PerformanceShop | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  useEffect(() => {
    const controller = new AbortController();
    setFinance(null);
    setShop(null);
    setErrors({});
    setLoading(true);
    setSupplier('all');
    const forced = refresh.current;
    refresh.current = false;
    const load = async (source: 'finance' | 'shop') => {
      try {
        let response: Response,
          value: PerformanceFinance & PerformanceShop & { error?: string };
        // Another tab or user may be fetching the same numbers; wait for them instead of failing.
        for (let attempt = 0; ; attempt++) {
          response = await tier1Fetch(
            `/api/performance/${source}?year=${year}${forced ? '&refresh=1' : ''}`,
            {
              cache: 'no-store',
              signal: AbortSignal.any([
                controller.signal,
                AbortSignal.timeout(90000),
              ]),
            },
          );
          value = await response.json();
          if (
            response.status !== 409 ||
            !/hentes allerede/.test(value.error || '') ||
            attempt >= 30
          )
            break;
          await new Promise((resolve) => setTimeout(resolve, 3000));
          if (controller.signal.aborted) return;
        }
        if (!response.ok)
          throw Error(value.error || 'Tallene kunne ikke hentes.');
        if (controller.signal.aborted) return;
        if (source === 'finance') setFinance(value);
        else setShop(value);
      } catch (error) {
        if (!controller.signal.aborted)
          setErrors((previous) => ({
            ...previous,
            [source]:
              error instanceof Error
                ? error.message
                : 'Tallene kunne ikke hentes.',
          }));
      }
    };
    void Promise.all([
      ...(admin ? [load('finance')] : []),
      load('shop'),
    ]).finally(() => {
      if (!controller.signal.aborted) setLoading(false);
    });
    return () => controller.abort();
  }, [year, revision, webshopId, company.id, admin]);
  const shopName =
    webshops.find((s) => s.id === webshopId)?.name || 'Valgt webshop';
  const expenseMonths =
    supplier === 'all'
      ? finance?.expenses.months
      : supplier === 'unassigned'
        ? finance?.unassigned
        : finance?.suppliers.find((s) => s.id === supplier)?.months;
  const sourceNote = (start?: string, checked?: string) =>
    checked
      ? `Hentet ${formatDateTime(checked)} · Historik fra ${formatDate(start!)}`
      : '';
  return (
    <div className="mx-auto max-w-[1440px] px-5 py-7 md:px-8 md:py-9">
      <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="eyebrow">Tools · Årsoversigt</p>
          <h1 className="page-title">Performance</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Følg udviklingen måned for måned og sammenlign med året før.
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <label className="grid gap-1 text-xs font-medium">
            År
            <select
              className="h-10 rounded-xl border border-border bg-white px-3 text-sm"
              aria-label="År for Performance"
              value={year}
              onChange={(event) => setYear(Number(event.target.value))}
            >
              {Array.from({ length: 10 }, (_, i) => currentYear - i).map(
                (y) => (
                  <option key={y} value={y}>
                    {y}
                  </option>
                ),
              )}
            </select>
          </label>
          <RefreshButton
            onRefresh={() => {
              refresh.current = true;
              setRevision((v) => v + 1);
            }}
            disabled={loading}
          />
        </div>
      </header>
      <div className="mb-7 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#e9e2d7] bg-[#faf8f5] px-4 py-3 text-xs text-muted-foreground">
        <p className="flex items-center gap-2">
          <Info className="size-4 shrink-0" />
          Regnskab: {company.name} · Webshop: {shopName}
        </p>
        <Button
          variant="link"
          className="h-auto p-0 text-xs"
          onClick={onIntegrations}
        >
          Se integrationer
          <ArrowUpRight className="size-3" />
        </Button>
      </div>
      <div className="grid gap-6 xl:grid-cols-2">
        {admin ? (
          <>
            <PerformanceChart
              title="Omsætning"
              icon={<Banknote className="size-5" />}
              source="Dinero · Hele virksomheden"
              description="Bogført omsætning ekskl. moms."
              color="#9a7440"
              year={year}
              monetary
              metric={finance?.revenue}
              error={errors.finance}
              loading={loading && !finance && !errors.finance}
              note={sourceNote(finance?.startDate, finance?.checkedAt)}
            />
            <PerformanceChart
              title="Omkostninger"
              icon={<ArrowUpRight className="size-5" />}
              source="Dinero · Hele virksomheden"
              description="Bogførte omkostninger før skat, uden fradragsberettiget moms."
              color="#ba7046"
              year={year}
              monetary
              metric={expenseMonths ? { months: expenseMonths } : undefined}
              error={errors.finance}
              loading={loading && !finance && !errors.finance}
              note={sourceNote(finance?.startDate, finance?.checkedAt)}
              controls={
                <label className="grid min-w-0 gap-1 text-xs text-muted-foreground">
                  Leverandør
                  <select
                    className="h-9 w-full max-w-full rounded-lg border border-border bg-white px-2 text-sm text-foreground sm:max-w-64"
                    aria-label="Filtrér omkostninger efter leverandør"
                    disabled={!finance}
                    value={supplier}
                    onChange={(event) => setSupplier(event.target.value)}
                  >
                    <option value="all">Alle leverandører</option>
                    <option value="unassigned">Uden leverandør</option>
                    {finance?.suppliers.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.name}
                      </option>
                    ))}
                  </select>
                </label>
              }
            />
            <div className="min-w-0 xl:col-span-2">
              <PerformanceChart
                title="Overskud"
                icon={<Wallet className="size-5" />}
                source="Dinero · Hele virksomheden"
                description="Resultat før skat pr. måned, som på Dashboardet."
                color="#6f8f4e"
                year={year}
                monetary
                metric={finance?.profit}
                error={errors.finance}
                loading={loading && !finance && !errors.finance}
                note={sourceNote(finance?.startDate, finance?.checkedAt)}
              />
            </div>
          </>
        ) : (
          <p className="flex items-center gap-2 rounded-2xl border border-dashed border-[#e0d6c6] bg-white p-5 text-sm text-muted-foreground xl:col-span-2">
            <Info className="size-4 shrink-0" />
            Omsætning og omkostninger kommer fra virksomhedens regnskab og kan
            kun ses af virksomhedens administratorer.
          </p>
        )}
        <PerformanceChart
          title="Besøg"
          icon={<Eye className="size-5" />}
          source={`Shopify · ${shopName}`}
          description="Besøg (sessioner) i webshoppens analyser."
          color="#37867b"
          year={year}
          metric={shop?.visits}
          error={errors.shop}
          loading={loading && !shop && !errors.shop}
          note={sourceNote(shop?.startDate, shop?.checkedAt)}
        />
        <PerformanceChart
          title="Antal ordrer"
          icon={<ShoppingBag className="size-5" />}
          source={`Shopify · ${shopName}`}
          description="Antal ordrer ifølge webshoppens salgsrapport."
          color="#567da3"
          year={year}
          metric={shop?.orders}
          error={errors.shop}
          loading={loading && !shop && !errors.shop}
          note={sourceNote(shop?.startDate, shop?.checkedAt)}
        />
      </div>
      <p className="mt-6 text-xs leading-6 text-muted-foreground">
        Indeværende måned vises til dato. Den stiplede linje viser hele måneder
        fra {year - 1}. Fremtidige måneder og måneder uden tilstrækkelig
        historik vises som —. Leverandørfilteret gælder kun omkostninger; “Uden
        leverandør” omfatter posteringer uden tilknyttet leverandør. Tal
        genbruges i op til 15 minutter.
        {shop?.timezone && ` Webshoppen opgøres i tidszonen ${shop.timezone}.`}
      </p>
    </div>
  );
}

export function PerformanceChart({
  title,
  source,
  description,
  icon,
  color,
  year,
  monetary = false,
  metric,
  error,
  loading,
  controls,
  note,
}: {
  title: string;
  source: string;
  description: string;
  icon: ReactNode;
  color: string;
  year: number;
  monetary?: boolean;
  metric?: PerformanceMetric;
  error?: string;
  loading: boolean;
  controls?: ReactNode;
  note: string;
}) {
  const months = metric?.months || [],
    failure = error || metric?.error;
  const format = (value: number | null) =>
    value === null
      ? '—'
      : monetary
        ? money.format(value / 100)
        : number.format(value);
  const data = performanceMonths.map((label, i) => ({
    label,
    current: months[i]?.current ?? null,
    previous: months[i]?.previous ?? null,
  }));
  const anyData = months.some((m) => m.current !== null || m.previous !== null);
  const tick = (value: number) =>
    new Intl.NumberFormat('da-DK', {
      notation: 'compact',
      maximumFractionDigits: 1,
    }).format(monetary ? value / 100 : value);
  return (
    <section
      aria-label={title}
      className="min-w-0 overflow-hidden rounded-2xl border border-[#e9e2d7] bg-white shadow-[0_8px_30px_rgba(70,50,20,0.04)]"
    >
      <div className="p-5 pb-0 sm:p-6 sm:pb-0">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="mb-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
              {source}
            </p>
            <h2 className="flex items-center gap-2 text-lg font-semibold">
              <span style={{ color }}>{icon}</span>
              {title}
            </h2>
          </div>
          {controls}
        </div>
        <p className="mt-2 min-h-5 text-xs text-muted-foreground">
          {description}
        </p>
        <div className="my-5 flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-[11px] text-muted-foreground">
              {year} · Sum af viste måneder
            </p>
            <p className="mt-1 text-2xl font-semibold tabular-nums sm:text-3xl">
              {loading || failure ? '—' : format(total(months, 'current'))}
            </p>
          </div>
          <div className="flex gap-4 pb-1 text-xs text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <span
                className="h-2.5 w-2.5 rounded-sm"
                style={{ background: color }}
              />
              {year}
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-5 border-t-2 border-dashed border-slate-500" />
              {year - 1}
            </span>
          </div>
        </div>
      </div>
      {failure ? (
        <div
          role="alert"
          className="mx-5 mb-6 flex min-h-64 items-center rounded-xl bg-amber-50 p-5 text-sm leading-6 text-amber-900"
        >
          {failure}
        </div>
      ) : loading ? (
        <div
          role="status"
          className="flex h-72 items-center justify-center gap-2 text-sm text-muted-foreground"
        >
          <RefreshCw className="size-4 animate-spin" />
          Henter {title.toLocaleLowerCase('da')}…
        </div>
      ) : (
        <>
          {!anyData && (
            <p className="mx-5 mb-3 rounded-lg bg-slate-50 p-3 text-xs text-muted-foreground">
              Ingen komplette månedstal i den valgte periode. Kontrollér
              historik og integration.
            </p>
          )}
          <div
            className="h-64 pr-3 sm:h-72 sm:pr-5"
            role="img"
            aria-label={`${title}: søjler for ${year}, stiplet linje for ${year - 1}. Månedstal findes i tabellen nedenfor.`}
          >
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart
                data={data}
                margin={{ top: 12, right: 8, left: 6, bottom: 6 }}
                accessibilityLayer
              >
                <CartesianGrid stroke="#eeeae4" vertical={false} />
                <XAxis
                  dataKey="label"
                  tickLine={false}
                  axisLine={false}
                  interval={0}
                  tick={{ fontSize: 10, fill: '#77736d' }}
                />
                <YAxis
                  width={54}
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={tick}
                  tick={{ fontSize: 10, fill: '#77736d' }}
                  allowDecimals={monetary}
                />
                <Tooltip
                  formatter={(value, name) => [
                    format(typeof value === 'number' ? value : null),
                    name,
                  ]}
                  contentStyle={{
                    borderRadius: 12,
                    borderColor: '#e9e2d7',
                    fontSize: 12,
                  }}
                  cursor={{ fill: '#faf8f5' }}
                />
                <Bar
                  dataKey="current"
                  name={String(year)}
                  fill={color}
                  radius={[4, 4, 0, 0]}
                  maxBarSize={26}
                  isAnimationActive={false}
                />
                <Line
                  dataKey="previous"
                  name={String(year - 1)}
                  stroke="#64748b"
                  strokeWidth={2}
                  strokeDasharray="5 5"
                  dot={false}
                  activeDot={{ r: 4 }}
                  connectNulls={false}
                  isAnimationActive={false}
                />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
          <details className="mx-5 mb-4 border-t border-[#f0ece6] pt-3 sm:mx-6">
            <summary className="cursor-pointer text-xs font-medium text-muted-foreground">
              Se månedstal
            </summary>
            <div className="mt-3 overflow-x-auto">
              <table className="w-full text-left text-xs tabular-nums">
                <caption className="sr-only">{title} pr. måned</caption>
                <thead>
                  <tr>
                    <th className="py-2">Måned</th>
                    <th className="text-right">{year}</th>
                    <th className="text-right">{year - 1}</th>
                  </tr>
                </thead>
                <tbody>
                  {data.map((row) => (
                    <tr key={row.label} className="border-t border-[#f0ece6]">
                      <th scope="row" className="py-2 font-normal">
                        {row.label}
                      </th>
                      <td className="text-right">{format(row.current)}</td>
                      <td className="text-right">{format(row.previous)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        </>
      )}
      {note && !failure && (
        <p className="border-t border-[#f0ece6] bg-[#fcfbf9] px-5 py-3 text-[10px] text-muted-foreground sm:px-6">
          {note}
        </p>
      )}
    </section>
  );
}
