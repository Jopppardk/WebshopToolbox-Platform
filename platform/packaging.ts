import { dataStartDate } from './tier1-history';
import { syncPackaging } from './packaging-source';
import { requireCompany, requireWebshop } from './auth';
import { jsonBody } from './invitations';
import {
  packagingPeriod,
  packagingEstimate,
  validateManualPackaging,
  validatePackagingPrice,
  type ManualPackaging,
} from './packaging-calculations';
import { HttpError, reply, type Actor, type PlatformEnv } from './types';
import { danishDate } from './tier1/src/lib/history-policy';
function date(value: string) {
  return (
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString().slice(0, 10) === value
  );
}
export async function handlePackaging(
  request: Request,
  env: PlatformEnv,
  actor: Actor,
  company: string,
  shop: string,
) {
  const db = env.PLATFORM_DB;
  await requireWebshop(db, actor, company, shop);
  if (request.method === 'GET') {
    const url = new URL(request.url),
      today = danishDate(),
      start = url.searchParams.get('from') || today.slice(0, 4) + '-01-01',
      end = url.searchParams.get('to') || today;
    if (!date(start) || !date(end) || start > end)
      throw new HttpError(400, 'Vælg en gyldig periode.');
    const cutoff = await dataStartDate(env, company, shop);
    const rows = await db
      .prepare(
        "SELECT payload_json,version FROM platform_packaging WHERE company_id=? AND webshop_id=? AND json_extract(payload_json,'$.date')>=? AND json_extract(payload_json,'$.date')<=? LIMIT 5001",
      )
      .bind(company, shop, start > cutoff ? start : cutoff, end)
      .all<{ payload_json: string; version: number }>();
    if (rows.results.length > 5000)
      throw new HttpError(409, 'Vælg en kortere periode.');
    const entries = rows.results.map((r) => ({
      ...JSON.parse(r.payload_json),
      version: r.version,
    })) as ManualPackaging[];
    const prices = (await db
      .prepare(
        'SELECT household,commercial FROM platform_packaging_prices WHERE company_id=? AND webshop_id=?',
      )
      .bind(company, shop)
      .first<{ household: number; commercial: number | null }>()) || {
      household: 0,
      commercial: null,
    };
    const products = await db
      .prepare(
        "SELECT payload_json FROM packaging_snapshots WHERE company_id=? AND webshop_id=? AND json_extract(payload_json,'$.date') BETWEEN ? AND ? LIMIT 10001",
      )
      .bind(company, shop, start > cutoff ? start : cutoff, end)
      .all<{ payload_json: string }>();
    if (products.results.length > 10000)
      throw new HttpError(409, 'Vælg en kortere periode.');
    const sync = await db
      .prepare(
        'SELECT coverage_start,coverage_end,synced_at FROM packaging_sync WHERE company_id=? AND webshop_id=?',
      )
      .bind(company, shop)
      .first();
    const period = packagingPeriod(
      products.results.map((r) => JSON.parse(r.payload_json)),
      entries,
      start,
      end,
    );
    return reply({
      period,
      prices,
      sync,
      estimate: packagingEstimate(period, prices.household, prices.commercial),
      source: 'shopify-and-manual',
    });
  }
  if (request.method !== 'POST') throw new HttpError(405, 'Brug Gem.');
  await requireCompany(db, actor, company, true);
  if (actor.support)
    throw new HttpError(403, 'Afslut impersonering før ændringer.');
  const b = await jsonBody(request);
  if (b.action === 'sync') {
    if (
      typeof b.start !== 'string' ||
      typeof b.end !== 'string' ||
      !date(b.start) ||
      !date(b.end) ||
      b.start > b.end ||
      b.end > danishDate()
    )
      throw new HttpError(400, 'Vælg en gyldig periode.');
    try {
      return reply(await syncPackaging(env, company, shop, b.start, b.end));
    } catch (e) {
      if (e instanceof HttpError) throw e;
      throw new HttpError(
        409,
        'Emballagehistorikken kunne ikke hentes komplet. Ingen delvis import er gemt.',
      );
    }
  }
  const audited = async (statement: D1PreparedStatement) =>
    db.batch([
      statement,
      db
        .prepare(
          "INSERT INTO audit_events(id,company_id,actor_id,action,resource_id,details_json) SELECT ?,?,?,'packaging.updated',?,'{}' WHERE changes()=1",
        )
        .bind(crypto.randomUUID(), company, actor.id, shop),
    ]);
  if (b.action === 'prices') {
    let household: number, commercial: number | null;
    try {
      household = validatePackagingPrice(b.household);
      commercial =
        b.commercial === null ? null : validatePackagingPrice(b.commercial);
    } catch {
      throw new HttpError(400, 'Ugyldig pris pr. kg.');
    }
    await audited(
      db
        .prepare(
          'INSERT INTO platform_packaging_prices(company_id,webshop_id,household,commercial) VALUES(?,?,?,?) ON CONFLICT(company_id,webshop_id) DO UPDATE SET household=excluded.household,commercial=excluded.commercial',
        )
        .bind(company, shop, household, commercial),
    );
    return reply({ ok: true });
  }
  if (b.action !== 'save') throw new HttpError(400, 'Ugyldig handling.');
  let entry;
  try {
    entry = validateManualPackaging(b);
  } catch {
    throw new HttpError(400, 'Udfyld emballageregistreringen korrekt.');
  }
  if (
    !date(entry.date) ||
    !['household', 'commercial'].includes(String(b.audience))
  )
    throw new HttpError(400, 'Ugyldig dato eller målgruppe.');
  const id = typeof b.id === 'string' ? b.id : crypto.randomUUID();
  if (!/^[a-f0-9-]{36}$/.test(id)) throw new HttpError(400, 'Ugyldigt ID.');
  const payload = JSON.stringify({
    ...entry,
    id,
    updatedAt: new Date().toISOString(),
  });
  if (b.id) {
    const result = await audited(
      db
        .prepare(
          'UPDATE platform_packaging SET payload_json=?,version=version+1 WHERE company_id=? AND webshop_id=? AND id=? AND version=?',
        )
        .bind(payload, company, shop, id, Number(b.version) || 0),
    );
    if (result[0].meta.changes !== 1)
      throw new HttpError(
        409,
        'Registreringen er ændret eller findes ikke. Genindlæs.',
      );
  } else
    await audited(
      db
        .prepare(
          'INSERT INTO platform_packaging(company_id,webshop_id,id,payload_json) VALUES(?,?,?,?)',
        )
        .bind(company, shop, id, payload),
    );
  return reply({ id });
}
