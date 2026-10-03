// One date style across the portal: "29. sep. 2026" and "29. sep. 2026 kl. 10.56", Danish time.
const zone = 'Europe/Copenhagen';
const dateFormat = new Intl.DateTimeFormat('da-DK', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  timeZone: zone,
});
const timeFormat = new Intl.DateTimeFormat('da-DK', {
  hour: '2-digit',
  minute: '2-digit',
  timeZone: zone,
});

/** Accepts Date, epoch milliseconds, ISO strings, plain dates and SQLite UTC timestamps. */
function parse(value: Date | string | number | null | undefined) {
  if (value === null || value === undefined || value === '') return null;
  if (value instanceof Date)
    return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value === 'number') return new Date(value);
  // A plain date is a calendar day: read it at noon so no time zone moves it to another day.
  const text = /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? `${value}T12:00:00Z`
    : /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(value)
      ? value.replace(' ', 'T') + 'Z'
      : value;
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? null : date;
}
export const formatDate = (
  value: Date | string | number | null | undefined,
  fallback = '—',
) => {
  const d = parse(value);
  return d ? dateFormat.format(d) : fallback;
};
export const formatDateTime = (
  value: Date | string | number | null | undefined,
  fallback = '—',
) => {
  const d = parse(value);
  return d ? `${dateFormat.format(d)} kl. ${timeFormat.format(d)}` : fallback;
};
export const formatTime = (
  value: Date | string | number | null | undefined,
  fallback = '—',
) => {
  const d = parse(value);
  return d ? timeFormat.format(d) : fallback;
};
