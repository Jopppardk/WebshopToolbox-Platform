import { Info } from 'lucide-react';

/** Shown on the demo account: everything is fictional and reset every night. */
export function DemoBanner() {
  return (
    <div
      role="note"
      className="flex items-center justify-center gap-2 bg-[#fdf1d8] px-4 py-2 text-center text-xs text-[#6b4a0c]"
    >
      <Info className="size-3.5 shrink-0" />
      <span>
        <strong>Demokonto</strong> · Alle data er fiktive og nulstilles hver
        nat. Intet sendes til Shopify, Dinero eller kunder.
      </span>
    </div>
  );
}
