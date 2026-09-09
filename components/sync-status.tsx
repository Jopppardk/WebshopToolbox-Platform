'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Clock3 } from 'lucide-react';
import { millisecondsToNextRun } from '@/lib/sync-schedule';

type Status = { intervalMinutes: number; serverNow: number; status: 'running' | 'succeeded' | 'failed' | 'interrupted' | 'unknown'; startedAt: string | null; finishedAt: string | null; blockedUntil: number | null };
export function useSyncStatus() {
  const [status, setStatus] = useState<Status | null>(null);
  const [error, setError] = useState(false);
  const [revision, setRevision] = useState(0);
  const [clockOffset, setClockOffset] = useState(0);
  const lastFinish = useRef<string | null>(null);
  const initialized = useRef(false);
  const request = useRef<AbortController | null>(null);
  const refresh = useCallback(async () => {
    request.current?.abort();
    const controller = new AbortController(); request.current = controller;
    try {
      const response = await fetch('/api/admin/sync-status', { cache: 'no-store', signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10000)]) });
      if (!response.ok) throw new Error('Status unavailable');
      const data = await response.json() as Status;
      if (controller.signal.aborted) return;
      setStatus(data); setClockOffset(data.serverNow - Date.now()); setError(false);
      if (data.finishedAt && data.finishedAt !== lastFinish.current) {
        if (initialized.current) setRevision(value => value + 1);
        lastFinish.current = data.finishedAt;
      }
      initialized.current = true;
    } catch { if (!controller.signal.aborted) setError(true); }
  }, []);
  useEffect(() => {
    const initial = window.setTimeout(() => { void refresh(); }, 0);
    const timer = window.setInterval(() => { if (!document.hidden) void refresh(); }, 15000);
    const visible = () => { if (!document.hidden) void refresh(); };
    document.addEventListener('visibilitychange', visible);
    return () => { window.clearTimeout(initial); window.clearInterval(timer); document.removeEventListener('visibilitychange', visible); request.current?.abort(); };
  }, [refresh]);
  return { status, error, clockOffset, revision, refresh };
}
export function SyncStatus({ state, mobile = false }: { state: ReturnType<typeof useSyncStatus>; mobile?: boolean }) {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 1000); return () => window.clearInterval(timer); }, []);
  const { status, error, clockOffset } = state;
  const time = (value: string | null) => value ? new Date(value).toLocaleTimeString('da-DK', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : 'Ingen registreret';
  const seconds = status && now ? Math.ceil(millisecondsToNextRun(now + clockOffset, status.intervalMinutes) / 1000) : null;
  const countdown = seconds === null ? '—' : `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
  const label = error ? 'Status kan ikke hentes' : !status ? 'Henter status…' : status.status === 'running' ? 'Synkronisering i gang' : status.status === 'failed' ? 'Afsluttet med fejl · se Indsigt' : status.status === 'interrupted' ? 'Kørsel afbrudt · afventer næste start' : status.status === 'unknown' ? 'Ingen kørsel bekræftet endnu' : 'Seneste kørsel afsluttet';
  return <div className={mobile ? 'fixed bottom-4 left-4 z-40 max-w-[90vw] rounded-xl border bg-[#232323] p-3 text-xs text-white shadow-xl lg:hidden' : 'mx-4 mb-4 rounded-xl border border-white/10 bg-white/5 p-3 text-xs'}>
    <p className="flex items-center gap-2 font-medium"><Clock3 className="size-4 shrink-0 text-[#c09960]" />{label}</p>
    {status && !error && <div className="mt-2 space-y-1 text-[11px]">
      <p>Gemt interval: {status.intervalMinutes} min.</p>
      {status.status === 'running' ? <p>Næste kørsel afventer den igangværende.</p> : status.blockedUntil && now && status.blockedUntil > now + clockOffset ? <p>Sikkerhedspause indtil {time(new Date(status.blockedUntil).toISOString())}</p> : <p>Næste planlagte start om {countdown}</p>}
      {!mobile && <><p>Senest startet: {time(status.startedAt)}</p><p>Senest afsluttet: {time(status.finishedAt)}</p><p className="opacity-70">Planlagt tid er ikke en bekræftet start.</p></>}
    </div>}
  </div>;
}
