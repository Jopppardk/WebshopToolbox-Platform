import { useEffect, useState } from 'react';
import { formatTime } from '@/lib/format';
import { platformApi } from './transport';
import type { Workspace } from './workspace';

/** Shown while Toolbox support views the portal as a customer user; support can only look, not change. */
export function SupportBanner({ user }: { user: Workspace['user'] }) {
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const expiresAt = user.support?.expiresAt;
  useEffect(() => {
    if (!expiresAt) return;
    const timer = window.setTimeout(() => window.location.assign('/admin/'), Math.max(0, expiresAt * 1000 - Date.now() + 1000));
    return () => window.clearTimeout(timer);
  }, [expiresAt]);
  if (!user.support) return null;
  async function stop() {
    setBusy(true); setError('');
    try { await platformApi('/api/platform/support', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: '{}' }); window.location.assign('/admin/'); }
    catch (e) { setError((e as Error).message); setBusy(false); }
  }
  return <div role="status" className="sticky top-0 z-50 flex flex-wrap items-center justify-between gap-2 bg-amber-100 px-4 py-2 text-sm text-amber-950">
    <span><strong>Supportadgang</strong> · Du ser portalen som {user.email} · kun visning · udløber kl. {formatTime(user.support.expiresAt * 1000)}{error && <span role="alert" className="ml-2 text-red-700">{error}</span>}</span>
    <span className="flex gap-3"><a className="underline" href="/admin/">Til administrationen</a><button type="button" className="font-medium underline" disabled={busy} onClick={() => void stop()}>{busy ? 'Afslutter…' : 'Afslut supportadgang'}</button></span>
  </div>;
}
