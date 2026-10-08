export const bookingStatuses: Record<string, { label: string; tone: string }> =
  {
    setup_required: { label: 'Vælg bogføringsstart', tone: 'badge-pending' },
    historical: {
      label: 'Før bogføringsstart',
      tone: 'bg-muted text-muted-foreground',
    },
    reconciliation_required: { label: 'Afventer', tone: 'badge-pending' },
    booked_changed: {
      label: 'Afstemt · ændret post',
      tone: 'bg-red-50 text-red-800',
    },
    booked: { label: 'Bogført', tone: 'badge-booked' },
    failed: {
      label: 'Fejlet - Kræver manuel handling',
      tone: 'bg-red-50 text-red-800',
    },
    failed_retry: {
      label: 'Fejlet - afventer nyt forsøg',
      tone: 'badge-pending',
    },
    failed_manual: {
      label: 'Fejlet - Kræver manuel handling',
      tone: 'bg-red-50 text-red-800',
    },
    draft: { label: 'Kladde i Dinero', tone: 'bg-blue-50 text-blue-800' },
    pending: { label: 'Afventer', tone: 'badge-pending' },
    prepared: { label: 'Afventer', tone: 'badge-pending' },
    creating: { label: 'Overfører…', tone: 'badge-pending' },
    recovering: { label: 'Kontrollerer…', tone: 'badge-pending' },
    booking: { label: 'Bogfører…', tone: 'badge-pending' },
    uncertain: {
      label: 'Fejlet - Kræver manuel handling',
      tone: 'bg-red-50 text-red-800',
    },
    held: { label: 'Fejlet - Kræver manuel handling', tone: 'badge-pending' },
    expected: { label: 'Afventer udbetaling', tone: 'badge-pending' },
    not_enabled: {
      label: 'Ikke understøttet',
      tone: 'bg-muted text-muted-foreground',
    },
    foreign: { label: 'Afventer · marked ikke sat op', tone: 'badge-pending' },
    check: { label: 'Kræver kontrol', tone: 'bg-red-50 text-red-800' },
    sale_pending: {
      label: 'Afventer bogføring af salget',
      tone: 'badge-pending',
    },
    cancelled: { label: 'Annulleret', tone: 'badge-booked' },
  };

// An order cancelled in Shopify before its sale was booked needs nothing more: it shows as cancelled, not waiting.
// A sale already booked, in Dinero as a draft or failed keeps its status.
const unbooked = new Set([
  'cancelled',
  'setup_required',
  'pending',
  'prepared',
  'reconciliation_required',
  'sale_pending',
  'foreign',
  'expected',
]);
export const cancelledOrder = (cancelledAt: unknown, status: string) =>
  !!cancelledAt && unbooked.has(status);

export const bookingStatusLabel = (status: string) =>
  bookingStatuses[status]?.label ?? 'Ukendt status';
