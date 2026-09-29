import { parseEntries, type LedgerYear } from './finance-calculations';
import type { MonthComparison } from './tier1/src/lib/performance';

const guid = /^[\da-f]{8}(-[\da-f]{4}){3}-[\da-f]{12}$/i;
export const expenseCategories = ['Variable Expenses', 'Salary', 'Sales Expenses', 'Property Expenses', 'Administration Expenses', 'Travel Expenses', 'Depreciation', 'Interest Expenses', 'Charge'];
const otherCategories = ['Turnover', 'Interest Income', 'Property', 'Turnover Assets', 'Financial Assets', 'Receivables', 'Liquid Assets', 'Equity', 'Long Term Debt', 'Short Term Debt', 'Vat Due', 'Salary Due', 'IntangibleProperty', 'Tax'];
export function validDate(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
}
export function monthRange(year: number, month: number) {
  return { from: `${year}-${String(month).padStart(2, '0')}-01`, to: new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10) };
}
function covered(from: string, to: string, ranges: LedgerYear[]) {
  let cursor = from;
  for (const range of [...ranges].sort((a, b) => a.from.localeCompare(b.from))) {
    if (range.to < cursor) continue;
    if (range.from > cursor) return false;
    if (range.to >= to) return true;
    cursor = new Date(Date.parse(range.to) + 86400000).toISOString().slice(0, 10);
  }
  return false;
}
export function comparison(year: number, today: string, start: string, ranges: LedgerYear[], sums: Map<string, number>): MonthComparison[] {
  const value = (y: number, month: number) => {
    const range = monthRange(y, month), to = range.to > today ? today : range.to;
    if (range.from > today || range.from < start || !covered(range.from, to, ranges)) return null;
    return sums.get(range.from.slice(0, 7)) ?? 0;
  };
  return Array.from({ length: 12 }, (_, i) => ({ month: i + 1, current: value(year, i + 1), previous: value(year - 1, i + 1) }));
}
export function parsePerformanceEntries(payload: unknown) {
  const entries = parseEntries(payload);
  return entries.map((entry, i) => {
    const raw = (payload as Record<string, unknown>[])[i];
    if (!validDate(entry.date) || (raw.ContactGuid != null && !guid.test(String(raw.ContactGuid))) || (raw.VoucherGuid != null && !guid.test(String(raw.VoucherGuid)))) throw Error('Dinero returnerede ugyldige posteringer.');
    return { ...entry, guid: entry.guid.toLowerCase(), contact: typeof raw.ContactGuid === 'string' ? raw.ContactGuid.toLowerCase() : null, voucher: typeof raw.VoucherGuid === 'string' ? raw.VoucherGuid.toLowerCase() : null };
  });
}
export function aggregateFinance(entries: ReturnType<typeof parsePerformanceEntries>, categories: Record<string, string>, ranges: LedgerYear[], year: number, today: string, start: string, contacts: Map<string, string>) {
  const revenue = new Map<string, number>(), expenses = new Map<string, number>();
  const bySupplier = new Map<string, Map<string, number>>(), voucherContacts = new Map<string, string | null>();
  const ids = new Set<string>();
  for (const e of entries) {
    if (ids.has(e.guid)) throw Error('Dinero gentog en postering. Tallene kunne ikke valideres.');
    ids.add(e.guid);
    if (e.type !== 'Normal' || !e.voucher || !e.contact) continue;
    const previous = voucherContacts.get(e.voucher);
    // A manual voucher can contain several contacts. Only inherit an unambiguous one.
    voucherContacts.set(e.voucher, previous === undefined || previous === e.contact ? e.contact : null);
  }
  const add = (sums: Map<string, number>, key: string, amount: number) => {
    const next = (sums.get(key) ?? 0) + amount;
    if (!Number.isSafeInteger(next)) throw Error('Regnskabstallene er for store til sikker beregning.');
    sums.set(key, next);
  };
  for (const e of entries) {
    if (e.type !== 'Normal' || e.date < start || e.date > today || e.date < `${year - 1}-01-01` || e.date > `${year}-12-31`) continue;
    const category = categories[e.account], month = e.date.slice(0, 7);
    if (![...expenseCategories, ...otherCategories].includes(category)) throw Error('En bogført konto mangler en entydig kategori i Dinero. Kontrollér kontoplanen.');
    if (category === 'Turnover') add(revenue, month, -e.minor);
    if (expenseCategories.includes(category)) {
      add(expenses, month, e.minor);
      const contact = e.contact || (e.voucher && voucherContacts.get(e.voucher)) || '';
      if (!bySupplier.has(contact)) bySupplier.set(contact, new Map());
      add(bySupplier.get(contact)!, month, e.minor);
    }
  }
  const series = (sums: Map<string, number>) => comparison(year, today, start, ranges, sums);
  return {
    revenue: { months: series(revenue) }, expenses: { months: series(expenses) },
    suppliers: [...bySupplier].filter(([id]) => id).map(([id, sums]) => ({ id, name: contacts.get(id) || `Ukendt/slettet leverandør (${id.slice(0, 8)})`, months: series(sums) })).sort((a, b) => a.name.localeCompare(b.name, 'da')),
    unassigned: series(bySupplier.get('') || new Map()),
  };
}
export function parseShopifyMetric(payload: unknown, metric: 'sessions' | 'orders', year: number, today: string, start: string) {
  const result = payload as { parseErrors?: unknown[]; tableData?: { columns?: Array<{ name: string }>; rows?: Array<Record<string, unknown>> } } | null;
  if (!Array.isArray(result?.parseErrors) || result.parseErrors.length || !Array.isArray(result.tableData?.rows) || !result.tableData.columns?.some(c => c.name === 'month') || !result.tableData.columns.some(c => c.name === metric)) throw Error('Shopify kunne ikke levere den valgte rapport. Kontrollér rapportadgang under Integrationer.');
  const sums = new Map<string, number>();
  for (const row of result.tableData.rows) {
    const date = row.month, raw = row[metric];
    const value = typeof raw === 'number' ? raw : typeof raw === 'string' && /^\d+$/.test(raw) ? Number(raw) : NaN;
    if (!validDate(date) || !date.endsWith('-01') || date < `${year - 1}-01-01` || date > `${year}-12-31` || !Number.isSafeInteger(value) || value < 0 || sums.has(date.slice(0, 7))) throw Error('Shopify returnerede ufuldstændige eller ugyldige månedstal.');
    sums.set(date.slice(0, 7), value);
  }
  // TIMESERIES must supply every month. Missing rows are unknown, never fabricated zeroes.
  const months = comparison(year, today, start, [{ from: start, to: today }], sums);
  for (const row of months) for (const key of ['current', 'previous'] as const) {
    if (!sums.has(`${key === 'current' ? year : year - 1}-${String(row.month).padStart(2, '0')}`)) row[key] = null;
  }
  return { months };
}
