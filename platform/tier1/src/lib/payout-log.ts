import { payoutStatusLabel } from './payout-status';
import { logTimestamp, type OrderLogEvent } from './order-log';
import { sanitizeDiagnostic } from './diagnostics';
export type PayoutLogEvent = OrderLogEvent & { id: string };
export type StoredPayoutEvent = {
  id: string;
  kind: string;
  at: string | null;
  data_json: string;
};
export type PayoutLogData = {
  name: string;
  events: PayoutLogEvent[];
  details: Array<{ label: string; value: string }>;
  nextOffset: number | null;
  legacy: boolean;
};

const phaseLabels: Record<string, string> = {
  prepared: 'Bogføringsforslag forberedt',
  creating: 'Oprettelse i Dinero startet',
  draft: 'Kladde oprettet i Dinero',
  booking: 'Bogføring i Dinero startet',
  booked: 'Bogføring bekræftet i Dinero',
  uncertain: 'Bogføringsforsøg kræver kontrol',
  recovering: 'Manuel kontrol startet',
  archived: 'Bogføringsreference arkiveret',
};
export function payoutLogEvent(row: StoredPayoutEvent): PayoutLogEvent {
  const d = JSON.parse(row.data_json),
    status = (v: string) => payoutStatusLabel(v);
  let title = '',
    detail = '',
    tone: OrderLogEvent['tone'];
  switch (row.kind) {
    case 'received':
      title = 'Modtaget i Toolbox';
      detail = d.status ? 'Udbetalingsstatus: ' + status(d.status) : '';
      break;
    case 'legacy_received':
      title = 'Modtaget i Toolbox';
      detail = row.at
        ? 'Første gemte indlæsning.'
        : 'Det oprindelige modtagelsestidspunkt er ikke bevaret.';
      break;
    case 'status':
      title = 'Udbetalingsstatus ændret';
      detail = `${status(d.from || 'Ukendt')} → ${status(d.status)}. Registreret ved synkronisering.`;
      tone = ['PAID', 'Udbetalt', 'Afregnet'].includes(d.status)
        ? 'success'
        : 'warning';
      break;
    case 'estimate':
      title = 'Forventet udbetaling ændret';
      detail = 'Flatpay har ændret den forventede dato eller nettobeløbet.';
      break;
    case 'phase':
    case 'legacy_phase':
      title = phaseLabels[d.phase] || 'Dinero-status opdateret';
      detail =
        (row.kind === 'legacy_phase'
          ? 'Seneste gemte status fra før hændelsesloggen. '
          : '') +
        (d.phase === 'uncertain'
          ? 'Resultatet er ikke sikkert bekræftet; det betyder ikke nødvendigvis, at intet er bogført. '
          : '') +
        (d.message || '');
      tone = ['draft', 'booked'].includes(d.phase)
        ? 'success'
        : d.phase === 'uncertain'
          ? 'warning'
          : undefined;
      break;
    case 'attachment':
      title = 'Udbetalingsrapport overført til Dinero';
      detail = 'PDF-upload bekræftet. Bogføring er en separat hændelse.';
      tone = 'success';
      break;
    case 'manual_started':
      title = 'Manuel bogføring startet';
      detail = 'Brugeren har bekræftet kontrollen af Dinero.';
      break;
    case 'manual_completed':
      title = d.message?.includes('allerede bogført')
        ? 'Bogført bilag fundet ved manuel kontrol'
        : d.message?.includes('oprettet som kladde')
          ? 'Kladde oprettet manuelt i Dinero'
          : d.message?.includes('bogført')
            ? 'Bogført manuelt i Dinero'
            : 'Manuel behandling gennemført';
      detail = d.message || 'Se den gemte Dinero-status for resultatet.';
      tone = 'success';
      break;
    case 'manual_failed':
      title = 'Manuel bogføring mislykkedes eller kræver kontrol';
      detail =
        d.message || 'Forsøget blev ikke gennemført med et bekræftet resultat.';
      tone = 'warning';
      break;
    default:
      title = 'Bogføringsforsøg mislykkedes';
      detail = d.message || 'Forsøget blev afbrudt.';
      tone = 'warning';
  }
  return {
    id: row.id,
    title,
    at: logTimestamp(row.at),
    detail: sanitizeDiagnostic(detail, 900),
    tone,
  };
}
