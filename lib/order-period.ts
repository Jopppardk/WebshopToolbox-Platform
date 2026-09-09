import { danishDate, midnight, shiftMonths } from './history-policy';

export const orderPeriods = [
  ['all', 'Hele historikken'], ['today', 'I dag'], ['7days', 'Seneste 7 dage'],
  ['30days', 'Seneste 30 dage'], ['month', 'Denne måned'],
  ['last-month', 'Sidste måned'], ['year', 'I år'],
] as const;
export type OrderPeriod = typeof orderPeriods[number][0];

export function orderPeriodWindow(period: string, historyCutoff: string, now = new Date()) {
  if (!orderPeriods.some(([value]) => value === period)) throw new Error('Ugyldig periode');
  if (period === 'all') return { from: historyCutoff, until: '9999-12-31T00:00:00.000Z' };
  const today = danishDate(now);
  const date = new Date(today + 'T00:00:00Z');
  const nextDay = new Date(+date + 86400000).toISOString().slice(0, 10);
  let from = today, until = nextDay;
  if (period === '7days' || period === '30days') from = new Date(+date - (period === '7days' ? 6 : 29) * 86400000).toISOString().slice(0, 10);
  if (period === 'month') from = today.slice(0, 7) + '-01';
  if (period === 'year') from = today.slice(0, 4) + '-01-01';
  if (period === 'last-month') {
    until = today.slice(0, 7) + '-01';
    from = shiftMonths(new Date(until + 'T00:00:00Z'), -1).toISOString().slice(0, 10);
  }
  return { from: [historyCutoff, midnight(from)].sort().at(-1)!, until: midnight(until) };
}
