'use client';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import type { CheckedInvoice } from '@/lib/invoice-check';
import type { SalesDraft } from '@/lib/sales-preview';

type Result = { invoice: CheckedInvoice; draft?: SalesDraft; notes: string[]; checkedAt: string; error?: string };
export function SalesPreview({ externalId, mode = 'sale', disabled = false }: { externalId: string; mode?: 'sale' | 'invoice'; disabled?: boolean }) {
  const [open, setOpen] = useState(false), [result, setResult] = useState<Result | null>(null), [error, setError] = useState(''), [retry, setRetry] = useState(0);
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    setResult(null); setError('');
    fetch('/api/sales/preview', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ externalId, mode }), signal: controller.signal })
      .then(async response => { const data = await response.json() as Result; if (!response.ok) throw new Error(data.error || 'Kontrollen kunne ikke gennemføres.'); return data; })
      .then(setResult).catch(error => { if (!controller.signal.aborted) setError(error instanceof Error ? error.message : 'Kontrollen kunne ikke gennemføres.'); });
    return () => controller.abort();
  }, [open, externalId, mode, retry]);
  const invoice = result?.invoice;
  const format = (minor: number) => {
    const currency = invoice?.currency || 'DKK';
    const digits = new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions().maximumFractionDigits!;
    return new Intl.NumberFormat('da-DK', { style: 'currency', currency }).format(minor / 10 ** digits);
  };
  return <>
    <Button variant="outline" size="sm" onClick={() => setOpen(true)} disabled={!externalId || disabled} title={disabled ? 'Salget er allerede bogført i Dinero' : undefined}>Kontrollér</Button>
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetContent className="data-[side=right]:w-full data-[side=right]:sm:max-w-4xl overflow-y-auto">
        <SheetHeader className="pr-12"><SheetTitle>{mode === 'sale' ? 'Salg · bogføringsforhåndsvisning' : 'Fakturakontrol'}{invoice ? ` ${invoice.number}` : ''}</SheetTitle><SheetDescription>Kun kontrol. Intet bogføres i Dinero, og ingen gemte PDF’er ændres.</SheetDescription></SheetHeader>
        <div className="space-y-6 px-4 pb-8 text-left">
          {!result && !error && <p role="status">Henter og kontrollerer komplette ordredata{mode === 'sale' ? ' og kontoplan' : ''}…</p>}
          {error && <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-red-800"><p>{error}</p><Button variant="outline" className="mt-3" onClick={() => setRetry(n => n + 1)}>Prøv kontrollen igen</Button></div>}
          {invoice && result && <>
            <div className="rounded-xl border p-4"><p className="font-semibold">{invoice.customer.name}</p><p>{invoice.customer.address1} {invoice.customer.address2}</p><p>{invoice.customer.zip} {invoice.customer.city} · {invoice.customer.country}</p><p className="mt-3">Ordredato: {new Date(invoice.date).toLocaleDateString('da-DK', { timeZone: 'Europe/Copenhagen' })}</p><p>{invoice.paid ? 'Betalt i Shopify' : 'Ikke registreret som fuldt betalt i Shopify'}</p></div>
            <section><h3 className="mb-2 font-semibold">Kontrollerede fakturalinjer</h3><div className="overflow-x-auto"><table className="w-full min-w-[570px] text-sm"><thead><tr className="border-b text-left"><th className="p-2">Beskrivelse</th><th>Antal</th><th className="text-right">Ekskl. moms</th><th className="text-right">Moms</th><th className="text-right">Inkl. moms</th></tr></thead><tbody>{invoice.lines.map(line => <tr key={line.id} className="border-b"><td className="p-2">{line.title}</td><td>{line.quantity}</td><td className="text-right tabular-nums">{format(line.net)}</td><td className="text-right tabular-nums">{format(line.tax)}</td><td className="text-right tabular-nums">{format(line.gross)}</td></tr>)}</tbody><tfoot><tr className="font-semibold"><td className="p-2" colSpan={2}>Afstemt mod Shopify</td><td className="text-right">{format(invoice.net)}</td><td className="text-right">{format(invoice.tax)}</td><td className="text-right">{format(invoice.gross)}</td></tr></tfoot></table></div><p className="mt-2 text-xs text-muted-foreground">Alle beløb er efter rabatter. Linjer, fragt, moms og total er afstemt i mindste valutaenhed.</p></section>
            {result.draft && <section className="space-y-3"><h3 className="font-semibold">Kontoforslag — ikke en bogført kladde</h3><div className={`rounded-xl border p-4 ${result.draft.ready ? 'bg-emerald-50' : 'bg-amber-50'}`}><p className="font-medium">{result.draft.ready ? 'Teknisk kontrol bestået. Kræver stadig din godkendelse før en senere bogføring.' : 'Skal afklares før bogføring'}</p>{result.draft.blockers.length > 0 && <ul className="mt-2 list-disc space-y-1 pl-5">{result.draft.blockers.map(item => <li key={item}>{item}</li>)}</ul>}</div>
              <div className="overflow-x-auto"><table className="w-full min-w-[620px] text-sm"><thead><tr className="border-b text-left"><th className="p-2">Salg / fragt</th><th>Kreditkonto</th><th>Momskode</th><th className="text-right">Netto kredit</th><th className="text-right">Moms kredit*</th></tr></thead><tbody>{result.draft.lines.map((line, i) => <tr className="border-b" key={i}><td className="p-2">{line.title}</td><td>{line.account || 'Mangler'}</td><td>{line.vatCode === '' ? 'Ingen moms' : line.vatCode ?? 'Mangler'}</td><td className="text-right">{format(line.net)}</td><td className="text-right">{format(line.tax)}</td></tr>)}</tbody></table></div>
              <p>Debet — mellemregning: <strong>{result.draft.clearing || 'Mangler konto'}</strong> · {format(result.draft.debit)}</p><p>Debet i alt: {format(result.draft.debit)} · Kredit inkl. moms: {format(result.draft.credit)}</p>{result.draft.inventory && <p className="rounded-xl border bg-muted/30 p-3">Lager: {format(result.draft.inventory.cost)} debiteres <strong>{result.draft.inventory.adjustmentAccount}</strong> og krediteres <strong>{result.draft.inventory.account}</strong>.</p>}<p className="text-xs text-muted-foreground">* Momsen vises særskilt til kontrol. Hvis lagerautomatik er aktiv, indgår vareforbruget uden moms i samme finansbilag som salget.</p>
            </section>}
            <div className="space-y-2 rounded-xl bg-muted p-4 text-sm">{result.notes.map(note => <p key={note}>{note}</p>)}<p className="text-xs text-muted-foreground">Kontrolleret {new Date(result.checkedAt).toLocaleString('da-DK', { timeZone: 'Europe/Copenhagen' })}</p></div>
            <Button variant="outline" onClick={() => setRetry(n => n + 1)}>Hent og kontrollér igen</Button>
          </>}
        </div>
      </SheetContent>
    </Sheet>
  </>;
}

