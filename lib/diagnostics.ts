// Never retain credential-bearing URLs or authorization values in diagnostics.
export function sanitizeDiagnostic(value: unknown, limit = 500): string {
  if (typeof value !== 'string') return '';
  return value
    .replace(/https?:\/\/[^\s<>"']+/gi, '[URL skjult]')
    .replace(/\bBearer\s+\S+/gi, 'Bearer [skjult]')
    .replace(/(?:["']?(?:access_token|refresh_token|token|secret|signature|password|authorization|api[-_ ]?key)["']?\s*[:=]\s*)(?:"[^"\r\n]*"|'[^'\r\n]*'|[^\s,;&}]+)/gi, '[adgangsdata skjult]')
    .replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g, '[mail skjult]')
    // oxlint-disable-next-line eslint/no-control-regex -- Remove control characters from stored diagnostics.
    .replace(/[\x00-\x1f]+/g, ' ').trim().slice(0, limit);
}
