'use client';

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Activity, CheckCircle2, CircleDot, RefreshCw, TriangleAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

type JobStatus = 'running' | 'succeeded' | 'failed' | 'skipped';
type JobRun = { id: string; job_key: string; job_name: string; status: JobStatus; started_at: string; finished_at: string | null; duration_ms: number | null; message: string | null };
type Insights = { summary: { total: number; succeeded: number; failed: number; skipped: number; running: number }; latest: JobRun[]; runs: JobRun[] };
const statusLabel: Record<JobStatus, string> = { running: 'Kører', succeeded: 'Gennemført', failed: 'Fejlet', skipped: 'Sprunget over' };
const statusClass: Record<JobStatus, string> = { running: 'border-blue-200 bg-blue-50 text-blue-800', succeeded: 'border-emerald-200 bg-emerald-50 text-emerald-800', failed: 'border-red-200 bg-red-50 text-red-800', skipped: 'border-stone-200 bg-stone-100 text-stone-700' };
const date = (value: string) => new Intl.DateTimeFormat('da-DK', { dateStyle: 'short', timeStyle: 'medium', timeZone: 'Europe/Copenhagen' }).format(new Date(value));
const duration = (value: number | null) => value === null ? '—' : value < 1000 ? `${value} ms` : value < 60000 ? `${(value / 1000).toLocaleString('da-DK', { maximumFractionDigits: 1 })} sek.` : `${(value / 60000).toLocaleString('da-DK', { maximumFractionDigits: 1 })} min.`;

export function JobInsights() {
  const [data, setData] = useState<Insights | null>(null), [busy, setBusy] = useState(true), [error, setError] = useState('');
  const load = useCallback(async (showSpinner = true) => {
    if (showSpinner) setBusy(true); setError('');
    try { const response = await fetch('/api/admin/insights', { cache: 'no-store' }); const result = await response.json() as Insights & { error?: string }; if (!response.ok) throw new Error(result.error || 'Jobindsigten kunne ikke indlæses.'); setData(result); }
    catch (caught) { setError(caught instanceof Error ? caught.message : 'Jobindsigten kunne ikke indlæses.'); }
    finally { if (showSpinner) setBusy(false); }
  }, []);
  useEffect(() => { void load(); const timer = window.setInterval(() => void load(false), 60000); return () => window.clearInterval(timer); }, [load]);
  const successRate = useMemo(() => { const completed = (data?.summary.succeeded || 0) + (data?.summary.failed || 0); return completed ? Math.round((data!.summary.succeeded / completed) * 100) : 0; }, [data]);
  return <div className="mx-auto max-w-[1440px] px-5 py-7 md:px-8 md:py-9">
    <div className="mb-7 flex flex-wrap items-end justify-between gap-4"><div><p className="eyebrow">System · Drift</p><h1 className="mt-1 text-3xl font-semibold tracking-[-.035em]">Indsigt</h1><p className="mt-2 text-sm text-muted-foreground">Se alle automatiske jobs, deres seneste resultat og den fulde kørselslog.</p></div><Button variant="outline" onClick={() => void load()} disabled={busy}><RefreshCw className={busy ? 'animate-spin' : ''}/>{busy ? 'Opdaterer…' : 'Opdatér'}</Button></div>
    {error && <p role="alert" className="mb-5 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">{error}</p>}
    <div className="mb-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><Summary icon={<Activity/>} label="Kørsler seneste 24 timer" value={data?.summary.total ?? 0}/><Summary icon={<CheckCircle2/>} label="Gennemført" value={data?.summary.succeeded ?? 0} tone="good"/><Summary icon={<TriangleAlert/>} label="Fejlet" value={data?.summary.failed ?? 0} tone="bad"/><Summary icon={<CircleDot/>} label="Succesrate" value={`${successRate} %`} note="Af afsluttede kørsler"/></div>
    <section className="mb-6 rounded-2xl border bg-white shadow-[0_12px_40px_rgba(23,31,27,.045)]"><div className="border-b p-5"><h2 className="font-semibold">Aktuelle jobs</h2><p className="mt-1 text-sm text-muted-foreground">Seneste registrerede kørsel for hvert job.</p></div><div className="grid gap-3 p-5 md:grid-cols-2 xl:grid-cols-3">{!busy && !data?.latest.length && <p className="text-sm text-muted-foreground">Der er endnu ingen registrerede jobkørsler. De vises efter næste planlagte synkronisering.</p>}{data?.latest.map(run => <article key={run.job_key} className="rounded-xl border p-4"><div className="flex items-start justify-between gap-3"><div><p className="font-medium">{run.job_name}</p><p className="mt-1 text-xs text-muted-foreground">{date(run.started_at)} · {duration(run.duration_ms)}</p></div><Status status={run.status}/></div>{run.message && <p className="mt-3 text-sm text-muted-foreground">{run.message}</p>}</article>)}</div></section>
    <section className="overflow-hidden rounded-2xl border bg-white shadow-[0_12px_40px_rgba(23,31,27,.045)]"><div className="border-b p-5"><h2 className="font-semibold">Jobhistorik</h2><p className="mt-1 text-sm text-muted-foreground">De seneste 100 kørsler på tværs af systemet.</p></div><div className="overflow-x-auto"><Table><TableHeader><TableRow className="bg-muted/45 hover:bg-muted/45"><TableHead className="pl-5">Job</TableHead><TableHead>Start</TableHead><TableHead>Varighed</TableHead><TableHead>Status</TableHead><TableHead>Besked</TableHead></TableRow></TableHeader><TableBody>{!busy && !data?.runs.length && <TableRow><TableCell colSpan={5} className="p-10 text-center text-muted-foreground">Ingen jobkørsler er registreret endnu.</TableCell></TableRow>}{data?.runs.map(run => <TableRow key={run.id}><TableCell className="pl-5 font-medium">{run.job_name}</TableCell><TableCell className="whitespace-nowrap">{date(run.started_at)}</TableCell><TableCell>{duration(run.duration_ms)}</TableCell><TableCell><Status status={run.status}/></TableCell><TableCell className="max-w-[430px] text-sm text-muted-foreground">{run.message || '—'}</TableCell></TableRow>)}</TableBody></Table></div></section>
  </div>;
}

function Status({ status }: { status: JobStatus }) { return <Badge variant="outline" className={statusClass[status]}>{statusLabel[status]}</Badge>; }
function Summary({ icon, label, value, note, tone }: { icon: ReactNode; label: string; value: string | number; note?: string; tone?: 'good' | 'bad' }) { return <div className="stat-card"><div className={`mb-3 grid size-9 place-items-center rounded-lg ${tone === 'good' ? 'bg-emerald-50 text-emerald-700' : tone === 'bad' ? 'bg-red-50 text-red-700' : 'bg-[#f1e7d7] text-[#6d5430]'}`}>{icon}</div><p className="text-xs text-muted-foreground">{label}</p><p className="mt-1 text-2xl font-semibold">{value}</p>{note && <p className="mt-1 text-xs text-muted-foreground">{note}</p>}</div>; }
