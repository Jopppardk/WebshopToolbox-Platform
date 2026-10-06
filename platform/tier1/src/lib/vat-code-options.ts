export function vatCodeOptions(
  chart: ReadonlyArray<{ vatCode?: string | null }>,
) {
  return [
    ...new Set(
      chart.map((account) => account.vatCode?.trim() || '').filter(Boolean),
    ),
  ].sort((a, b) => a.localeCompare(b, 'da', { numeric: true }));
}
