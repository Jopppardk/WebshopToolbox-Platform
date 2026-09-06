'use client';
import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
type Failure = { id: number; source: string; message: string; created_at: string };
export function ErrorOverview({ onCountChange }: { onCountChange?: (count: number) => void }) {
  const [errors, setErrors] = useState<Failure[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState('');
  const [resolving, setResolving] = useState<number | null>(null);
  const [notifications, setNotifications] = useState({ enabled: false, email: '' });
  const [savingNotifications, setSavingNotifications] = useState(false);
  const [notificationMessage, setNotificationMessage] = useState('');
  const refresh = useCallback(async () => {
    setLoading(true); setMessage('');
    try {
      const response = await fetch('/api/admin/errors', { cache: 'no-store' });
      const data = await response.json() as { errors: Failure[]; openCount?: number; notifications?: { enabled: boolean; email: string }; error?: string };
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
      const data = await response.json() as { notifications?: { enabled: boolean; email: string }; error?: string };
      if (!response.ok || !data.notifications) throw new Error(data.error);
      setNotifications(data.notifications); setNotificationMessage('Mailadvarslen er gemt.');
    } catch (error) { setNotificationMessage(error instanceof Error && error.message ? error.message : 'Mailadvarslen kunne ikke gemmes.'); }
    finally { setSavingNotifications(false); }
  }
  return <section className="mb-8 rounded-2xl border bg-white p-5" aria-busy={loading}>
    <div className="flex items-center justify-between gap-3"><h2 className="text-lg font-semibold">Fejloversigt</h2><Button variant="outline" onClick={refresh} disabled={loading}>Opdatér</Button></div>
    <p className="mt-2 text-sm text-muted-foreground">Seneste 20 åbne fejl. Markering som håndteret skjuler meddelelsen — det genforsøger ikke handlingen.</p>
    <div className="mt-4 rounded-xl border bg-muted/20 p-4"><div className="flex flex-col gap-4 sm:flex-row sm:items-end"><div className="flex-1"><label htmlFor="error-notification-email" className="text-sm font-medium">Mailadresse til fejl</label><Input id="error-notification-email" className="mt-1" type="email" autoComplete="email" value={notifications.email} onChange={event => setNotifications(current => ({ ...current, email: event.target.value }))} placeholder="navn@sablen.dk"/><p className="mt-1 text-xs text-muted-foreground">Der sendes én mail pr. ny åben fejl. Gentagelser samles, indtil fejlen markeres håndteret.</p></div><div className="flex items-center justify-between gap-3 sm:pb-2"><span className="text-sm font-medium">Send mail ved fejl</span><Switch checked={notifications.enabled} onCheckedChange={enabled => setNotifications(current => ({ ...current, enabled }))} aria-label="Send mail ved fejl"/></div><Button onClick={saveNotifications} disabled={savingNotifications}>{savingNotifications ? 'Gemmer…' : 'Gem mailadvarsel'}</Button></div>{notificationMessage && <p role="status" className="mt-3 text-sm">{notificationMessage}</p>}</div>
    {message ? <p role="alert" className="mt-3 text-sm text-red-700">{message}</p> : loading ? <p className="mt-3 text-sm">Indlæser…</p> : !errors.length ? <p className="mt-3 text-sm">Ingen registrerede åbne fejl. Dette er ikke en live-test af forbindelserne.</p> : <ul className="mt-4 divide-y">{errors.map(error => <li key={error.id} className="flex flex-col justify-between gap-3 py-4 sm:flex-row"><div className="min-w-0"><p className="font-medium">{error.source}</p><p className="mt-1 break-words text-sm">{error.message}</p><p className="mt-1 text-sm text-muted-foreground">{new Intl.DateTimeFormat('da-DK', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Europe/Copenhagen' }).format(new Date(error.created_at.includes('T') ? error.created_at : error.created_at.replace(' ', 'T') + 'Z'))}</p></div><Button variant="outline" disabled={resolving !== null} onClick={() => resolve(error.id)}>{resolving === error.id ? 'Gemmer…' : 'Markér håndteret'}</Button></li>)}</ul>}
  </section>;
}
