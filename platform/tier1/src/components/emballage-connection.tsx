'use client';
import { tier1Fetch as fetch, tier1Url } from '@/platform/transport';
import { useState, useEffect } from 'react';
import { PackageCheck, Save } from 'lucide-react';
import type {ReactNode} from 'react';
import {IntegrationCard} from '@/components/integration-card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { emptyEIConfig, type EIConfig } from '@/lib/emballage-reporting';
import type { EIReport, EISchema } from '@/lib/emballage-api';
type Status = {
  connected: boolean;
  testMode?: boolean;
  organisation?: string;
  config: EIConfig;
  responsibilities?: Array<{ code: string }>;
  reports?: EIReport[];
  error?: string;
};
export function EmballageConnection({
  initialExpanded = false,
  onConnected,
  footer,
}: {
  initialExpanded?: boolean;
  footer?: ReactNode;
  onConnected: () => void;
}) {
  const [open, setOpen] = useState(initialExpanded),
    [status, setStatus] = useState<Status | null>(null),
    [config, setConfig] = useState<EIConfig>(emptyEIConfig),
    [apiKey, setApiKey] = useState(''),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(''),
    [error, setError] = useState(''),
    [reportId, setReportId] = useState(''),
    [schema, setSchema] = useState<EISchema | null>(null),
    [mapping, setMapping] = useState({ household: '', commercial: '' });
  async function load() {
    const r = await fetch('/api/emballage/connection', { cache: 'no-store' }),
      d = (await r.json()) as Status;
    if (!r.ok) throw Error(d.error);
    setStatus(d);
    setConfig({
      ...d.config,
      responsibility:
        d.config.responsibility ||
        (d.responsibilities?.length === 1 ? d.responsibilities[0].code : ''),
    });
  }
  useEffect(() => {
    const timer=window.setTimeout(()=>{void load().catch((e) => setError(e.message));},0);
    return ()=>window.clearTimeout(timer);
  }, []);
  async function act(body: unknown) {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const r = await fetch('/api/emballage/connection', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        }),
        d = (await r.json()) as { error?: string };
      if (!r.ok) throw Error(d.error);
      setApiKey('');
      await load();
      onConnected();
      setMessage('Forbindelsen og indstillingerne er gemt.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Kunne ikke gemme.');
    } finally {
      setBusy(false);
    }
  }
  async function chooseReport(id: string) {
    setReportId(id);
    setSchema(null);
    setMapping({ household: '', commercial: '' });
    if (!id) return;
    setBusy(true);
    setError('');
    try {
      const r = await fetch('/api/emballage/connection?reportId=' + id, {
          cache: 'no-store',
        }),
        d = (await r.json()) as { schema: EISchema; error?: string };
      if (!r.ok) throw Error(d.error);
      setSchema(d.schema);
      setMapping(
        config.mappings[String(d.schema.form_version_id)] || {
          household: '',
          commercial: '',
        },
      );
    } catch (e) {
      setError(
        e instanceof Error ? e.message : 'Formularen kunne ikke hentes.',
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <IntegrationCard name="Emballage Indberetning" description="Kvartalsvis indberetning under 8.000 kg" icon={PackageCheck} connected={status?.connected??null} testMode={status?.testMode} expanded={open} onToggle={()=>setOpen(!open)} panelId="emballage-connection-panel" footer={footer}>
          {status?.connected&&<p className="text-sm">Forbundet til {status.organisation}.</p>}
          <label htmlFor="emballage-api-key" className="block text-sm">
            API-nøgle
            <Input
              id="emballage-api-key" type="password"
              autoComplete="off"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="esk_… . secret"
            />
          </label>
          <Button
            disabled={busy || !apiKey}
            onClick={() => void act({ action: 'connect', apiKey })}
          >
            {busy ? 'Arbejder…' : 'Validér og gem forbindelse'}
          </Button>
          {status?.connected && (
            <>
              <p className="text-xs text-muted-foreground">
                Nøglen opbevares krypteret.{' '}
                {status.testMode
                  ? 'Testnøgle tilsluttet. Dev henter data, men sender ingen indberetninger.'
                  : 'Dev henter og viser data. Ekstern indberetning er blokeret.'}
              </p>
              <label htmlFor="emballage-start" className="block text-sm">
                Startdato
                <Input
                  id="emballage-start" type="date"
                  value={config.startDate}
                  onChange={(e) =>
                    setConfig({ ...config, startDate: e.target.value })
                  }
                />
                <span className="text-xs text-muted-foreground">
                  Første dag i det første kvartal, der skal indberettes.
                </span>
              </label>
              <label className="block text-sm">
                Producentansvar
                <select
                  className="mt-1 h-10 w-full rounded-lg border bg-white px-3"
                  value={config.responsibility}
                  onChange={(e) => {
                    setConfig({ ...config, responsibility: e.target.value });
                    setReportId('');
                    setSchema(null);
                  }}
                >
                  <option value="">Vælg</option>
                  {status.responsibilities?.map((r) => (
                    <option key={r.code} value={r.code}>
                      {r.code}
                    </option>
                  ))}
                </select>
              </label>
              <div className="rounded-xl border bg-white p-3">
                <p className="text-sm font-medium">Erhvervsordrer identificeres ved Company name</p>
                <p className="mt-2 text-xs text-muted-foreground">Et udfyldt firmanavn på fakturerings- eller leveringsadressen betyder erhverv. Ellers husholdning. Hent historikken igen på fanen Indberetning for at opdatere tidligere ordrer.</p>
              </div>
              <label className="block text-sm">
                Formular til feltopsætning
                <select
                  className="mt-1 h-10 w-full rounded-lg border bg-white px-3"
                  value={reportId}
                  disabled={busy}
                  onChange={(e) => void chooseReport(e.target.value)}
                >
                  <option value="">Vælg kvartal</option>
                  {status.reports
                    ?.filter(
                      (r) => r.responsibility.code === config.responsibility,
                    )
                    .map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.period.label}
                      </option>
                    ))}
                </select>
              </label>
              {schema && (
                <div className="grid gap-3 sm:grid-cols-2">
                  {(['household', 'commercial'] as const).map((a) => (
                    <label key={a} className="text-sm">
                      {a === 'household' ? 'Husholdning (kg)' : 'Erhverv (kg)'}
                      <select
                        className="mt-1 h-10 w-full rounded-lg border bg-white px-3"
                        value={mapping[a]}
                        onChange={(e) =>
                          setMapping({ ...mapping, [a]: e.target.value })
                        }
                      >
                        <option value="">Vælg modtagerfelt</option>
                        {schema.fields
                          .filter(
                            (f) =>
                              f.type === 'number' &&
                              f.unit?.trim().toLowerCase() === 'kg',
                          )
                          .map((f) => (
                            <option key={f.name} value={f.name}>
                              {f.label.da || f.label.en || f.name}
                            </option>
                          ))}
                      </select>
                    </label>
                  ))}
                </div>
              )}
              <Button
                disabled={busy}
                onClick={() =>
                  void act({
                    action: 'settings',
                    config,
                    ...(schema ? { reportId: Number(reportId), mapping } : {}),
                  })
                }
              >
                <Save />
                Gem indstillinger
              </Button>
            </>
          )}
          {error && (
            <p role="alert" className="text-sm text-red-700">
              {error}
            </p>
          )}
          {message && (
            <output  className="text-sm text-green-800">
              {message}
            </output>
          )}
    </IntegrationCard>
  );
}
