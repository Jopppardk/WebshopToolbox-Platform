import { NextRequest, NextResponse } from 'next/server';
import { prepareDatabase } from '@/db/database';
import { loadCredentials } from '@/db/credentials';
import { loadHistory } from '@/db/history';
import { recordFailure } from '@/db/errors';
import { danishDate, historyWindow, midnight, shiftMonths, type HistoryPolicy } from '@/lib/history-policy';
import { dateOnly, identifier, keys, list, object, payment, payout, publicError, ViaBillError, viabillRequest, type ViaBillRecord } from '@/lib/viabill';

const tenant = 'sablen.dk';
const reply = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
function kind(value: unknown): 'payment' | 'payout' { if (value !== 'payment' && value !== 'payout') throw new ViaBillError('ViaBill understøtter kun Betalinger og Udbetalinger her.'); return value; }
function period(from: unknown, to: unknown, policy: HistoryPolicy) {
  const cutoff = historyWindow(policy).effectiveDate;
  const start = dateOnly(from ?? cutoff); const end = dateOnly(to ?? danishDate());
  if (start > end || end > danishDate()) throw new ViaBillError('Vælg en gyldig periode frem til i dag.');
  return { from: start > cutoff ? start : cutoff, to: end };
}
export async function GET(request: NextRequest) {
  try {
    const params = request.nextUrl.searchParams; const type = kind(params.get('kind'));
    const db = await prepareDatabase(); const policy = await loadHistory(db);
    const dates = period(params.get('from') || undefined, params.get('to') || undefined, policy);
    const offset = Number(params.get('offset') || 0);
    if (!Number.isSafeInteger(offset) || offset < 0) throw new ViaBillError('Ugyldigt sidetal.');
    const search = (params.get('search') || '').trim().slice(0, 100);
    const nextDay = new Date(`${dates.to}T00:00:00Z`); nextDay.setUTCDate(nextDay.getUTCDate() + 1);
    const where = `tenant = ? AND record_type = ? AND json_extract(payload_json, '$.provider') = 'viabill'
      AND occurred_at >= ? AND occurred_at < ?
      AND (? = '' OR instr(lower(COALESCE(json_extract(payload_json, '$.orderNumber'), '') || ' ' || external_id || ' ' || COALESCE(json_extract(payload_json, '$.transactionId'), '')), lower(?)) > 0)`;
    const bindings = [tenant, type, midnight(dates.from), midnight(nextDay.toISOString().slice(0, 10)), search, search];
    if (params.get('id')) {
      const row = await db.prepare(`SELECT payload_json, booking_status FROM integration_records WHERE ${where} AND external_id = ?`).bind(...bindings, params.get('id')).first<{ payload_json: string; booking_status: string }>();
      if (!row) return reply({ error: 'Posten findes ikke i den valgte historik.' }, 404);
      return reply({ record: { ...JSON.parse(row.payload_json), bookingStatus: row.booking_status } });
    }
    const [rows, totals] = await Promise.all([
      db.prepare(`SELECT json_remove(payload_json, '$.entries') AS payload_json, booking_status FROM integration_records WHERE ${where} ORDER BY occurred_at DESC, external_id DESC LIMIT 50 OFFSET ?`).bind(...bindings, offset).all<{ payload_json: string; booking_status: string }>(),
      db.prepare(`SELECT currency, COUNT(*) AS count, SUM(amount_minor) AS amountMinor FROM integration_records WHERE ${where} GROUP BY currency`).bind(...bindings).all(),
    ]);
    return reply({ records: rows.results.map(row => ({ ...JSON.parse(row.payload_json), bookingStatus: row.booking_status })), totals: totals.results });
  } catch (error) { await recordFailure('ViaBill', { category: 'integration', cause: publicError(error) }); return reply({ error: publicError(error) }, 400); }
}
export async function POST(request: NextRequest) {
  try {
    if (request.headers.get('origin') && request.headers.get('origin') !== request.nextUrl.origin) return reply({ error: 'Ugyldig forespørgsel.' }, 403);
    const body = object(await request.json()); const type = kind(body.kind);
    const db = await prepareDatabase(); const policy = await loadHistory(db);
    const dates = period(body.from, body.to, policy);
    if (dates.from > dates.to) return reply({ synced: 0, skipped: 0, next: null, mismatches: 0 });
    const stored = await loadCredentials('viabill');
    if (!stored) throw new ViaBillError('Forbind ViaBill under Administration først.');
    const credentials = keys(stored); const accountId = identifier(stored.accountId);
    const pageLength = type === 'payout' ? 5 : 50;
    let first = 1; let previousHash = '';
    if (body.next != null) {
      const cursor = object(body.next);
      if (cursor.kind !== type || cursor.accountId !== accountId || cursor.from !== dates.from || cursor.to !== dates.to || typeof cursor.first !== 'number' || !Number.isSafeInteger(cursor.first) || cursor.first < 1 || cursor.first > 100000 || (cursor.first - 1) % pageLength || typeof cursor.hash !== 'string' || !/^[a-f0-9]{64}$/.test(cursor.hash)) throw new ViaBillError('Importens fortsættelse er ikke længere gyldig. Start hentningen igen.');
      first = cursor.first; previousHash = cursor.hash;
    }
    const exported = await viabillRequest(credentials, `/public/merchant/accounts/${accountId}/entries/download/JSON`, {
      filter: { transactions: type === 'payment', transfers: type === 'payout', dateRange: { startDate: dates.from, endDate: dates.to } },
      entryPage: { first, pageLength }, sorting: [],
    });
    const rows = list(exported, 'entries');
    if (rows.length > pageLength) throw new ViaBillError('ViaBill overholder ikke importens sidestørrelse. Vælg en kortere periode, så formatet kan kontrolleres.');
    const ids = rows.map(row => identifier(object(row).entryUUID));
    if (new Set(ids).size !== ids.length) throw new ViaBillError('ViaBill returnerede dublerede poster i samme portion. Importen er stoppet.');
    const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode([...ids].sort().join('|')))), byte => byte.toString(16).padStart(2, '0')).join('');
    if (rows.length && previousHash === hash) throw new ViaBillError('ViaBill gentog den foregående side. Importen er stoppet; perioden er ikke færdighentet.');
    const records: ViaBillRecord[] = []; let skipped = 0;
    for (const raw of rows) {
      let record: ViaBillRecord | null;
      if (type === 'payment') record = payment(raw, accountId);
      else {
        const row = object(raw);
        if (typeof row.type !== 'string' || row.type.toLowerCase() !== 'transfer') throw new ViaBillError('ViaBill returnerede en post, der ikke er en udbetaling.');
        const entryUUID = identifier(row.entryUUID);
        record = payout(await viabillRequest(credentials, `/public/merchant/accounts/${accountId}/payout/${entryUUID}`), accountId, entryUUID);
      }
      if (!record || record.date < dates.from || record.date > dates.to) { skipped++; continue; }
      records.push(record);
    }
    const statements = records.map(record => db.prepare(`INSERT INTO integration_records
      (id, tenant, record_type, external_id, occurred_at, amount_minor, currency, booking_status, payload_json, expires_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)
      ON CONFLICT(tenant, record_type, external_id) DO UPDATE SET occurred_at = excluded.occurred_at,
        amount_minor = excluded.amount_minor, currency = excluded.currency, payload_json = excluded.payload_json, expires_at = excluded.expires_at`)
      .bind(`${type}:${record.id}`, tenant, type, record.id, midnight(record.date), record.amountMinor, record.currency, JSON.stringify(record), shiftMonths(new Date(midnight(record.date)), policy.months).toISOString()));
    if (statements.length) await db.batch(statements);
    return reply({ synced: records.length, skipped, mismatches: records.filter(row => row.reconciled === false).length,
      next: rows.length === pageLength ? { kind: type, accountId, ...dates, first: first + pageLength, hash } : null });
  } catch (error) { await recordFailure('ViaBill', { category: 'integration', cause: publicError(error) }); return reply({ error: publicError(error) }, 400); }
}
