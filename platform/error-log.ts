// Unexpected failures are logged with a short id that the user also sees, so support can find the
// exact log line without the customer repeating the action. Logs must never carry credentials,
// tokens or customer data, and provider errors and SQL messages can contain them, so everything
// is reduced first. Request bodies and headers are never logged.
export function redactForLog(text: string) {
  return text
    .replace(/\bBearer\s+\S+/gi, 'Bearer [skjult]')
    .replace(/([?&][^=\s&#]+=)[^&\s#]*/g, '$1[skjult]')
    .replace(/[^\s@<>"'(),;:]+@[^\s@<>"'(),;:]+\.[A-Za-z]{2,}/g, '[e-mail]')
    // Tokens, keys and invitation/feed links; ids such as UUIDs (36 characters) stay readable.
    .replace(/[A-Za-z0-9_+=-]{40,}/g, '[skjult]')
    .slice(0, 1000);
}

export function logUnexpected(error: unknown, request: Request) {
  const errorId = crypto.randomUUID().slice(0, 8);
  const message = error instanceof Error ? error.message : String(error);
  const stack = error instanceof Error && error.stack ? error.stack.split('\n').slice(1, 8).join('\n') : '';
  console.error(
    JSON.stringify({
      level: 'error',
      errorId,
      method: request.method,
      path: redactForLog(new URL(request.url).pathname),
      name: error instanceof Error ? error.name : typeof error,
      message: redactForLog(message),
      stack: redactForLog(stack),
    }),
  );
  return errorId;
}
