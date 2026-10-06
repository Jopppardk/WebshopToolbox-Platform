import { danishDate } from './history-policy';

export type LedgerEntry = {
  guid: string;
  account: number;
  date: string;
  minor: number;
  type: 'Normal' | 'Primo' | 'Ultimo';
};
export type LedgerYear = { from: string; to: string };
export const resultCategories = [
  'Turnover',
  'Variable Expenses',
  'Salary',
  'Sales Expenses',
  'Property Expenses',
  'Administration Expenses',
  'Travel Expenses',
  'Depreciation',
  'Interest Income',
  'Interest Expenses',
  'Charge',
];
const balanceCategories = [
  'Property',
  'Turnover Assets',
  'Financial Assets',
  'Receivables',
  'Liquid Assets',
  'Equity',
  'Long Term Debt',
  'Short Term Debt',
  'Vat Due',
  'Salary Due',
  'IntangibleProperty',
  'Tax',
];
export function financePeriods(now = new Date()) {
  const today = danishDate(now),
    year = Number(today.slice(0, 4)),
    month = Number(today.slice(5, 7)),
    day = Number(today.slice(8));
  const priorDay = Math.min(
    day,
    new Date(Date.UTC(year - 1, month, 0)).getUTCDate(),
  );
  const previous = `${year - 1}-${String(month).padStart(2, '0')}-${String(priorDay).padStart(2, '0')}`;
  return {
    today,
    monthStart: today.slice(0, 7) + '-01',
    yearStart: year + '-01-01',
    previous,
    priorMonthStart: previous.slice(0, 7) + '-01',
    priorYearStart: year - 1 + '-01-01',
  };
}
export function parseEntries(payload: unknown): LedgerEntry[] {
  if (!Array.isArray(payload) || payload.length > 50000)
    throw new Error('Dinero returnerede et ugyldigt eller for stort datasæt.');
  return payload.map((row) => {
    const minor = Math.round(row.Amount * 100);
    if (
      typeof row.EntryGuid !== 'string' ||
      !/^[\da-f-]{36}$/i.test(row.EntryGuid) ||
      !Number.isInteger(row.AccountNumber) ||
      typeof row.Amount !== 'number' ||
      !Number.isSafeInteger(minor) ||
      !/^\d{4}-\d{2}-\d{2}$/.test(row.Date) ||
      !['Normal', 'Primo', 'Ultimo'].includes(row.Type)
    )
      throw new Error('Dinero returnerede en ugyldig postering.');
    return {
      guid: row.EntryGuid,
      account: row.AccountNumber,
      date: row.Date,
      minor,
      type: row.Type,
    };
  });
}
export function calculateFinance(
  entries: LedgerEntry[],
  categories: Record<string, string>,
  years: LedgerYear[],
  inventoryAccount: number | null,
  now = new Date(),
) {
  const p = financePeriods(now);
  const covered = (from: string, to: string) => {
    let cursor = from;
    for (const y of [...years].sort((a, b) => a.from.localeCompare(b.from))) {
      if (y.to < cursor) continue;
      if (y.from > cursor) return false;
      if (y.to >= to) return true;
      cursor = new Date(Date.parse(y.to + 'T00:00:00Z') + 86400000)
        .toISOString()
        .slice(0, 10);
    }
    return false;
  };
  const metric = (from: string, to: string, turnover: boolean) => {
    if (!covered(from, to)) return null;
    let sum = 0;
    for (const e of entries) {
      if (e.type !== 'Normal' || e.date < from || e.date > to) continue;
      const category = categories[e.account];
      if (
        !category ||
        ![...resultCategories, ...balanceCategories].includes(category)
      )
        return null;
      if (
        turnover ? category === 'Turnover' : resultCategories.includes(category)
      )
        sum -= e.minor;
    }
    return sum;
  };
  const currentYear = years.find((y) => y.from <= p.today && y.to >= p.today);
  const inventory =
    currentYear && inventoryAccount !== null
      ? entries
          .filter(
            (e) =>
              e.account === inventoryAccount &&
              e.date >= currentYear.from &&
              e.date <= p.today &&
              e.type !== 'Ultimo',
          )
          .reduce((sum, e) => sum + e.minor, 0)
      : null;
  return {
    periods: p,
    revenueMtd: metric(p.monthStart, p.today, true),
    revenueYtd: metric(p.yearStart, p.today, true),
    previousMtd: metric(p.priorMonthStart, p.previous, true),
    previousYtd: metric(p.priorYearStart, p.previous, true),
    profitMtd: metric(p.monthStart, p.today, false),
    profitYtd: metric(p.yearStart, p.today, false),
    inventory,
  };
}
export function percentageChange(
  current: number | null,
  previous: number | null,
) {
  return current === null || previous === null || previous <= 0
    ? null
    : ((current - previous) / previous) * 100;
}
