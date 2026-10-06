'use client';
import { formatDate } from '@/lib/format';
import { tier1Fetch as fetch } from '@/platform/transport';
import { useEffect, useState } from 'react';
import { CheckCircle2, Download, RefreshCw, Send, Plug } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
type Quarter = {
  id: string;
  label: string;
  start: string;
  end: string;
  householdGrams: number;
  reportableGrams: number;
  unknownAudienceGrams: number;
  commercialGrams: number;
  submitted: boolean;
  submittedAt?: string;
  reason: string;
  statusNote?: string;
  warning?: string;
  canSubmit: boolean;
  unresolved: number;
};
type Overview = {
  connected: boolean;
  testMode?: boolean;
  organisation?: string;
  startDate?: string;
  quarters: Quarter[];
  error?: string;
  providerError?: string;
};
type Preview = {
  token: string;
  quarter: string;
  householdKg: number;
  ignoredLines: number;
  commercialKg: number;
  testMode: boolean;
  organisation: string;
};
export function PackagingReporting({
  revision = 0,
  onUpdated,
  onShowConsumption,
}: {
  revision?: number;
  onUpdated?: () => void;
  onShowConsumption?: (start: string, end: string) => void;
}) {
  const [data, setData] = useState<Overview | null>(null),
    [busy, setBusy] = useState(false),
    [acceptIncomplete, setAcceptIncomplete] = useState(false),
    [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [preview, setPreview] = useState<(Preview & { id: string }) | null>(null);
  async function load() {
    const r = await fetch('/api/emballage/reporting', { cache: 'no-store' }),
      d = (await r.json()) as Overview;
    if (!r.ok) throw Error(d.error);
    setData(d);
  }
  useEffect(() => {
    const timer = window.setTimeout(() => {
      void load().catch((e) => setError(e.message));
    }, 0);
    return () => window.clearTimeout(timer);
  }, [revision]);
  async function action(body: {
    action: string;
    quarter?: string;
    token?: string;
    acceptIncomplete?: boolean;
  }) {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const r = await fetch('/api/emballage/reporting', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        }),
        d = (await r.json()) as Preview & {
          error?: string;
          receipt?: { submission_number: string };
        };
      if (!r.ok) throw Error(d.error);
      if (body.action === 'preview') {
        setAcceptIncomplete(false);
        setPreview({ ...d, id: body.quarter! });
      } else {
        setPreview(null);
        setNotice(
          body.action === 'sync'
            ? 'Historikken er hentet.'
            : d.testMode
              ? `Test gennemført · ${d.receipt?.submission_number}. Kvartalet er ikke indberettet.`
              : `Indberettet · ${d.receipt?.submission_number}`,
        );
        await load();
        if (body.action === 'sync') onUpdated?.();
      }
    } catch (e) {
      setError(
        e instanceof Error ? e.message : 'Handlingen kunne ikke gennemføres.',
      );
    } finally {
      setBusy(false);
    }
  }
  const visibleQuarters =
    data?.quarters.filter(
      (q) => !data.startDate || q.start >= data.startDate,
    ) ?? [];
  const kg = (g: number) =>
    new Intl.NumberFormat('da-DK', {
      minimumFractionDigits: 3,
      maximumFractionDigits: 3,
    }).format(g / 1000) + ' kg';
  if (data && !data.connected)
    return (
      <div className="rounded-2xl border border-dashed bg-white p-8 text-center">
        <Plug className="mx-auto mb-3 size-8 text-muted-foreground" />
        <h2 className="font-semibold">Indberetning er deaktiveret</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Tilføj og aktivér Emballage Indberetning under Indstillinger →
          Integrationer og kontoplan.
        </p>
      </div>
    );
  return (
    <section className="rounded-2xl border bg-white">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b p-5">
        <div>
          <h2 className="text-lg font-semibold">Kvartalsindberetninger</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Op til fem afsluttede kvartaler fra integrationens startdato ·{' '}
            {data?.organisation || 'Henter…'}
          </p>
          {data?.testMode && (
            <p className="mt-2 font-medium text-amber-700">
              Testtilstand — ingen endelig indberetning eller fakturering
            </p>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            disabled={busy || !data?.connected}
            onClick={() => void action({ action: 'sync' })}
          >
            <Download />
            Hent historik til indberetning
          </Button>
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => {
              setError('');
              void load().catch((e) => setError(e.message));
            }}
          >
            <RefreshCw />
            Opdatér status
          </Button>
        </div>
      </div>
      <p className="px-5 pt-4 text-xs text-muted-foreground">
        Indberetningspligtige mængder fra Forbrug for samme afsluttede kvartal.
        Klik på kvartalet for at se registreringerne. Manglende kundetype regnes
        som Privat. Linjer uden gyldig vægt eller afklaret indberetningspligt
        ignoreres.
      </p>
      {data?.providerError && (
        <p role="alert" className="m-5 rounded-xl bg-amber-50 p-4 text-sm">
          {data.providerError}
        </p>
      )}
      {error && (
        <p
          role="alert"
          className="m-5 rounded-xl bg-red-50 p-4 text-sm text-red-800"
        >
          {error}
        </p>
      )}
      {notice && (
        <output className="m-5 rounded-xl bg-green-50 p-4 text-sm text-green-800">
          {notice}
        </output>
      )}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[700px] text-sm">
          <thead className="bg-muted/30 text-left">
            <tr>
              <th className="p-4">Kvartal</th>
              <th className="p-4 text-right">I alt</th>
              <th className="p-4 text-right">Privat</th>
              <th className="p-4 text-right">Erhverv</th>
              <th className="p-4">Status</th>
              <th className="p-4">
                <span className="sr-only">Handling</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {data && visibleQuarters.length === 0 && (
              <tr>
                <td
                  colSpan={6}
                  className="p-6 text-center text-muted-foreground"
                >
                  Der er endnu ingen afsluttede kvartaler fra integrationens
                  startdato.
                </td>
              </tr>
            )}
            {visibleQuarters.map((q) => (
              <tr key={q.id} className="border-t">
                <td className="p-4 font-medium">
                  <button
                    className="text-left underline decoration-dotted underline-offset-4"
                    onClick={() => onShowConsumption?.(q.start, q.end)}
                  >
                    {q.label}
                  </button>
                </td>
                <td className="p-4 text-right tabular-nums">
                  {kg(q.reportableGrams)}
                </td>
                <td className="p-4 text-right tabular-nums">
                  {kg(q.householdGrams)}
                </td>
                <td className="p-4 text-right tabular-nums">
                  {kg(q.commercialGrams)}
                </td>
                <td className="max-w-64 p-4">
                  {q.submitted ? (
                    <span className="inline-flex items-center gap-2 text-green-800">
                      <CheckCircle2 className="size-4" />
                      Indberettet
                      {q.submittedAt ? ' ' + formatDate(q.submittedAt) : ''}
                    </span>
                  ) : (
                    q.reason ||
                    q.statusNote ||
                    (q.warning ? (
                      <span className="text-amber-800">
                        Klar til indberetning med advarsel: {q.warning}
                      </span>
                    ) : (
                      'Klar til indberetning'
                    ))
                  )}
                  {q.unresolved > 0 && (
                    <p className="mt-1 text-xs text-muted-foreground">
                      {q.unresolved} linjer ignoreret
                    </p>
                  )}
                </td>
                <td className="p-4 text-right">
                  {!q.submitted && (
                    <Button
                      disabled={busy || !q.canSubmit}
                      onClick={() =>
                        void action({ action: 'preview', quarter: q.id })
                      }
                    >
                      <Send />
                      {data?.testMode ? 'Test indberetning' : 'Indberet'}
                    </Button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {busy && <output className="px-5 pb-5 text-sm">Arbejder…</output>}
      {preview && (
        <Dialog
          open
          onOpenChange={(open) => {
            if (!open && !busy) setPreview(null);
          }}
        >
          <DialogContent showCloseButton={!busy}>
            <DialogTitle>Kontrollér {preview.quarter}</DialogTitle>
            <DialogDescription>
              {preview.organisation} ·{' '}
              {preview.testMode ? 'Testindberetning' : 'Endelig indberetning'}
            </DialogDescription>
            <dl className="my-5 space-y-3">
              <div className="flex justify-between">
                <dt>Privat</dt>
                <dd>{kg(preview.householdKg * 1000)}</dd>
              </div>
              <div className="flex justify-between">
                <dt>Erhverv</dt>
                <dd>{kg(preview.commercialKg * 1000)}</dd>
              </div>
            </dl>
            {preview.ignoredLines > 0 && (
              <div
                role="alert"
                className="mb-4 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950"
              >
                <p className="font-semibold">
                  Advarsel: {preview.ignoredLines}{' '}
                  {preview.ignoredLines === 1
                    ? 'leveringslinje mangler'
                    : 'leveringslinjer mangler'}{' '}
                  emballageoplysninger
                </p>
                <p className="mt-1">
                  De kommer ikke med i indberetningen, så mængderne ovenfor kan
                  være for lave. Udfyld vægten under fanen Varer for at få dem
                  med.
                </p>
                <label className="mt-3 flex items-start gap-2">
                  <input
                    type="checkbox"
                    className="mt-0.5"
                    checked={acceptIncomplete}
                    onChange={(e) => setAcceptIncomplete(e.target.checked)}
                  />
                  Jeg indberetter alligevel uden disse linjer.
                </label>
              </div>
            )}
            <p className="mb-5 text-sm">
              {preview.testMode
                ? 'Testen kontrollerer data uden at afslutte kvartalet.'
                : 'Bekræft, at mængderne er komplette og korrekte. Indberetningen bruges som grundlag for fakturering. Rettelser efter indberetning håndteres af udbyderen.'}
            </p>
            {error && (
              <p role="alert" className="mb-4 text-sm text-red-700">
                {error}
              </p>
            )}
            <div className="flex justify-end gap-2">
              <Button
                variant="outline"
                disabled={busy}
                onClick={() => setPreview(null)}
              >
                Annullér
              </Button>
              <Button
                disabled={
                  busy || (preview.ignoredLines > 0 && !acceptIncomplete)
                }
                onClick={() =>
                  void action({
                    action: 'submit',
                    quarter: preview.id,
                    token: preview.token,
                    acceptIncomplete:
                      preview.ignoredLines > 0 && acceptIncomplete,
                  })
                }
              >
                {busy
                  ? 'Sender…'
                  : preview.testMode
                    ? 'Bekræft test'
                    : 'Bekræft og indberet'}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </section>
  );
}
