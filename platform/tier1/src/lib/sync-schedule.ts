export const syncIntervals = [5, 15, 30, 60] as const;
export type SyncInterval = (typeof syncIntervals)[number];

export function normalizeSyncInterval(value: unknown): SyncInterval {
  return syncIntervals.includes(value as SyncInterval)
    ? (value as SyncInterval)
    : 15;
}

export function scheduledRunIsDue(
  scheduledTime: number,
  intervalMinutes: unknown,
) {
  const interval = normalizeSyncInterval(intervalMinutes);
  return Math.floor(scheduledTime / 60_000) % interval === 0;
}

export function millisecondsToNextRun(now: number, intervalMinutes: unknown) {
  const interval = normalizeSyncInterval(intervalMinutes) * 60_000;
  return interval - (now % interval);
}
