'use client';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import type { Voucher } from '@/lib/dinero-sale';
type Result = { enabled: boolean; draftTestAllowed?: boolean; error?: string; state: null | { phase: string; version: string; draftTest?: boolean; guid?: string; voucherNumber?: number; organizationId: string; message?: string; snapshot: { invoiceNumber: string; gross: number; attach: boolean; voucher: Voucher; expected: { net: number; tax: number; gross: number }[] } } };
const labels: Record<string, string> = { prepared: 'Forslag klar – ikke overført', creating: 'Opretter kladde – afvent status', draft: 'Kladde i Dinero – ikke bogført', booking: 'Bogføring igang – afvent status', booked: 'Bogført i Dinero', uncertain: 'Kræver kontrol i Dinero', archived: 'Ældre overførsel – spærret for gentagelse' };
export function SalesTransfer({ externalId, disabled = false, onBooked }: { externalId: string; disabled?: boolean; onBooked?: () => void }) {
  const [open, setOpen] = useState(false), [busy, setBusy] = useState(false), [result, setResult] = useState<Result | null>(null), [error, setError] = useState('');
  const [date, setDate] = useState(''), [noOtherBooking, setNoOtherBooking] = useState(false), [storebuddyStopped, setStorebuddyStopped] = useState(false), [confirmNumber, setConfirmNumber] = useState('');
  const [draftTestAcknowledged, setDraftTestAcknowledged] = useState(false);
  async function call(action: string) {
    setBusy(true); setError('');
    try {
      const response = await fetch('/api/sales/transfer', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ externalId, action, date, version: result?.state?.version, noOtherBooking, storebuddyStopped, confirmNumber, draftTestAcknowledged }) });
      const data = await response.json() as Result;
      if (!response.ok) throw new Error(data.error || 'Handlingen kunne ikke gennemføres.');
      setResult(data); setNoOtherBooking(false); setStorebuddyStopped(false); setConfirmNumber(''); setDraftTestAcknowledged(false);
      if (data.state?.phase === 'booked') onBooked?.();
    } catch (e) { setError(e instanceof Error ? e.message : 'Forbindelsen blev afbrudt. Hent status før et nyt forsøg.'); }
    finally { setBusy(false); }
  }
  useEffect(() => { if (open) { setResult(null); void call('status'); } }, [open, externalId]); // Only reads local status on opening.
  const state = result?.state, snapshot = state?.snapshot;
  const money = (n: number) => new Intl.NumberFormat('da-DK', { style: 'currency', currency: 'DKK' }).format(n / 100);
  const testCreate = state?.phase === 'prepared' && state.draftTest === true;
  const actionEnabled = testCreate ? result?.draftTestAllowed : result?.enabled && !state?.draftTest;
  const confirmed = (testCreate ? draftTestAcknowledged : noOtherBooking && storebuddyStopped) && confirmNumber === snapshot?.invoiceNumber;
  return <>
    <Button variant="outline" size="sm" onClick={() => setOpen(true)} disabled={disabled} title={disabled ? 'Salget er allerede bogført i Dinero' : undefined}>{disabled ? 'Bogført' : 'Overfør til Dinero'}</Button>
    <Sheet open={open} onOpenChange={setOpen}><SheetContent className="data-[side=right]:w-full data-[side=right]:sm:max-w-3xl overflow-y-auto">
      <SheetHeader><SheetTitle>Manuel salgsoverførsel</SheetTitle><SheetDescription>Kun fuldt afsendte salg. Betalinger og udbetalinger overføres ikke her. Ingen automatisk bogføring.</SheetDescription></SheetHeader>
      <div className="space-y-5 px-4 pb-8 text-sm">
        {result && !result.enabled && <p className="rounded-xl border bg-amber-50 p-4">{result.draftTestAllowed ? 'Kun en testkladde er tilladt for denne ordre. Bogføring er spærret. Forbered forslaget igen for at vælge kladdetesten; Storebuddy behøver ikke stoppes.' : 'Produktionsoverførsel er låst, indtil vi har aftalt den første bogføring og overgangen fra Storebuddy. Du kan forberede og kontrollere forslaget nu.'}</p>}
        {state?.draftTest && state.phase !== 'prepared' && <p className="rounded-xl border bg-amber-50 p-4">Dette er en testkladde. Den kan ikke bogføres fra Sablen Toolbox, heller ikke når normal bogføring senere åbnes. Slet den i Dinero efter kontrollen og giv besked, så vi kan afklare testregistreringen her. Opret ikke en ny kladde som genforsøg.</p>}
        {error && <p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-red-800">{error}</p>}
        {state && <p role="status" className="font-semibold">{labels[state.phase] || state.phase}</p>}
        {state?.message && <p>{state.message}</p>}
        {(!state || state.phase === 'prepared') && <div className="space-y-3"><label className="block">Bogføringsdato<Input type="date" value={date} onChange={e => setDate(e.target.value)} disabled={busy} /></label><p className="text-muted-foreground">Vælg den dato, salget skal bogføres på. Afsendelsesstatus kontrolleres på ny i Shopify; datoen er ikke automatisk afsendelsesdatoen.</p><Button onClick={() => call('prepare')} disabled={busy || !date}>Forbered forslag — uden overførsel</Button></div>}
        {snapshot && state?.phase !== 'archived' && <section className="space-y-3 rounded-xl border p-4">
          <p className="font-semibold">Faktura {snapshot.invoiceNumber} · {money(snapshot.gross)}</p>
          <p>Dinero-organisation: {state?.organizationId} · Bogføringsdato: {snapshot.voucher.VoucherDate}</p>
          <p>{snapshot.attach ? 'PDF vedhæftes kladden i Dinero.' : 'Bilagsupload er fravalgt. PDF bevares kun i Sablen Toolbox.'}</p>
          <a className="underline" href={`/api/invoices/pdf?externalId=${encodeURIComponent(externalId)}`} target="_blank" rel="noreferrer">Åbn faktura-PDF</a>
          <p className="text-sm text-muted-foreground">Positive beløb er debet, negative beløb er kredit. Salg samles pr. konto og momskode; fragt holdes separat.</p>
          <div className="overflow-x-auto"><table className="w-full min-w-[500px] text-left"><thead><tr><th>Linje / konto</th><th>Moms</th><th>Netto</th><th>Momsbeløb</th></tr></thead><tbody>{snapshot.voucher.Lines.map((line, i) => <tr key={i} className="border-t"><td className="py-2">{line.Description}<br />{line.AccountNumber}{line.BalancingAccountNumber ? ` → mellemregning ${line.BalancingAccountNumber}` : ''}</td><td>{line.AccountVatCode === 'none' ? 'Ingen moms' : line.AccountVatCode}</td><td>{money(snapshot.expected[i].net)}</td><td>{money(snapshot.expected[i].tax)}</td></tr>)}</tbody></table></div>
        </section>}
        {state?.guid && <p className="break-all">Dinero bilags-ID: {state.guid}{state.voucherNumber ? ` · Bilag nr. ${state.voucherNumber}` : ''}</p>}
        {state && ['prepared', 'draft'].includes(state.phase) && !(state.draftTest && state.phase === 'draft') && <section className="space-y-4 rounded-xl border p-4">
          {testCreate ? <label className="flex items-start gap-3"><Checkbox checked={draftTestAcknowledged} onCheckedChange={v => setDraftTestAcknowledged(v === true)} disabled={busy || !actionEnabled} />Jeg godkender kun en testkladde, som ikke må bogføres og slettes efter kontrollen i Dinero.</label> : <>
            <p>Kontrollér også Storebuddy og Dinero. Sablen Toolbox kan ikke automatisk genkende alt, Storebuddy har bogført.</p>
            <label className="flex items-start gap-3"><Checkbox checked={storebuddyStopped} onCheckedChange={v => setStorebuddyStopped(v === true)} disabled={busy || !actionEnabled} />Storebuddys salgsbogføring er stoppet.</label>
            <label className="flex items-start gap-3"><Checkbox checked={noOtherBooking} onCheckedChange={v => setNoOtherBooking(v === true)} disabled={busy || !actionEnabled} />Denne ordre er ikke allerede bogført i Dinero, hverken via Storebuddy eller manuelt.</label>
          </>}
          <label className="block">Skriv fakturanummeret {snapshot?.invoiceNumber} for at godkende<Input value={confirmNumber} onChange={e => setConfirmNumber(e.target.value)} disabled={busy || !actionEnabled} /></label>
          <Button disabled={busy || !actionEnabled || !confirmed} onClick={() => call(state.phase === 'prepared' ? 'create' : 'book')}>{testCreate ? 'Opret kun testkladde i Dinero' : state.phase === 'prepared' ? 'Opret kladde i Dinero' : 'Bogfør denne kladde i Dinero'}</Button>
        </section>}
        <div className="flex flex-wrap gap-2"><Button variant="outline" disabled={busy} onClick={() => call('status')}>Hent status</Button>{state && ['draft', 'uncertain', 'creating', 'booking', 'booked'].includes(state.phase) && <Button variant="outline" disabled={busy} onClick={() => call('reconcile')}>Kontrollér status hos Dinero</Button>}</div>
        {busy && <p role="status">Arbejder… Luk ikke et igangværende overførselsforsøg for at starte et nyt.</p>}
      </div>
    </SheetContent></Sheet>
  </>;
}
