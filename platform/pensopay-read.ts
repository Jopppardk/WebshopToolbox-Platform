// Pensopay API v2, read-only (docs.pensopay.com, reviewed 2026-09-29).
// Only GET /account, /payments and /settlements are reachable through this client;
// no capture, refund, cancel or payout endpoints. Amounts are integer minor units.
// Not yet verified against a live Pensopay account.
export class PensopayError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
  ) {
    super(message);
  }
}
export type PensopayKeys = { apiKey: string };
export type PensopayAccount = { id: string; name: string };
export type PensopayPayment = {
  id: string;
  provider: 'pensopay';
  paymentId: string;
  orderId: string | null;
  state: string;
  date: string;
  amountMinor: number;
  authorizedMinor: number;
  capturedMinor: number;
  refundedMinor: number;
  feeMinor: number | null;
  currency: string;
  testmode: boolean;
  acquirer: string | null;
};
export type PensopaySettlement = {
  id: string;
  provider: 'pensopay';
  settlementId: string;
  currency: string;
  settled: boolean;
  periodStart: string | null;
  periodEnd: string | null;
  salesMinor: number;
  refundsMinor: number;
  chargebacksMinor: number;
  feesMinor: number;
  otherMinor: number;
  netMinor: number;
  amountMinor: number;
  date: string;
  payoutDate: string | null;
  paidDate: string | null;
  cancelled: boolean;
  reference: string | null;
};
type ObjectValue = Record<string, unknown>;
const base = 'https://api.pensopay.com/v2';

export function object(value: unknown): ObjectValue {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new PensopayError(
      'Pensopay returnerede et ukendt dataformat. Ingen poster fra denne portion er gemt.',
    );
  return value as ObjectValue;
}
export function keys(value: unknown): PensopayKeys {
  const body = object(value),
    apiKey = typeof body.apiKey === 'string' ? body.apiKey.trim() : '';
  if (!apiKey || apiKey.length > 2048 || /\s/.test(apiKey))
    throw new PensopayError(
      'Indsæt API-nøglen fra Pensopay (Indstillinger → Keys).',
    );
  return { apiKey };
}
const optional = (value: unknown) =>
  typeof value === 'string' && value.length <= 500 ? value : null;
function integer(value: unknown, what: string) {
  if (typeof value !== 'number' || !Number.isSafeInteger(value))
    throw new PensopayError(`Pensopay returnerede et ugyldigt ${what}.`);
  return value;
}
function currency(value: unknown) {
  if (typeof value !== 'string' || !/^[A-Z]{3}$/.test(value))
    throw new PensopayError('Pensopay returnerede en ukendt valuta.');
  // Minor units are only unambiguous for two-decimal currencies; others need a separate check.
  if (
    new Intl.NumberFormat('en', {
      style: 'currency',
      currency: value,
    }).resolvedOptions().maximumFractionDigits !== 2
  )
    throw new PensopayError(
      'Pensopays valuta kræver en særskilt beløbskontrol før import.',
    );
  return value;
}
function timestamp(value: unknown) {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value)))
    throw new PensopayError('Pensopay returnerede en ugyldig dato.');
  return new Date(value).toISOString();
}
function day(value: unknown, required: boolean) {
  if (value == null && !required) return null;
  if (
    typeof value !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}/.test(value) ||
    !Number.isFinite(Date.parse(value.slice(0, 10)))
  )
    throw new PensopayError('Pensopay returnerede en ugyldig dato.');
  return value.slice(0, 10);
}

type Resource = 'account' | 'payments' | 'settlements';
export async function pensopayRequest(
  credentials: PensopayKeys,
  resource: Resource,
  params: Record<string, string> = {},
): Promise<unknown> {
  const url = new URL(`${base}/${resource}`);
  for (const [key, value] of Object.entries(params)) {
    if (
      !['page', 'per_page', 'date_from', 'date_to'].includes(key) ||
      !/^[\w:.-]{1,40}$/.test(value)
    )
      throw new PensopayError('Denne Pensopay-forespørgsel er ikke tilladt.');
    url.searchParams.set(key, value);
  }
  let response: Response;
  try {
    // Manual redirects plus explicit rejection keep the bearer token on api.pensopay.com.
    response = await fetch(url, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${credentials.apiKey}`,
      },
      redirect: 'manual',
      signal: AbortSignal.timeout(15000),
    });
  } catch {
    throw new PensopayError(
      'Pensopay kunne ikke kontaktes. Prøv igen om lidt.',
    );
  }
  if (response.status >= 300 && response.status < 400) {
    await response.body?.cancel();
    throw new PensopayError(
      'Pensopay omdirigerede API-kaldet. Forbindelsen er stoppet for at beskytte API-nøglen.',
    );
  }
  if (!response.ok) {
    await response.body?.cancel();
    const operation =
      resource === 'account'
        ? 'kontooplysningerne'
        : resource === 'payments'
          ? 'betalingerne'
          : 'afregningerne';
    throw new PensopayError(
      response.status === 401
        ? 'Pensopay kunne ikke godkende API-nøglen (HTTP 401). Kontrollér nøglen under Indstillinger → Keys hos Pensopay.'
        : response.status === 403
          ? `Pensopay afviste adgang til ${operation} (HTTP 403). Kontrollér nøglens rettigheder hos Pensopay.`
          : response.status === 429
            ? 'Pensopay begrænser hentningen (HTTP 429). Vent lidt og prøv igen.'
            : `Pensopay kunne ikke hente ${operation} (HTTP ${response.status}). Prøv senere.`,
      response.status,
    );
  }
  // Bound memory; never log the response or the token.
  const reader = response.body?.getReader();
  if (!reader) throw new PensopayError('Pensopay returnerede et tomt svar.');
  let size = 0;
  let text = '';
  const decoder = new TextDecoder();
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > 2_000_000) {
        await reader.cancel();
        throw new PensopayError(
          'Pensopay returnerede for mange data. Vælg en kortere periode.',
        );
      }
      text += decoder.decode(chunk.value, { stream: true });
    }
    return JSON.parse(text + decoder.decode());
  } catch (error) {
    if (error instanceof PensopayError) throw error;
    throw new PensopayError('Pensopay returnerede ikke læsbare JSON-data.');
  }
}

export async function account(
  credentials: PensopayKeys,
): Promise<PensopayAccount> {
  // The response also carries the account's private_key; only id and a display name are kept.
  const body = object(await pensopayRequest(credentials, 'account'));
  const row =
    body.data && typeof body.data === 'object' && !Array.isArray(body.data)
      ? object(body.data)
      : body;
  const id = integer(row.id, 'konto-ID');
  if (id <= 0)
    throw new PensopayError('Pensopay returnerede et ugyldigt konto-ID.');
  const name =
    optional(row.display_name) ||
    optional(row.name) ||
    optional(row.company) ||
    `Konto ${id}`;
  return { id: String(id), name: name.slice(0, 100) };
}

export type PensopayPage<T> = { rows: T[]; page: number; lastPage: number };
function page(value: unknown): {
  data: unknown[];
  page: number;
  lastPage: number;
} {
  const body = object(value),
    meta = object(body.meta);
  if (!Array.isArray(body.data))
    throw new PensopayError(
      'Pensopays liste har et ukendt format. Formatet skal kontrolleres før import.',
    );
  const current = integer(meta.current_page, 'sidetal'),
    last = integer(meta.last_page, 'sidetal');
  if (current < 1 || last < 0 || current > Math.max(last, 1))
    throw new PensopayError('Pensopay returnerede ugyldige sidetal.');
  return { data: body.data, page: current, lastPage: last };
}

export function payment(value: unknown): PensopayPayment {
  const row = object(value),
    money = currency(row.currency);
  const paymentId = String(integer(row.id, 'betalings-ID'));
  const authorizedMinor = integer(row.amount, 'beløb'),
    capturedMinor = integer(row.captured ?? 0, 'beløb'),
    refundedMinor = integer(row.refunded ?? 0, 'beløb');
  if (typeof row.state !== 'string' || !/^[a-z_]{1,40}$/.test(row.state))
    throw new PensopayError('Pensopay-betalingen mangler status.');
  return {
    id: `pensopay:${paymentId}`,
    provider: 'pensopay',
    paymentId,
    orderId: optional(row.order_id),
    state: row.state,
    date: timestamp(row.created_at),
    amountMinor: capturedMinor || authorizedMinor,
    authorizedMinor,
    capturedMinor,
    refundedMinor,
    feeMinor: row.card_fee == null ? null : integer(row.card_fee, 'gebyr'),
    currency: money,
    testmode: row.testmode === true,
    acquirer: optional(row.acquirer),
  };
}

export function settlement(value: unknown, today: string): PensopaySettlement {
  const row = object(value),
    money = currency(row.currency);
  if (typeof row.id !== 'string' || !/^[a-zA-Z0-9-]{1,64}$/.test(row.id))
    throw new PensopayError('Pensopay returnerede et ugyldigt afregnings-ID.');
  const summary = object(row.summary),
    payout = row.payout == null ? {} : object(row.payout),
    period = row.period == null ? {} : object(row.period);
  const sum = (key: string) => integer(summary[key] ?? 0, 'afregningsbeløb');
  const payoutDate = day(payout.date, false),
    cancelled = payout.cancelled_date != null,
    settled = row.settled === true;
  const periodEnd = day(period.end_date, false);
  return {
    id: `pensopay:${row.id}`,
    provider: 'pensopay',
    settlementId: row.id,
    currency: money,
    settled,
    periodStart: day(period.start_date, false),
    periodEnd,
    salesMinor: sum('sales'),
    refundsMinor: sum('refunds'),
    chargebacksMinor: sum('chargebacks'),
    feesMinor: sum('fees'),
    otherMinor: sum('other_postings'),
    netMinor: sum('net'),
    amountMinor:
      payout.amount == null
        ? sum('net')
        : integer(payout.amount, 'udbetalingsbeløb'),
    date: payoutDate || periodEnd || today,
    payoutDate,
    // A payout counts as paid only when Pensopay has settled it and its date has passed.
    paidDate:
      settled && payoutDate && !cancelled && payoutDate <= today
        ? payoutDate
        : null,
    cancelled,
    reference: optional(payout.reference_number),
  };
}

export async function payments(
  credentials: PensopayKeys,
  from: string,
  to: string,
  pageNumber: number,
): Promise<PensopayPage<PensopayPayment>> {
  const result = page(
    await pensopayRequest(credentials, 'payments', {
      date_from: from,
      date_to: to + 'T23:59:59Z',
      per_page: '100',
      page: String(pageNumber),
    }),
  );
  if (result.data.length > 100)
    throw new PensopayError(
      'Pensopay returnerede for mange betalinger på én side.',
    );
  return {
    rows: result.data.map(payment),
    page: result.page,
    lastPage: result.lastPage,
  };
}

export async function settlements(
  credentials: PensopayKeys,
  from: string,
  to: string,
  pageNumber: number,
  today: string,
): Promise<PensopayPage<PensopaySettlement>> {
  const result = page(
    await pensopayRequest(credentials, 'settlements', {
      date_from: from,
      date_to: to,
      per_page: '50',
      page: String(pageNumber),
    }),
  );
  if (result.data.length > 50)
    throw new PensopayError(
      'Pensopay returnerede for mange afregninger på én side.',
    );
  return {
    rows: result.data.map((value) => settlement(value, today)),
    page: result.page,
    lastPage: result.lastPage,
  };
}

export const publicError = (error: unknown) =>
  error instanceof PensopayError
    ? error.message
    : 'Pensopay-handlingen mislykkedes. Prøv igen; der er ikke ændret noget hos Pensopay.';
