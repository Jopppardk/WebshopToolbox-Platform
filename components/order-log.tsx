'use client';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import type { OrderLogEvent } from '@/lib/order-log';
export function OrderLog({ externalId }: { externalId: string }) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<{ name: string; events: OrderLogEvent[] } | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    setData(null); setError('');
    void (async () => {
      try {
        const response = await fetch('/api/sales/log?externalId=' + encodeURIComponent(externalId), { cache: 'no-store', signal: controller.signal });
        const body = await response.json() as { name: string; events: OrderLogEvent[]; error?: string };
        if (!response.ok) throw new Error(body.error || 'Ordreloggen kunne ikke hentes.');
        setData(body);
      } catch (e) { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : 'Ordreloggen kunne ikke hentes.'); }
    })();
    return () => controller.abort();
  }, [open, externalId]);
  return <>
    <Button size="sm" variant="outline" onClick={() => setOpen(true)}>Log</Button>
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader><DialogTitle>Ordrelog {data?.name || ''}</DialogTitle><DialogDescription>Gemte hændelser og seneste status. Alle tider vises i dansk tid. Tidligere forsøg og statusændringer er ikke nødvendigvis bevaret.</DialogDescription></DialogHeader>
        {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
        {!data && !error && <p role="status" className="text-sm text-muted-foreground">Henter ordrelog…</p>}
        {data && <ol className="ml-2 border-l space-y-5 py-2">{data.events.map((event, i) => <li key={i} className="relative pl-5">
          <span className={'absolute -left-1.5 top-1.5 size-3 rounded-full border-2 border-white ' + (event.tone === 'success' ? 'bg-emerald-500' : event.tone === 'warning' ? 'bg-amber-500' : 'bg-slate-400')} />
          <p className="text-sm font-medium">{event.title}</p>
          <p className="text-xs text-muted-foreground">{event.at ? <time dateTime={event.at}>{new Intl.DateTimeFormat('da-DK', { dateStyle: 'medium', timeStyle: 'medium', timeZone: 'Europe/Copenhagen' }).format(new Date(event.at))}</time> : 'Intet registreret tidspunkt'}</p>
          {event.detail && <p className="mt-1 text-sm text-muted-foreground">{event.detail}</p>}
        </li>)}</ol>}
      </DialogContent>
    </Dialog>
  </>;
}
