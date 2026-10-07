// The one "Opdatér" button of a page: fetches what is new from the page's sources and fresh status for posts that
// are not finished, then reloads the page's view. It never books or sends anything; that is left to the
// automatic run (and "Prøv igen nu" / "Bogfør manuelt"). Shows when the page was last updated, or what failed.
import { RefreshCw } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { formatTime } from '@/lib/format';

export function RefreshButton({
  onRefresh,
  disabled = false,
}: {
  onRefresh: () => Promise<unknown> | void;
  disabled?: boolean;
}) {
  const [busy, setBusy] = useState(false),
    [at, setAt] = useState<Date | null>(null),
    [error, setError] = useState('');
  async function refresh() {
    setBusy(true);
    setError('');
    try {
      await onRefresh();
      setAt(new Date());
    } catch (reason) {
      setError(
        reason instanceof Error && reason.message
          ? reason.message
          : 'Siden kunne ikke opdateres.',
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="flex flex-col items-end gap-1">
      <Button
        type="button"
        variant="outline"
        className="h-10 rounded-xl px-4"
        disabled={busy || disabled}
        onClick={() => void refresh()}
      >
        <RefreshCw
          data-icon="inline-start"
          className={busy ? 'animate-spin' : ''}
        />
        {busy ? 'Opdaterer…' : 'Opdatér'}
      </Button>
      {error ? (
        <p role="alert" className="max-w-xs text-right text-xs text-red-700">
          {error}
        </p>
      ) : (
        at && (
          <p className="text-[11px] text-muted-foreground">
            Opdateret kl. {formatTime(at)}
          </p>
        )
      )}
    </div>
  );
}
