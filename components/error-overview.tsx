'use client';
import { useCallback, useEffect, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
type FailureDetails = { severity?: 'warning'|'alarm'; category?: string; cause?: string; action?: string; reference?: string | null; occurrenceCount?: number };
type Failure = { id: number; source: string; message: string; details?: FailureDetails | null; created_at: string };
export function ErrorOverview({ onCountChange }: { onCountChange?: (count: number) => void }) {
  const [errors, setErrors] = useState<Failure[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState('');
  const [resolving, setResolving] = useState<number | null>(null);
  const [notifications, setNotifications] = useState({ enabled: false, warnings:false, alarms:false, email: '' });
  const [savingNotifications, setSavingNotifications] = useState(false);
  const [notificationMessage, setNotificationMessage] = useState('');
  const [expanded, setExpanded] = useState<number | null>(null);
  const refresh = useCallback(async () => {
    setLoading(true); setMessage('');
    try {
      const response = await fetch('/api/admin/errors', { cache: 'no-store' });
      const data = await response.json() as { errors: Failure[]; openCount?: number; notifications?: { enabled: boolean; warnings:boolean; alarms:boolean; email: string }; error?: string };
      if (!response.ok) throw new Error(data.error);
      setErrors(data.errors); if (data.notifications) setNotifications(data.notifications); onCountChange?.(data.openCount ?? data.errors.length);
    } catch { setMessage('Fejloversigten kunne ikke indlæses. Prøv Opdatér.'); }
    finally { setLoading(false); }
  }, [onCountChange]);
  useEffect(() => { void refresh(); }, [refresh]);
  async function resolve(id: number) {
    setResolving(id);
    try {
      const response = await fetch('/api/admin/errors', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) });
      if (!response.ok) throw new Error();
      await refresh();
    } catch { setMessage('Fejlen kunne ikke markeres håndteret. Prøv igen.'); }
    finally { setResolving(null); }
  }
  async function saveNotifications() {
    setSavingNotifications(true); setNotificationMessage('');
    try {
      const response = await fetch('/api/admin/errors', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'notifications', ...notifications }) });
      const data = await response.json() as { notifications?: { enabled: boolean; warnings:boolean; alarms:boolean; email: string }; error?: string };
      if (!response.ok || !data.notifications) throw new Error(data.error);
      setNotifications(data.notifications); setNotificationMessage('Mailindstillingerne er gemt.');
    } catch (error) { setNotificationMessage(error instanceof Error && error.message ? error.message : 'Mailindstillingerne kunne ikke gemmes.'); }
    finally { setSavingNotifications(false); }
  }
  return <section className="mb-8 rounded-2xl border bg-white p-5" aria-busy={loading}>
    <div className="flex items-center justify-between gap-3"><h2 className="text-lg font-semibold">Advarsler og alarmer</h2><Button variant="outline" onClick={refresh} disabled={loading}>Opdatér</Button></div>
    <p className="mt-2 text-sm text-muted-foreground">Seneste 20 åbne beskeder. Advarsler genforsøges automatisk; alarmer kræver din handling. Bekræftet bogføring lukker den tilhørende besked. Markér håndteret lukker kun beskeden og starter ikke et nyt forsøg.</p>
    <div className="mt-4 rounded-xl border bg-muted/20 p-4"><div className="flex flex-col gap-4 sm:flex-row sm:flex-wrap sm:items-end"><div className="flex-1"><label htmlFor="error-notification-email" className="text-sm font-medium">Mailadresse til driftsbeskeder</label><Input id="error-notification-email" className="mt-1" type="email" autoComplete="email" value={notifications.email} onChange={event => setNotifications(current => ({ ...current, email: event.target.value }))} placeholder="navn@sablen.dk"/><p className="mt-1 text-xs text-muted-foreground">Der sendes én mail pr. ny besked af de valgte typer og ved ændring fra advarsel til alarm. Gentagelser samles. Mailen indeholder et link til årsag og næste skridt.</p></div><div className="flex items-center justify-between gap-3 sm:pb-2"><span className="text-sm font-medium">Mail ved advarsler</span><Switch checked={notifications.warnings} onCheckedChange={warnings => setNotifications(current => ({ ...current, warnings }))} aria-label="Mail ved advarsler"/></div><div className="flex items-center justify-between gap-3 sm:pb-2"><span className="text-sm font-medium">Mail ved alarmer</span><Switch checked={notifications.alarms} onCheckedChange={alarms => setNotifications(current => ({ ...current, alarms }))} aria-label="Mail ved alarmer"/></div><Button onClick={saveNotifications} disabled={savingNotifications}>{savingNotifications ? 'Gemmer…' : 'Gem mailindstillinger'}</Button></div>{notificationMessage && <p role="status" className="mt-3 text-sm">{notificationMessage}</p>}</div>
    {message ? <p role="alert" className="mt-3 text-sm text-red-700">{message}</p> : loading ? <p className="mt-3 text-sm">Indlæser…</p> : !errors.length ? <p className="mt-3 text-sm">Ingen åbne advarsler eller alarmer.</p> : <ul className="mt-4 divide-y">{errors.map(error => {
      const isOpen = expanded === error.id;
      return <li key={error.id} className="py-4">
        <div className="flex flex-col justify-between gap-3 sm:flex-row">
          <button type="button" className="flex min-w-0 flex-1 items-start justify-between gap-3 text-left" onClick={() => setExpanded(isOpen ? null : error.id)} aria-expanded={isOpen}>
            <span className="min-w-0"><span className={`mb-1 block text-xs font-semibold ${error.details?.severity==='warning'?'text-amber-700':'text-red-700'}`}>{error.details?.severity==='warning'?'Advarsel · Automatisk genforsøg':'Alarm · Kræver manuel handling'}</span><span className="font-medium">{error.source}</span><span className="mt-1 block break-words text-sm">{error.details?.cause || error.message}</span><span className="mt-2 block text-sm"><strong>Næste skridt: </strong>{error.details?.action || 'Åbn det berørte modul, kontrollér årsagen og prøv igen.'}</span><span className="mt-1 block text-sm text-muted-foreground">{new Intl.DateTimeFormat('da-DK', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Europe/Copenhagen' }).format(new Date(error.created_at.includes('T') ? error.created_at : error.created_at.replace(' ', 'T') + 'Z'))}{(error.details?.occurrenceCount || 0) > 1 ? ` · Gentaget ${error.details?.occurrenceCount} gange` : ''}</span></span>
            <ChevronDown className={`mt-1 size-4 shrink-0 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
          </button>
          <Button variant="outline" disabled={resolving !== null} onClick={() => resolve(error.id)}>{resolving === error.id ? 'Gemmer…' : 'Markér håndteret'}</Button>
        </div>
        {isOpen && <div className="mt-3 rounded-xl border bg-muted/20 p-4 text-sm"><dl className="grid gap-3 sm:grid-cols-2"><div><dt className="text-xs font-medium text-muted-foreground">Kategori</dt><dd className="mt-1 capitalize">{error.details?.category || 'Ældre fejl'}</dd></div>{error.details?.reference && <div><dt className="text-xs font-medium text-muted-foreground">Reference</dt><dd className="mt-1 break-words">{error.details.reference}</dd></div>}<div className="sm:col-span-2"><dt className="text-xs font-medium text-muted-foreground">Anbefalet handling</dt><dd className="mt-1">{error.details?.action || 'Åbn det berørte modul og prøv igen.'}</dd></div></dl></div>}
      </li>;
    })}</ul>}
  </section>;
}

