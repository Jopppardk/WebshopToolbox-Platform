'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';

export function BookingAction({
  endpoint,
  externalId,
  onDone,
}: {
  endpoint: string;
  externalId: string;
  onDone: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function book() {
    if (
      !window.confirm(
        'Bilaget oprettes og bogføres nu i Dinero. Vil du fortsætte?',
      )
    )
      return;
    setBusy(true);
    setError('');
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ externalId }),
      });
      const data = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(data.error || 'Bogføringen fejlede.');
      onDone();
    } catch (failure) {
      setError(
        failure instanceof Error ? failure.message : 'Bogføringen fejlede.',
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <div>
      <Button size="sm" variant="outline" disabled={busy} onClick={book}>
        {busy ? 'Bogfører…' : 'Bogfør nu'}
      </Button>
      {error && <p className="mt-1 max-w-56 text-xs text-red-700">{error}</p>}
    </div>
  );
}
