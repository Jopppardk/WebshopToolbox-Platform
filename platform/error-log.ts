// Unexpected errors are logged with a short ID that is also shown to the user (and in the bell and run log for
// automatic jobs), so a reported problem can be found in Workers Logs: Cloudflare dashboard → Workers →
// the platform Worker → Observability, search for the ID. Only the error and where it happened are logged,
// never request bodies, headers, query strings or credentials.
import { asText } from './tier1/src/lib/format';

export function logUnexpected(
  context: Record<string, string>,
  error: unknown,
): string {
  const errorId = crypto.randomUUID().slice(0, 8);
  console.error(
    JSON.stringify({
      level: 'error',
      errorId,
      ...context,
      name: error instanceof Error ? error.name : typeof error,
      message: (error instanceof Error ? error.message : asText(error)).slice(
        0,
        500,
      ),
      stack: error instanceof Error ? error.stack?.slice(0, 2000) : undefined,
    }),
  );
  return errorId;
}
