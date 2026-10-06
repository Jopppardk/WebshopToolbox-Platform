import { TransferError, normalizeRemote } from './dinero-sale';

export class DineroHttpError extends TransferError {
  constructor(
    public readonly status: number,
    public readonly detail = '',
  ) {
    super(
      `Dinero svarede HTTP ${status}. Kontrollér bilagsstatus før et nyt forsøg.`,
    );
  }
}
// Dinero's own reason for a rejected request, shortened and stripped of control characters; never credentials.
async function rejection(response: Response) {
  try {
    const text = (await response.text()).slice(0, 4000);
    let reason = text;
    try {
      const body = JSON.parse(text) as Record<string, unknown>;
      const fields = body.validationErrors ?? body.ValidationErrors;
      const listed =
        fields && typeof fields === 'object'
          ? Object.entries(fields as Record<string, unknown>)
              .map(
                ([k, v]) =>
                  `${k}: ${Array.isArray(v) ? v.join(', ') : String(v)}`,
              )
              .join('; ')
          : '';
      reason =
        [body.message ?? body.Message, listed].filter(Boolean).join(' – ') ||
        text;
    } catch {
      /* plain text */
    }
    return String(reason)
      .replace(/[\x00-\x1f\x7f]+/g, ' ')
      .trim()
      .slice(0, 300);
  } catch {
    return '';
  }
}

// This client never retries writes and never follows redirects carrying credentials.
export async function dineroClient(credentials: Record<string, string>) {
  const tokenResponse = await fetch(
    'https://authz.dinero.dk/dineroapi/oauth/token',
    {
      method: 'POST',
      redirect: 'manual',
      signal: AbortSignal.timeout(20000),
      headers: {
        Authorization: `Basic ${btoa(`${credentials.clientId}:${credentials.clientSecret}`)}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        grant_type: 'password',
        scope: 'read write',
        username: credentials.apiKey,
        password: credentials.apiKey,
      }),
    },
  );
  const token = (await tokenResponse.json()) as { access_token?: string };
  if (!tokenResponse.ok || !token.access_token)
    throw new TransferError('Dinero-adgangen kunne ikke fornyes.');
  return async (path: string, method: 'GET' | 'POST', body?: unknown) => {
    if (!/^(files|vouchers\/manuel(?:\/[\da-f-]{36}(?:\/book)?)?)$/.test(path))
      throw new TransferError('Ugyldigt Dinero-kald.');
    const multipart = body instanceof FormData;
    const response = await fetch(
      `https://api.dinero.dk/v1/${encodeURIComponent(credentials.organizationId)}/${path}`,
      {
        method,
        cache: 'no-store',
        redirect: 'manual',
        signal: AbortSignal.timeout(20000),
        headers: {
          Authorization: `Bearer ${token.access_token}`,
          Accept: 'application/json',
          ...(!multipart && body ? { 'Content-Type': 'application/json' } : {}),
        },
        body:
          method === 'GET'
            ? undefined
            : multipart
              ? body
              : JSON.stringify(body),
      },
    );
    if (!response.ok)
      throw new DineroHttpError(response.status, await rejection(response));
    return normalizeRemote(await response.json());
  };
}
