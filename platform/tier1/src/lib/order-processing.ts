type Result = { status: string; invoices?: number; sent?: number; booked?: number; drafts?: number; failed?: number };
const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** The status line after Synkronisér nu has invoiced, sent and booked fulfilled orders. */
export function processedSummary(result: Result) {
  if (result.status === 'off') return 'Automatisk fakturering og bogføring er slået fra under Indstillinger → Automatik';
  if (result.status === 'busy') return 'En automatisk kørsel er i gang, så afsendte ordrer behandles om lidt';
  if (result.status === 'disabled') return 'Fakturering og bogføring kører ikke i testmiljøet';
  if (result.status !== 'completed') return 'Afsendte ordrer behandles ved næste automatiske kørsel';
  const parts = [
    result.invoices ? count(result.invoices, 'faktura dannet', 'fakturaer dannet') : '',
    result.sent ? count(result.sent, 'faktura sendt til kunden', 'fakturaer sendt til kunderne') : '',
    result.booked ? count(result.booked, 'ordre bogført i Dinero', 'ordrer bogført i Dinero') : '',
    result.drafts ? count(result.drafts, 'ordre lagt som kladde i Dinero', 'ordrer lagt som kladde i Dinero') : '',
    result.failed ? count(result.failed, 'ordre kunne ikke behandles – se klokken', 'ordrer kunne ikke behandles – se klokken') : '',
  ].filter(Boolean);
  return parts.length ? parts.join(' · ') : 'Ingen nye afsendte ordrer at fakturere eller bogføre';
}
