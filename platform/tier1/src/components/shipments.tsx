'use client';
import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowUpRight,
  Check,
  ChevronDown,
  Copy,
  ExternalLink,
  Info,
  MapPin,
  PackageCheck,
  RefreshCw,
  Search,
  Store,
  Truck,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { RefreshButton } from '@/components/refresh-button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { tier1Fetch } from '@/platform/transport';
import { PageTitle, useWorkspace } from '@/platform/workspace';
import { danishDate } from '@/lib/history-policy';
import { useStackTable } from '@/lib/stack-table';
import { formatDate, formatDateTime } from '@/lib/format';
import {
  carriers,
  pickupDeadline,
  shipmentCounts,
  shipmentDays,
  type Carrier,
  type Shipment,
  type ShipmentList,
} from '@/lib/shipments';

type Filter = 'all' | 'moving' | 'waiting' | 'return';
const filters: Array<[Filter, string]> = [
  ['all', 'Alle'],
  ['moving', 'På vej'],
  ['waiting', 'Venter i pakkeshop'],
  ['return', 'Returneres snart'],
];

export function CarrierIcon({
  carrier,
  name,
  className = '',
}: {
  carrier: Carrier | null;
  name: string | null;
  className?: string;
}) {
  if (!carrier)
    return (
      <span
        title={name || 'Ukendt fragtfirma'}
        className={
          'inline-grid h-7 min-w-11 place-items-center rounded-md border border-dashed border-[#d9cfbf] px-1.5 text-[10px] font-semibold text-muted-foreground ' +
          className
        }
      >
        {name ? name.slice(0, 6) : '?'}
      </span>
    );
  const c = carriers[carrier];
  return (
    <span
      title={c.name}
      aria-label={c.name}
      className={
        'inline-grid h-7 min-w-11 place-items-center rounded-md px-1.5 text-[11px] font-extrabold tracking-tight ' +
        className
      }
      style={{ background: c.color, color: c.text }}
    >
      {c.short}
    </span>
  );
}

function returnWarning(s: Shipment, today: string) {
  const d = pickupDeadline(s, today);
  if (!d || d.state === 'ok') return null;
  return d.state === 'overdue'
    ? {
        tone: 'red',
        text: 'Fristen er sandsynligvis overskredet',
        detail: `Anslået sidste afhentning var ${formatDate(d.deadline)}. Pakken kan være på vej retur.`,
      }
    : {
        tone: 'amber',
        text:
          d.daysLeft === 0
            ? 'Sidste afhentningsdag i dag'
            : `Returneres om ${d.daysLeft} ${d.daysLeft === 1 ? 'dag' : 'dage'}`,
        detail: `Anslået sidste afhentning ${formatDate(d.deadline)} (${d.holdDays} dages opbevaring).`,
      };
}

function StatusCell({
  s,
  open,
  onToggle,
  today,
}: {
  s: Shipment;
  open: boolean;
  onToggle: () => void;
  today: string;
}) {
  const step = s.steps.find((x) => x.key === s.current)!,
    index = s.steps.indexOf(step),
    warning = returnWarning(s, today);
  const done = s.current === 'delivered' || s.current === 'manual';
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      className="group flex w-full min-w-48 flex-col gap-1.5 rounded-lg px-2 py-1.5 text-left hover:bg-[#faf8f5]"
    >
      <span className="flex items-center gap-2 text-sm font-medium">
        {done ? (
          <PackageCheck className="size-4 shrink-0 text-emerald-700" />
        ) : s.current === 'ready' ? (
          <Store className="size-4 shrink-0 text-[#9a7440]" />
        ) : (
          <Truck className="size-4 shrink-0 text-[#567da3]" />
        )}
        <span className={done ? 'text-emerald-800' : ''}>
          {s.publicTracking?.checkedAt ? s.publicTracking.text : step.label}
        </span>
        <ChevronDown
          className={
            'ml-auto size-4 shrink-0 text-muted-foreground transition-transform ' +
            (open ? 'rotate-180' : '')
          }
        />
      </span>
      {s.publicTracking && (
        <span className="text-[11px] text-muted-foreground">
          {s.publicTracking.checkedAt
            ? `Tracking hentet ${formatDateTime(s.publicTracking.checkedAt)}`
            : s.publicTracking.text}
          {s.publicTracking.error ? ' · Opdatering fejlede' : ''}
        </span>
      )}
      {s.shipmondo && (
        <span className="text-xs text-muted-foreground">
          Shipmondo: {s.shipmondo.text || s.shipmondo.status}
        </span>
      )}
      <span className="flex gap-1" aria-hidden>
        {s.steps.map((x, i) => (
          <span
            key={x.key}
            className={
              'h-1.5 flex-1 rounded-full ' +
              (i <= index
                ? done
                  ? 'bg-emerald-600'
                  : 'bg-[#9a7440]'
                : 'bg-[#ece6dc]')
            }
          />
        ))}
      </span>
      {(warning || s.issue) && (
        <span
          className={
            'flex items-center gap-1 text-[11px] font-medium ' +
            (warning?.tone === 'red' || (!warning && s.issue)
              ? 'text-red-700'
              : 'text-amber-700')
          }
        >
          <AlertTriangle className="size-3.5 shrink-0" />
          {warning?.text || s.issue}
        </span>
      )}
    </button>
  );
}

function TrackingNotice({ s }: { s: Shipment }) {
  const t = s.publicTracking;
  if (!t) return null;
  return (
    <p className="rounded-lg border p-3 text-xs text-muted-foreground">
      <strong>
        Tracking via {s.carrier === 'bring' ? 'Bring' : 'Shipmondo'}
      </strong>{' '}
      · {t.text}
      {t.checkedAt
        ? ` · Hentet ${formatDateTime(t.checkedAt)}`
        : s.delivered
          ? ' · Afsluttet – kontrolleres ikke igen.'
          : ' · Shopify-oplysninger vises indtil videre.'}
      {t.shipmentId ? ` · Forsendelses-ID: ${t.shipmentId}` : ''}
      {t.error && <span className="mt-1 block text-amber-800">{t.error}</span>}
    </p>
  );
}

function Timeline({ s, today }: { s: Shipment; today: string }) {
  const index = s.steps.findIndex((x) => x.key === s.current),
    warning = returnWarning(s, today),
    deadline = pickupDeadline(s, today);
  return (
    <div className="grid gap-4 px-4 py-4 sm:px-6">
      {s.shipmondo && (
        <p className="rounded-lg border p-3 text-xs">
          <strong>Shipmondo</strong> · {s.shipmondo.text || s.shipmondo.status}{' '}
          · {formatDateTime(s.shipmondo.at)} · Forsendelses-ID:{' '}
          {s.shipmondo.shipmentId}
        </p>
      )}
      <TrackingNotice s={s} />
      <ol className="grid gap-3 sm:grid-cols-[repeat(auto-fit,minmax(130px,1fr))] sm:gap-0">
        {s.steps.map((x, i) => (
          <li
            key={x.key}
            className="relative flex items-start gap-3 sm:flex-col sm:items-center sm:text-center"
          >
            {i > 0 && (
              <span
                aria-hidden
                className={
                  'absolute top-3 right-1/2 hidden h-0.5 w-full sm:block ' +
                  (i <= index ? 'bg-[#9a7440]' : 'bg-[#ece6dc]')
                }
              />
            )}
            <span
              className={
                'relative z-10 grid size-6 shrink-0 place-items-center rounded-full border-2 text-[10px] font-semibold ' +
                (x.reached
                  ? 'border-[#9a7440] bg-[#9a7440] text-white'
                  : 'border-[#ddd3c4] bg-white text-muted-foreground')
              }
            >
              {x.reached ? <Check className="size-3.5" /> : i + 1}
            </span>
            <span className="min-w-0 sm:mt-2">
              <span
                className={
                  'block text-xs font-medium ' +
                  (x.reached ? '' : 'text-muted-foreground')
                }
              >
                {x.label}
              </span>
              <span className="block text-[11px] text-muted-foreground">
                {x.at
                  ? formatDateTime(x.at)
                  : x.reached
                    ? 'Dato ikke oplyst'
                    : 'Afventer'}
              </span>
            </span>
          </li>
        ))}
      </ol>
      {deadline && (
        <p
          className={
            'flex items-start gap-2 rounded-lg px-3 py-2 text-xs ' +
            (warning?.tone === 'red'
              ? 'bg-red-50 text-red-800'
              : warning
                ? 'bg-amber-50 text-amber-900'
                : 'bg-[#faf8f5] text-muted-foreground')
          }
        >
          <Info className="mt-0.5 size-3.5 shrink-0" />
          {warning
            ? warning.detail
            : `Klar i pakkeshop siden ${formatDate(s.readyAt)}. Anslået sidste afhentning ${formatDate(deadline.deadline)}.`}
        </p>
      )}
      <p className="text-[11px] text-muted-foreground">
        {s.method ? `Fragtmetode: ${s.method} · ` : ''}
        {s.current === 'manual'
          ? 'Afsluttet i Shopify uden trackingnummer. Levering hos kunden er ikke bekræftet.'
          : s.current === 'untracked'
            ? 'Intet trackingnummer registreret.'
            : s.pickupPoint
              ? 'Sendt til pakkeshop'
              : 'Sendt til kundens adresse'}
      </p>
    </div>
  );
}

function TrackingDialog({
  s,
  onClose,
  today,
}: {
  s: Shipment | null;
  onClose: () => void;
  today: string;
}) {
  const [copied, setCopied] = useState(false),
    warning = s ? returnWarning(s, today) : null;
  useEffect(() => setCopied(false), [s?.id]);
  return (
    <Dialog
      open={s !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto p-0 sm:max-w-lg">
        {s && (
          <>
            <DialogHeader className="border-b border-[#f0ece6] bg-[#fcfbf9] px-5 py-4">
              <p className="eyebrow">Track & trace · {s.orderName}</p>
              <DialogTitle className="flex items-center gap-3 text-lg">
                <CarrierIcon carrier={s.carrier} name={s.carrierName} />
                {s.carrierName || 'Ukendt fragtfirma'}
              </DialogTitle>
              <DialogDescription>
                {s.customer}
                {s.city ? ', ' + s.city : ''}
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-4 px-5 pb-5">
              <div className="flex items-center justify-between gap-3 rounded-xl border border-[#e9e2d7] px-4 py-3">
                <div className="min-w-0">
                  <p className="text-[11px] text-muted-foreground">
                    Trackingnummer
                  </p>
                  <p className="truncate font-mono text-sm">
                    {s.trackingNumber || 'Ikke oplyst i Shopify'}
                  </p>
                </div>
                {s.trackingNumber && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      void navigator.clipboard
                        ?.writeText(s.trackingNumber!)
                        .then(() => setCopied(true));
                    }}
                  >
                    {copied ? <Check /> : <Copy />}
                    {copied ? 'Kopieret' : 'Kopiér'}
                  </Button>
                )}
              </div>
              {warning && (
                <p
                  className={
                    'flex items-start gap-2 rounded-lg px-3 py-2 text-xs ' +
                    (warning.tone === 'red'
                      ? 'bg-red-50 text-red-800'
                      : 'bg-amber-50 text-amber-900')
                  }
                >
                  <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                  <span>
                    <b>{warning.text}.</b> {warning.detail}
                  </span>
                </p>
              )}
              <TrackingNotice s={s} />
              <section aria-label="Hændelser">
                <h3 className="mb-2 text-xs font-semibold">
                  Hændelser fra fragtfirmaet
                </h3>
                {s.events.length ? (
                  <ol className="relative grid gap-3 border-l border-[#ece6dc] pl-4">
                    {[...s.events].reverse().map((e, i) => (
                      <li key={e.at + e.status + i} className="relative">
                        <span
                          aria-hidden
                          className={
                            'absolute -left-[21px] top-1 size-2.5 rounded-full ' +
                            (i === 0 ? 'bg-[#9a7440]' : 'bg-[#ddd3c4]')
                          }
                        />
                        <p className="text-sm font-medium">{e.label}</p>
                        <p className="text-[11px] text-muted-foreground">
                          {formatDateTime(e.at)}
                        </p>
                        {e.message && (
                          <p className="mt-0.5 text-xs text-muted-foreground">
                            {e.message}
                          </p>
                        )}
                      </li>
                    ))}
                  </ol>
                ) : (
                  <p className="rounded-lg bg-[#faf8f5] p-3 text-xs text-muted-foreground">
                    Fragtfirmaet har endnu ikke sendt hændelser til Shopify. Åbn
                    fragtfirmaets side for den seneste status.
                  </p>
                )}
              </section>
              {s.trackingUrl ? (
                <a
                  href={s.trackingUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-[#2b2620] px-4 text-sm font-medium text-white hover:bg-[#3d362e]"
                >
                  Åbn hos {s.carrierName || 'fragtfirmaet'}
                  <ExternalLink className="size-4" />
                </a>
              ) : (
                <p className="text-xs text-muted-foreground">
                  Shopify har intet track & trace-link til denne forsendelse.
                </p>
              )}
              <p className="text-[11px] leading-5 text-muted-foreground">
                Fragtfirmaernes egne sider kan ikke vises inde i WebshopToolbox
                og åbnes derfor i en ny fane.
              </p>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

export function Shipments({ onIntegrations }: { onIntegrations: () => void }) {
  const { webshopId, webshops, user, demo } = useWorkspace();
  const [days, setDays] = useState<number>(30),
    [revision, setRevision] = useState(0),
    refresh = useRef(false),
    loadedFor = useRef('');
  const [data, setData] = useState<ShipmentList | null>(null),
    [error, setError] = useState(''),
    [loading, setLoading] = useState(true);
  const [query, setQuery] = useState(''),
    [filter, setFilter] = useState<Filter>('all'),
    [carrier, setCarrier] = useState<'all' | Carrier>('all');
  const [open, setOpen] = useState<Set<string>>(new Set()),
    [tracking, setTracking] = useState<Shipment | null>(null);
  const [parcelFeedback, setParcelFeedback] = useState<Record<string, string>>(
    {},
  );
  const activeView = useRef('');
  activeView.current = `${webshopId}:${days}`;
  const today = danishDate(),
    stackRef = useStackTable<HTMLTableElement>();
  useEffect(() => {
    const controller = new AbortController(),
      forced = refresh.current,
      key = `${webshopId}:${days}`;
    refresh.current = false;
    // Another webshop or period is never shown under this one's name while it loads.
    const first = loadedFor.current !== key;
    if (first) {
      setData(null);
      setOpen(new Set());
      setTracking(null);
      setParcelFeedback({});
      loadedFor.current = key;
    }
    setLoading(true);
    setError('');
    const load = async (fresh: boolean) => {
      let response: Response, value: ShipmentList & { error?: string };
      // Another tab or user may be fetching the same list; wait for them instead of failing.
      for (let attempt = 0; ; attempt++) {
        response = await tier1Fetch(
          `/api/shipments?days=${days}${forced ? '&refresh=1' : fresh ? '&fresh=1' : ''}`,
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
          attempt >= 30
        )
          break;
        await new Promise((resolve) => setTimeout(resolve, 3000));
        if (controller.signal.aborted) return null;
      }
      if (!response.ok)
        throw Error(value.error || 'Forsendelserne kunne ikke hentes.');
      if (!controller.signal.aborted) setData(value);
      return value;
    };
    void (async () => {
      try {
        // On opening the page the server may answer at once with the last list it read (stale); the fresh list
        // from Shopify replaces it when it arrives. A list already on screen is only ever replaced by a fresh one.
        const value = await load(!first);
        if (value?.stale && !controller.signal.aborted) await load(true);
      } catch (e) {
        if (!controller.signal.aborted) {
          setData(null);
          setError(
            e instanceof Error
              ? e.message
              : 'Forsendelserne kunne ikke hentes.',
          );
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();
    return () => controller.abort();
  }, [days, revision, webshopId]);
  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') setRevision((v) => v + 1);
    }, 60000);
    return () => window.clearInterval(timer);
  }, []);
  // "Opdatér": fresh tracking for parcels that are not delivered (one at a time, at most 15; each parcel at most
  // once a minute on the server), then the shipments from Shopify again. Support and the demo only reload.
  const refreshAll = async () => {
    if (!user.support && !demo)
      for (const parcel of (data?.shipments ?? [])
        .filter(
          (x) =>
            Boolean(x.trackingNumber) &&
            !x.delivered &&
            x.publicTracking?.state !== 'unavailable',
        )
        .slice(0, 15))
        await refreshParcel(parcel);
    refresh.current = true;
    setRevision((v) => v + 1);
  };
  const refreshParcel = async (s: Shipment) => {
    if (s.delivered) return;
    const view = activeView.current;
    setParcelFeedback((p) => ({ ...p, [s.id]: '' }));
    try {
      const response = await tier1Fetch(`/api/shipments/refresh?days=${days}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shipmentId: s.id }),
      });
      const value = (await response.json()) as ShipmentList & {
        error?: string;
      };
      if (!response.ok)
        throw Error(value.error || 'Status kunne ikke opdateres.');
      if (activeView.current !== view) return;
      const updated = value.shipments.find((x) => x.id === s.id);
      if (updated) {
        setData((previous) =>
          previous
            ? {
                ...previous,
                shipments: previous.shipments.map((x) =>
                  x.id === s.id ? updated : x,
                ),
              }
            : previous,
        );
        setTracking((previous) => (previous?.id === s.id ? updated : previous));
      }
      setParcelFeedback((p) => ({
        ...p,
        [s.id]: updated?.publicTracking?.error || 'Status er hentet på ny.',
      }));
    } catch (e) {
      if (activeView.current === view)
        setParcelFeedback((p) => ({
          ...p,
          [s.id]:
            e instanceof Error ? e.message : 'Status kunne ikke opdateres.',
        }));
    }
  };
  const all = useMemo(() => data?.shipments || [], [data]);
  const counts = useMemo(
    () => ({
      ...shipmentCounts(all, today),
      return: all.filter((s) => returnWarning(s, today)).length,
    }),
    [all, today],
  );
  const used = [
    ...new Set(
      all.map((s) => s.carrier).filter((c): c is Carrier => c !== null),
    ),
  ];
  // A carrier chosen for another webshop or period no longer hides every row.
  const activeCarrier =
    carrier !== 'all' && used.includes(carrier) && used.length > 1
      ? carrier
      : 'all';
  const term = query.trim().toLocaleLowerCase('da');
  const rows = all.filter(
    (s) =>
      (activeCarrier === 'all' || s.carrier === activeCarrier) &&
      (filter === 'all' ||
        (filter === 'moving'
          ? s.current !== 'delivered' &&
            s.current !== 'manual' &&
            s.current !== 'untracked' &&
            s.current !== 'ready'
          : filter === 'waiting'
            ? s.current === 'ready'
            : Boolean(returnWarning(s, today)))) &&
      (!term ||
        [s.orderName, s.customer, s.city, s.trackingNumber || ''].some((v) =>
          v.toLocaleLowerCase('da').includes(term),
        )),
  );
  const toggle = (id: string) =>
    setOpen((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const shopName =
    webshops.find((s) => s.id === webshopId)?.name || 'Valgt webshop';
  return (
    <div className="mx-auto max-w-[1440px] px-5 py-7 md:px-8 md:py-9">
      <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="eyebrow">Tools · Track & trace</p>
          <PageTitle title="Forsendelser" />
          <p className="mt-2 text-sm text-muted-foreground">
            Følg pakkerne fra label til kunde, og se hvilke der snart sendes
            retur.
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <label className="grid gap-1 text-xs font-medium">
            Periode
            <select
              className="h-10 rounded-xl border border-border bg-white px-3 text-sm"
              aria-label="Periode for forsendelser"
              value={days}
              onChange={(e) => setDays(Number(e.target.value))}
            >
              {shipmentDays.map((d) => (
                <option key={d} value={d}>
                  Seneste {d} dage
                </option>
              ))}
            </select>
          </label>
          <RefreshButton onRefresh={refreshAll} disabled={loading} />
        </div>
      </header>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#e9e2d7] bg-[#faf8f5] px-4 py-3 text-xs text-muted-foreground">
        <p className="flex items-center gap-2">
          <Info className="size-4 shrink-0" />
          Webshop: {shopName}
          {data
            ? ` · Hentet ${formatDateTime(data.checkedAt)} · Ordrer fra ${formatDate(data.since)}`
            : ''}
          {data?.stale ? ' · Henter nyeste fra Shopify…' : ''}
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
      <p className="mb-4 text-xs text-muted-foreground">
        Tracking hentes fra Shipmondos offentlige trackingside på tværs af
        fragtfirmaer. Ingen API-nøgle eller Pro-abonnement kræves. Aktive pakker
        kontrolleres automatisk hver sjette time. “Opdatér” henter ny status på
        op til 15 pakker, der ikke er leveret (hver pakke højst én gang pr.
        minut). Leverede pakker kontrolleres ikke igen.
      </p>
      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        {(
          [
            ['moving', 'På vej', counts.moving, Truck, 'text-[#567da3]'],
            [
              'waiting',
              'Venter i pakkeshop',
              counts.waiting,
              MapPin,
              'text-[#9a7440]',
            ],
            [
              'return',
              'Returneres snart',
              counts.return,
              AlertTriangle,
              counts.return ? 'text-amber-700' : 'text-muted-foreground',
            ],
          ] as const
        ).map(([key, label, n, Icon, color]) => (
          <button
            type="button"
            key={key}
            onClick={() => setFilter(filter === key ? 'all' : key)}
            aria-pressed={filter === key}
            className={
              'flex items-center justify-between rounded-2xl border bg-white p-4 text-left shadow-sm transition ' +
              (filter === key
                ? 'border-[#9a7440] ring-2 ring-[#9a7440]/20'
                : 'hover:bg-[#fcfbf9]')
            }
          >
            <span>
              <span className="block text-xs text-muted-foreground">
                {label}
              </span>
              <span className="mt-1 block text-2xl font-semibold tabular-nums">
                {data ? n : '—'}
              </span>
            </span>
            <Icon className={'size-5 ' + color} />
          </button>
        ))}
      </div>
      <section className="overflow-hidden rounded-2xl border border-[#e9e2d7] bg-white shadow-[0_8px_30px_rgba(70,50,20,0.04)]">
        <div className="flex flex-wrap items-center gap-3 border-b border-[#f0ece6] px-4 py-3 sm:px-5">
          <div className="relative min-w-0 flex-1 sm:max-w-xs">
            <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="pl-9"
              aria-label="Søg i forsendelser"
              placeholder="Ordre, navn, by eller trackingnr."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <div
            className="flex flex-wrap gap-1.5"
            role="group"
            aria-label="Filtrér efter status"
          >
            {filters.map(([key, label]) => (
              <button
                type="button"
                key={key}
                aria-pressed={filter === key}
                onClick={() => setFilter(key)}
                className={
                  'rounded-full px-3 py-1 text-xs ' +
                  (filter === key
                    ? 'bg-[#2b2620] text-white'
                    : 'bg-[#f4efe7] text-[#5c4524] hover:bg-[#ebe2d4]')
                }
              >
                {label}
              </button>
            ))}
          </div>
          {used.length > 1 && (
            <select
              className="ml-auto h-9 rounded-lg border bg-white px-2 text-sm"
              aria-label="Filtrér efter fragtfirma"
              value={activeCarrier}
              onChange={(e) => setCarrier(e.target.value as 'all' | Carrier)}
            >
              <option value="all">Alle fragtfirmaer</option>
              {used.map((c) => (
                <option key={c} value={c}>
                  {carriers[c].name}
                </option>
              ))}
            </select>
          )}
        </div>
        {error ? (
          <div
            role="alert"
            className="m-5 rounded-xl bg-amber-50 p-5 text-sm leading-6 text-amber-900"
          >
            {error}
          </div>
        ) : loading && !data ? (
          <div
            role="status"
            className="flex h-64 items-center justify-center gap-2 text-sm text-muted-foreground"
          >
            <RefreshCw className="size-4 animate-spin" />
            Henter forsendelser fra Shopify…
          </div>
        ) : (
          <div className="overflow-x-auto p-3 sm:p-0">
            <table
              ref={stackRef}
              className="stack-table w-full min-w-[860px] text-left text-sm"
            >
              <thead className="bg-muted/45 text-xs text-muted-foreground">
                <tr>
                  <th className="py-3 pl-5 font-medium">Ordre</th>
                  <th className="font-medium">Modtager</th>
                  <th className="font-medium">By</th>
                  <th className="px-2 font-medium">Status</th>
                  <th className="font-medium">Track & trace</th>
                  <th className="pr-5 font-medium">Fragtfirma</th>
                </tr>
              </thead>
              <tbody>
                {!rows.length && (
                  <tr>
                    <td
                      colSpan={6}
                      className="p-8 text-center text-sm text-muted-foreground"
                    >
                      {all.length
                        ? 'Ingen forsendelser matcher filteret.'
                        : 'Ingen afsendte ordrer i perioden.'}
                    </td>
                  </tr>
                )}
                {rows.map((s) => {
                  const expanded = open.has(s.id),
                    warning = returnWarning(s, today);
                  return (
                    <Fragment key={s.id}>
                      <tr
                        className={
                          'border-t border-[#f0ece6] align-top ' +
                          (warning?.tone === 'red'
                            ? 'bg-red-50/40'
                            : warning
                              ? 'bg-amber-50/50'
                              : '')
                        }
                      >
                        <td className="py-3 pl-5">
                          <span className="font-medium">{s.orderName}</span>
                          {s.test && (
                            <span className="ml-1 text-xs text-muted-foreground">
                              (test)
                            </span>
                          )}
                          <span className="block text-[11px] text-muted-foreground">
                            Sendt {formatDate(s.shippedAt)}
                          </span>
                        </td>
                        <td className="py-3 pr-3">{s.customer}</td>
                        <td className="py-3 pr-3">
                          {s.city || '—'}
                          {s.country && s.country !== 'DK' && (
                            <span className="ml-1 text-xs text-muted-foreground">
                              ({s.country})
                            </span>
                          )}
                        </td>
                        <td className="py-1.5 pr-3">
                          <StatusCell
                            s={s}
                            open={expanded}
                            onToggle={() => toggle(s.id)}
                            today={today}
                          />
                          {parcelFeedback[s.id] && (
                            <p
                              role="status"
                              className="max-w-64 px-2 text-xs text-muted-foreground"
                            >
                              {parcelFeedback[s.id]}
                            </p>
                          )}
                        </td>
                        <td className="py-3 pr-3">
                          {s.trackingNumber ||
                          s.trackingUrl ||
                          s.events.length ? (
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => setTracking(s)}
                            >
                              <MapPin />
                              {s.trackingNumber ? (
                                <span className="max-w-32 truncate font-mono text-xs">
                                  {s.trackingNumber}
                                </span>
                              ) : (
                                'Se forsendelse'
                              )}
                            </Button>
                          ) : (
                            <span className="text-xs text-muted-foreground">
                              Ikke oplyst
                            </span>
                          )}
                        </td>
                        <td className="py-3 pr-5">
                          <CarrierIcon
                            carrier={s.carrier}
                            name={s.carrierName}
                          />
                        </td>
                      </tr>
                      {expanded && (
                        <tr className="bg-[#fcfbf9]">
                          <td
                            colSpan={6}
                            className="border-t border-[#f0ece6] p-0 !text-left"
                          >
                            <Timeline s={s} today={today} />
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {data?.truncated && (
          <p className="border-t border-[#f0ece6] bg-amber-50 px-5 py-3 text-xs text-amber-900">
            Der er flere end 300 afsendte ordrer i perioden. Vælg en kortere
            periode for at se alle.
          </p>
        )}
      </section>
      <p className="mt-6 text-xs leading-6 text-muted-foreground">
        Status og hændelser hentes fra Shipmondos trackingside. Hvis opslag
        mangler, vises Shopify-oplysninger med en tydelig markering. Trin uden
        tidspunkt vises som “Dato ikke oplyst”. Fristen for afhentning er et
        skøn: dagen pakken blev klar i pakkeshoppen plus{' '}
        {carriers.postnord.holdDays} dages opbevaring. Fragtfirmaet kan have en
        anden frist for den enkelte pakke. Listen genbruges i op til 5 minutter.
      </p>
      <TrackingDialog
        s={tracking}
        onClose={() => setTracking(null)}
        today={today}
      />
    </div>
  );
}
