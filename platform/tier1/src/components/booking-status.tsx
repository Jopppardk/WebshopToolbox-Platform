import { Badge } from '@/components/ui/badge';

import { bookingStatuses } from '@/lib/booking-status';

export function BookingStatus({ status }: { status: string }) {
  const value = bookingStatuses[status] ?? { label: 'Ukendt status', tone: 'bg-muted text-muted-foreground' };
  return <Badge variant="secondary" className={value.tone}>{value.label}</Badge>;
}
