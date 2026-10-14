'use client';
import { danishDate } from '@/lib/history-policy';
import { PageTitle } from '@/platform/workspace';
import { formatDate, asText } from '@/lib/format';
import { useStackTable } from '@/lib/stack-table';
import { TestModeNote } from '@/components/test-mode-note';
import { tier1Fetch as fetch } from '@/platform/transport';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { BookingStatus } from '@/components/booking-status';
import { RefreshButton } from '@/components/refresh-button';
import { ManualBookingAction } from '@/components/manual-booking-action';
import { PayoutLog } from '@/components/payout-log';
import type { UnifiedPayout } from '@/lib/unified-payouts';
const pageSize = 25;
export function UnifiedPayouts({
  syncRevision = 0,
}: {
  syncRevision?: number;
}) {
  const stackRef = useStackTable<HTMLTableElement>();
  const [rows, setRows] = useState<UnifiedPayout[]>([]),
    [total, setTotal] = useState(0),
    [offset, setOffset] = useState(0),
    [revision, setRevision] = useState(0),
    [loading, setLoading] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [notice, setNotice] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    void fetch(
      '/api/payouts/overview?limit=' + pageSize + '&offset=' + offset,
      { cache: 'no-store', signal: controller.signal },
    )
      .then(async (r) => {
        const d = (await r.json()) as {
          payouts: UnifiedPayout[];
          total: number;
          error?: string;
        };
        if (!r.ok) throw Error(d.error);
        if (controller.signal.aborted) return;
        if (offset && offset >= d.total) {
          setOffset(Math.max(0, Math.ceil(d.total / pageSize) - 1) * pageSize);
          return;
        }
        setRows(d.payouts);
        setTotal(d.total);
      })
      .catch((e) => {
        if (!controller.signal.aborted) {
          setRows([]);
          setError(e.message);
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [offset, revision, syncRevision]);
  // "Opdatér": payouts from every connected provider (Shopify Payments, Flatpay, ViaBill, Pensopay) for the last
  // 30 days, which covers payouts still on their way; older ones are fetched by the automatic run. A provider that
  // fails does not stop the others; their errors are shown together.
  async function syncProvider(provider: string) {
    const to = danishDate(),
      from = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
    // Flatpay walks forward in 30-day steps from `next`; it starts 30 days back instead of at the history start.
    let next: unknown = provider === 'flatpay' ? from : null;
    const seen = new Set<string>();
    for (let page = 0; page < 200; page++) {
      const endpoint =
        provider === 'shopify'
          ? '/api/shopify/payouts'
          : provider === 'viabill'
            ? '/api/viabill/records'
            : provider === 'pensopay'
              ? '/api/pensopay/records'
              : '/api/flatpay/sync';
      const body =
        provider === 'shopify'
          ? { after: next, recentDays: 30 }
          : provider === 'viabill'
            ? { kind: 'payout', from, to, next }
            : provider === 'pensopay'
              ? { kind: 'settlements', from, to, next }
              : { next };
      const r = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const d = (await r.json()) as {
        error?: string;
        reportWarnings?: string[];
        hasNextPage?: boolean;
        endCursor?: string;
        next?: unknown;
      };
      if (!r.ok) throw Error(d.error || 'Hentningen fejlede.');
      next =
        provider === 'shopify' ? (d.hasNextPage ? d.endCursor : null) : d.next;
      if (provider === 'shopify' && d.hasNextPage && !next)
        throw Error('Hentningen mangler en fortsættelse.');
      if (!next) return d.reportWarnings ?? [];
      const key = JSON.stringify(next);
      if (seen.has(key) || page === 199)
        throw Error('Hentningen er ikke afsluttet. Prøv igen.');
      seen.add(key);
    }
    return [];
  }
  async function sync() {
    setBusy(true);
    setError('');
    setNotice('');
    const names: Record<string, string> = {
      shopify: 'Shopify Payments',
      flatpay: 'Flatpay',
      viabill: 'ViaBill',
      pensopay: 'Pensopay',
    };
    const failures: string[] = [],
      warnings: string[] = [];
    try {
      const connected = (
        (await (
          await fetch('/api/integrations', { cache: 'no-store' })
        ).json()) as { integrations?: Array<{ provider: string }> }
      ).integrations?.map((i) => i.provider) ?? ['shopify'];
      for (const provider of Object.keys(names).filter((p) =>
        connected.includes(p),
      )) {
        try {
          warnings.push(...(await syncProvider(provider)));
        } catch (e) {
          failures.push(
            names[provider] +
              ': ' +
              (e instanceof Error ? e.message : 'Hentningen fejlede.'),
          );
        }
      }
      if (warnings.length) setNotice(warnings.join(' '));
      if (failures.length) throw Error(failures.join(' · '));
    } finally {
      setBusy(false);
      setOffset(0);
      setRevision((v) => v + 1);
    }
  }
  const date = (value: string) => formatDate(value);
  return (
    <section className="mx-auto max-w-[1440px] px-5 py-7 md:px-8 md:py-9">
      <p className="eyebrow">Bogføring · Samlet oversigt</p>
      <PageTitle title="Udbetalinger" />
      <p className="mt-2 text-sm text-muted-foreground">
        Alle udbydere samlet · nyeste først · perioden følger fælles historik.
      </p>
      <div className="my-5 flex justify-end">
        <RefreshButton onRefresh={sync} disabled={busy} />
      </div>
      <p className="mb-4 text-xs text-muted-foreground">
        Udbetalinger hentes automatisk ved hver synkronisering fra
        integrationens startdato og fælles historik. Kommende udbetalinger
        vises, når udbyderen oplyser dem; forventede beløb bogføres ikke.
      </p>
      <TestModeNote>
        Testmiljøet udfører ingen automatisk bogføring eller planlagte kørsler.
      </TestModeNote>
      {error && (
        <p role="alert" className="mb-4 text-sm text-red-700">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="mb-4 text-sm">
          {notice}
        </p>
      )}
      <div className="overflow-x-auto rounded-2xl border bg-white">
        <table ref={stackRef} className="stack-table w-full text-left text-sm">
          <thead className="bg-muted/45">
            <tr>
              {[
                'Udbyder',
                'Udbetalings-ID',
                'Dato',
                'Beløb',
                'Udbetalingsstatus',
                'Bogføringsstatus',
                'Handling',
              ].map((h) => (
                <th
                  className={h === 'Beløb' ? 'p-4 text-right' : 'p-4'}
                  key={h}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={7} className="p-6">
                  Indlæser…
                </td>
              </tr>
            ) : !rows.length ? (
              <tr>
                <td colSpan={7} className="p-6">
                  {error
                    ? 'Oversigten kunne ikke indlæses.'
                    : 'Ingen gemte udbetalinger. Vælg udbyder og hent udbetalinger.'}
                </td>
              </tr>
            ) : (
              rows.map((r) => (
                <tr key={r.provider + ':' + r.id} className="border-t">
                  <td className="p-4 font-medium">{r.label}</td>
                  <td className="p-4 break-all">
                    {asText(
                      r.detail.paymentID ||
                        (r.detail.source === 'settlement'
                          ? 'Afregning ' + r.detail.settlementNumber
                          : '') ||
                        r.detail.entryUUID ||
                        r.id.split('/').pop(),
                    )}
                  </td>
                  <td className="p-4 whitespace-nowrap">{date(r.date)}</td>
                  <td className="p-4 whitespace-nowrap text-right tabular-nums">
                    {new Intl.NumberFormat('da-DK', {
                      style: 'currency',
                      currency: r.currency,
                    }).format(r.amount)}
                  </td>
                  <td className="p-4">{r.status}</td>
                  <td className="p-4">
                    <BookingStatus status={r.booking} />
                  </td>
                  <td className="p-4">
                    <div className="flex gap-2">
                      {((r.provider === 'flatpay' &&
                        r.status === 'Udbetalt' &&
                        r.booking !== 'booked') ||
                        r.canBook) && (
                        <ManualBookingAction
                          kind={r.provider === 'flatpay' ? 'flatpay' : 'payout'}
                          externalId={r.id}
                          onDone={() => setRevision((v) => v + 1)}
                        />
                      )}
                      <PayoutLog externalId={r.id} provider={r.provider} />
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
        <div className="flex flex-wrap items-center justify-between gap-3 border-t p-4">
          <span>
            {total} udbetalinger · Side {offset / pageSize + 1} af{' '}
            {Math.max(1, Math.ceil(total / pageSize))}
          </span>
          <div className="flex gap-2">
            <Button
              variant="outline"
              disabled={loading || busy || !offset}
              onClick={() => setOffset((o) => o - pageSize)}
            >
              Forrige
            </Button>
            <Button
              variant="outline"
              disabled={loading || busy || offset + pageSize >= total}
              onClick={() => setOffset((o) => o + pageSize)}
            >
              Næste
            </Button>
          </div>
        </div>
      </div>
    </section>
  );
}
