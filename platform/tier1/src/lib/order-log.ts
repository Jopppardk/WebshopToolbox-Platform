export type OrderLogEvent = { title: string; at: string | null; detail?: string; tone?: 'success' | 'warning' };
export type LogRecord = { payload_json: string; created_at: string; booking_status: string };
export type LogDelivery = { delivery_mode: string; status: string; updated_at: string };
export function logTimestamp(value?: string | null): string | null {
  if (!value) return null;
  const utc = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value) ? value.replace(' ', 'T') + 'Z' : value;
  return Number.isFinite(Date.parse(utc)) ? new Date(utc).toISOString() : null;
}
export function orderLog(order: LogRecord, invoice: LogRecord | null, transfer: string | null, deliveries: LogDelivery[]) {
  const source = JSON.parse(order.payload_json);
  const events: OrderLogEvent[] = [];
  const add = (title: string, at?: string | null, detail?: string, tone?: OrderLogEvent['tone']) => events.push({ title, at: logTimestamp(at), detail, tone });
  add('Ordre modtaget i Shopify', source.createdAt);
  add('Første indlæsning i Toolbox', order.created_at);
  const shipments = (source.fulfillments || []).filter((f: { status: string }) => f.status === 'SUCCESS');
  for (const f of shipments) add('Afsendelse registreret i Shopify', f.createdAt, 'Tidspunktet for oprettelse af en gennemført afsendelse i Shopify.', 'success');
  if (!shipments.length) add('Afsendelse', null, source.displayFulfillmentStatus === 'FULFILLED' ? 'Ordren er afsendt, men afsendelsestidspunktet er ikke gemt.' : source.displayFulfillmentStatus === 'PARTIAL' ? 'Ordren er delvist afsendt; tidspunktet er ikke gemt.' : 'Ordren er endnu ikke registreret som afsendt.');
  if (source.cancelledAt) add('Ordre annulleret i Shopify', source.cancelledAt, undefined, 'warning');
  if (invoice) add('Faktura-PDF genereret', JSON.parse(invoice.payload_json).generatedAt, undefined, 'success');
  else add('Faktura-PDF', null, source.cancelledAt ? 'Ingen faktura genereret; ordren er annulleret.' : 'Ingen faktura registreret.');
  for (const d of deliveries) {
    const name = d.delivery_mode === 'test' ? 'Testmail med faktura' : 'Fakturamail til kunden';
    add(name + (d.status === 'sent' ? ' sendt' : d.status === 'failed' ? ' fejlet' : ' afventer bekræftelse'), d.updated_at,
      d.status === 'sent' ? 'Mailudbyderen har accepteret afsendelsen. Modtagelse i kundens indbakke er ikke bekræftet.' : d.status === 'failed' ? 'Mailen kunne ikke sendes.' : 'Afsendelsen er startet, men resultatet er endnu ikke bekræftet.', d.status === 'sent' ? 'success' : 'warning');
  }
  if (!deliveries.some(d => d.delivery_mode === 'customer')) add('Fakturamail til kunden', null, 'Ingen afsendelse registreret i Toolbox.');
  if (transfer) {
    const state = JSON.parse(transfer);
    const labels: Record<string, string> = { prepared: 'Forslag forberedt', creating: 'Opretter kladde', draft: 'Kladde oprettet', booking: 'Bogføring i gang', booked: 'Bogført', uncertain: 'Kræver kontrol', archived: 'Arkiveret' };
    add('Dinero: ' + (labels[state.phase] || 'Ukendt status'), state.updatedAt, 'Seneste gemte overførselsstatus.' + (state.voucherNumber ? ' Bilag ' + state.voucherNumber + '.' : '') + (state.draftTest ? ' Testkladde.' : ''), state.phase === 'booked' ? 'success' : 'warning');
  } else add('Dinero', null, order.booking_status === 'booked' ? 'Bogført; tidspunktet er ikke gemt.' : 'Ingen overførsel registreret.');
  events.sort((a, b) => a.at && b.at ? Date.parse(a.at) - Date.parse(b.at) : a.at ? -1 : b.at ? 1 : 0);
  return { name: source.name, events };
}
