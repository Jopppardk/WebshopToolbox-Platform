'use client';
import { tier1Fetch as fetch } from '@/platform/transport';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';

type Field = { key: string; name: string; type: string; status: 'present' | 'missing' | 'conflict'; existingType: string | null };
type Status = { fields: Field[]; canWrite: boolean; writes: boolean; created?: string[]; error?: string };
const labels = { present: 'Oprettet', missing: 'Mangler', conflict: 'Findes med anden type' } as const;

// Product fields in Shopify that the packaging report reads. Values are entered per product in Shopify.
export function ShopifyPackagingFields() {
  const [status, setStatus] = useState<Status | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/emballage/shopify-fields', { cache: 'no-store', signal: controller.signal })
      .then(async response => { const data = await response.json() as Status; if (!response.ok) throw new Error(data.error); setStatus(data); })
      .catch(error => { if (!controller.signal.aborted) setError(error instanceof Error && error.message ? error.message : 'Felterne i Shopify kunne ikke kontrolleres.'); });
    return () => controller.abort();
  }, []);
  async function create() {
    if (!window.confirm(`Der oprettes ${missing} nye felter på alle varekort (produkter) i Shopify. Felterne kan ses og udfyldes af alle med adgang til produkter i Shopify. Eksisterende felter og produktdata ændres ikke. Vil du fortsætte?`)) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const response = await fetch('/api/emballage/shopify-fields', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      const data = await response.json() as Status; if (!response.ok) throw new Error(data.error);
      setStatus(data); setNotice(data.created?.length ? `${data.created.length} felter er oprettet i Shopify.` : 'Alle felter fandtes allerede.');
    } catch (error) { setError(error instanceof Error && error.message ? error.message : 'Felterne kunne ikke oprettes.'); }
    finally { setBusy(false); }
  }
  const missing = status?.fields.filter(field => field.status === 'missing').length ?? 0, conflicts = status?.fields.filter(field => field.status === 'conflict').length ?? 0;
  return <div className="rounded-xl border bg-white p-4">
    <p className="text-sm font-semibold">Felter i Shopify</p>
    <p className="mt-1 text-xs text-muted-foreground">Indberetningen læser fem produktfelter i Shopify. Opret dem her, og udfyld dem derefter pr. produkt i Shopify, fx med masseredigering.</p>
    {!status && !error && <p role="status" className="mt-3 text-sm">Kontrollerer felterne i Shopify…</p>}
    {status && <ul className="mt-3 divide-y rounded-lg border text-sm">{status.fields.map(field => <li key={field.key} className="flex items-center justify-between gap-3 p-3"><span>{field.name}<span className="block text-xs text-muted-foreground">custom.{field.key}</span></span><span className={field.status === 'present' ? 'text-emerald-700' : field.status === 'conflict' ? 'text-red-700' : 'text-amber-700'}>{labels[field.status]}{field.status === 'conflict' && field.existingType ? ` (${field.existingType})` : ''}</span></li>)}</ul>}
    {conflicts > 0 && <p className="mt-3 text-xs text-red-700">Et felt findes allerede med en anden type. WebshopToolbox ændrer det ikke; ret eller slet feltet i Shopify under Indstillinger → Brugerdefinerede data → Produkter.</p>}
    {status && missing > 0 && !status.writes && <p className="mt-3 text-xs text-muted-foreground">Felterne kan kun oprettes fra produktionsportalen. Testmiljøet ændrer intet i Shopify.</p>}
    {status && missing > 0 && status.writes && !status.canWrite && <p className="mt-3 text-xs text-amber-800">Shopify-appen mangler rettigheden write_products. Tilføj den under appens adgang i Shopify (se vejledningen til Shopify), og kontrollér igen.</p>}
    {status && missing > 0 && <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900"><span className="font-semibold">Bemærk:</span> Knappen opretter {missing} nye felter på alle varekort (produkter) i Shopify. Felterne vises på produktsiden i Shopify for alle med adgang til produkter. Eksisterende felter og produktdata ændres ikke, og felterne kan slettes igen i Shopify under Indstillinger → Brugerdefinerede data → Produkter.</p>}
    {status && missing > 0 && <Button className="mt-3" onClick={create} disabled={busy || !status.writes || !status.canWrite}>{busy ? 'Opretter…' : `Opret ${missing} felter i Shopify`}</Button>}
    {status && missing === 0 && conflicts === 0 && <p className="mt-3 text-xs text-emerald-700">Alle felter er oprettet. Udfyld dem pr. produkt i Shopify.</p>}
    {error && <p role="alert" className="mt-3 text-sm text-red-800">{error}</p>}{notice && <p role="status" className="mt-3 text-sm">{notice}</p>}
  </div>;
}

/** Warning on the Emballage page when the Shopify fields are missing, linking to the integration that creates them. */
export function PackagingFieldsWarning({ onFix }: { onFix: () => void }) {
  const [problems, setProblems] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    // Without a Shopify connection the check fails; the page then shows its own guidance instead.
    fetch('/api/emballage/shopify-fields', { cache: 'no-store', signal: controller.signal })
      .then(async response => { if (!response.ok) return; const data = await response.json() as Status; setProblems(data.fields.filter(field => field.status !== 'present').length); })
      .catch(() => {});
    return () => controller.abort();
  }, []);
  if (!problems) return null;
  return <div role="alert" className="mb-6 flex flex-col justify-between gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900 sm:flex-row sm:items-center">
    <p><span className="font-semibold">{problems} af de fem emballagefelter mangler i Shopify.</span> Uden felterne kan vægt og indberetningspligt ikke læses fra dine varer, og indberetningen bliver ufuldstændig.</p>
    <Button variant="outline" className="shrink-0" onClick={onFix}>Løs under Integrationer</Button>
  </div>;
}
