// Public contract: https://app.emballageindberetning.dk/docs/public-api (2026-09-09).
export type EIReport = {
  id: number;
  status: string;
  accepts_writes: boolean;
  submitted_at: string | null;
  due_at: string | null;
  period: { start_date: string; end_date: string; label: string };
  responsibility: { code: string; product_area: { slug: string } };
};
export type EIContext = {
  organisation: { id: number; name: string };
  api_key: { is_test: boolean };
  responsibilities: Array<{
    code: string;
    status: string;
    product_area: { slug: string; name: string };
  }>;
};
export type EIField = {
  name: string;
  type: string;
  required: boolean;
  unit: string | null;
  label: { da: string | null; en: string | null };
  constraints?: { integer?: boolean; min?: number; max?: number };
};
export type EISchema = { form_version_id: number; fields: EIField[] };
export type EIReceipt = {
  submission_number: string;
  completed_at: string;
  report_status: string;
};
export class EIError extends Error {
  constructor(
    public status: number,
    public code: string,
    public requestId: string | null = null,
  ) {
    const messages: Record<string, string> = {
      authentication_failed: 'API-nøglen blev afvist eller er udløbet.',
      forbidden: 'API-adgangen er ikke aktiveret.',
      report_closed: 'Perioden er lukket hos Emballage Indberetning.',
      report_already_submitted:
        'Perioden er allerede indberettet. Opdatér oversigten.',
      validation_failed:
        'Indberetningens felter eller værdier blev afvist. Kontrollér feltopsætningen.',
      idempotency_request_in_flight:
        'Indberetningen behandles stadig. Opdatér status om lidt.',
      rate_limit_exceeded: 'Tjenestens kaldgrænse er nået. Prøv igen senere.',
      authentication_rate_limit_exceeded:
        'For mange afviste nøgleforsøg. Kontrollér API-nøglen.',
      http_error:
        'Tjenesten afviste forespørgslen. Kontrollér formularversion og periodestatus.',
    };
    super(
      (messages[code] || 'Emballage Indberetning kunne ikke kontaktes.') +
        (status ? ` (HTTP ${status})` : ''),
    );
  }
}
export async function eiRequest<T>(
  key: string,
  path: string,
  method = 'GET',
  body?: unknown,
  idempotencyKey?: string,
): Promise<{ data: T; meta: { next_cursor?: string | null } }> {
  if (
    !/^\/(me|reports(?:\/\d+(?:\/(schema|data|submit))?)?)(?:\?.*)?$/.test(path)
  )
    throw new Error('Ugyldigt API-kald.');
  let response: Response;
  try {
    response = await fetch(
      'https://app.emballageindberetning.dk/api/public/v1' + path,
      {
        method,
        headers: {
          Authorization: 'Bearer ' + key,
          'Content-Type': 'application/json',
          'X-Request-Id': crypto.randomUUID(),
          ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
        },
        ...(method !== 'GET' && body !== undefined ? {body:JSON.stringify(body)} : {}),
        signal: AbortSignal.timeout(15000),
        redirect: 'manual',
      },
    );
  } catch {
    throw new EIError(0, 'network_error');
  }
  const value = (await response.json().catch(() => null)) as {
    data: T;
    meta: { next_cursor?: string | null };
    code?: string;
  } | null;
  if (!response.ok)
    throw new EIError(
      response.status,
      typeof value?.code === 'string' ? value.code : 'http_error',
      response.headers.get('X-Request-Id'),
    );
  if (!value || !('data' in value)) throw new EIError(502, 'invalid_response');
  return { data: value.data, meta: value.meta || {} };
}
export async function eiReports(key: string): Promise<EIReport[]> {
  const reports: EIReport[] = [],
    seen = new Set<string>();
  let cursor: string | null = null;
  for (let page = 0; page < 30; page++) {
    const r: { data: EIReport[]; meta: { next_cursor?: string | null } } =
      await eiRequest<EIReport[]>(
        key,
        '/reports?page_size=100' +
          (cursor ? '&cursor=' + encodeURIComponent(cursor) : ''),
      );
    if (!Array.isArray(r.data)) throw new EIError(502, 'invalid_response');
    for (const report of r.data) {
      if (
        !Number.isSafeInteger(report.id) ||
        !report.period?.start_date ||
        !report.period?.end_date ||
        typeof report.accepts_writes !== 'boolean'
      )
        throw new EIError(502, 'invalid_response');
      reports.push(report);
    }
    cursor = r.meta.next_cursor || null;
    if (!cursor) return reports;
    if (seen.has(cursor)) throw new EIError(502, 'invalid_pagination');
    seen.add(cursor);
  }
  throw new EIError(502, 'pagination_limit');
}
export const isSubmitted = (status: string) =>
  ['submitted', 'pending_external_invoices', 'invoiced', 'completed'].includes(
    status,
  );
