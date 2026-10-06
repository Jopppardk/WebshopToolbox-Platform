'use client';
import { tier1Fetch as fetch } from '@/platform/transport';
import { useCallback, useEffect, useRef, useState } from 'react';

type Status = {
  automatic?: boolean;
  intervalMinutes: number;
  serverNow: number;
  status: 'running' | 'succeeded' | 'failed' | 'interrupted' | 'unknown';
  startedAt: string | null;
  finishedAt: string | null;
  blockedUntil: number | null;
};
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
    const controller = new AbortController();
    request.current = controller;
    try {
      const response = await fetch('/api/admin/sync-status', {
        cache: 'no-store',
        signal: AbortSignal.any([
          controller.signal,
          AbortSignal.timeout(10000),
        ]),
      });
      if (!response.ok) throw new Error('Status unavailable');
      const data = (await response.json()) as Status;
      if (controller.signal.aborted) return;
      setStatus(data);
      setClockOffset(data.serverNow - Date.now());
      setError(false);
      if (data.finishedAt && data.finishedAt !== lastFinish.current) {
        if (initialized.current) setRevision((value) => value + 1);
        lastFinish.current = data.finishedAt;
      }
      initialized.current = true;
    } catch {
      if (!controller.signal.aborted) setError(true);
    }
  }, []);
  useEffect(() => {
    const initial = window.setTimeout(() => {
      void refresh();
    }, 0);
    const timer = window.setInterval(() => {
      if (!document.hidden) void refresh();
    }, 15000);
    const visible = () => {
      if (!document.hidden) void refresh();
    };
    document.addEventListener('visibilitychange', visible);
    return () => {
      window.clearTimeout(initial);
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', visible);
      request.current?.abort();
    };
  }, [refresh]);
  return { status, error, clockOffset, revision, refresh };
}
