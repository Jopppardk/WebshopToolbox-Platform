import { Badge } from '@/components/ui/badge';

const statuses: Record<string, { label: string; tone: string }> = {
  booked: { label: 'Bogført', tone: 'badge-booked' },
  failed: { label: 'Fejlet', tone: 'bg-red-50 text-red-800' },
  draft: { label: 'Kladde i Dinero', tone: 'bg-blue-50 text-blue-800' },
  pending: { label: 'Afventer', tone: 'badge-pending' },
  prepared: { label: 'Afventer', tone: 'badge-pending' },
  creating: { label: 'Overfører…', tone: 'badge-pending' },
  booking: { label: 'Bogfører…', tone: 'badge-pending' },
  uncertain: { label: 'Kræver kontrol', tone: 'bg-red-50 text-red-800' },
  held: { label: 'Afventer afklaring', tone: 'badge-pending' },
  expected: { label: 'Afventer udbetaling', tone: 'badge-pending' },
  not_enabled: { label: 'Ikke understøttet', tone: 'bg-muted text-muted-foreground' },
};

export function BookingStatus({ status }: { status: string }) {
  const value = statuses[status] ?? { label: 'Ukendt status', tone: 'bg-muted text-muted-foreground' };
  return <Badge variant="secondary" className={value.tone}>{value.label}</Badge>;
}
