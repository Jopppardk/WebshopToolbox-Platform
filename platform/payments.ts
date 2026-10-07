import { collapseRepeat } from './run-cleanup';
import { requireCompany, requireWebshop } from './auth';
import { seal, unseal } from './connections';
import { jsonBody } from './invitations';
import { flatpayRead, safeAgreement, flatpayDateRange } from './flatpay-read';
import * as vb from './viabill-read';
import * as pp from './pensopay-read';
import { HttpError, reply, type Actor, type PlatformEnv } from './types';

type Saved = {
  identity: string;
  metadata_json: string;
  credentials_encrypted: string;
  start_date: string;
  revision: number;
  verified_at: string;
};
type Row = {
  id: string;
  date: string;
  paid: boolean;
  data: Record<string, unknown>;
};
const id = (v: unknown) => vb.identifier(v);
function date(v: unknown) {
  return vb.dateOnly(v);
}
function flatKeys(b: Record<string, unknown>) {
  const username = typeof b.username === 'string' ? b.username.trim() : '',
    password = typeof b.password === 'string' ? b.password : '';
  if (
    !username ||
    username.includes(':') ||
    !password ||
    username.length > 500 ||
    password.length > 2048
  )
    throw new HttpError(400, 'Udfyld Flatpay API-brugernavn og adgangskode.');
  return { username, password };
}
async function digest(value: string) {
  return Array.from(
    new Uint8Array(
      await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)),
    ),
    (v) => v.toString(16).padStart(2, '0'),
  ).join('');
}
// Payment providers with an adapter in this file. Routes follow the registry in catalog.ts,
// so a registered provider without an adapter must be refused rather than treated as another.
// Pensopay failures during connection are shown as a clear message, not a generic error.
async function pensopayErrors(work: () => Promise<Response>) {
  try {
    return await work();
  } catch (error) {
    if (error instanceof pp.PensopayError)
      throw new HttpError(422, error.message);
    throw error;
  }
}
const adapters = new Set(['flatpay', 'viabill', 'pensopay']);
// Data kinds each provider stores in payment_records; the first is the default view.
const kinds: Record<string, string[]> = {
  flatpay: ['payments', 'transactions', 'settlements'],
  viabill: ['payout', 'payment'],
  pensopay: ['settlements', 'payments'],
};
export async function handlePayments(
  request: Request,
  env: PlatformEnv,
  actor: Actor,
  company: string,
  shop: string,
  provider: string,
  action: string,
) {
  if (!adapters.has(provider))
    throw new HttpError(501, 'Integrationen er endnu ikke tilsluttet.');
  const db = env.PLATFORM_DB;
  await requireWebshop(db, actor, company, shop);
  const saved = await db
    .prepare(
      'SELECT * FROM payment_connections WHERE company_id=? AND webshop_id=? AND provider=?',
    )
    .bind(company, shop, provider)
    .first<Saved>();
  const url = new URL(request.url);
  if (request.method === 'GET') {
    if (action === 'connection')
      return reply({
        connection: saved
          ? {
              ...JSON.parse(saved.metadata_json),
              startDate: saved.start_date,
              revision: saved.revision,
              verifiedAt: saved.verified_at,
            }
          : null,
      });
    const kind = url.searchParams.get('kind') || kinds[provider][0],
      offset = Number(url.searchParams.get('offset') || 0),
      search = url.searchParams.get('search') || '';
    if (
      !kinds[provider].includes(kind) ||
      !Number.isSafeInteger(offset) ||
      offset < 0 ||
      search.length > 100
    )
      throw new HttpError(400, 'Ugyldigt filter.');
    const from = date(url.searchParams.get('from') || '1970-01-01'),
      to = date(url.searchParams.get('to') || '9999-12-31');
    if (to < from) throw new HttpError(400, 'Ugyldig periode.');
    const rows = await db
      .prepare(
        "SELECT payload_json,imported_at FROM payment_records WHERE company_id=? AND webshop_id=? AND provider=? AND kind=? AND substr(occurred_at,1,10) BETWEEN ? AND ? AND (?='' OR instr(lower(payload_json),lower(?))>0) ORDER BY occurred_at DESC,external_id LIMIT 51 OFFSET ?",
      )
      .bind(company, shop, provider, kind, from, to, search, search, offset)
      .all<{ payload_json: string; imported_at: string }>();
    return reply({
      rows: rows.results.slice(0, 50).map((r) => ({
        ...JSON.parse(r.payload_json),
        importedAt: r.imported_at,
      })),
      hasMore: rows.results.length > 50,
      offset,
    });
  }
  if (!['POST', 'PUT'].includes(request.method))
    throw new HttpError(405, 'Ugyldig handling.');
  await requireCompany(db, actor, company, true);
  if (actor.support)
    throw new HttpError(403, 'Afslut impersonering før ændring eller import.');
  const b = await jsonBody(request, 8192);
  if (action === 'connection')
    return pensopayErrors(async () => {
      const credentials =
        provider === 'flatpay'
          ? flatKeys(b)
          : provider === 'pensopay'
            ? pp.keys(b)
            : vb.keys(b);
      if (b.action === 'discover')
        return reply({
          accounts:
            provider === 'flatpay'
              ? (
                  await flatpayRead(
                    credentials as ReturnType<typeof flatKeys>,
                    'agreements',
                  )
                ).map(safeAgreement)
              : provider === 'pensopay'
                ? [await pp.account(credentials as pp.PensopayKeys)]
                : await vb.accounts(credentials as vb.ViaBillKeys),
        });
      const start = date(b.startDate);
      if (start > new Date().toISOString().slice(0, 10))
        throw new HttpError(400, 'Startdato må ikke ligge i fremtiden.');
      let metadata: Record<string, unknown>, identity: string;
      if (provider === 'flatpay') {
        const agreements = (
          await flatpayRead(
            credentials as ReturnType<typeof flatKeys>,
            'agreements',
          )
        )
          .map(safeAgreement)
          .filter((a) => a.agreementNumber === b.agreementNumber);
        if (agreements.length !== 1)
          throw new HttpError(
            409,
            'Vælg præcis én aftale fra Flatpay-kontolisten.',
          );
        metadata = { ...agreements[0], agreementId: agreements[0].id };
        identity = JSON.stringify([agreements[0].merchantID, agreements[0].id]);
      } else if (provider === 'pensopay') {
        // The key belongs to exactly one Pensopay account; its ID is the connection identity.
        const found = await pp.account(credentials as pp.PensopayKeys);
        metadata = { accountId: found.id, name: found.name };
        identity = found.id;
      } else {
        const accountId = await vb.verifyAccount(
          credentials as vb.ViaBillKeys,
          b.accountId,
        );
        metadata = {
          accountId,
          name: typeof b.name === 'string' ? b.name.slice(0, 100) : 'ViaBill',
        };
        identity = accountId;
      }
      if (saved && saved.identity !== identity)
        throw new HttpError(
          409,
          'En eksisterende forbindelse kan ikke skiftes til en anden aftale. Det beskytter historik og bogføringskvitteringer.',
        );
      if (saved && b.revision !== saved.revision)
        throw new HttpError(
          409,
          'Forbindelsen er ændret. Genindlæs før lagring.',
        );
      const encrypted = await seal(
        env,
        [company, shop, provider, identity],
        credentials,
      );
      const result = await db.batch([
        db
          .prepare(
            `INSERT INTO payment_connections(company_id,webshop_id,provider,identity,metadata_json,credentials_encrypted,start_date) VALUES(?,?,?,?,?,?,?) ON CONFLICT(company_id,webshop_id,provider) DO UPDATE SET metadata_json=excluded.metadata_json,credentials_encrypted=excluded.credentials_encrypted,start_date=excluded.start_date,revision=payment_connections.revision+1,verified_at=CURRENT_TIMESTAMP WHERE payment_connections.revision=?`,
          )
          .bind(
            company,
            shop,
            provider,
            identity,
            JSON.stringify(metadata),
            encrypted,
            start,
            saved?.revision || 0,
          ),
        db
          .prepare(
            "INSERT INTO audit_events(id,company_id,actor_id,action,resource_id,details_json) SELECT ?,?,?,'payment.connection',?,? WHERE changes()=1",
          )
          .bind(
            crypto.randomUUID(),
            company,
            actor.id,
            shop,
            JSON.stringify({ provider }),
          ),
      ]);
      if (result[0].meta.changes !== 1)
        throw new HttpError(409, 'Forbindelsen er ændret. Genindlæs.');
      return reply({ ok: true });
    });
  if (!saved)
    throw new HttpError(
      409,
      'Forbind betalingsudbyderen under Integrationer først.',
    );
  const start = date(b.start),
    end = date(b.end);
  if (
    start < saved.start_date ||
    end < start ||
    end > new Date().toISOString().slice(0, 10)
  )
    throw new HttpError(
      400,
      'Vælg en periode fra integrationens startdato til i dag.',
    );
  const credentials = await unseal(
      env,
      [company, shop, provider, saved.identity],
      saved.credentials_encrypted,
    ),
    metadata = JSON.parse(saved.metadata_json);
  const run = crypto.randomUUID();
  await db
    .prepare(
      "INSERT INTO operation_runs(id,company_id,webshop_id,module,status) VALUES(?,?,?,?,'running')",
    )
    .bind(run, company, shop, provider)
    .run();
  try {
    let rows: Row[] = [],
      next: unknown = null;
    const kind = String(b.kind);
    if (provider === 'flatpay') {
      flatpayDateRange(start, end, saved.start_date);
      if (!['transactions', 'settlements', 'payments'].includes(kind))
        throw new HttpError(400, 'Vælg en Flatpay-datatype.');
      const resource = kind as 'transactions' | 'settlements' | 'payments',
        field =
          kind === 'transactions'
            ? 'PurchaseDate'
            : kind === 'settlements'
              ? 'CreatedDate'
              : 'PaidDate';
      const data = await flatpayRead(credentials, resource, {
        [field + 'From']: start + 'T00:00:00Z',
        [field + 'To']: end + 'T23:59:59.999Z',
        ...(kind === 'settlements'
          ? { AgreementNumber: metadata.agreementNumber }
          : {}),
      });
      const until = new Date(Date.now() + 30 * 86400000)
          .toISOString()
          .slice(0, 10),
        recent = new Date(Date.now() - 14 * 86400000)
          .toISOString()
          .slice(0, 10);
      if (kind === 'payments' && b.includeUpcoming !== false)
        data.push(
          ...(
            await flatpayRead(credentials, 'payments', {
              ScheduledDateFrom: recent + 'T00:00:00Z',
              ScheduledDateTo: until + 'T23:59:59.999Z',
            })
          ).filter((r) => r.paidDate == null),
        );
      const unique = new Map<string, Row>();
      for (const r of data) {
        if (r.merchantID !== metadata.merchantID) continue;
        const owns =
          kind === 'payments'
            ? r.agreementNumber === metadata.agreementNumber
            : kind === 'transactions'
              ? r.agreementID === metadata.agreementId
              : (r.agreementNumber === metadata.agreementNumber ||
                  r.agreementID === metadata.agreementId) &&
                (r.agreementNumber == null ||
                  r.agreementNumber === metadata.agreementNumber) &&
                (r.agreementID == null ||
                  r.agreementID === metadata.agreementId);
        if (!owns) continue;
        const rawDate =
          kind === 'transactions'
            ? r.purchaseDate
            : kind === 'settlements'
              ? r.createdDate
              : (r.paidDate ?? r.scheduledDate);
        if (
          typeof rawDate !== 'string' ||
          !Number.isFinite(Date.parse(rawDate))
        )
          throw new HttpError(409, 'Flatpay-posten mangler en gyldig dato.');
        const day = date(rawDate.slice(0, 10)),
          upcoming = kind === 'payments' && r.paidDate == null;
        if (day < (upcoming ? recent : start) || day > (upcoming ? until : end))
          continue;
        const external = id(
          kind === 'transactions'
            ? r.transactionID
            : kind === 'payments'
              ? r.paymentID
              : (r.settlementNumber ?? r.settlementID ?? r.id),
        );
        if (typeof r.currency !== 'string' || !/^[A-Z]{3}$/.test(r.currency))
          throw new HttpError(409, 'Flatpay-posten mangler valuta.');
        const amount =
          kind === 'transactions'
            ? r.grossAmount
            : kind === 'payments'
              ? r.payoutAmount
              : r.payout;
        if (typeof amount !== 'number' || !Number.isFinite(amount))
          throw new HttpError(409, 'Flatpay-posten mangler beløb.');
        const row = { id: external, date: rawDate, paid: !upcoming, data: r };
        const previous = unique.get(external);
        if (
          previous &&
          previous.paid === row.paid &&
          JSON.stringify(previous.data) !== JSON.stringify(row.data)
        )
          throw new HttpError(
            409,
            'Flatpay returnerede modstridende data for samme post.',
          );
        if (!previous || row.paid) unique.set(external, row);
      }
      rows = [...unique.values()];
      // Flatpay creates the bank payment only when it is paid. Until then an upcoming payout exists
      // only as a settlement with a scheduled date and an expected net amount (an estimate, never
      // booked or reported). Settlements already covered by a paid payment are skipped.
      if (kind === 'payments' && b.includeUpcoming !== false) {
        const paidRows = (
          await db
            .prepare(
              "SELECT json_extract(payload_json,'$.settlements') settlements FROM payment_records WHERE company_id=? AND webshop_id=? AND provider='flatpay' AND kind='payments' AND paid=1 AND occurred_at>=?",
            )
            .bind(company, shop, recent)
            .all<{ settlements: string | null }>()
        ).results;
        const covered = new Set(
          [
            ...paidRows.map((r) => r.settlements),
            ...rows
              .filter((r) => r.paid)
              .map((r) => String((r.data as any).settlements ?? '')),
          ]
            .flatMap((v) => String(v || '').split(/[,;\s]+/))
            .filter(Boolean),
        );
        const scheduled = await flatpayRead(credentials, 'settlements', {
          AgreementNumber: metadata.agreementNumber,
          ScheduledDateFrom: recent + 'T00:00:00Z',
          ScheduledDateTo: until + 'T23:59:59.999Z',
        });
        for (const s of scheduled) {
          const owns =
            s.merchantID === metadata.merchantID &&
            (s.agreementNumber === metadata.agreementNumber ||
              s.agreementID === metadata.agreementId) &&
            (s.agreementNumber == null ||
              s.agreementNumber === metadata.agreementNumber) &&
            (s.agreementID == null || s.agreementID === metadata.agreementId);
          if (
            !owns ||
            s.paidDate != null ||
            covered.has(String(s.settlementNumber))
          )
            continue;
          if (
            typeof s.settlementNumber !== 'string' ||
            !/^\d{1,30}$/.test(s.settlementNumber) ||
            typeof s.scheduledDate !== 'string' ||
            !Number.isFinite(Date.parse(s.scheduledDate)) ||
            typeof s.netSettlement !== 'number' ||
            !Number.isFinite(s.netSettlement) ||
            typeof s.currency !== 'string' ||
            !/^[A-Z]{3}$/.test(s.currency)
          )
            throw new HttpError(
              409,
              'Flatpay returnerede en ufuldstændig kommende afregning.',
            );
          const day = date(s.scheduledDate.slice(0, 10));
          if (day < recent || day > until) continue;
          rows.push({
            id: 'upcoming:' + s.settlementNumber,
            date: s.scheduledDate,
            paid: false,
            data: {
              paymentID: null,
              source: 'settlement',
              estimate: true,
              settlementNumber: s.settlementNumber,
              settlements: s.settlementNumber,
              scheduledDate: s.scheduledDate,
              paidDate: null,
              currency: s.currency,
              payoutAmount: s.netSettlement,
              merchantID: s.merchantID,
              agreementNumber: metadata.agreementNumber,
            },
          });
        }
      }
    } else if (provider === 'pensopay') {
      if (!['payments', 'settlements'].includes(kind))
        throw new HttpError(400, 'Vælg betalinger eller afregninger.');
      const today = new Date().toISOString().slice(0, 10),
        cursor = b.cursor as Record<string, unknown> | undefined,
        pageNumber = cursor?.page ?? 1;
      // Settlements are selected by payout date; look ahead so upcoming payouts are shown as such.
      const until =
        kind === 'settlements'
          ? new Date(Date.parse(end) + 60 * 86400000).toISOString().slice(0, 10)
          : end;
      const scope = await digest(
        JSON.stringify([
          company,
          shop,
          saved.identity,
          saved.revision,
          kind,
          start,
          end,
        ]),
      );
      if (
        !Number.isSafeInteger(pageNumber) ||
        Number(pageNumber) < 1 ||
        Number(pageNumber) > 1000 ||
        (cursor && cursor.scope !== scope)
      )
        throw new HttpError(
          400,
          'Fortsættelsen passer ikke til denne konto og periode.',
        );
      const credentialsPp = credentials as pp.PensopayKeys;
      const result =
        kind === 'payments'
          ? await pp.payments(credentialsPp, start, end, Number(pageNumber))
          : await pp.settlements(
              credentialsPp,
              start,
              until,
              Number(pageNumber),
              today,
            );
      if (result.page !== Number(pageNumber))
        throw new HttpError(
          409,
          'Pensopay returnerede en anden side end forespurgt. Import er stoppet.',
        );
      const ids = result.rows.map((r) => r.id);
      if (new Set(ids).size !== ids.length)
        throw new HttpError(409, 'Pensopay returnerede gentagne poster.');
      for (const record of result.rows) {
        rows.push(
          'paymentId' in record
            ? {
                id: record.paymentId,
                date: record.date,
                paid: true,
                data: record,
              }
            : {
                id: record.settlementId,
                date: record.date,
                paid: record.paidDate !== null,
                data: record,
              },
        );
      }
      if (result.page < result.lastPage)
        next = { scope, page: result.page + 1 };
    } else {
      if (!['payment', 'payout'].includes(kind))
        throw new HttpError(400, 'Vælg betaling eller udbetaling.');
      const pageLength = kind === 'payment' ? 50 : 5,
        cursor = b.cursor as Record<string, unknown> | undefined,
        first = cursor?.first ?? 1;
      const scope = await digest(
        JSON.stringify([
          company,
          shop,
          saved.identity,
          saved.revision,
          kind,
          start,
          end,
        ]),
      );
      if (
        !Number.isSafeInteger(first) ||
        Number(first) < 1 ||
        Number(first) > 100000 ||
        (Number(first) - 1) % pageLength ||
        (cursor &&
          (cursor.scope !== scope ||
            typeof cursor.hash !== 'string' ||
            !/^[a-f0-9]{64}$/.test(cursor.hash)))
      )
        throw new HttpError(
          400,
          'Fortsættelsen passer ikke til denne konto og periode.',
        );
      const data = vb.list(
        await vb.viabillRequest(
          credentials,
          `/public/merchant/accounts/${id(metadata.accountId)}/entries/download/JSON`,
          {
            filter: {
              transactions: kind === 'payment',
              transfers: kind === 'payout',
              dateRange: { startDate: start, endDate: end },
            },
            entryPage: { first, pageLength },
            sorting: [],
          },
        ),
        'entries',
      );
      if (data.length > pageLength)
        throw new HttpError(409, 'ViaBill returnerede for mange poster.');
      const ids = data.map((r) => id(vb.object(r).entryUUID));
      if (new Set(ids).size !== ids.length)
        throw new HttpError(409, 'ViaBill returnerede gentagne poster.');
      const hash = await digest(ids.slice().sort().join('|'));
      if (data.length && cursor?.hash === hash)
        throw new HttpError(
          409,
          'ViaBill gentog forrige side. Import er stoppet.',
        );
      for (const value of data) {
        const r = vb.object(value);
        let record: vb.ViaBillRecord | null;
        if (kind === 'payment') record = vb.payment(r, metadata.accountId);
        else {
          if (typeof r.type !== 'string')
            throw new HttpError(409, 'ViaBill-posten mangler type.');
          if (r.type.toLowerCase() !== 'transfer') continue;
          const external = id(r.entryUUID);
          record = vb.payout(
            await vb.viabillRequest(
              credentials,
              `/public/merchant/accounts/${id(metadata.accountId)}/payout/${external}`,
            ),
            metadata.accountId,
            external,
          );
        }
        if (record && record.date >= start && record.date <= end)
          rows.push({
            id: record.entryUUID,
            date: record.date,
            paid: true,
            data: record,
          });
      }
      if (data.length === pageLength)
        next = { scope, first: Number(first) + pageLength, hash };
    }
    // A single transaction also checks that credentials were not replaced during the read.
    // The NOT NULL constraint makes a changed revision abort the entire batch.
    if (rows.length > 1000)
      throw new HttpError(
        409,
        'Vælg en kortere periode med højst 1000 poster.',
      );
    await db.batch([
      db
        .prepare(
          'UPDATE payment_connections SET metadata_json=CASE WHEN revision=? THEN metadata_json ELSE NULL END WHERE company_id=? AND webshop_id=? AND provider=?',
        )
        .bind(saved.revision, company, shop, provider),
      ...rows
        .filter((r) => provider === 'flatpay' && kind === 'payments' && r.paid)
        .flatMap((r) =>
          String((r.data as any).settlements ?? '')
            .split(/[,;\s]+/)
            .filter((v) => /^\d{1,30}$/.test(v)),
        )
        .map((sn) =>
          db
            .prepare(
              "DELETE FROM payment_records WHERE company_id=? AND webshop_id=? AND provider='flatpay' AND kind='payments' AND paid=0 AND external_id=?",
            )
            .bind(company, shop, 'upcoming:' + sn),
        ),
      ...rows.map((r) =>
        db
          .prepare(
            `INSERT INTO payment_records(company_id,webshop_id,provider,kind,external_id,occurred_at,payload_json,paid) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(company_id,webshop_id,provider,kind,external_id) DO UPDATE SET occurred_at=excluded.occurred_at,payload_json=excluded.payload_json,paid=excluded.paid,imported_at=CURRENT_TIMESTAMP WHERE excluded.paid=1 OR payment_records.paid=0`,
          )
          .bind(
            company,
            shop,
            provider,
            kind,
            r.id,
            r.date,
            JSON.stringify(r.data),
            r.paid ? 1 : 0,
          ),
      ),
      db
        .prepare(
          "UPDATE operation_runs SET status='success',count=?,finished_at=CURRENT_TIMESTAMP WHERE id=?",
        )
        .bind(rows.length, run),
    ]);
    // A quiet repeat of the previous run is merged into it; never fails the run itself.
    await collapseRepeat(db, run).catch(() => false);
    return reply({ count: rows.length, next, externalWrites: 'blocked' });
  } catch (error) {
    await db
      .prepare(
        "UPDATE operation_runs SET status='failed',message=?,finished_at=CURRENT_TIMESTAMP WHERE id=?",
      )
      .bind(
        'Betalingsimporten mislykkedes. Kontrollér forbindelsen og perioden.',
        run,
      )
      .run();
    if (error instanceof HttpError) throw error;
    if (error instanceof vb.ViaBillError || error instanceof pp.PensopayError)
      throw new HttpError(422, error.message);
    throw new HttpError(
      422,
      'Betalingsdata kunne ikke hentes eller valideres. Ingen poster fra denne portion er gemt.',
    );
  }
}
