'use client';
import { useEffect, useState } from 'react';
import { FileDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

type DocumentRow = { externalId: string; date: string; provider: string; amount: { amount: string; currencyCode: string }; filename: string };
export function Documents({ syncRevision = 0 }: { syncRevision?: number }) {
  const [rows, setRows] = useState<DocumentRow[]>([]), [error, setError] = useState(''), [loading, setLoading] = useState(true);
  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/documents', { cache: 'no-store', signal: controller.signal }).then(async response => {
      const data = await response.json() as { documents?: DocumentRow[]; error?: string };
      if (!response.ok) throw new Error(data.error);
      if (!controller.signal.aborted) { setRows(data.documents || []); setError(''); }
    }).catch(failure => { if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : 'Dokumenterne kunne ikke indlæses.'); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [syncRevision]);
  return <div className="mx-auto max-w-[1440px] px-5 py-7 md:px-8 md:py-9"><div className="mb-6"><p className="eyebrow">Dokumentarkiv</p><h1 className="mt-1 text-3xl font-semibold">Udbetalingsrapporter</h1><p className="mt-2 text-sm text-muted-foreground">Én kontrolleret PDF pr. Shopify Payments-udbetaling. Den samme PDF vedhæftes Dinero-bilaget.</p></div>{error && <p role="alert" className="mb-4 rounded-xl bg-red-50 p-4 text-red-800">{error}</p>}<section className="overflow-hidden rounded-2xl border bg-white"><Table><TableHeader><TableRow><TableHead>Indløser</TableHead><TableHead>Udbetalings-ID</TableHead><TableHead>Dato</TableHead><TableHead className="text-right">Netto</TableHead><TableHead>Dokument</TableHead></TableRow></TableHeader><TableBody>{loading ? <TableRow><TableCell colSpan={5}>Indlæser…</TableCell></TableRow> : !rows.length ? <TableRow><TableCell colSpan={5} className="p-8 text-center">Ingen udbetalingsrapporter endnu. De dannes automatisk, når udbetalinger hentes.</TableCell></TableRow> : rows.map(row => <TableRow key={row.externalId}><TableCell>Shopify Payments</TableCell><TableCell>{row.externalId.split('/').pop()}</TableCell><TableCell>{new Intl.DateTimeFormat('da-DK', { dateStyle: 'medium', timeZone: 'Europe/Copenhagen' }).format(new Date(row.date))}</TableCell><TableCell className="text-right tabular-nums">{new Intl.NumberFormat('da-DK', { style: 'currency', currency: row.amount.currencyCode }).format(Number(row.amount.amount))}</TableCell><TableCell><Button variant="outline" render={<a href={`/api/documents?externalId=${encodeURIComponent(row.externalId)}`} target="_blank" rel="noreferrer" />}><FileDown />Åbn PDF</Button></TableCell></TableRow>)}</TableBody></Table></section></div>;
}
