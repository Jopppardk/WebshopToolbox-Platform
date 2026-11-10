import { markTick } from './ops-monitor';
import type { PlatformEnv } from './types';

// Work that runs on each scheduler tick beside the webshop jobs: tracking, feeds and custom apps.
export type SideWork = Record<string, () => Promise<unknown>>;
// A part that takes longer than this is logged as slow, so it can be found in Workers Logs.
const slowMs = 60000;

/**
 * One production scheduler tick. The heartbeat (/healthz/scheduler and the operations alarm) follows only the
 * webshop jobs: it is closed as soon as the due webshops are queued (or run, without a queue). Tracking, feeds and
 * custom apps run after that, each on its own with its own log line, so a slow carrier lookup or a long shop sync
 * can no longer make the whole scheduler look stopped. The operations check runs between the two.
 */
export async function scheduledTick<T>(
  env: PlatformEnv,
  jobs: () => Promise<T>,
  side: SideWork,
  check: () => Promise<unknown>,
): Promise<T> {
  let result: T | undefined,
    failure: unknown,
    failed = false;
  try {
    await markTick(env, 'start');
    result = await jobs();
    await markTick(env, 'ok');
  } catch (error) {
    failed = true;
    failure = error;
    try {
      await markTick(env, 'error', error);
    } catch {
      /* The original error is what matters. */
    }
  }
  try {
    await check();
  } catch (error) {
    console.error('Driftsovervågningen fejlede', error);
  }
  await Promise.all(
    Object.entries(side).map(async ([name, work]) => {
      const started = Date.now();
      try {
        await work();
      } catch (error) {
        console.error(`Planlagt kørsel fejlede: ${name}`, error);
      } finally {
        const ms = Date.now() - started;
        if (ms > slowMs)
          console.warn(`Planlagt kørsel var langsom: ${name} (${ms} ms)`);
      }
    }),
  );
  if (failed) throw failure;
  return result as T;
}
