export type Reportable = 'yes' | 'no' | 'unknown';
export type PackagingRow = { eventId: string; fulfillmentId: string; fulfilledAt: string; date: string; orderId: string; orderName: string; productId: string | null; product: string; variantId: string | null; variant: string; quantity: number; weightGrams: number | null; reportable: Reportable; supplier: string; supplierCountry: string; supplierCvr: string; snapshottedAt: string; refreshedAt?: string };
export type ManualPackaging = { id: string; date: string; description: string; supplier: string; supplierCountry: string; supplierCvr: string; weightGrams: number; reportable: Reportable; updatedAt: string };
export type PackagingPeriod = { start: string; end: string; totalGrams: number; reportableGrams: number; productGrams: number; productReportableGrams: number; manualGrams: number; manualReportableGrams: number; unknownReportabilityGrams: number; unconfiguredProductLines: number; products: Array<{ productId: string | null; product: string; grams: number; reportableGrams: number; quantity: number; orders: PackagingRow[] }>; manualEntries: ManualPackaging[] };

export const normalizeReportable = (value: unknown): Reportable => {
  const text = String(value || '').trim().toLowerCase();
  return ['ja', 'yes', 'true', '1'].includes(text) ? 'yes' : ['nej', 'no', 'false', '0'].includes(text) ? 'no' : 'unknown';
};
export function packagingPeriod(rows: PackagingRow[], manual: ManualPackaging[], start: string, end: string): PackagingPeriod {
  const selectedRows = rows.filter(row => row.date >= start && row.date <= end), selectedManual = manual.filter(row => row.date >= start && row.date <= end);
  const products = new Map<string, PackagingPeriod['products'][number]>(); let unknown = 0, missing = 0;
  for (const row of selectedRows) {
    const grams = (row.weightGrams ?? 0) * row.quantity, reportableGrams = row.reportable === 'yes' ? grams : 0;
    if (row.weightGrams === null) missing++; if (row.reportable === 'unknown') unknown += grams;
    const key = row.productId || row.product, product = products.get(key) || { productId: row.productId, product: row.product, grams: 0, reportableGrams: 0, quantity: 0, orders: [] };
    product.grams += grams; product.reportableGrams += reportableGrams; product.quantity += row.quantity; product.orders.push(row); products.set(key, product);
  }
  for (const item of selectedManual) if (item.reportable === 'unknown') unknown += item.weightGrams;
  const list = [...products.values()].sort((a,b) => b.grams-a.grams || a.product.localeCompare(b.product,'da'));
  for (const product of list) product.orders.sort((a,b) => b.date.localeCompare(a.date) || b.orderName.localeCompare(a.orderName));
  const productGrams = list.reduce((s,p)=>s+p.grams,0), productReportableGrams=list.reduce((s,p)=>s+p.reportableGrams,0), manualGrams=selectedManual.reduce((s,p)=>s+p.weightGrams,0), manualReportableGrams=selectedManual.filter(p=>p.reportable==='yes').reduce((s,p)=>s+p.weightGrams,0);
  return { start, end, totalGrams: productGrams+manualGrams, reportableGrams: productReportableGrams+manualReportableGrams, productGrams, productReportableGrams, manualGrams, manualReportableGrams, unknownReportabilityGrams: unknown, unconfiguredProductLines: missing, products:list, manualEntries:selectedManual.sort((a,b)=>b.date.localeCompare(a.date)) };
}
export function validateManualPackaging(value: unknown): Omit<ManualPackaging,'id'|'updatedAt'> {
  const row=value as Record<string,unknown>, date=String(row?.date||''), description=String(row?.description||'').trim(), supplier=String(row?.supplier||'').trim(), supplierCountry=String(row?.supplierCountry||'').trim().toUpperCase(), supplierCvr=String(row?.supplierCvr||'').trim(), weightGrams=Number(row?.weightGrams), reportable=String(row?.reportable||'') as Reportable;
  const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Copenhagen'}).format(new Date());
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||date>today||!description||description.length>200||supplier.length>200||supplierCountry.length>100||supplierCvr.length>50||!Number.isSafeInteger(weightGrams)||weightGrams<0||weightGrams>100_000_000||!['yes','no','unknown'].includes(reportable)) throw new Error('Den manuelle emballagepost er ugyldig.');
  return {date,description,supplier,supplierCountry,supplierCvr,weightGrams,reportable};
}
