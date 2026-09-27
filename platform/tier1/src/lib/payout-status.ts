const labels: Record<string, string> = {
  PAID: 'Udbetalt', Udbetalt: 'Udbetalt',
  SCHEDULED: 'Kommende', Planlagt: 'Kommende', Kommende: 'Kommende',
  'Kommende - forventet': 'Kommende',
  IN_TRANSIT: 'Under overførsel', 'Under overførsel': 'Under overførsel',
  FAILED: 'Fejlet', Fejlet: 'Fejlet',
  CANCELED: 'Annulleret', CANCELLED: 'Annulleret', Annulleret: 'Annulleret',
  Afregnet: 'Afregnet', Beløbsdifference: 'Beløbsdifference',
};
export const payoutStatusLabel = (status: string) => labels[status] || status || 'Ukendt status';
export function payoutBookingStatus(status: string, upcoming: boolean) {
  const normalized = status === 'test' ? 'pending' : status;
  return upcoming && ['pending', 'prepared', 'expected'].includes(normalized) ? 'expected' : normalized;
}
