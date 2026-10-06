'use client';
import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { ChevronDown } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { IntegrationGuide } from '@/components/integration-guide';
export function IntegrationCard({
  name,
  description,
  icon: Icon,
  connected,
  expanded,
  onToggle,
  panelId,
  children,
  footer,
  testMode = false,
}: {
  name: string;
  description: string;
  icon: LucideIcon;
  connected: boolean | null;
  expanded: boolean;
  onToggle: () => void;
  panelId: string;
  children: ReactNode;
  footer?: ReactNode;
  testMode?: boolean;
}) {
  return (
    <section className="overflow-hidden rounded-2xl border bg-white">
      <button
        type="button"
        className="flex min-h-24 w-full items-center gap-4 p-4 text-left transition-colors hover:bg-muted/30"
        onClick={onToggle}
        aria-expanded={expanded}
        aria-controls={panelId}
      >
        <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-muted">
          <Icon className="size-5" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block font-semibold">{name}</span>
          <span className="block text-xs text-muted-foreground">
            {description}
          </span>
        </span>
        <Badge className={connected ? 'badge-booked' : ''} variant="secondary">
          {connected === null
            ? 'Status ukendt'
            : connected
              ? testMode
                ? 'Testtilstand'
                : 'Forbundet'
              : 'Ikke forbundet'}
        </Badge>
        <ChevronDown
          className={`size-4 shrink-0 text-muted-foreground transition-transform ${expanded ? 'rotate-180' : ''}`}
        />
      </button>
      {expanded && (
        <div id={panelId} className="space-y-4 border-t bg-muted/20 p-5">
          <IntegrationGuide provider={name} />
          {children}
          {footer}
        </div>
      )}
    </section>
  );
}
