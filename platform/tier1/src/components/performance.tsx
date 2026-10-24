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
  CalendarDays,
  Eye,
  ShoppingBag,
  RefreshCw,
  Info,
  Wallet,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { RefreshButton } from '@/components/refresh-button';
import { tier1Fetch } from '@/platform/transport';
import { PageTitle, useWorkspace } from '@/platform/workspace';
import { danishDate } from '@/lib/history-policy';
import { formatDate, formatDateTime } from '@/lib/format';
import {
  performanceMonths,
  type MonthComparison,
  type PerformanceDaily,
  type PerformanceFinance,
  type PerformanceShop,
} from '@/lib/performance';

const number = new Intl.NumberFormat('da-DK', { maximumFractionDigits: 0 });
const monthName = (month: number) =>
  new Intl.DateTimeFormat('da-DK', { month: 'long', timeZone: 'UTC' }).format(
    Date.UTC(2026, month - 1, 1),
  );
const sum = (points: ChartPoint[], key: 'current' | 'previous') => {
  const known = points
    .map((p) => p[key])
    .filter((value): value is number => value !== null);
  return known.length ? known.reduce((total, value) => total + value, 0) : null;
};
// Last year's numbers for the months that have a number this year.
const samePeriod = (points: ChartPoint[]) =>
  sum(
    points.filter((p) => p.current !== null),
    'previous',
  );
export type ChartPoint = {
  label: string;
  title: string;
  current: number | null;
  previous: number | null;
};
const monthPoints = (months?: MonthComparison[]): ChartPoint[] =>
  performanceMonths.map((label, i) => ({
    label,
    title: label,
    current: months?.[i]?.current ?? null,
    previous: months?.[i]?.previous ?? null,
  }));
// Another tab or user may be fetching the same numbers; wait for them instead of failing.
async function fetchReport<T>(path: string, signal: AbortSignal): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    const response = await tier1Fetch(path, {
      cache: 'no-store',
      signal: AbortSignal.any([signal, AbortSignal.timeout(90000)]),
    });
    const value = (await response.json()) as T & { error?: string };
    if (
      response.status === 409 &&
      /hentes allerede/.test(value.error || '') &&
      attempt < 30
    ) {
      await new Promise((resolve) => setTimeout(resolve, 3000));
      if (signal.aborted) throw Error('Afbrudt.');
      continue;
    }
    if (!response.ok) throw Error(value.error || 'Tallene kunne ikke hentes.');
    return value;
  }
}

export function Performance({
  onIntegrations,
}: {
  onIntegrations: () => void;
}) {
  const { company, webshopId, webshops } = useWorkspace();
  const today = danishDate(),
    currentYear = Number(today.slice(0, 4)),
    currentMonth = Number(today.slice(5, 7));
  const [year, setYear] = useState(currentYear),
    [month, setMonth] = useState(currentMonth),
    [supplier, setSupplier] = useState('all');
  const [revision, setRevision] = useState(0),
    [loading, setLoading] = useState(true),
    refresh = useRef(-1);
  // Revenue and costs cover the whole company's bookkeeping and are only for company administrators.
  const admin = company.role === 'admin';
  const [finance, setFinance] = useState<PerformanceFinance | null>(null),
    [shop, setShop] = useState<PerformanceShop | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  // Daily sales belong to the request that fetched them, so a new month or webshop never shows old numbers.
  const dailyKey = [year, month, revision, webshopId, company.id].join(':');
  const [dailyResult, setDailyResult] = useState<{
    key: string;
    value?: PerformanceDaily;
    error?: string;
  } | null>(null);
  const current = dailyResult?.key === dailyKey ? dailyResult : null,
    daily = current?.value ?? null,
    dailyLoading = !current;
  const message = (error: unknown) =>
    error instanceof Error ? error.message : 'Tallene kunne ikke hentes.';
  useEffect(() => {
    const controller = new AbortController();
    setFinance(null);
    setShop(null);
    setErrors({});
    setLoading(true);
    setSupplier('all');
    const forced = refresh.current === revision ? '&refresh=1' : '';
    const load = async (source: 'finance' | 'shop') => {
      try {
        const value = await fetchReport<PerformanceFinance & PerformanceShop>(
          `/api/performance/${source}?year=${year}${forced}`,
          controller.signal,
        );
        if (controller.signal.aborted) return;
        if (source === 'finance') setFinance(value);
        else setShop(value);
      } catch (error) {
        if (!controller.signal.aborted)
          setErrors((previous) => ({
            ...previous,
            [source]: message(error),
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
  useEffect(() => {
    const controller = new AbortController();
    const forced = refresh.current === revision ? '&refresh=1' : '';
    // Opdatér applies to this fetch only; later changes of month, year or webshop use the cache again.
    refresh.current = -1;
    fetchReport<PerformanceDaily>(
      `/api/performance/daily?year=${year}&month=${month}${forced}`,
      controller.signal,
    ).then(
      (value) => {
        if (!controller.signal.aborted)
          setDailyResult({ key: dailyKey, value });
      },
      (error) => {
        if (!controller.signal.aborted)
          setDailyResult({ key: dailyKey, error: message(error) });
      },
    );
    return () => controller.abort();
  }, [year, month, revision, webshopId, company.id, dailyKey]);
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
  const name = monthName(month),
    dayPoints: ChartPoint[] = (daily?.days || []).map((d) => ({
      label: String(d.day),
      title: `${d.day}. ${name}`,
      current: d.current,
      previous: d.previous,
    }));
  const financeLoading = loading && !finance && !errors.finance,
    shopLoading = loading && !shop && !errors.shop;
  return (
    <div className="mx-auto max-w-[1440px] px-5 py-7 md:px-8 md:py-9">
      <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="eyebrow">Tools · Årsoversigt</p>
          <PageTitle title="Performance" />
          <p className="mt-2 text-sm text-muted-foreground">
            Følg udviklingen dag for dag og måned for måned, og sammenlign med
            året før.
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
              refresh.current = revision + 1;
              setRevision(revision + 1);
            }}
            disabled={loading || dailyLoading}
          />
        </div>
      </header>
      <div className="mb-7 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#e9e2d7] bg-[#faf8f5] px-4 py-3 text-xs text-muted-foreground">
        <p className="flex items-center gap-2">
          <Info className="size-4 shrink-0" />
          Webshop: {shopName} · Regnskab: {company.name}
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
      <section aria-labelledby="performance-webshop">
        <SectionHeading
          id="performance-webshop"
          title={`Webshop · ${shopName}`}
          description="Tal fra Shopify for den valgte webshop."
        />
        <div className="grid gap-6 xl:grid-cols-2">
          <div className="min-w-0 xl:col-span-2">
            <PerformanceChart
              title="Salg pr. dag"
              icon={<CalendarDays className="size-5" />}
              source={`Shopify · ${shopName}`}
              description="Salg ekskl. moms (inkl. fragt, efter rabatter og returneringer), som på Dashboardet."
              color="#9a7440"
              year={year}
              monetary
              currency={daily?.currency}
              points={dayPoints}
              previousTotals
              unit="day"
              summary={`${name[0].toLocaleUpperCase('da')}${name.slice(1)} ${year}${year === currentYear && month === currentMonth ? ' · Til dato' : year === currentYear && month > currentMonth ? ' · Ikke begyndt' : ''}${daily?.missingDays ? ` · Delsum, ${daily.missingDays} ${daily.missingDays === 1 ? 'dag' : 'dage'} uden tal` : ''}`}
              error={current?.error}
              loading={dailyLoading}
              note={sourceNote(daily?.startDate, daily?.checkedAt)}
              controls={
                <label className="grid min-w-0 gap-1 text-xs text-muted-foreground">
                  Måned
                  <select
                    className="h-9 w-full max-w-full rounded-lg border border-border bg-white px-2 text-sm text-foreground sm:max-w-48"
                    aria-label="Måned for salg pr. dag"
                    value={month}
                    onChange={(event) => setMonth(Number(event.target.value))}
                  >
                    {performanceMonths.map((_, i) => (
                      <option key={i} value={i + 1}>
                        {monthName(i + 1)}
                      </option>
                    ))}
                  </select>
                </label>
              }
            />
          </div>
          <PerformanceChart
            title="Besøg"
            icon={<Eye className="size-5" />}
            source={`Shopify · ${shopName}`}
            description="Besøg (sessioner) i webshoppens analyser."
            color="#37867b"
            year={year}
            points={monthPoints(shop?.visits.months)}
            previousTotals
            error={errors.shop || shop?.visits.error}
            loading={shopLoading}
            note={sourceNote(shop?.startDate, shop?.checkedAt)}
          />
          <PerformanceChart
            title="Antal ordrer"
            icon={<ShoppingBag className="size-5" />}
            source={`Shopify · ${shopName}`}
            description="Antal ordrer ifølge webshoppens salgsrapport."
            color="#567da3"
            year={year}
            points={monthPoints(shop?.orders.months)}
            previousTotals
            error={errors.shop || shop?.orders.error}
            loading={shopLoading}
            note={sourceNote(shop?.startDate, shop?.checkedAt)}
          />
        </div>
      </section>
      <section aria-labelledby="performance-company" className="mt-10">
        <SectionHeading
          id="performance-company"
          title={`Virksomhed · ${company.name}`}
          description="Bogførte tal fra Dinero for hele virksomheden, på tværs af webshops."
        />
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
                points={monthPoints(finance?.revenue.months)}
                previousTotals
                error={errors.finance || finance?.revenue.error}
                loading={financeLoading}
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
                points={monthPoints(expenseMonths)}
                previousTotals
                error={errors.finance}
                loading={financeLoading}
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
                  points={monthPoints(finance?.profit?.months)}
                  previousTotals
                  error={errors.finance || finance?.profit?.error}
                  loading={financeLoading}
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
        </div>
      </section>
      <p className="mt-6 text-xs leading-6 text-muted-foreground">
        Salg pr. dag viser alle dage i den valgte måned; dage efter i dag er
        tomme for {year}, mens den stiplede linje viser hele måneden i{' '}
        {year - 1}. Indeværende måned vises til dato i månedsgraferne, og den
        stiplede linje viser hele måneder fra {year - 1}. Fremtidige perioder og
        perioder uden tilstrækkelig historik vises som —. “{year - 1} samme
        periode” summerer sidste års tal for de dage eller måneder, der har tal
        i {year}, mens “Hele {year - 1}” og “Hele måneden {year - 1}” summerer
        hele sidste års linje. Leverandørfilteret gælder kun omkostninger; “Uden
        leverandør” omfatter posteringer uden tilknyttet leverandør. Tal
        genbruges i op til 15 minutter.
        {shop?.timezone && ` Webshoppen opgøres i tidszonen ${shop.timezone}.`}
      </p>
    </div>
  );
}

function SectionHeading({
  id,
  title,
  description,
}: {
  id: string;
  title: string;
  description: string;
}) {
  return (
    <div className="mb-4">
      <h2 id={id} className="text-base font-semibold">
        {title}
      </h2>
      <p className="mt-1 text-xs text-muted-foreground">{description}</p>
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
  currency = 'DKK',
  points,
  unit = 'month',
  summary,
  error,
  loading,
  controls,
  note,
  previousTotals = false,
}: {
  title: string;
  source: string;
  description: string;
  icon: ReactNode;
  color: string;
  year: number;
  monetary?: boolean;
  currency?: string;
  points: ChartPoint[];
  unit?: 'month' | 'day';
  summary?: string;
  error?: string;
  loading: boolean;
  controls?: ReactNode;
  note: string;
  previousTotals?: boolean;
}) {
  const failure = error,
    data = points,
    daily = unit === 'day',
    money = new Intl.NumberFormat('da-DK', {
      style: 'currency',
      currency,
      maximumFractionDigits: 2,
    });
  const format = (value: number | null) =>
    value === null
      ? '—'
      : monetary
        ? money.format(value / 100)
        : number.format(value);
  const anyData = data.some((m) => m.current !== null || m.previous !== null);
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
              {summary || `${year} · Sum af viste måneder`}
            </p>
            <p className="mt-1 text-2xl font-semibold tabular-nums sm:text-3xl">
              {loading || failure ? '—' : format(sum(data, 'current'))}
            </p>
            {previousTotals && !loading && !failure && (
              <p className="mt-1 text-xs text-muted-foreground tabular-nums">
                {year - 1} samme periode:{' '}
                <span className="font-medium text-foreground">
                  {format(samePeriod(data))}
                </span>
                {' · '}
                {daily ? `Hele måneden ${year - 1}` : `Hele ${year - 1}`}:{' '}
                <span className="font-medium text-foreground">
                  {format(sum(data, 'previous'))}
                </span>
              </p>
            )}
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
              {daily
                ? 'Ingen dagstal i den valgte måned.'
                : 'Ingen komplette månedstal i den valgte periode.'}{' '}
              Kontrollér historik og integration.
            </p>
          )}
          <div
            className="h-64 pr-3 sm:h-72 sm:pr-5"
            role="img"
            aria-label={`${title}: søjler for ${year}, stiplet linje for ${year - 1}. ${daily ? 'Dagstal' : 'Månedstal'} findes i tabellen nedenfor.`}
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
                  interval={daily ? 'preserveStartEnd' : 0}
                  minTickGap={daily ? 6 : 0}
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
                  labelFormatter={(label, payload) =>
                    payload?.[0]?.payload?.title ?? label
                  }
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
                  maxBarSize={daily ? 18 : 26}
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
              {daily ? 'Se dagstal' : 'Se månedstal'}
            </summary>
            <div className="mt-3 overflow-x-auto">
              <table className="w-full text-left text-xs tabular-nums">
                <caption className="sr-only">
                  {title} pr. {daily ? 'dag' : 'måned'}
                </caption>
                <thead>
                  <tr>
                    <th className="py-2">{daily ? 'Dag' : 'Måned'}</th>
                    <th className="text-right">{year}</th>
                    <th className="text-right">{year - 1}</th>
                  </tr>
                </thead>
                <tbody>
                  {data.map((row) => (
                    <tr key={row.label} className="border-t border-[#f0ece6]">
                      <th scope="row" className="py-2 font-normal">
                        {row.title}
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
