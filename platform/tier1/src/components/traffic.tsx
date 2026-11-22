'use client';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  ArrowUpRight,
  Banknote,
  Eye,
  Info,
  Percent,
  RefreshCw,
  ShoppingBag,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { RefreshButton } from '@/components/refresh-button';
import { CountryFlag, countryName } from '@/components/country-flag';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { tier1Fetch } from '@/platform/transport';
import { PageTitle, useWorkspace } from '@/platform/workspace';
import { formatDate, formatDateTime } from '@/lib/format';
import {
  conversionRate,
  trafficPeriods,
  type TrafficPeriod,
  type TrafficReport,
  type TrafficRow,
  type TrafficTable,
} from '@/lib/traffic';

const VISITS = '#37867b',
  ORDERS = '#567da3';
const number = new Intl.NumberFormat('da-DK', { maximumFractionDigits: 0 });
const percent = new Intl.NumberFormat('da-DK', {
  style: 'percent',
  maximumFractionDigits: 1,
});
const count = (value: number | null) =>
  value === null ? '—' : number.format(value);
const share = (value: number | null, total: number | null) =>
  value === null || !total ? null : value / total;
const pct = (value: number | null) =>
  value === null ? '—' : percent.format(value);

// Another tab or user may be fetching the same numbers; wait for them instead of failing.
async function fetchTraffic(
  days: TrafficPeriod,
  force: boolean,
  signal: AbortSignal,
): Promise<TrafficReport> {
  for (let attempt = 0; ; attempt++) {
    const response = await tier1Fetch(
      `/api/traffic?days=${days}${force ? '&refresh=1' : ''}`,
      {
        cache: 'no-store',
        signal: AbortSignal.any([signal, AbortSignal.timeout(120000)]),
      },
    );
    const value = (await response.json()) as TrafficReport & {
      error?: string;
    };
    if (
      response.status === 409 &&
      /hentes allerede/.test(value.error || '') &&
      attempt < 40
    ) {
      await new Promise((resolve) => setTimeout(resolve, 3000));
      if (signal.aborted) throw Error('Afbrudt.');
      continue;
    }
    if (!response.ok)
      throw Error(value.error || 'Trafikkilderne kunne ikke hentes.');
    return value;
  }
}

type Tab = 'referrers' | 'campaigns' | 'countries' | 'landingPages' | 'devices';
const tabs: Array<{
  id: Tab;
  label: string;
  heading: string;
  orders: boolean;
}> = [
  { id: 'referrers', label: 'Henvisere', heading: 'Henviser', orders: true },
  {
    id: 'campaigns',
    label: 'Kampagner (UTM)',
    heading: 'Kampagne',
    orders: true,
  },
  { id: 'countries', label: 'Lande', heading: 'Land', orders: true },
  {
    id: 'landingPages',
    label: 'Landingssider',
    heading: 'Første side',
    orders: false,
  },
  { id: 'devices', label: 'Enheder', heading: 'Enhed', orders: false },
];

export function Traffic({ onIntegrations }: { onIntegrations: () => void }) {
  const { webshopId, webshops } = useWorkspace();
  const [days, setDays] = useState<TrafficPeriod>(30),
    [revision, setRevision] = useState(0),
    refresh = useRef(-1);
  // The numbers belong to the request that fetched them, so a new period or webshop never shows old numbers.
  const key = [days, revision, webshopId].join(':');
  const [result, setResult] = useState<{
    key: string;
    value?: TrafficReport;
    error?: string;
  } | null>(null);
  const current = result?.key === key ? result : null,
    report = current?.value ?? null,
    loading = !current;
  useEffect(() => {
    const controller = new AbortController();
    const force = refresh.current === revision;
    refresh.current = -1;
    fetchTraffic(days, force, controller.signal).then(
      (value) => {
        if (!controller.signal.aborted) setResult({ key, value });
      },
      (error) => {
        if (!controller.signal.aborted)
          setResult({
            key,
            error:
              error instanceof Error
                ? error.message
                : 'Trafikkilderne kunne ikke hentes.',
          });
      },
    );
    return () => controller.abort();
  }, [days, revision, webshopId, key]);
  const shopName =
    webshops.find((s) => s.id === webshopId)?.name || 'Valgt webshop';
  const totals = report?.totals;
  const money = new Intl.NumberFormat('da-DK', {
    style: 'currency',
    currency: report?.currency || 'DKK',
    maximumFractionDigits: 0,
  });
  const kr = (value: number | null) =>
    value === null ? '—' : money.format(value / 100);
  return (
    <div className="mx-auto max-w-[1440px] px-5 py-7 md:px-8 md:py-9">
      <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="eyebrow">Tools · Analyse</p>
          <PageTitle title="Trafikkilder" />
          <p className="mt-2 text-sm text-muted-foreground">
            Se hvor dine besøgende kommer fra, og hvor de kunder, der bestiller,
            kommer fra.
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <label className="grid gap-1 text-xs font-medium">
            Periode
            <select
              className="h-10 rounded-xl border border-border bg-white px-3 text-sm"
              aria-label="Periode for trafikkilder"
              value={days}
              onChange={(event) =>
                setDays(Number(event.target.value) as TrafficPeriod)
              }
            >
              {trafficPeriods.map((d) => (
                <option key={d} value={d}>
                  Seneste {d} dage
                </option>
              ))}
            </select>
          </label>
          <RefreshButton
            onRefresh={() => {
              refresh.current = revision + 1;
              setRevision(revision + 1);
            }}
            disabled={loading}
          />
        </div>
      </header>
      <div className="mb-7 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#e9e2d7] bg-[#faf8f5] px-4 py-3 text-xs text-muted-foreground">
        <p className="flex items-center gap-2">
          <Info className="size-4 shrink-0" />
          Webshop: {shopName}
          {report &&
            ` · ${formatDate(report.from)} – ${formatDate(report.to)}${report.limitedByHistory ? ' (fra historikstart)' : ''}`}
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
      {current?.error ? (
        <div
          role="alert"
          className="rounded-2xl bg-amber-50 p-5 text-sm leading-6 text-amber-900"
        >
          {current.error}
        </div>
      ) : loading || !report || !totals ? (
        <div
          role="status"
          className="flex h-72 items-center justify-center gap-2 rounded-2xl border border-[#e9e2d7] bg-white text-sm text-muted-foreground"
        >
          <RefreshCw className="size-4 animate-spin" />
          Henter trafikkilder…
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Kpi
              icon={<Eye className="size-4" />}
              color={VISITS}
              label="Besøg"
              value={count(totals.sessions)}
              error={totals.sessionsError}
            />
            <Kpi
              icon={<ShoppingBag className="size-4" />}
              color={ORDERS}
              label="Ordrer"
              value={count(totals.orders)}
              error={totals.ordersError}
            />
            <Kpi
              icon={<Percent className="size-4" />}
              color="#7a6a9a"
              label="Konverteringsrate"
              value={pct(conversionRate(totals))}
              hint="Besøg med gennemført køb"
              error={totals.sessionsError}
            />
            <Kpi
              icon={<Banknote className="size-4" />}
              color="#9a7440"
              label="Salg ekskl. moms"
              value={kr(totals.sales)}
              error={totals.ordersError}
            />
          </div>
          <Channels table={report.channels} totals={report.totals} kr={kr} />
          <section
            aria-labelledby="traffic-details"
            className="mt-8 min-w-0 rounded-2xl border border-[#e9e2d7] bg-white p-5 shadow-[0_8px_30px_rgba(70,50,20,0.04)] sm:p-6"
          >
            <h2 id="traffic-details" className="text-lg font-semibold">
              Kilder i detaljer
            </h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Henvisende sider, kampagner, lande, første side og enhed.
            </p>
            <Tabs defaultValue="referrers" className="mt-4">
              <div className="max-w-full overflow-x-auto">
                <TabsList>
                  {tabs.map((t) => (
                    <TabsTrigger key={t.id} value={t.id}>
                      {t.label}
                    </TabsTrigger>
                  ))}
                </TabsList>
              </div>
              {tabs.map((t) => (
                <TabsContent key={t.id} value={t.id}>
                  <SourceTable
                    table={report[t.id]}
                    totals={report.totals}
                    heading={t.heading}
                    orders={t.orders}
                    country={t.id === 'countries'}
                    kr={kr}
                  />
                </TabsContent>
              ))}
            </Tabs>
          </section>
          <p className="mt-6 text-xs leading-6 text-muted-foreground">
            Besøg er sessioner i Shopify Analytics, opgjort efter hvor besøget
            kom fra. Ordrer og salg er fra Shopifys salgsrapport og tilskrives
            den kilde, Shopify har registreret på ordren, så en kunde, der først
            kom fra Google og senere vendte direkte tilbage, tæller som besøg
            begge steder, men ordren tæller ét sted. “Direkte / ukendt” samler
            besøg uden henvisning, hvor Shopify ikke kender kilden. Lande er
            besøgets land og ordrens leveringsland. Salg er ekskl. moms, inkl.
            fragt og efter rabatter og returneringer i perioden. Tal genbruges i
            op til 15 minutter
            {report.timezone &&
              `, og perioden opgøres i webshoppens tidszone ${report.timezone}`}
            . Hentet {formatDateTime(report.checkedAt)}.
          </p>
        </>
      )}
    </div>
  );
}

function Kpi({
  icon,
  color,
  label,
  value,
  hint,
  error,
}: {
  icon: ReactNode;
  color: string;
  label: string;
  value: string;
  hint?: string;
  error?: string;
}) {
  return (
    <div className="min-w-0 rounded-2xl border border-[#e9e2d7] bg-white p-4 shadow-[0_8px_30px_rgba(70,50,20,0.04)] sm:p-5">
      <p className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
        <span style={{ color }}>{icon}</span>
        {label}
      </p>
      <p className="mt-2 truncate text-2xl font-semibold tabular-nums sm:text-3xl">
        {error ? '—' : value}
      </p>
      {error ? (
        <p className="mt-1 text-[11px] leading-4 text-amber-800">{error}</p>
      ) : (
        hint && <p className="mt-1 text-[11px] text-muted-foreground">{hint}</p>
      )}
    </div>
  );
}

function Bar({ value, color }: { value: number | null; color: string }) {
  return (
    <div className="h-2.5 min-w-0 flex-1 overflow-hidden rounded-full bg-[#f1ede7]">
      <div
        className="h-full rounded-full"
        style={{
          width: `${Math.max(0, Math.min(1, value ?? 0)) * 100}%`,
          background: color,
        }}
      />
    </div>
  );
}

function Errors({ table }: { table: TrafficTable }) {
  const messages = [
    table.sessionsError && `Besøg: ${table.sessionsError}`,
    table.ordersError && `Ordrer: ${table.ordersError}`,
  ].filter(Boolean);
  return messages.length ? (
    <div
      role="alert"
      className="mb-4 rounded-xl bg-amber-50 p-3 text-xs leading-5 text-amber-900"
    >
      {messages.map((m) => (
        <p key={m as string}>{m}</p>
      ))}
    </div>
  ) : null;
}

// The main overview: per channel, its share of the visitors next to its share of the orders.
function Channels({
  table,
  totals,
  kr,
}: {
  table: TrafficTable;
  totals: TrafficReport['totals'];
  kr: (value: number | null) => string;
}) {
  const rows = [...table.rows, ...(table.other ? [table.other] : [])];
  return (
    <section
      aria-labelledby="traffic-channels"
      className="mt-8 min-w-0 rounded-2xl border border-[#e9e2d7] bg-white p-5 shadow-[0_8px_30px_rgba(70,50,20,0.04)] sm:p-6"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="traffic-channels" className="text-lg font-semibold">
            Kanaler
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Hver kanals andel af besøgene og af ordrerne. En kanal med større
            andel af ordrer end af besøg sender kunder, der køber.
          </p>
        </div>
        <div className="flex gap-4 text-xs text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <span
              className="h-2.5 w-2.5 rounded-sm"
              style={{ background: VISITS }}
            />
            Besøg
          </span>
          <span className="flex items-center gap-1.5">
            <span
              className="h-2.5 w-2.5 rounded-sm"
              style={{ background: ORDERS }}
            />
            Ordrer
          </span>
        </div>
      </div>
      <div className="mt-5">
        <Errors table={table} />
        {!rows.length ? (
          <p className="rounded-lg bg-slate-50 p-3 text-xs text-muted-foreground">
            Ingen besøg eller ordrer i perioden.
          </p>
        ) : (
          <ul className="grid gap-4">
            {rows.map((row) => {
              const visits = share(row.sessions, totals.sessions),
                orders = share(row.orders, totals.orders);
              return (
                <li
                  key={row.key}
                  className="grid gap-2 border-t border-[#f0ece6] pt-4 first:border-0 first:pt-0 md:grid-cols-[minmax(0,13rem)_minmax(0,1fr)_minmax(0,11rem)] md:items-center md:gap-5"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{row.label}</p>
                    <p className="text-[11px] text-muted-foreground tabular-nums">
                      Konvertering {pct(conversionRate(row))}
                    </p>
                  </div>
                  <div className="grid gap-1.5">
                    <div className="flex items-center gap-3 text-xs tabular-nums">
                      <Bar value={visits} color={VISITS} />
                      <span className="w-28 shrink-0 text-right">
                        {count(row.sessions)} · {pct(visits)}
                      </span>
                    </div>
                    <div className="flex items-center gap-3 text-xs tabular-nums">
                      <Bar value={orders} color={ORDERS} />
                      <span className="w-28 shrink-0 text-right">
                        {count(row.orders)} · {pct(orders)}
                      </span>
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground tabular-nums md:text-right">
                    Salg{' '}
                    <span className="font-medium text-foreground">
                      {kr(row.sales)}
                    </span>
                  </p>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}

type Sort = 'sessions' | 'orders' | 'sales' | 'conversion';
function SourceTable({
  table,
  totals,
  heading,
  orders,
  country,
  kr,
}: {
  table: TrafficTable;
  totals: TrafficReport['totals'];
  heading: string;
  orders: boolean;
  country: boolean;
  kr: (value: number | null) => string;
}) {
  const [sort, setSort] = useState<Sort>('sessions'),
    [all, setAll] = useState(false);
  const value = (row: TrafficRow) =>
    (sort === 'conversion' ? conversionRate(row) : row[sort]) ?? -Infinity;
  const sorted = [...table.rows].sort((a, b) => value(b) - value(a));
  const shown = all ? sorted : sorted.slice(0, 15);
  const label = (row: TrafficRow) =>
    country && row.key !== '(none)' ? (
      <span className="flex items-center gap-2">
        <CountryFlag code={row.key} />
        {countryName(row.key)}
      </span>
    ) : (
      row.label
    );
  return (
    <div className="mt-3">
      <Errors table={table} />
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <label className="grid gap-1 text-xs text-muted-foreground">
          Sortér efter
          <select
            className="h-9 rounded-lg border border-border bg-white px-2 text-sm text-foreground"
            value={sort}
            onChange={(event) => setSort(event.target.value as Sort)}
          >
            <option value="sessions">Besøg</option>
            {orders && <option value="orders">Ordrer</option>}
            {orders && <option value="sales">Salg</option>}
            <option value="conversion">Konverteringsrate</option>
          </select>
        </label>
        <p className="text-xs text-muted-foreground">
          {table.rows.length} {table.rows.length === 1 ? 'kilde' : 'kilder'}
        </p>
      </div>
      {!table.rows.length ? (
        <p className="rounded-lg bg-slate-50 p-3 text-xs text-muted-foreground">
          Ingen data i perioden.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-left text-xs tabular-nums">
            <thead className="text-muted-foreground">
              <tr>
                <th className="py-2 pr-3 font-medium">{heading}</th>
                <th className="px-2 text-right font-medium">Besøg</th>
                <th className="w-32 px-2 font-medium">Andel af besøg</th>
                {orders && (
                  <>
                    <th className="px-2 text-right font-medium">Ordrer</th>
                    <th className="w-32 px-2 font-medium">Andel af ordrer</th>
                    <th className="px-2 text-right font-medium">Salg</th>
                  </>
                )}
                <th className="pl-2 text-right font-medium">Konvertering</th>
              </tr>
            </thead>
            <tbody>
              {[...shown, ...(table.other ? [table.other] : [])].map((row) => {
                const visits = share(row.sessions, totals.sessions),
                  bought = share(row.orders, totals.orders);
                return (
                  <tr key={row.key} className="border-t border-[#f0ece6]">
                    <th
                      scope="row"
                      className="max-w-72 py-2.5 pr-3 font-normal"
                    >
                      <span
                        className="block truncate text-sm"
                        title={row.label}
                      >
                        {label(row)}
                      </span>
                      {row.detail && (
                        <span className="block truncate text-[11px] text-muted-foreground">
                          {row.detail}
                        </span>
                      )}
                    </th>
                    <td className="px-2 text-right">{count(row.sessions)}</td>
                    <td className="px-2">
                      <div className="flex items-center gap-2">
                        <Bar value={visits} color={VISITS} />
                        <span className="w-11 text-right">{pct(visits)}</span>
                      </div>
                    </td>
                    {orders && (
                      <>
                        <td className="px-2 text-right">{count(row.orders)}</td>
                        <td className="px-2">
                          <div className="flex items-center gap-2">
                            <Bar value={bought} color={ORDERS} />
                            <span className="w-11 text-right">
                              {pct(bought)}
                            </span>
                          </div>
                        </td>
                        <td className="px-2 text-right">{kr(row.sales)}</td>
                      </>
                    )}
                    <td className="pl-2 text-right">
                      {pct(conversionRate(row))}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {sorted.length > 15 && (
        <Button
          variant="link"
          className="mt-2 h-auto p-0 text-xs"
          onClick={() => setAll(!all)}
        >
          {all ? 'Vis færre' : `Vis alle ${sorted.length}`}
        </Button>
      )}
    </div>
  );
}
