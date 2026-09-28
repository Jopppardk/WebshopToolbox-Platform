'use client';
import {PayoutLog} from './payout-log';
import { tier1Fetch as fetch, tier1Url } from '@/platform/transport';

import { useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { BookingStatus } from '@/components/booking-status';
import { ManualBookingAction } from '@/components/manual-booking-action';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import type { PaymentSummary, PaymentView } from '@/lib/shopify-payments';

const today = () =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Copenhagen',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
const money = (amount: string, currency: string) =>
  new Intl.NumberFormat('da-DK', { style: 'currency', currency }).format(
    Number(amount),
  );
const minorMoney = (amount: number, currency: string) =>
  money(
    String(
      amount /
        10 **
          new Intl.NumberFormat('en', {
            style: 'currency',
            currency,
          }).resolvedOptions().maximumFractionDigits!,
    ),
    currency,
  );
const date = (value: string) =>
  new Intl.DateTimeFormat('da-DK', {
    dateStyle: 'short',
    timeStyle: 'short',
    timeZone: 'Europe/Copenhagen',
  }).format(new Date(value));
const shortId = (value?: string | null) => value?.split('/').pop() || '—';
const payoutStatuses: Record<string, string> = {
  PAID: 'Udbetalt',
  PENDING: 'Afventer',
  IN_TRANSIT: 'Under overførsel',
  SCHEDULED: 'Planlagt',
  FAILED: 'Fejlet',
  CANCELED: 'Annulleret',
};

export function Payments({
  kind = 'payment',
  syncRevision = 0,
}: {
  kind?: 'payment' | 'refund';
  syncRevision?: number;
}) {
  const refund = kind === 'refund';
  const endpoint = refund ? '/api/refunds/overview' : '/api/shopify/payments';
  const [provider,setProvider]=useState('shopify');
  const syncEndpoint=refund?(provider==='flatpay'?'/api/flatpay/refunds':'/api/shopify/refunds'):endpoint;
  const plural = refund ? 'tilbagebetalinger' : 'betalinger';
  const title = refund ? 'Tilbagebetalinger' : 'Betalinger';
  const [from, setFrom] = useState(() => `${today().slice(0, 7)}-01`);
  const [to, setTo] = useState(today);
  const [search, setSearch] = useState('');
  const [offset, setOffset] = useState(0);
  const [payments, setPayments] = useState<PaymentView[]>([]);
  const [summary, setSummary] = useState<PaymentSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [revision, setRevision] = useState(0);
  const total = summary.reduce((sum, row) => sum + row.count, 0);
  useEffect(() => {
    fetch('/api/admin/history')
      .then(
        (response) => response.json() as Promise<{ effectiveDate?: string }>,
      )
      .then((data) => {
        if (data.effectiveDate && data.effectiveDate <= today())
          setFrom(data.effectiveDate);
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    const timer = setTimeout(async () => {
      try {
        const response = await fetch(
          `${endpoint}?${new URLSearchParams({ from, to, search, offset: String(offset) })}`,
          { signal: controller.signal },
        );
        const data = (await response.json()) as {
          payments: PaymentView[];
          summary: PaymentSummary[];
          error?: string;
        };
        if (!response.ok)
          throw new Error(data.error || 'Betalingerne kunne ikke indlæses');
        if (controller.signal.aborted) return;
        setError('');
        setPayments(data.payments);
        setSummary(data.summary);
      } catch (failure) {
        if (!controller.signal.aborted) {
          setError(
            failure instanceof Error
              ? failure.message
              : 'Betalingerne kunne ikke indlæses',
          );
          setPayments([]);
          setSummary([]);
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, 200);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [from, to, search, offset, revision, endpoint, syncRevision]);

  async function sync() {
    setSyncing(true);
    setError('');
    setNotice(`Henter ${plural}…`);
    let after: string | null = null;
    let synced = 0;
    const seen=new Set<string>();
    try {
      do {
        const response = await fetch(syncEndpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ from, to, after }),
        });
        const data: {
          synced: number;
          hasNextPage: boolean;
          endCursor: string | null;
          error?: string;
        } = (await response.json()) as {
          synced: number;
          hasNextPage: boolean;
          endCursor: string | null;
          error?: string;
        };
        if (!response.ok)
          throw new Error(data.error || 'Hentningen mislykkedes');
        synced += data.synced;
        after = data.hasNextPage ? data.endCursor : null;
        if(data.hasNextPage&&(!after||seen.has(after)||seen.size>=200))throw Error('Hentningen kunne ikke fortsætte. Prøv igen.');
        if(after)seen.add(after);
        setNotice(
          `${synced} ${plural} hentet${after ? ' · henter flere…' : ' · perioden er færdighentet'}`,
        );
      } while (after);
    } catch (failure) {
      setError(
        failure instanceof Error ? failure.message : 'Hentningen mislykkedes',
      );
      setNotice(
        `${synced} ${plural} hentet. Perioden er ikke færdighentet. Prøv igen; allerede gemte ${plural} bliver opdateret.`,
      );
    } finally {
      setSyncing(false);
      setOffset(0);
      setRevision((value) => value + 1);
    }
  }

  return (
    <div className="mx-auto max-w-[1440px] px-5 py-7 md:px-8 md:py-9">
      <div className="mb-7 flex flex-col justify-between gap-5 sm:flex-row sm:items-end">
        <div>
          <p className="eyebrow">{refund?'Samlet oversigt':'Shopify Payments'}</p>
          <h1 className="page-title">
            {title}
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {refund
              ? 'Tilbagebetalinger fra Shopify Payments og Flatpay samlet, nyeste først. Delvise tilbagebetalinger vises som separate transaktioner.'
              : 'Gennemførte betalinger med gebyrer og nettobeløb.'}
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-3">
        {refund&&<label className="text-sm">Hent fra<select className="mt-1 block h-10 rounded-lg border px-3" value={provider} disabled={syncing} onChange={e=>setProvider(e.target.value)}><option value="shopify">Shopify Payments</option><option value="flatpay">Flatpay</option></select></label>}
        <Button
          className="h-10 rounded-xl px-4"
          onClick={sync}
          disabled={syncing || !from || !to || from > to}
        >
          <RefreshCw className={syncing ? 'animate-spin' : ''} />
          {syncing ? 'Henter…' : refund?'Hent tilbagebetalinger':'Hent fra Shopify Payments'}
        </Button>
        </div>
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
            onChange={(event) => {
              setFrom(event.target.value);
              setOffset(0);
              setError('');
              setNotice('');
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
            onChange={(event) => {
              setTo(event.target.value);
              setOffset(0);
              setError('');
              setNotice('');
            }}
          />
        </label>
        <label className="min-w-60 flex-1 text-sm">
          Søg {refund ? 'tilbagebetaling' : 'betaling'}
          <Input
            className="mt-1"
            placeholder="Ordrenummer eller transaktions-ID"
            value={search}
            disabled={syncing}
            onChange={(event) => {
              setSearch(event.target.value);
              setOffset(0);
              setError('');
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
      {summary.map((row) => (
        <div key={row.currency} className="mb-4 grid gap-3 sm:grid-cols-3">
          {[
            [title, row.gross],
            ['Gebyrer', row.fees],
            ['Netto efter gebyrer', row.net],
          ].map(([label, value]) => (
            <div key={label} className="rounded-2xl border bg-white p-5">
              <p className="text-sm text-muted-foreground">
                {label} · {row.currency}
              </p>
              <p className="mt-2 text-2xl font-semibold">
                {minorMoney(Number(value), row.currency)}
              </p>
              <p className="mt-2 text-sm text-muted-foreground">
                {row.count} gemte {plural} i det valgte udsnit
              </p>
            </div>
          ))}
        </div>
      ))}
      <p className="mb-4 text-sm text-muted-foreground">
        {refund
          ? 'Når modulet er aktiveret under Indstillinger, bogføres nye tilbagebetalinger fra Shopify Payments automatisk i Dinero. Flatpay vises til kontrol og bogføres ikke automatisk. Flatpay-beløb vises med API’ets fortegn; gebyrer og netto afrundes til visning. En afregning er ikke nødvendigvis udbetalt endnu.'
          : 'Bogføring i Dinero er ikke aktiveret for betalinger. Testbetalinger og tilbagebetalinger indgår ikke her.'}
      </p>
      <section
        aria-busy={loading || syncing}
        className="overflow-hidden rounded-2xl border bg-white"
      >
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/45">
              <TableHead className="pl-5">Ordre / transaktion</TableHead>
              <TableHead>{refund ? 'Tilbagebetalt' : 'Betalt'}</TableHead>
              <TableHead>Udbyder</TableHead>
              <TableHead className="text-right">Beløb</TableHead>
              <TableHead className="text-right">Gebyr</TableHead>
              <TableHead className="text-right">Netto</TableHead>
              <TableHead>Udbetaling</TableHead>
              <TableHead>Bogføring</TableHead>
              <TableHead>Handling</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={9} className="p-8 text-center">
                  Indlæser {plural}…
                </TableCell>
              </TableRow>
            ) : payments.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={9}
                  className="p-8 text-center text-muted-foreground"
                >
                  {error
                    ? `${title} kunne ikke vises.`
                    : search
                      ? `Ingen ${plural} matcher søgningen.`
                      : `Ingen gemte ${plural} i perioden. Vælg udbyder og hent tilbagebetalinger.`}
                </TableCell>
              </TableRow>
            ) : (
              payments.map((payment) => (
                <TableRow key={payment.id}>
                  <TableCell className="pl-5">
                    <div className="font-medium">
                      {payment.associatedOrder?.name ||
                        'Ingen tilknyttet ordre'}
                    </div>
                    <div className="mt-1 text-sm text-muted-foreground">
                      {payment.provider==='flatpay'?payment.transactionID:shortId(payment.id)}
                    </div>
                  </TableCell>
                  <TableCell>{date(payment.transactionDate)}</TableCell>
                  <TableCell>{payment.provider==='flatpay'?'Flatpay':'Shopify Payments'}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {money(payment.amount.amount, payment.amount.currencyCode)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {money(payment.fee.amount, payment.fee.currencyCode)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {money(payment.net.amount, payment.net.currencyCode)}
                  </TableCell>
                  <TableCell>
                    <div>{payment.provider==='flatpay'?(payment.settlementNumber||'—'):shortId(payment.associatedPayout?.id)}</div>
                    <div className="mt-1 text-sm text-muted-foreground">
                      {payment.provider==='flatpay'?'Afregningsnummer':payment.associatedPayout?.status
                        ? payoutStatuses[payment.associatedPayout.status] ||
                          payment.associatedPayout.status
                        : 'Ikke tildelt'}
                    </div>
                  </TableCell>
                  <TableCell>
                    <BookingStatus status={payment.provider==='flatpay'?'not_enabled':payment.bookingStatus || 'pending'} />
                  </TableCell>
                  <TableCell>
                    {refund && <PayoutLog kind="refund" provider={payment.provider==='flatpay'?'flatpay':'shopify'} externalId={(payment as PaymentView & {logExternalId?:string}).logExternalId||payment.id}/>}
                    {refund && payment.provider!=='flatpay' && payment.bookingStatus !== 'booked' ? (
                      <ManualBookingAction
                        kind="refund"
                        externalId={payment.id}
                        onDone={() => setRevision((value) => value + 1)}
                      />
                    ) : (
                      <span className="text-sm text-muted-foreground">
                        {payment.bookingStatus === 'booked' ? 'Bogført' : '—'}
                      </span>
                    )}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
        <div className="flex items-center justify-between gap-3 border-t px-5 py-4 text-sm">
          <span>
            {total
              ? `${offset + 1}–${Math.min(offset + 50, total)} af ${total} ${plural}`
              : `0 ${plural}`}
          </span>
          <div className="flex gap-2">
            <Button
              variant="outline"
              disabled={loading || syncing || offset === 0}
              onClick={() => setOffset((value) => Math.max(0, value - 50))}
            >
              Forrige
            </Button>
            <Button
              variant="outline"
              disabled={loading || syncing || offset + 50 >= total}
              onClick={() => setOffset((value) => value + 50)}
            >
              Næste
            </Button>
          </div>
        </div>
      </section>
    </div>
  );
}
