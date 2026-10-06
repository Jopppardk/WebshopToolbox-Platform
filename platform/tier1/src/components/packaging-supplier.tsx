'use client';
import { tier1Fetch as fetch } from '@/platform/transport';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { DineroSupplier, SupplierSnapshot } from '@/lib/dinero-suppliers';
type Fields = { supplier: string; supplierCountry: string; supplierCvr: string };
export function PackagingSupplier({ value, onChange }: { value: Fields; onChange: (fields: Fields) => void }) {
  const [suppliers, setSuppliers] = useState<DineroSupplier[]>([]), [loading, setLoading] = useState(true), [error, setError] = useState('');
  const [revision, setRevision] = useState(0), [manual, setManual] = useState(false);
  useEffect(() => {
    const controller = new AbortController(); setLoading(true); setError('');
    void fetch('/api/dinero/suppliers', { ...(revision ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' } : {}), cache: 'no-store', signal: controller.signal })
      .then(async response => { const data = await response.json() as SupplierSnapshot & { error?: string }; if (!response.ok) throw Error(data.error || 'Leverandørerne kunne ikke hentes.'); if (!controller.signal.aborted) setSuppliers(data.suppliers); })
      .catch(e => { if (!controller.signal.aborted) setError(e.message); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [revision]);
  const selected = suppliers.find(s => s.name === value.supplier && s.country === value.supplierCountry && s.vatNumber === value.supplierCvr);
  return <>
    <div className="text-sm"><label>Leverandør<select className="mt-1 h-10 w-full rounded-lg border bg-white px-3" disabled={loading} value={manual ? '__manual' : selected?.id || (value.supplier ? '__saved' : '')} onChange={e => {
      const supplier = suppliers.find(s => s.id === e.target.value); setManual(e.target.value === '__manual');
      if (supplier) onChange({ supplier: supplier.name, supplierCountry: supplier.country, supplierCvr: supplier.vatNumber });
      else if (!e.target.value) onChange({ supplier: '', supplierCountry: '', supplierCvr: '' });
    }}><option value="">{loading ? 'Henter leverandører…' : 'Vælg leverandør fra Dinero'}</option>{!selected && value.supplier && <option value="__saved">{value.supplier} (gemte oplysninger)</option>}{suppliers.map(s => <option key={s.id} value={s.id}>{s.name}{s.vatNumber ? ` · ${s.vatNumber}` : ''}{s.country ? ` · ${s.country}` : ''}</option>)}<option value="__manual">Indtast manuelt</option></select></label>
      {manual && <Input className="mt-2" aria-label="Leverandørnavn" value={value.supplier} onChange={e => onChange({ ...value, supplier: e.target.value })}/>}
      <Button type="button" variant="link" size="sm" className="h-auto px-0" disabled={loading} onClick={() => setRevision(n => n + 1)}>Opdatér leverandører fra Dinero</Button>
      <p className="text-xs text-muted-foreground">Leverandører med registrerede køb i Dinero. Land og CVR/VAT kan tilrettes på denne post.</p>
      {error && <p role="alert" className="mt-1 text-xs text-red-700">{error}</p>}
      {!loading && !error && !suppliers.length && <p className="text-xs text-muted-foreground">Ingen leverandører fundet. Dinero markerer kontakter som leverandører efter et registreret køb.</p>}
    </div>
    <label className="text-sm">Land<Input value={value.supplierCountry} placeholder="Fx DK" onChange={e => onChange({ ...value, supplierCountry: e.target.value.toUpperCase() })}/></label>
    <label className="text-sm">CVR/VAT<Input value={value.supplierCvr} onChange={e => onChange({ ...value, supplierCvr: e.target.value })}/></label>
  </>;
}
