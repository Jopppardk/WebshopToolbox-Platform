'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Activity, CheckCircle2, CircleDot, RefreshCw, SkipForward, TriangleAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

type JobStatus = 'running' | 'succeeded' | 'failed' | 'skipped';
type JobRun = { id: string; job_key: string; job_name: string; status: JobStatus; started_at: string; finished_at: string | null; duration_ms: number | null; message: string | null };
type Insights = { summary: { total: number; succeeded: number; failed: number; skipped: number; running: number }; latest: JobRun[]; runs: JobRun[]; pagination: { page: number; pageSize: number; total: number; until: string; since: string } };
const statusLabel: Record<JobStatus, string> = { running: 'Kører', succeeded: 'Gennemført', failed: 'Fejlet', skipped: 'Sprunget over' };
const statusClass: Record<JobStatus, string> = { running: 'border-blue-200 bg-blue-50 text-blue-800', succeeded: 'border-emerald-200 bg-emerald-50 text-emerald-800', failed: 'border-red-200 bg-red-50 text-red-800', skipped: 'border-stone-200 bg-stone-100 text-stone-700' };
const date = (value: string) => new Intl.DateTimeFormat('da-DK', { dateStyle: 'short', timeStyle: 'medium', timeZone: 'Europe/Copenhagen' }).format(new Date(value));
const duration = (value: number | null) => value === null ? '—' : value < 1000 ? `${value} ms` : value < 60000 ? `${(value / 1000).toLocaleString('da-DK', { maximumFractionDigits: 1 })} sek.` : `${(value / 60000).toLocaleString('da-DK', { maximumFractionDigits: 1 })} min.`;

export function JobInsights({ initialStatus = '' }: { initialStatus?: string }) {
  const [data, setData] = useState<Insights | null>(null), [busy, setBusy] = useState(true), [error, setError] = useState('');
  const [statusFilter, setStatusFilter] = useState(initialStatus), [page, setPage] = useState(1);
  const until = useRef('');
  const historyHeading = useRef<HTMLHeadingElement>(null);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    if (!initialStatus) return;
    const frame = window.requestAnimationFrame(() => {
      historyHeading.current?.focus({ preventScroll:true });
      historyHeading.current?.scrollIntoView({block:'start',behavior:'instant'});
    });
    return () => window.cancelAnimationFrame(frame);
  }, [initialStatus]);

  const refresh = useCallback(() => { setBusy(true); setError(''); setPage(1); until.current = ''; setRevision(value => value + 1); }, []);
  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams({ status: statusFilter, page: String(page), ...(until.current ? { until: until.current } : {}) });
    void (async () => {
      try {
        const response = await fetch(`/api/admin/insights?${params}`, { cache: 'no-store', signal: controller.signal });
        const result = await response.json() as Insights & { error?: string };
        if (!response.ok) throw new Error(result.error || 'Jobindsigten kunne ikke indlæses.');
        if (!controller.signal.aborted) { until.current = result.pagination.until; setData(result); }
      } catch (caught) {
        if (!controller.signal.aborted) setError(caught instanceof Error ? caught.message : 'Jobindsigten kunne ikke indlæses.');
      } finally { if (!controller.signal.aborted) setBusy(false); }
    })();
    return () => controller.abort();
  }, [statusFilter, page, revision]);
  useEffect(() => {
    if (page !== 1) return;
    const timer = window.setInterval(refresh, 60000);
    return () => window.clearInterval(timer);
  }, [page, refresh]);
  const selectStatus = (value: string) => { if (value === statusFilter && page === 1) return; setBusy(true); setError(''); setStatusFilter(value); setPage(1); };
  const showHistory = (status: string) => {
    selectStatus(status);
    window.requestAnimationFrame(() => {
      historyHeading.current?.focus({ preventScroll: true });
      historyHeading.current?.scrollIntoView({ block: 'start', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
    });
  };
  const total = data?.pagination.total || 0;
  const pages = Math.max(1, Math.ceil(total / 100));
  const successRate = useMemo(() => { const completed = (data?.summary.succeeded || 0) + (data?.summary.failed || 0); return completed ? Math.round((data!.summary.succeeded / completed) * 100) : 0; }, [data]);
  return <div className="mx-auto max-w-[1440px] px-5 py-7 md:px-8 md:py-9">
    <div className="mb-7 flex flex-wrap items-end justify-between gap-4"><div><p className="eyebrow">System · Drift</p><h1 className="mt-1 text-3xl font-semibold tracking-[-.035em]">Indsigt</h1><p className="mt-2 text-sm text-muted-foreground">Se alle automatiske jobs, deres seneste resultat og den fulde kørselslog.</p></div><Button variant="outline" onClick={refresh} disabled={busy}><RefreshCw className={busy ? 'animate-spin' : ''}/>{busy ? 'Opdaterer…' : 'Opdatér'}</Button></div>
    {error && <p role="alert" className="mb-5 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">{error}</p>}
    <div className="mb-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
      <Summary icon={<Activity/>} label="Kørsler seneste 24 timer" value={data?.summary.total ?? 0} onClick={() => showHistory('')} actionLabel="Vis alle kørsler i jobhistorikken" disabled={!data}/>
      <Summary icon={<CheckCircle2/>} label="Gennemført" value={data?.summary.succeeded ?? 0} tone="good" onClick={() => showHistory('succeeded')} actionLabel="Vis gennemførte kørsler i jobhistorikken" disabled={!data}/>
      <Summary icon={<TriangleAlert/>} label="Fejlet" value={data?.summary.failed ?? 0} tone="bad" onClick={() => showHistory('failed')} actionLabel="Vis fejlede kørsler i jobhistorikken" disabled={!data}/>
      <Summary icon={<SkipForward/>} label="Sprunget over" value={data?.summary.skipped ?? 0} onClick={() => showHistory('skipped')} actionLabel="Vis oversprungne kørsler i jobhistorikken" disabled={!data}/>
      <Summary icon={<CircleDot/>} label="Succesrate" value={`${successRate} %`} note="Af afsluttede kørsler" onClick={() => showHistory('succeeded')} actionLabel="Succesrate – vis gennemførte kørsler i jobhistorikken" disabled={!data}/>
    </div>
    <section className="mb-6 rounded-2xl border bg-white shadow-[0_12px_40px_rgba(23,31,27,.045)]"><div className="border-b p-5"><h2 className="font-semibold">Aktuelle jobs</h2><p className="mt-1 text-sm text-muted-foreground">Seneste registrerede kørsel for hvert job.</p></div><div className="grid gap-3 p-5 md:grid-cols-2 xl:grid-cols-3">{!busy && !data?.latest.length && <p className="text-sm text-muted-foreground">Der er endnu ingen registrerede jobkørsler. De vises efter næste planlagte synkronisering.</p>}{data?.latest.map(run => <article key={run.job_key} className="rounded-xl border p-4"><div className="flex items-start justify-between gap-3"><div><p className="font-medium">{run.job_name}</p><p className="mt-1 text-xs text-muted-foreground">{date(run.started_at)} · {duration(run.duration_ms)}</p></div><Status status={run.status}/></div>{run.message && <p className="mt-3 text-sm text-muted-foreground">{run.message}</p>}</article>)}</div></section>
    <section className="overflow-hidden rounded-2xl border bg-white shadow-[0_12px_40px_rgba(23,31,27,.045)]"><div className="border-b p-5"><h2 ref={historyHeading} tabIndex={-1} className="scroll-mt-6 font-semibold focus-visible:outline-2 focus-visible:outline-offset-4">Jobhistorik</h2><p className="mt-1 text-sm text-muted-foreground">Kørsler fra de seneste 24 timer, vist 100 ad gangen.</p>
      <fieldset className="mt-4 flex flex-wrap gap-2"><legend className="sr-only">Filtrér jobhistorik efter status</legend>
        <Button size="sm" variant={statusFilter === '' ? 'default' : 'outline'} aria-pressed={statusFilter === ''} onClick={() => selectStatus('')}>Alle</Button>
        {(['succeeded', 'failed', 'running', 'skipped'] as JobStatus[]).map(status => <Button key={status} size="sm" variant={statusFilter === status ? 'default' : 'outline'} aria-pressed={statusFilter === status} onClick={() => selectStatus(status)}>{statusLabel[status]}</Button>)}
      </fieldset>
      {data && <p className="mt-3 text-xs text-muted-foreground">Tidsvindue: {date(data.pagination.since)} – {date(data.pagination.until)}. Opdatér henter det nyeste døgn og går til side 1.</p>}
      </div><div className="overflow-x-auto" aria-busy={busy}><Table><TableHeader><TableRow className="bg-muted/45 hover:bg-muted/45"><TableHead className="pl-5">Job</TableHead><TableHead>Start</TableHead><TableHead>Varighed</TableHead><TableHead>Status</TableHead><TableHead>Besked</TableHead></TableRow></TableHeader><TableBody>{busy && <TableRow><TableCell colSpan={5} className="p-10 text-center">Henter jobhistorik…</TableCell></TableRow>}{!busy && !error && !data?.runs.length && <TableRow><TableCell colSpan={5} className="p-10 text-center text-muted-foreground">Ingen kørsler med denne status i det valgte døgn.</TableCell></TableRow>}{!busy && !error && data?.runs.map(run => <TableRow key={run.id}><TableCell className="pl-5 font-medium">{run.job_name}</TableCell><TableCell className="whitespace-nowrap">{date(run.started_at)}</TableCell><TableCell>{duration(run.duration_ms)}</TableCell><TableCell><Status status={run.status}/></TableCell><TableCell className="max-w-[430px] text-sm text-muted-foreground">{run.message || '—'}</TableCell></TableRow>)}</TableBody></Table></div>
      <nav aria-label="Sider i jobhistorikken" className="flex flex-wrap items-center justify-between gap-3 border-t p-5">
        <output className="text-sm text-muted-foreground">{busy ? 'Henter…' : error ? 'Historikken kunne ikke hentes.' : `Viser ${total ? (page - 1) * 100 + 1 : 0}–${Math.min(page * 100, total)} af ${total} kørsler · Side ${page} af ${pages}`}</output>
        <div className="flex gap-2"><Button variant="outline" disabled={busy || Boolean(error) || page <= 1} onClick={() => { setBusy(true); setError(''); setPage(value => value - 1); }}>Forrige</Button><Button variant="outline" disabled={busy || Boolean(error) || page >= pages} onClick={() => { setBusy(true); setError(''); setPage(value => value + 1); }}>Næste</Button></div>
      </nav></section>
  </div>;
}

function Status({ status }: { status: JobStatus }) { return <Badge variant="outline" className={statusClass[status]}>{statusLabel[status]}</Badge>; }
function Summary({ icon, label, value, note, tone, onClick, actionLabel, disabled }: { icon: ReactNode; label: string; value: string | number; note?: string; tone?: 'good' | 'bad'; onClick: () => void; actionLabel: string; disabled: boolean }) {
  return <button type="button" onClick={onClick} disabled={disabled} aria-label={`${actionLabel}: ${value}`} title={actionLabel} className="stat-card flex min-h-40 w-full cursor-pointer flex-col items-center justify-center text-center transition-colors hover:bg-muted/40 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring disabled:cursor-wait disabled:opacity-60">
    <span className={`mb-3 grid size-9 shrink-0 place-items-center rounded-lg ${tone === 'good' ? 'bg-emerald-50 text-emerald-700' : tone === 'bad' ? 'bg-red-50 text-red-700' : 'bg-[#f1e7d7] text-[#6d5430]'}`}>{icon}</span>
    <span className="text-xs text-muted-foreground">{label}</span><span className="mt-1 text-2xl font-semibold">{value}</span>
    <span className="mt-1 min-h-4 text-xs text-muted-foreground">{note || '\u00a0'}</span>
  </button>;
}
