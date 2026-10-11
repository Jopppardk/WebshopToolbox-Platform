'use client';
import { PageTitle } from '@/platform/workspace';
import { formatDate } from '@/lib/format';
import { tier1Fetch as fetch, tier1Url } from '@/platform/transport';
import { useEffect, useState } from 'react';
import { FileDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useCapabilities } from '@/platform/capabilities';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

type DocumentRow = {
  externalId: string;
  date: string;
  provider: string;
  amount: { amount: string; currencyCode: string };
  filename: string;
  ready?: boolean;
  status?: string;
  failed?: boolean;
};
export function Documents({ syncRevision = 0 }: { syncRevision?: number }) {
  const runtime = useCapabilities();
  const [rows, setRows] = useState<DocumentRow[]>([]),
    [error, setError] = useState(''),
    [loading, setLoading] = useState(true),
    [revision, setRevision] = useState(0),
    [busy, setBusy] = useState<string | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/documents', { cache: 'no-store', signal: controller.signal })
      .then(async (response) => {
        const data = (await response.json()) as {
          documents?: DocumentRow[];
          error?: string;
        };
        if (!response.ok) throw new Error(data.error);
        if (!controller.signal.aborted) {
          setRows(data.documents || []);
          setError('');
        }
      })
      .catch((failure) => {
        if (!controller.signal.aborted)
          setError(
            failure instanceof Error
              ? failure.message
              : 'Dokumenterne kunne ikke indlæses.',
          );
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [syncRevision, revision]);
  async function generate(externalId: string) {
    setBusy(externalId);
    setError('');
    try {
      const r = await fetch('/api/documents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ externalId }),
      });
      const d = (await r.json()) as { error?: string };
      if (!r.ok) throw Error(d.error || 'Rapporten kunne ikke dannes.');
      setRevision((v) => v + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Rapporten kunne ikke dannes.');
    } finally {
      setBusy(null);
    }
  }
  return (
    <div className="mx-auto max-w-[1440px] px-5 py-7 md:px-8 md:py-9">
      <div className="mb-6">
        <p className="eyebrow">Dokumenter</p>
        <PageTitle title="Udbetalingsrapporter" />
        <p className="mt-2 text-sm text-muted-foreground">
          Udbetalingsrapporter fra Shopify Payments og Flatpay. Rapporterne
          genereres af Toolbox.
          {runtime.production
            ? ' Rapporten vedhæftes bogføringen i Dinero, når bilag er slået til under Indstillinger.'
            : ' Overførsel til Dinero er blokeret i testmiljøet.'}
        </p>
      </div>
      {error && (
        <p role="alert" className="mb-4 rounded-xl bg-red-50 p-4 text-red-800">
          {error}
        </p>
      )}
      <section className="overflow-hidden rounded-2xl border bg-white">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Udbyder</TableHead>
              <TableHead>Udbetalings-ID</TableHead>
              <TableHead>Dato</TableHead>
              <TableHead className="text-right">Netto</TableHead>
              <TableHead>Dokument</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={5}>Indlæser…</TableCell>
              </TableRow>
            ) : !rows.length ? (
              <TableRow>
                <TableCell colSpan={5} className="p-8 text-center">
                  Ingen udbetalingsrapporter endnu. Hent først udbetalinger, og
                  vælg derefter Generér rapport.
                </TableCell>
              </TableRow>
            ) : (
              rows.map((row) => (
                <TableRow key={row.externalId}>
                  <TableCell>
                    {row.provider === 'flatpay'
                      ? 'Flatpay'
                      : 'Shopify Payments'}
                  </TableCell>
                  <TableCell>
                    {row.provider === 'flatpay'
                      ? row.filename.replace(/^flatpay-|\.pdf$/gi, '')
                      : row.externalId.split('/').pop()}
                  </TableCell>
                  <TableCell>{formatDate(row.date)}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {new Intl.NumberFormat('da-DK', {
                      style: 'currency',
                      currency: row.amount.currencyCode,
                    }).format(Number(row.amount.amount))}
                  </TableCell>
                  <TableCell>
                    {row.failed && (
                      <span className="mr-2 inline-flex items-center rounded-full border border-red-200 bg-red-50 px-2.5 py-1 text-xs font-medium text-red-800">
                        Automatisk dannelse fejlede · tryk Generér rapport for
                        årsagen
                      </span>
                    )}
                    {row.status &&
                      row.status !== 'PAID' &&
                      row.ready === false && (
                        <span className="mr-2 text-xs text-muted-foreground">
                          Kommende · rapporten dannes efter udbetaling
                        </span>
                      )}
                    {row.ready !== false && (
                      <Button
                        variant="outline"
                        render={
                          <a
                            href={tier1Url(
                              `/api/documents?externalId=${encodeURIComponent(row.externalId)}`,
                            )}
                            target="_blank"
                            rel="noreferrer"
                          />
                        }
                      >
                        <FileDown />
                        Åbn PDF
                      </Button>
                    )}
                    {(!row.status || row.status === 'PAID') && (
                      <Button
                        className="ml-2"
                        variant="outline"
                        disabled={busy !== null}
                        onClick={() => void generate(row.externalId)}
                      >
                        {busy === row.externalId
                          ? 'Genererer…'
                          : row.ready !== false
                            ? 'Opdatér rapport'
                            : 'Generér rapport'}
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </section>
    </div>
  );
}
