'use client';
import { useEffect, useRef, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import type { ViaBillRecord } from '@/lib/viabill';

const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Copenhagen', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const money = (minor: number, currency: string) => new Intl.NumberFormat('da-DK', { style: 'currency', currency }).format(minor / 100);
const date = (value: string) => new Intl.DateTimeFormat('da-DK', { dateStyle: 'medium', timeZone: 'Europe/Copenhagen' }).format(new Date(`${value}T12:00:00Z`));
const booking = (value?: string) => value === 'booked' ? 'Bogført' : value === 'failed' ? 'Fejlet' : 'Afventer';
export function ViaBillRecords({ kind }: { kind: 'payment' | 'payout' }) {
  const isPayout = kind === 'payout'; const title = isPayout ? 'Udbetalinger' : 'Betalinger';
  const [from, setFrom] = useState(today); const [to, setTo] = useState(today); const [search, setSearch] = useState('');
  const [ready, setReady] = useState(false); const [rows, setRows] = useState<ViaBillRecord[]>([]);
  const [totals, setTotals] = useState<Array<{ currency: string; count: number; amountMinor: number }>>([]);
  const [offset, setOffset] = useState(0); const [revision, setRevision] = useState(0);
  const [loading, setLoading] = useState(true); const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState(''); const [notice, setNotice] = useState('');
  const [detail, setDetail] = useState<ViaBillRecord | null>(null); const [detailBusy, setDetailBusy] = useState(false);
  const syncController = useRef<AbortController | null>(null);
  const total = totals.reduce((sum, row) => sum + row.count, 0);
  useEffect(() => { const controller = new AbortController(); fetch('/api/admin/history', { signal: controller.signal }).then(async response => { if (!response.ok) throw new Error('Historikindstillingerne kunne ikke hentes.'); const data = await response.json() as { effectiveDate: string }; setFrom(data.effectiveDate); setReady(true); }).catch(error => { if (!controller.signal.aborted) { setError(error.message); setLoading(false); } }); return () => { controller.abort(); syncController.current?.abort(); }; }, []);
  useEffect(() => {
    if (!ready) return; const controller = new AbortController(); setLoading(true); setDetail(null);
    const timer = setTimeout(async () => {
      try {
        const response = await fetch(`/api/viabill/records?${new URLSearchParams({ kind, from, to, search, offset: String(offset) })}`, { signal: controller.signal });
        const data = await response.json() as { records: ViaBillRecord[]; totals: typeof totals; error?: string };
        if (!response.ok) throw new Error(data.error || 'Posterne kunne ikke hentes.');
        setRows(data.records); setTotals(data.totals);
      } catch (error) { if (!controller.signal.aborted) { setRows([]); setTotals([]); setError(error instanceof Error ? error.message : 'Hentning fejlede.'); } }
      finally { if (!controller.signal.aborted) setLoading(false); }
    }, 200);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [kind, from, to, search, offset, revision, ready]);
  async function sync() {
    const controller = new AbortController(); syncController.current = controller;
    setSyncing(true); setError(''); setNotice('Henter fra ViaBill…');
    let next: unknown = null; let count = 0; let skipped = 0; let mismatches = 0;
    try {
      do {
        if (controller.signal.aborted) throw new Error('Hentningen er stoppet.');
        const response = await fetch('/api/viabill/records', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind, from, to, next }), signal: controller.signal });
        const data = await response.json() as { synced: number; skipped: number; mismatches: number; next: unknown; error?: string };
        if (!response.ok) throw new Error(data.error || 'Importen mislykkedes.');
        count += data.synced; skipped += data.skipped; mismatches += data.mismatches; next = data.next;
        setNotice(`${count} ${title.toLowerCase()} hentet${next ? ' · henter flere…' : ` · perioden er færdighentet.${skipped ? ` ${skipped} øvrige poster er ikke medtaget.` : ''}${mismatches ? ` ${mismatches} afregninger har en beløbsdifference — se detaljer.` : ''}`}`);
      } while (next);
    } catch (error) { setError(error instanceof Error ? error.message : 'Hentning stoppet.'); setNotice(`${count} poster gemt. Perioden er ikke færdighentet. Du kan hente igen uden at oprette dubletter.`); }
    finally { setSyncing(false); setOffset(0); setRevision(value => value + 1); }
  }
  async function showDetail(row: ViaBillRecord) {
    setDetailBusy(true); setError('');
    try { const response = await fetch(`/api/viabill/records?${new URLSearchParams({ kind, from, to, id: row.id })}`); const data = await response.json() as { record: ViaBillRecord; error?: string }; if (!response.ok) throw new Error(data.error || 'Detaljer kunne ikke hentes.'); setDetail(data.record); }
    catch (error) { setError(error instanceof Error ? error.message : 'Detaljer kunne ikke hentes.'); }
    finally { setDetailBusy(false); }
  }
  return <div className="mx-auto max-w-[1440px] px-5 py-7 md:px-8 md:py-9">
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4"><div><p className="eyebrow">ViaBill</p><h1 className="mt-1 text-3xl font-semibold">{title}</h1><p className="mt-2 text-sm text-muted-foreground">{isPayout ? 'Faktiske afregninger fra ViaBill med de tilhørende posteringer.' : 'Captured betalinger fra ViaBill — ikke ordrer eller kundens afdrag til ViaBill.'}</p></div><Button onClick={sync} disabled={!ready || syncing || !from || !to || from > to}><RefreshCw className={syncing ? 'animate-spin' : ''} />{syncing ? 'Henter…' : 'Hent fra ViaBill'}</Button></div>
    <fieldset disabled={syncing} className="mb-5 flex flex-wrap items-end gap-3"><label className="text-sm">Fra<Input type="date" className="mt-1" value={from} max={to} onChange={event => { setFrom(event.target.value); setOffset(0); setError(''); setNotice(''); }} /></label><label className="text-sm">Til<Input type="date" className="mt-1" value={to} min={from} max={today()} onChange={event => { setTo(event.target.value); setOffset(0); setError(''); setNotice(''); }} /></label><label className="min-w-48 flex-1 text-sm">Søg<Input className="mt-1" placeholder={isPayout ? 'Udbetalings-ID' : 'Ordrenummer eller transaktions-ID'} value={search} onChange={event => { setSearch(event.target.value); setOffset(0); setError(''); }} /></label></fieldset>
    {error && <p role="alert" className="mb-4 rounded-xl bg-red-50 p-4 text-sm text-red-800">{error}</p>}{notice && <p role="status" className="mb-4 text-sm">{notice}</p>}
    <p className="mb-4 text-sm text-muted-foreground">Historik følger Indstillinger. Hentningen er manuel og ændrer intet hos ViaBill. Bogføring i Dinero er endnu ikke aktiveret.{!isPayout && ' Gebyrer fordeles ikke skønsmæssigt på betalinger; de findes i afregningsdetaljerne.'}</p>
    {totals.map(row => <div key={row.currency} className="mb-4 rounded-2xl border bg-white p-5"><p className="text-sm text-muted-foreground">{row.count} gemte {title.toLowerCase()} · {row.currency}</p><p className="mt-2 text-2xl font-semibold">{money(row.amountMinor, row.currency)}</p></div>)}
    <section className="overflow-hidden rounded-2xl border bg-white" aria-busy={loading || syncing}><Table><TableHeader><TableRow><TableHead>{isPayout ? 'Indløser' : 'Ordrenummer'}</TableHead><TableHead>{isPayout ? 'Udbetalings-ID' : 'Captured'}</TableHead><TableHead>{isPayout ? 'Transaktionsdato' : 'Betalingsudbyder'}</TableHead><TableHead className="text-right">Beløb</TableHead><TableHead>Bogføringsstatus</TableHead>{isPayout && <TableHead>Afregning</TableHead>}</TableRow></TableHeader><TableBody>
      {loading ? <TableRow><TableCell colSpan={6} className="p-8 text-center">Indlæser…</TableCell></TableRow> : !rows.length ? <TableRow><TableCell colSpan={6} className="p-8 text-center">{error ? 'Posterne kunne ikke vises.' : 'Ingen gemte poster i udsnittet. Forbind ViaBill under Indstillinger og vælg Hent fra ViaBill.'}</TableCell></TableRow> : rows.map(row => <TableRow key={row.id}>
        <TableCell>{isPayout ? 'ViaBill' : <><div className="font-medium">{row.orderNumber || 'Ikke oplyst af ViaBill'}</div><div className="mt-1 text-sm text-muted-foreground break-all">{row.transactionId || row.entryUUID}</div></>}</TableCell>
        <TableCell className="break-all">{isPayout ? row.entryUUID : date(row.date)}</TableCell><TableCell>{isPayout ? date(row.date) : 'ViaBill'}</TableCell><TableCell className="text-right tabular-nums whitespace-nowrap">{money(row.amountMinor, row.currency)}</TableCell><TableCell>{booking(row.bookingStatus)}</TableCell>
        {isPayout && <TableCell><Button variant="outline" disabled={detailBusy} onClick={() => showDetail(row)}>Se poster</Button>{row.reconciled === false && <p className="mt-1 text-sm text-amber-800">Beløbsdifference</p>}</TableCell>}
      </TableRow>)}
    </TableBody></Table><div className="flex items-center justify-between gap-3 border-t p-4 text-sm"><span>{total} {title.toLowerCase()}</span><div className="flex gap-2"><Button variant="outline" disabled={loading || syncing || offset === 0} onClick={() => setOffset(value => Math.max(0, value - 50))}>Forrige</Button><Button variant="outline" disabled={loading || syncing || offset + 50 >= total} onClick={() => setOffset(value => value + 50)}>Næste</Button></div></div></section>
    {detail && <section className="mt-6 overflow-hidden rounded-2xl border bg-white"><div className="flex items-center justify-between gap-3 p-5"><div><h2 className="font-semibold">Afregningsposter</h2><p className="mt-1 break-all text-sm text-muted-foreground">{detail.entryUUID}</p></div><Button variant="outline" onClick={() => setDetail(null)}>Luk</Button></div><p className={`px-5 pb-4 text-sm ${detail.reconciled ? 'text-muted-foreground' : 'text-amber-800'}`}>{detail.reconciled ? 'Posternes sum stemmer med udbetalingen.' : 'Posternes sum afviger fra udbetalingen. Afregningen skal kontrolleres før bogføring.'}</p><Table><TableHeader><TableRow><TableHead>Dato</TableHead><TableHead>Type</TableHead><TableHead>Ordre / beskrivelse</TableHead><TableHead className="text-right">Beløb</TableHead></TableRow></TableHeader><TableBody>{detail.entries?.map((entry, index) => <TableRow key={index}><TableCell>{date(entry.date)}</TableCell><TableCell>{entry.type}</TableCell><TableCell>{entry.orderNumber && <div>{entry.orderNumber}</div>}{entry.text}</TableCell><TableCell className="text-right whitespace-nowrap">{money(entry.amountMinor, entry.currency)}</TableCell></TableRow>)}</TableBody></Table></section>}
  </div>;
}

