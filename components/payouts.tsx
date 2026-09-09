'use client';
import { useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { BookingAction } from '@/components/booking-action';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

type Payout = {
  id: string;
  issuedAt: string;
  status: string;
  transactionType: string;
  net: { amount: string; currencyCode: string };
  bookingStatus: string;
};
const statuses: Record<string, string> = {
  PAID: 'Udbetalt',
  SCHEDULED: 'Planlagt',
  IN_TRANSIT: 'Under overførsel',
  FAILED: 'Fejlet',
  CANCELED: 'Annulleret',
};
export function LivePayouts({ syncRevision = 0 }: { syncRevision?: number }) {
  const [rows, setRows] = useState<Payout[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [revision, setRevision] = useState(0);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    (async () => {
      try {
        const response = await fetch(`/api/shopify/payouts?offset=${offset}`, {
          signal: controller.signal,
        });
        const data = (await response.json()) as {
          payouts: Payout[];
          total: number;
          error?: string;
        };
        if (!response.ok)
          throw new Error(data.error || 'Udbetalingerne kunne ikke indlæses');
        if (controller.signal.aborted) return;
        setError('');
        setRows(data.payouts);
        setTotal(data.total);
      } catch (failure) {
        if (!controller.signal.aborted)
          setError(
            failure instanceof Error ? failure.message : 'Hentning fejlede',
          );
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();
    return () => controller.abort();
  }, [offset, revision, syncRevision]);
  async function sync() {
    setSyncing(true);
    setError('');
    setNotice('Henter udbetalinger…');
    let after: string | null = null;
    let count = 0;
    try {
      do {
        const response: Response = await fetch('/api/shopify/payouts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ after }),
        });
        const data: {
          synced: number;
          hasNextPage: boolean;
          endCursor: string | null;
          error?: string;
        } = await response.json();
        if (!response.ok) throw new Error(data.error || 'Hentning fejlede');
        count += data.synced;
        after = data.hasNextPage ? data.endCursor : null;
        setNotice(
          `${count} udbetalinger hentet${after ? ' · henter flere…' : ''}`,
        );
      } while (after);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Hentning fejlede');
    } finally {
      setSyncing(false);
      setOffset(0);
      setRevision((value) => value + 1);
    }
  }
  return (
    <div className="mx-auto max-w-[1440px] px-5 py-7 md:px-8 md:py-9">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="eyebrow">Shopify Payments</p>
          <h1 className="mt-1 text-3xl font-semibold">Udbetalinger</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Overførsler mellem Shopify Payments og banken · perioden følger
            Administration → Fælles historik.
          </p>
        </div>
        <Button onClick={sync} disabled={syncing}>
          <RefreshCw className={syncing ? 'animate-spin' : ''} />
          {syncing ? 'Henter…' : 'Hent udbetalinger'}
        </Button>
      </div>
      {error && (
        <p role="alert" className="mb-4 rounded-xl bg-red-50 p-4 text-red-800">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="mb-4 text-sm">
          {notice}
        </p>
      )}
      <p className="mb-4 text-sm text-muted-foreground">
        Beløbet er den faktiske nettooverførsel. Nye gennemførte udbetalinger
        bogføres automatisk i Dinero, når Udbetalinger er aktiveret under System
        → Dashboard.
      </p>
      <section
        className="overflow-hidden rounded-2xl border bg-white"
        aria-busy={loading || syncing}
      >
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Indløser</TableHead>
              <TableHead>Udbetalings-ID</TableHead>
              <TableHead>Udbetalingsdato</TableHead>
              <TableHead>Retning</TableHead>
              <TableHead className="text-right">Beløb</TableHead>
              <TableHead>Udbetalingsstatus</TableHead>
              <TableHead>Bogføringsstatus</TableHead>
              <TableHead>Handling</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={8}>Indlæser…</TableCell>
              </TableRow>
            ) : !rows.length ? (
              <TableRow>
                <TableCell colSpan={8} className="p-8 text-center">
                  Ingen gemte udbetalinger. Vælg Hent udbetalinger.
                </TableCell>
              </TableRow>
            ) : (
              rows.map((row) => (
                <TableRow key={row.id}>
                  <TableCell>Shopify Payments</TableCell>
                  <TableCell>{row.id.split('/').pop()}</TableCell>
                  <TableCell>
                    {new Intl.DateTimeFormat('da-DK', {
                      dateStyle: 'medium',
                      timeZone: 'Europe/Copenhagen',
                    }).format(new Date(row.issuedAt))}
                  </TableCell>
                  <TableCell>
                    {row.transactionType === 'DEPOSIT'
                      ? 'Til banken'
                      : row.transactionType === 'WITHDRAWAL'
                        ? 'Fra banken'
                        : row.transactionType}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {new Intl.NumberFormat('da-DK', {
                      style: 'currency',
                      currency: row.net.currencyCode,
                    }).format(Number(row.net.amount))}
                  </TableCell>
                  <TableCell>{statuses[row.status] || row.status}</TableCell>
                  <TableCell>
                    {row.bookingStatus === 'booked'
                      ? 'Bogført'
                      : row.bookingStatus === 'failed'
                        ? 'Fejlet'
                        : 'Afventer'}
                  </TableCell>
                  <TableCell>
                    {row.bookingStatus === 'booked' ? (
                      <span className="text-sm text-muted-foreground">
                        Færdig
                      </span>
                    ) : row.status === 'PAID' &&
                      row.transactionType === 'DEPOSIT' ? (
                      <BookingAction
                        endpoint="/api/payouts/transfer"
                        externalId={row.id}
                        onDone={() => setRevision((value) => value + 1)}
                      />
                    ) : (
                      <span className="text-sm text-muted-foreground">
                        Ingen handling
                      </span>
                    )}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
        <div className="flex items-center justify-between gap-3 border-t p-4 text-sm">
          <span>{total} udbetalinger</span>
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
