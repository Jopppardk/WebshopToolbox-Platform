'use client';
// The printer icon on Salg: creates the order's shipment in Shipmondo (with the product and pickup point already
// chosen there) and prints its label. An order that already has a label is only printed again, after a confirm.
import { useState } from 'react';
import { Check, LoaderCircle, Printer, TriangleAlert } from 'lucide-react';
import { tier1Fetch as fetch } from '@/platform/transport';
import { formatDateTime } from '@/lib/format';
import { useConfirm } from '@/components/confirm-dialog';

export type LabelState = { phase: 'creating' | 'created' | 'uncertain'; printedAt: string | null; printCount: number; message: string | null } | null;

export function LabelPrint({ externalId, orderName, label, onDone }: { externalId: string; orderName: string; label: LabelState; onDone: () => void }) {
  const { confirm, dialog } = useConfirm();
  const [busy, setBusy] = useState(false), [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const printed = label?.phase === 'created';
  async function print(confirmedNoShipment = false) {
    if (printed && !await confirm({ title: 'Udskriv label igen', message: `Ordre ${orderName} har allerede en label. Den samme label udskrives igen; der oprettes ikke en ny forsendelse.`, confirmLabel: 'Udskriv igen' })) return;
    setBusy(true); setResult(null);
    try {
      const r = await fetch('/api/shipmondo/label', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ externalId, confirmedNoShipment }) });
      const d = await r.json() as { error?: string; printer?: string; reprint?: boolean };
      if (!r.ok) throw Error(d.error || 'Labelen kunne ikke udskrives.');
      setResult({ ok: true, text: `${d.reprint ? 'Udskrevet igen' : 'Label udskrevet'} på ${d.printer}` });
      onDone();
    } catch (e) { setResult({ ok: false, text: e instanceof Error ? e.message : 'Labelen kunne ikke udskrives.' }); onDone(); } finally { setBusy(false); }
  }
  async function resolveUncertain() {
    if (await confirm({ title: 'Uafklaret label', message: `Et tidligere forsøg på ordre ${orderName} gav ikke et sikkert svar fra Shipmondo. Kontrollér ordren i Shipmondo. Opret kun en ny label, hvis der ikke allerede er en forsendelse.`, confirmLabel: 'Der er ingen forsendelse – opret label' })) void print(true);
  }
  const title = busy ? 'Opretter og udskriver label…' : label?.phase === 'uncertain' ? 'Uafklaret – kontrollér i Shipmondo' : printed ? `Label udskrevet${label?.printedAt ? ' ' + formatDateTime(label.printedAt.replace(' ', 'T') + 'Z') : ''}${label && label.printCount > 1 ? ` (${label.printCount} gange)` : ''} · klik for at udskrive igen` : 'Opret forsendelse i Shipmondo og udskriv label';
  return <>
    {dialog}
    <button type="button" aria-label={title} title={result?.text || label?.message || title} disabled={busy || label?.phase === 'creating'}
      onClick={() => void (label?.phase === 'uncertain' ? resolveUncertain() : print())}
      className={'relative inline-flex size-8 items-center justify-center rounded-lg border bg-white transition hover:bg-muted/50 disabled:opacity-60 ' + (result && !result.ok || label?.phase === 'uncertain' || label?.message ? 'border-red-300 text-red-700' : printed ? 'border-emerald-200 text-emerald-700' : 'text-foreground')}>
      {busy ? <LoaderCircle className="size-4 animate-spin" /> : label?.phase === 'uncertain' ? <TriangleAlert className="size-4" /> : <Printer className="size-4" />}
      {printed && !busy && <Check className="absolute -right-1 -top-1 size-3.5 rounded-full bg-emerald-600 p-0.5 text-white" />}
    </button>
    {result && !result.ok && <p role="alert" className="mt-1 max-w-64 text-left text-xs text-red-700">{result.text}</p>}
  </>;
}
