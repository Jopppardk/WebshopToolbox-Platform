'use client';
import { PageTitle } from '@/platform/workspace';
import { useEffect, useState } from 'react';
import { FileDown } from 'lucide-react';
import { tier1Fetch as fetch, tier1Url } from '@/platform/transport';
import { formatDateTime } from '@/lib/format';
import { Button } from '@/components/ui/button';
import { RefreshButton } from '@/components/refresh-button';
import { fetchRecentOrders } from '@/lib/recent-orders';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { BookingStatus } from '@/components/booking-status';
import { ManualBookingAction } from '@/components/manual-booking-action';
import { PayoutLog } from '@/components/payout-log';

type Refund = {
  id: string;
  orderName: string;
  date: string;
  currency: string;
  amount: number;
  full: boolean;
  gateways: string[];
  lines: Array<{
    kind: string;
    title: string;
    quantity: number;
    amount: number;
  }>;
  note: string | null;
  problem: string | null;
  creditNote: string | null;
  invoiced: boolean;
  mailed: boolean;
  legacy: boolean;
  foreign: boolean;
  booking: string;
};
type Totals = { currency: string; count: number; amount: number };
const pageSize = 25;
const today = () =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Copenhagen',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
const money = (amount: number, currency: string) =>
  new Intl.NumberFormat('da-DK', { style: 'currency', currency }).format(
    amount,
  );

/** Tilbagebetalinger: every refund of a Shopify order, whatever the payment gateway, with credit note and booking. */
export function OrderRefunds({ syncRevision = 0 }: { syncRevision?: number }) {
  const [from, setFrom] = useState(() => `${today().slice(0, 7)}-01`);
  const [to, setTo] = useState(today);
  const [search, setSearch] = useState('');
  const [offset, setOffset] = useState(0);
  const [refunds, setRefunds] = useState<Refund[]>([]);
  const [totals, setTotals] = useState<Totals[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    fetch('/api/admin/history')
      .then((r) => r.json() as Promise<{ effectiveDate?: string }>)
      .then((d) => {
        if (d.effectiveDate && d.effectiveDate <= today())
          setFrom(d.effectiveDate);
      })
      .catch(() => undefined);
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    const timer = setTimeout(async () => {
      try {
        const response = await fetch(
          `/api/order-refunds?${new URLSearchParams({ from, to, search, offset: String(offset), limit: String(pageSize) })}`,
          { signal: controller.signal },
        );
        const data = (await response.json()) as {
          refunds: Refund[];
          totals: Totals[];
          total: number;
          error?: string;
        };
        if (!response.ok)
          throw new Error(
            data.error || 'Tilbagebetalingerne kunne ikke indlæses.',
          );
        if (controller.signal.aborted) return;
        setError('');
        setRefunds(data.refunds);
        setTotals(data.totals);
        setTotal(data.total);
      } catch (failure) {
        if (!controller.signal.aborted) {
          setError(
            failure instanceof Error
              ? failure.message
              : 'Tilbagebetalingerne kunne ikke indlæses.',
          );
          setRefunds([]);
          setTotals([]);
          setTotal(0);
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, 200);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [from, to, search, offset, revision, syncRevision]);

  async function sync() {
    setSyncing(true);
    setError('');
    setNotice('Henter ændrede ordrer fra Shopify…');
    let refunds = 0,
      orders = 0;
    try {
      // New refunds show on their order first; the changed orders are fetched before the refunds are read.
      await fetchRecentOrders();
      setNotice('Henter tilbagebetalinger fra Shopify…');
      for (let round = 0; round < 20; round++) {
        const response = await fetch('/api/order-refunds/sync', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: '{}',
        });
        const data = (await response.json()) as {
          synced: number;
          orders: number;
          more: boolean;
          error?: string;
        };
        if (!response.ok)
          throw new Error(data.error || 'Hentningen mislykkedes.');
        refunds += data.synced;
        orders += data.orders;
        setNotice(
          `${orders} ordre${orders === 1 ? '' : 'r'} med tilbagebetalinger kontrolleret${data.more ? ' · henter flere…' : ''}`,
        );
        if (!data.more) break;
      }
      setNotice(
        orders
          ? `${refunds} tilbagebetaling${refunds === 1 ? '' : 'er'} hentet fra ${orders} ordre${orders === 1 ? '' : 'r'}.`
          : 'Ingen nye tilbagebetalinger.',
      );
    } catch (failure) {
      setError(
        failure instanceof Error ? failure.message : 'Hentningen mislykkedes.',
      );
      setNotice('');
    } finally {
      setSyncing(false);
      setOffset(0);
      setRevision((v) => v + 1);
    }
  }

  const status = (r: Refund) =>
    r.problem && r.booking !== 'booked' ? 'check' : r.booking;
  return (
    <div className="mx-auto max-w-[1440px] px-5 py-7 md:px-8 md:py-9">
      <div className="mb-7 flex flex-col justify-between gap-5 sm:flex-row sm:items-end">
        <div>
          <p className="eyebrow">Alle betalingsudbydere</p>
          <PageTitle title="Tilbagebetalinger" />
          <p className="mt-2 max-w-3xl text-sm text-muted-foreground">
            Hver tilbagebetaling på en ordre, uanset om kunden betalte med
            Shopify Payments, MobilePay, Flatpay, ViaBill eller andet. Delvise
            tilbagebetalinger vises hver for sig. Ordrer faktureret i
            WebshopToolbox får en kreditnota pr. tilbagebetaling.
          </p>
        </div>
        <RefreshButton onRefresh={sync} disabled={syncing} />
      </div>
      <div className="mb-5 flex flex-wrap items-end gap-3">
        <label className="text-sm">
          Fra
          <Input
            className="mt-1"
            type="date"
            value={from}
            max={to}
            disabled={syncing}
            onChange={(e) => {
              setFrom(e.target.value);
              setOffset(0);
            }}
          />
        </label>
        <label className="text-sm">
          Til
          <Input
            className="mt-1"
            type="date"
            value={to}
            min={from}
            max={today()}
            disabled={syncing}
            onChange={(e) => {
              setTo(e.target.value);
              setOffset(0);
            }}
          />
        </label>
        <label className="min-w-60 flex-1 text-sm">
          Søg tilbagebetaling
          <Input
            className="mt-1"
            placeholder="Ordrenummer, kreditnota eller betalingsudbyder"
            value={search}
            disabled={syncing}
            onChange={(e) => {
              setSearch(e.target.value);
              setOffset(0);
            }}
          />
        </label>
      </div>
      {error && (
        <div
          role="alert"
          className="mb-4 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800"
        >
          {error}
        </div>
      )}
      {notice && (
        <p role="status" className="mb-4 text-sm text-muted-foreground">
          {notice}
        </p>
      )}
      {totals.length > 0 && (
        <div className="mb-4 grid gap-3 sm:grid-cols-3">
          {totals.map((t) => (
            <div key={t.currency} className="rounded-2xl border bg-white p-5">
              <p className="text-sm text-muted-foreground">
                Tilbagebetalt · {t.currency}
              </p>
              <p className="mt-2 text-2xl font-semibold">
                {money(t.amount, t.currency)}
              </p>
              <p className="mt-2 text-sm text-muted-foreground">
                {t.count} tilbagebetaling{t.count === 1 ? '' : 'er'} i det
                valgte udsnit
              </p>
            </div>
          ))}
        </div>
      )}
      <p className="mb-4 text-sm text-muted-foreground">
        Når refunderinger er slået til under Indstillinger, bogføres
        tilbagebetalingen i Dinero mod samme mellemregningskonto som salget, med
        kreditnotaen som bilag. Er afsendelse af fakturaer til kunden slået til,
        mailes kreditnotaen også til kunden.
      </p>
      <section
        aria-busy={loading || syncing}
        className="overflow-hidden rounded-2xl border bg-white"
      >
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/45">
              <TableHead className="pl-5">Ordre</TableHead>
              <TableHead>Tilbagebetalt</TableHead>
              <TableHead>Betaling</TableHead>
              <TableHead>Type</TableHead>
              <TableHead className="text-right">Beløb</TableHead>
              <TableHead>Kreditnota</TableHead>
              <TableHead>Bogføring</TableHead>
              <TableHead>Handling</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={8} className="p-8 text-center">
                  Indlæser tilbagebetalinger…
                </TableCell>
              </TableRow>
            ) : refunds.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={8}
                  className="p-8 text-center text-muted-foreground"
                >
                  {error
                    ? 'Tilbagebetalingerne kunne ikke vises.'
                    : search
                      ? 'Ingen tilbagebetalinger matcher søgningen.'
                      : 'Ingen tilbagebetalinger i perioden.'}
                </TableCell>
              </TableRow>
            ) : (
              refunds.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="pl-5 align-top">
                    <div className="font-medium">{r.orderName}</div>
                    <div
                      className="mt-1 max-w-72 truncate text-sm text-muted-foreground"
                      title={r.lines
                        .map((l) => `${l.quantity} × ${l.title}`)
                        .join('\n')}
                    >
                      {r.lines.map((l) => l.title).join(', ') || '—'}
                    </div>
                    {r.problem && (
                      <div className="mt-1 max-w-72 text-xs text-red-700">
                        {r.problem}
                      </div>
                    )}
                  </TableCell>
                  <TableCell className="align-top">
                    {formatDateTime(r.date)}
                  </TableCell>
                  <TableCell className="align-top">
                    {r.gateways.join(', ') || '—'}
                  </TableCell>
                  <TableCell className="align-top">
                    {r.full ? 'Fuld' : 'Delvis'}
                  </TableCell>
                  <TableCell className="text-right align-top tabular-nums">
                    {money(r.amount, r.currency)}
                  </TableCell>
                  <TableCell className="align-top">
                    {r.creditNote || (r.invoiced && !r.problem) ? (
                      <Button
                        size="sm"
                        variant="outline"
                        render={
                          <a
                            href={tier1Url(
                              `/api/order-refunds/credit-note?externalId=${encodeURIComponent(r.id)}`,
                            )}
                            target="_blank"
                            rel="noreferrer"
                          />
                        }
                      >
                        <FileDown />
                        {r.creditNote || 'Dan kreditnota'}
                      </Button>
                    ) : (
                      <span className="text-sm text-muted-foreground">
                        {r.invoiced ? '—' : 'Ikke faktureret her'}
                      </span>
                    )}
                    {r.mailed && (
                      <div className="mt-1 text-xs text-muted-foreground">
                        Sendt til kunden
                      </div>
                    )}
                  </TableCell>
                  <TableCell className="align-top">
                    <BookingStatus status={status(r)} />
                    {r.legacy && (
                      <div className="mt-1 text-xs text-muted-foreground">
                        Via Shopify Payments-posten
                      </div>
                    )}
                  </TableCell>
                  <TableCell className="align-top">
                    <div className="flex flex-wrap gap-2">
                      <PayoutLog
                        kind="refund"
                        provider="shopify"
                        externalId={r.id}
                      />
                      {![
                        'booked',
                        'historical',
                        'sale_pending',
                        'foreign',
                        'void',
                      ].includes(r.booking) &&
                        !r.legacy &&
                        !r.problem && (
                          <ManualBookingAction
                            kind="order_refund"
                            externalId={r.id}
                            onDone={() => setRevision((v) => v + 1)}
                          />
                        )}
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
        <div className="flex items-center justify-between gap-3 border-t px-5 py-4 text-sm">
          <span>
            {total
              ? `${offset + 1}–${Math.min(offset + pageSize, total)} af ${total} tilbagebetalinger`
              : '0 tilbagebetalinger'}
          </span>
          <div className="flex gap-2">
            <Button
              variant="outline"
              disabled={loading || syncing || offset === 0}
              onClick={() => setOffset((v) => Math.max(0, v - pageSize))}
            >
              Forrige
            </Button>
            <Button
              variant="outline"
              disabled={loading || syncing || offset + pageSize >= total}
              onClick={() => setOffset((v) => v + pageSize)}
            >
              Næste
            </Button>
          </div>
        </div>
      </section>
    </div>
  );
}
