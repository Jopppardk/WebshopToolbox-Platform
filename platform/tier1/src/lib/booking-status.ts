export const bookingStatuses: Record<string, { label: string; tone: string }> = {
  setup_required: { label: 'Vælg bogføringsstart', tone: 'badge-pending' },
  historical: { label: 'Før bogføringsstart', tone: 'bg-muted text-muted-foreground' },
  reconciliation_required: { label: 'Kræver afstemning', tone: 'badge-pending' },
  booked_changed: { label: 'Afstemt · ændret post', tone: 'bg-red-50 text-red-800' },
  booked: { label: 'Bogført', tone: 'badge-booked' },
  failed: { label: 'Fejlet', tone: 'bg-red-50 text-red-800' },
  draft: { label: 'Kladde i Dinero', tone: 'bg-blue-50 text-blue-800' },
  pending: { label: 'Afventer', tone: 'badge-pending' },
  prepared: { label: 'Afventer', tone: 'badge-pending' },
  creating: { label: 'Overfører…', tone: 'badge-pending' },
  recovering: { label: 'Kontrollerer…', tone: 'badge-pending' },
  booking: { label: 'Bogfører…', tone: 'badge-pending' },
  uncertain: { label: 'Kræver kontrol', tone: 'bg-red-50 text-red-800' },
  held: { label: 'Kræver kontrol', tone: 'badge-pending' },
  expected: { label: 'Afventer udbetaling', tone: 'badge-pending' },
  not_enabled: { label: 'Ikke understøttet', tone: 'bg-muted text-muted-foreground' },
};

export const bookingStatusLabel = (status: string) => bookingStatuses[status]?.label ?? 'Ukendt status';
