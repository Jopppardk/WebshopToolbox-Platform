import { asText } from './tier1/src/lib/format';
import { HttpError } from './types';
import { parseEntries } from './finance-calculations';

export type PreviewAccount = {
  number: string;
  name: string;
  vatCode: string;
  kind: 'entry' | 'deposit';
  hidden: boolean;
};

// Authentication plus GETs only. This helper never creates a voucher or invoice.
export async function readDineroAccounts(
  supplied: Record<string, string>,
): Promise<PreviewAccount[]> {
  const credentials = supplied;
  if (!credentials) throw new Error('Dinero er endnu ikke forbundet.');
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
    throw new Error('Dinero-adgangen kunne ikke fornyes.');
  const headers = {
    Authorization: `Bearer ${token.access_token}`,
    Accept: 'application/json',
  };
  const accounts = new Map<string, PreviewAccount>();
  const kinds = ['entry', 'deposit'] as const;
  const reads = await Promise.allSettled(
    kinds.map(async (kind) => {
      const fields =
        kind === 'entry'
          ? 'AccountNumber,Name,VatCode,Category'
          : 'AccountNumber,Name,IsDefault,IsHidden';
      const response = await fetch(
        `https://api.dinero.dk/v1/${encodeURIComponent(credentials.organizationId)}/accounts/${kind}?fields=${fields}`,
        {
          headers,
          cache: 'no-store',
          redirect: 'manual',
          signal: AbortSignal.timeout(20000),
        },
      );
      if (!response.ok)
        throw new Error(
          `Kontoplanen kunne ikke hentes fra Dinero (HTTP ${response.status}). Kontrollér organisation og API-adgang.`,
        );
      const payload = (await response.json()) as
        | Record<string, unknown>
        | unknown[];
      const collection = Array.isArray(payload)
        ? payload
        : (payload?.collection ?? payload?.Collection);
      if (!Array.isArray(collection))
        throw new Error('Dinero returnerede en ukendt kontoplan.');
      return collection as Record<string, unknown>[];
    }),
  );
  const failed = reads.find((result) => result.status === 'rejected');
  if (failed?.status === 'rejected') throw failed.reason;
  // Merge deterministically after both reads; preserve VAT/conflict checks.
  for (const [index, kind] of kinds.entries()) {
    const result = reads[index];
    if (result.status !== 'fulfilled')
      throw new Error('Kontoplanen kunne ikke hentes.');
    for (const raw of result.value) {
      const number = asText(raw.accountNumber ?? raw.AccountNumber ?? '');
      const name = asText(raw.name ?? raw.Name ?? '')
        .trim()
        .replace(/\s+/g, ' ');
      if (!/^\d+$/.test(number) || !name)
        throw new Error('Dinero returnerede en ugyldig konto.');
      const next: PreviewAccount = {
        number,
        name,
        vatCode: asText(raw.vatCode ?? raw.VatCode ?? '').trim(),
        kind,
        hidden: (raw.isHidden ?? raw.IsHidden) === true,
      };
      const previous = accounts.get(number);
      if (previous) {
        if (
          previous.name.toLocaleLowerCase('da') !==
            name.toLocaleLowerCase('da') ||
          (kind === 'entry' && previous.vatCode !== next.vatCode) ||
          (kind === 'deposit' &&
            next.vatCode &&
            next.vatCode !== previous.vatCode)
        )
          throw new Error(
            `Dinero returnerede modstridende oplysninger for konto ${number}. Den gemte kontoplan bevares.`,
          );
        // Deposit omits VAT; preserve entry VAT and mark the shared account as a deposit.
        accounts.set(number, {
          ...previous,
          kind: kind === 'deposit' ? 'deposit' : previous.kind,
          hidden: previous.hidden || next.hidden,
        });
      } else accounts.set(number, next);
    }
  }
  return [...accounts.values()].sort(
    (a, b) => Number(a.number) - Number(b.number),
  );
}

export type DineroSupplier = {
  id: string;
  name: string;
  country: string;
  vatNumber: string;
};
export type SupplierSnapshot = {
  suppliers: DineroSupplier[];
  fetchedAt: string;
};
export function supplierContact(
  raw: Record<string, unknown>,
): DineroSupplier | null {
  const creditor = raw.IsCreditor ?? raw.isCreditor;
  if (typeof creditor !== 'boolean')
    throw Error('Dinero returnerede ikke leverandørmarkeringen.');
  if (!creditor || (raw.DeletedAt ?? raw.deletedAt)) return null;
  const id = raw.ContactGuid ?? raw.contactGuid,
    name = raw.Name ?? raw.name;
  const country = raw.CountryKey ?? raw.countryKey ?? '',
    vat = raw.VatNumber ?? raw.vatNumber ?? '';
  if (
    typeof id !== 'string' ||
    !/^[\da-f]{8}(-[\da-f]{4}){3}-[\da-f]{12}$/i.test(id) ||
    typeof name !== 'string' ||
    !name.trim() ||
    typeof country !== 'string' ||
    typeof vat !== 'string'
  )
    throw Error('Dinero returnerede ugyldige leverandøroplysninger.');
  return {
    id,
    name: name.trim(),
    country: country.trim().toUpperCase(),
    vatNumber: vat.trim(),
  };
}

// Only authenticates and reads contacts; no contact or accounting writes.
export async function readDineroSuppliers(
  credentials: Record<string, string>,
): Promise<DineroSupplier[]> {
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
  if (!tokenResponse.ok) throw Error('Dinero-adgangen kunne ikke fornyes.');
  const token = (await tokenResponse.json()) as { access_token?: string };
  if (!token.access_token) throw Error('Dinero-adgangen kunne ikke fornyes.');
  const suppliers = new Map<string, DineroSupplier>();
  for (let page = 0; page < 100; page++) {
    const query = new URLSearchParams({
      fields: 'ContactGuid,Name,CountryKey,VatNumber,IsCreditor,DeletedAt',
      page: String(page),
      pageSize: '1000',
      deletedOnly: 'false',
    });
    const response = await fetch(
      `https://api.dinero.dk/v1/${encodeURIComponent(credentials.organizationId)}/contacts?${query}`,
      {
        method: 'GET',
        redirect: 'manual',
        cache: 'no-store',
        signal: AbortSignal.timeout(20000),
        headers: {
          Authorization: `Bearer ${token.access_token}`,
          Accept: 'application/json',
        },
      },
    );
    if (!response.ok)
      throw Error(
        `Leverandørerne kunne ikke hentes fra Dinero (HTTP ${response.status}).`,
      );
    const payload = (await response.json()) as Record<string, any>;
    const pagination = payload.Pagination ?? payload.pagination;
    const total =
      pagination?.ResultWithoutFilter ?? pagination?.resultWithoutFilter;
    const rows =
      payload.Collection ?? payload.collection ?? (total === 0 ? [] : null);
    if (
      !Array.isArray(rows) ||
      !pagination ||
      (pagination.Page ?? pagination.page) !== page ||
      (pagination.PageSize ?? pagination.pageSize) !== 1000 ||
      !Number.isSafeInteger(total) ||
      total < 0
    )
      throw Error(
        'Dinero returnerede en ukendt leverandørliste eller sideopdeling.',
      );
    for (const raw of rows) {
      const supplier = supplierContact(raw);
      if (supplier) {
        if (suppliers.has(supplier.id))
          throw Error(
            'Dinero gentog en leverandør under hentningen. Prøv igen.',
          );
        suppliers.set(supplier.id, supplier);
      }
    }
    if ((page + 1) * 1000 >= total)
      return [...suppliers.values()].sort(
        (a, b) =>
          a.name.localeCompare(b.name, 'da') || a.id.localeCompare(b.id),
      );
    if (rows.length !== 1000)
      throw Error(
        'Dinero returnerede en ufuldstændig kontaktliste. Prøv igen.',
      );
  }
  throw Error('Leverandørlisten er for stor til én hentning.');
}

const guidPattern = /^[\da-f]{8}(-[\da-f]{4}){3}-[\da-f]{12}$/i;
export async function readExistingVoucher(
  credentials: Record<string, string>,
  guid: string,
) {
  if (!guidPattern.test(guid))
    throw new HttpError(400, 'Angiv bilagets GUID fra Dinero.');
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
  if (!tokenResponse.ok)
    throw new HttpError(409, 'Dinero-adgangen kunne ikke fornyes.');
  const token = (await tokenResponse.json()) as { access_token?: string };
  if (!token.access_token)
    throw new HttpError(409, 'Dinero-adgangen kunne ikke fornyes.');
  const response = await fetch(
    `https://api.dinero.dk/v1/${encodeURIComponent(credentials.organizationId)}/vouchers/manuel/${guid}`,
    {
      method: 'GET',
      redirect: 'manual',
      cache: 'no-store',
      signal: AbortSignal.timeout(20000),
      headers: {
        Authorization: `Bearer ${token.access_token}`,
        Accept: 'application/json',
      },
    },
  );
  if (!response.ok)
    throw new HttpError(
      409,
      'Bilaget kunne ikke læses fra den tilknyttede Dinero-organisation.',
    );
  const raw = (await response.json()) as Record<string, any>;
  const voucher = {
    guid: String(raw.Guid ?? raw.guid ?? '').toLowerCase(),
    status: raw.Status ?? raw.status,
    timestamp: raw.Timestamp ?? raw.timestamp,
    date: raw.VoucherDate ?? raw.voucherDate,
    reference: raw.ExternalReference ?? raw.externalReference ?? '',
    number: raw.VoucherNumber ?? raw.voucherNumber ?? null,
    lines: raw.Lines ?? raw.lines,
  };
  if (
    voucher.guid !== guid.toLowerCase() ||
    !['Booked', 'Draft'].includes(voucher.status) ||
    typeof voucher.timestamp !== 'string' ||
    !voucher.timestamp ||
    typeof voucher.date !== 'string' ||
    !Array.isArray(voucher.lines) ||
    !voucher.lines.length
  )
    throw new HttpError(
      409,
      'Dinero returnerede et ufuldstændigt eller ukendt bilag.',
    );
  return voucher;
}

// Booked balance of one account from the start of today's accounting year to today, primo included.
// Authenticates and reads; never writes. Drafts are not entries and are not part of the balance.
export async function readDineroAccountBalance(
  credentials: Record<string, string>,
  account: number,
  today: string,
) {
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
  if (!tokenResponse.ok) throw Error('Dinero-adgangen kunne ikke fornyes.');
  const token = (await tokenResponse.json()) as { access_token?: string };
  if (!token.access_token) throw Error('Dinero-adgangen kunne ikke fornyes.');
  const read = async (path: string) => {
    const response = await fetch(
      `https://api.dinero.dk/v1/${encodeURIComponent(credentials.organizationId)}/${path}`,
      {
        method: 'GET',
        redirect: 'manual',
        cache: 'no-store',
        signal: AbortSignal.timeout(20000),
        headers: {
          Authorization: `Bearer ${token.access_token}`,
          Accept: 'application/json',
        },
      },
    );
    if (!response.ok)
      throw Error(
        `Lagerkontoen kunne ikke hentes fra Dinero (HTTP ${response.status}).`,
      );
    return response.json();
  };
  const years = (await read('accountingyears')) as Array<{
    FromDate: string;
    ToDate: string;
  }>;
  if (
    !Array.isArray(years) ||
    years.some(
      (y) =>
        !/^\d{4}-\d{2}-\d{2}$/.test(y?.FromDate) ||
        !/^\d{4}-\d{2}-\d{2}$/.test(y?.ToDate),
    )
  )
    throw Error('Dinero returnerede ukendte regnskabsår.');
  const year = years.find((y) => y.FromDate <= today && y.ToDate >= today);
  if (!year)
    throw Error('Dinero har intet regnskabsår, der omfatter dags dato.');
  const entries = parseEntries(
    await read(
      'entries?' +
        new URLSearchParams({
          fromDate: year.FromDate,
          toDate: today,
          includePrimo: 'true',
        }),
    ),
  );
  if (entries.some((e) => e.date < year.FromDate || e.date > today))
    throw Error('Dinero returnerede posteringer uden for perioden.');
  const balanceMinor = entries
    .filter((e) => e.account === account && e.type !== 'Ultimo')
    .reduce((sum, e) => sum + e.minor, 0);
  if (!Number.isSafeInteger(balanceMinor))
    throw Error('Dinero returnerede en ugyldig saldo.');
  return { account, balanceMinor, from: year.FromDate, to: today };
}
