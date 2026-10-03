export type HistoryPolicy = { months: number; startDate: string };
export const defaultHistory: HistoryPolicy = { months: 24, startDate: '' };
export function validateHistory(value: HistoryPolicy): HistoryPolicy {
  if (!Number.isInteger(value.months) || value.months < 1 || value.months > 120)
    throw new Error('Historik skal være mellem 1 og 120 måneder');
  if (
    typeof value.startDate !== 'string' ||
    (value.startDate !== '' &&
      (!/^\d{4}-\d{2}-\d{2}$/.test(value.startDate) ||
        !Number.isFinite(Date.parse(value.startDate)) ||
        new Date(value.startDate).toISOString().slice(0, 10) !==
          value.startDate))
  )
    throw new Error('Vælg en gyldig startdato');
  return { months: value.months, startDate: value.startDate };
}
export function shiftMonths(value: Date, months: number) {
  const result = new Date(value);
  const day = result.getUTCDate();
  result.setUTCDate(1);
  result.setUTCMonth(result.getUTCMonth() + months);
  const last = new Date(
    Date.UTC(result.getUTCFullYear(), result.getUTCMonth() + 1, 0),
  ).getUTCDate();
  result.setUTCDate(Math.min(day, last));
  return result;
}
export function danishDate(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Copenhagen',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}
export function midnight(date: string) {
  const utc = new Date(`${date}T00:00:00Z`);
  const hour = Number(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Europe/Copenhagen',
      hour: '2-digit',
      hourCycle: 'h23',
    }).format(utc),
  );
  return new Date(+utc - hour * 3600000).toISOString();
}
export function historyWindow(policy: HistoryPolicy, now = new Date()) {
  const rollingDate = shiftMonths(
    new Date(`${danishDate(now)}T00:00:00Z`),
    -policy.months,
  )
    .toISOString()
    .slice(0, 10);
  const effectiveDate =
    policy.startDate > rollingDate ? policy.startDate : rollingDate;
  return {
    rollingDate,
    effectiveDate,
    retentionCutoff: midnight(rollingDate),
    cutoff: midnight(effectiveDate),
  };
}
