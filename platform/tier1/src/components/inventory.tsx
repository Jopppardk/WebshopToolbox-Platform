'use client';
import { tier1Fetch as fetch, tier1Url } from '@/platform/transport';
import {useCapabilities} from '@/platform/capabilities';
import { useEffect, useMemo, useState } from 'react';
import { RefreshCw, Save } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { InventoryRow } from '@/lib/inventory';

type Result = { rows: InventoryRow[]; locations: Array<{ id: string; name: string }>; totalValueMinor: number; fetchedAt: string; error?: string };
export function Inventory() {
  const runtime=useCapabilities();
  const [data, setData] = useState<Result | null>(null), [counts, setCounts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false), [message, setMessage] = useState(''), [error, setError] = useState('');
  const load = async () => {
    setBusy(true); setError('');
    try { const response = await fetch('/api/shopify/inventory', { cache: 'no-store' }); const value = await response.json() as Result; if (!response.ok) throw new Error(value.error); setData(value); setCounts({}); }
    catch (e) { setError(e instanceof Error ? e.message : 'Lageret kunne ikke indlæses.'); }
    finally { setBusy(false); }
  };
  useEffect(() => { void load(); }, []);
  const changes = useMemo(() => (data?.rows || []).flatMap(row => {
    const key = `${row.inventoryItemId}:${row.locationId}`, raw = counts[key];
    if (raw === undefined || raw === '' || Number(raw) === row.quantity) return [];
    return [{ inventoryItemId: row.inventoryItemId, locationId: row.locationId, quantity: Number(raw), compareQuantity: row.quantity }];
  }), [data, counts]);
  const correctedValue = (data?.rows || []).reduce((sum, row) => {
    const raw = counts[`${row.inventoryItemId}:${row.locationId}`], quantity = raw === undefined || raw === '' ? row.quantity : Number(raw);
    return sum + (Number.isSafeInteger(quantity) && quantity >= 0 ? quantity : row.quantity) * row.unitCostMinor;
  }, 0);
  const save = async () => {
    if (!changes.length) return;
    setBusy(true); setError(''); setMessage('');
    try {
      const preparedResponse = await fetch('/api/shopify/inventory', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'prepare', changes }) });
      const prepared = await preparedResponse.json() as { operationId?: string; version?: string; adjustmentMinor?: number; changedLines?: number; willBook?: boolean; error?: string };
      if (!preparedResponse.ok) throw new Error(prepared.error);
      const amount = money(Math.abs(prepared.adjustmentMinor || 0)), direction = (prepared.adjustmentMinor || 0) < 0 ? 'nedskrivning' : 'opskrivning';
      const approved = window.confirm(runtime.bookkeeping?`Opdatér lagerantal i Shopify og overfør reguleringen til Dinero? Lagerværdi: ${direction} på ${amount}.`:`Simulér lageroptællingen? Lagerværdi: ${direction} på ${amount}. Ingen ændringer sendes til Shopify eller Dinero.`);
      if (!approved) { setMessage('Lageroptællingen blev ikke godkendt. Intet er ændret.'); setBusy(false); return; }
      const response = await fetch('/api/shopify/inventory', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: runtime.bookkeeping?'commit':'simulate', id: prepared.operationId, version: prepared.version, confirmation: true }) });
      const value = await response.json() as { voucherNumber?: number; message?: string; error?: string };
      if (!response.ok) throw new Error(value.error);
      setMessage(`${value.message || 'Lageroptællingen er simuleret. Shopify og Dinero er uændrede.'}${value.voucherNumber ? ` Bilag nr. ${value.voucherNumber}.` : ''}`); await load();
    }
    catch (e) { setError(e instanceof Error ? e.message : 'Lageroptællingen kunne ikke gemmes.'); setBusy(false); }
  };
  const money = (minor: number) => new Intl.NumberFormat('da-DK', { style: 'currency', currency: 'DKK' }).format(minor / 100);
  return <div className="mx-auto max-w-[1440px] px-5 py-7 md:px-8 md:py-9">
    <div className="mb-7 flex flex-col justify-between gap-4 sm:flex-row sm:items-end"><div><p className="eyebrow">Bogføring · Shopify</p><h1 className="page-title">Lager</h1><p className="mt-2 text-sm text-muted-foreground">Lagerstatus og kontrolleret optælling baseret på Shopifys fysiske antal og kostpris.</p></div><Button variant="outline" onClick={load} disabled={busy}><RefreshCw className={busy ? 'animate-spin' : ''}/>{busy ? 'Henter…' : 'Hent lagerstatus'}</Button></div>
    {error && <p role="alert" className="mb-4 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">{error}</p>}{message && <p role="status" className="mb-4 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">{message}</p>}
    {data && <><div className="mb-5 grid gap-3 sm:grid-cols-3"><div className="stat-card"><p className="text-xs text-muted-foreground">Registreret lagerværdi</p><p className="mt-2 text-xl font-semibold">{money(data.totalValueMinor)}</p></div><div className="stat-card"><p className="text-xs text-muted-foreground">Værdi efter optælling</p><p className="mt-2 text-xl font-semibold">{money(correctedValue)}</p></div><div className="stat-card"><p className="text-xs text-muted-foreground">Afvigelse</p><p className="mt-2 text-xl font-semibold">{money(correctedValue-data.totalValueMinor)}</p></div></div>
    {data.locations.length !== 1 && <p className="mb-4 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm">Der er {data.locations.length} aktive lagerlokationer. Optællingen vises pr. lokation; kontrollér lokationsnavnet før ændringer.</p>}
    <section className="overflow-hidden rounded-2xl border bg-white"><div className="overflow-x-auto"><table className="w-full min-w-[820px] text-sm"><thead><tr className="border-b bg-muted/45 text-left"><th className="p-4">Produkt</th><th>Variant / SKU</th><th>Lokation</th><th className="text-right">Shopify antal</th><th className="text-right">Kostpris</th><th className="text-right">Værdi</th><th className="w-32 px-4">Optalt antal</th></tr></thead><tbody>{data.rows.map(row => { const key=`${row.inventoryItemId}:${row.locationId}`; return <tr key={key} className="border-b"><td className="p-4 font-medium">{row.product}</td><td>{row.variant}{row.sku ? <span className="block text-xs text-muted-foreground">{row.sku}</span>:null}</td><td>{data.locations.find(l=>l.id===row.locationId)?.name || row.locationId}</td><td className="text-right tabular-nums">{row.quantity}</td><td className="text-right tabular-nums">{money(row.unitCostMinor)}</td><td className="text-right tabular-nums">{money(Math.max(0,row.quantity)*row.unitCostMinor)}</td><td className="px-4"><Input type="number" min="0" step="1" value={counts[key] ?? String(row.quantity)} onChange={e=>setCounts(c=>({...c,[key]:e.target.value}))}/></td></tr>})}</tbody></table></div><div className="flex flex-wrap items-center justify-between gap-3 p-4"><p className="text-xs text-muted-foreground">{runtime.bookkeeping?'Godkendte optællinger opdaterer Shopify og overføres til Dinero efter dine indstillinger.':'Dev simulerer optællingen. Ingen eksterne ændringer.'}</p><Button onClick={save} disabled={busy || !changes.length || changes.some(c=>!Number.isSafeInteger(c.quantity)||c.quantity<0)}><Save/>{busy ? 'Behandler…' : `${runtime.bookkeeping?'Gem':'Simulér'} ${changes.length || ''}`}</Button></div></section></>}
  </div>;
}
