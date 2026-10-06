'use client';
import type { ReactNode } from 'react';
import { useCapabilities } from '@/platform/capabilities';

/** Text that only applies to the test environment; hidden in the production portal. */
export function TestModeNote({
  children,
  className = 'mb-4 text-xs text-muted-foreground',
}: {
  children: ReactNode;
  className?: string;
}) {
  const runtime = useCapabilities();
  if (runtime.production) return null;
  return <p className={className}>{children}</p>;
}
