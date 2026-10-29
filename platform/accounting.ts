import { requireCompany } from './auth';
import { seal } from './connections';
import { readDineroAccounts, type PreviewAccount } from './dinero-read';
import { jsonBody } from './invitations';
import { HttpError, reply, type Actor, type PlatformEnv } from './types';

export const accountKeys = [
  'vatCode',
  'noVatCode',
  'goodsVat',
  'goodsNoVat',
  'shippingVat',
  'shippingNoVat',
  'servicesVat',
  'servicesNoVat',
  'refundGoodsVat',
  'refundGoodsNoVat',
  'refundShippingVat',
  'refundShippingNoVat',
  'refundServicesVat',
  'refundServicesNoVat',
  'fees',
  'clearing',
  'bank',
  'shopifyPaymentsClearing',
  'viaBillClearing',
  'flatpayClearing',
  'inventory',
  'inventoryAdjustment',
  'receivables',
];
export async function handleAccounting(
  request: Request,
  env: PlatformEnv,
  actor: Actor,
  company: string,
  action: string,
) {
  const db = env.PLATFORM_DB;
  await requireCompany(db, actor, company, request.method !== 'GET');
  const saved = await db
    .prepare(
      'SELECT organization_id,revision,chart_json,verified_at FROM accounting_connections WHERE company_id=?',
    )
    .bind(company)
    .first<{
      organization_id: string;
      revision: string;
      chart_json: string;
      verified_at: string;
    }>();
  if (request.method === 'GET') {
    const mapping = await db
      .prepare(
        'SELECT accounts_json FROM accounting_mapping WHERE company_id=?',
      )
      .bind(company)
      .first<{ accounts_json: string }>();
    return reply({
      organizationId: saved?.organization_id || '',
      verifiedAt: saved?.verified_at || null,
      revision: saved?.revision || null,
      accounts: saved ? JSON.parse(saved.chart_json) : [],
      mapping: mapping ? JSON.parse(mapping.accounts_json) : {},
      externalWrites: 'blocked',
    });
  }
  if (request.method !== 'PUT' || actor.support)
    throw new HttpError(403, 'Afslut supportadgang og brug Gem.');
  const b = await jsonBody(request, 14000);
  const audit = db
    .prepare(
      'INSERT INTO audit_events(id,company_id,actor_id,action,resource_id,details_json) VALUES(?,?,?,?,?,?)',
    )
    .bind(
      crypto.randomUUID(),
      company,
      actor.id,
      'accounting.' + action,
      company,
      '{}',
    );
  if (action === 'connection') {
    const credentials: Record<string, string> = {};
    for (const key of [
      'organizationId',
      'clientId',
      'clientSecret',
      'apiKey',
    ]) {
      const value = b[key];
      if (
        typeof value !== 'string' ||
        !value.trim() ||
        value.length > 2048 ||
        /[^\x21-\x7e]/.test(value)
      )
        throw new HttpError(400, 'Udfyld Dinero-oplysningerne korrekt.');
      credentials[key] = value;
    }
    if (!/^\d{1,20}$/.test(credentials.organizationId))
      throw new HttpError(400, 'Ugyldigt organisations-ID.');
    if (saved && saved.organization_id !== credentials.organizationId)
      throw new HttpError(
        409,
        'Virksomheden er allerede knyttet til et andet regnskab. Et regnskabsskift kræver særskilt afklaring.',
      );
    let chart: PreviewAccount[];
    try {
      chart = await readDineroAccounts(credentials);
    } catch {
      throw new HttpError(
        409,
        'Dinero kunne ikke godkende forbindelsen eller hente kontoplanen. De tidligere oplysninger er bevaret.',
      );
    }
    const encrypted = await seal(
      env,
      [company, 'dinero', credentials.organizationId],
      credentials,
    );
    const written = await db.batch([
      db
        .prepare(
          'INSERT INTO accounting_connections(company_id,organization_id,credentials_encrypted,revision,chart_json) VALUES(?,?,?,?,?) ON CONFLICT(company_id) DO UPDATE SET credentials_encrypted=excluded.credentials_encrypted,revision=excluded.revision,chart_json=excluded.chart_json,verified_at=CURRENT_TIMESTAMP WHERE organization_id=excluded.organization_id',
        )
        .bind(
          company,
          credentials.organizationId,
          encrypted,
          crypto.randomUUID(),
          JSON.stringify(chart),
        ),
      audit,
    ]);
    if (written[0].meta.changes !== 1)
      throw new HttpError(
        409,
        'Regnskabet er ændret under kontrollen. Genindlæs.',
      );
    return reply({ ok: true });
  }
  if (action === 'mapping') {
    if (!saved || b.revision !== saved.revision)
      throw new HttpError(
        409,
        'Hent den aktuelle kontoplan før du gemmer kontotilknytninger.',
      );
    const chart: PreviewAccount[] = JSON.parse(saved.chart_json),
      input = b.mapping as Record<string, unknown>,
      mapping: Record<string, string> = {};
    if (!input || typeof input !== 'object' || Array.isArray(input))
      throw new HttpError(400, 'Ugyldige kontotilknytninger.');
    for (const key of accountKeys) {
      const value = input[key] ?? '';
      if (typeof value !== 'string' || value.length > 200)
        throw new HttpError(400, 'Ugyldig kontotilknytning.');
      if (
        value &&
        (key === 'vatCode'
          ? value !== 'U25'
          : key === 'noVatCode'
            ? value !== 'NONE'
            : !chart.some(
                (a) => !a.hidden && value === a.number + ' - ' + a.name,
              ))
      )
        throw new HttpError(400, 'Vælg en aktiv konto fra kontoplanen.');
      mapping[key] = value;
    }
    await db.batch([
      db
        .prepare(
          'INSERT INTO accounting_mapping(company_id,accounts_json) VALUES(?,?) ON CONFLICT(company_id) DO UPDATE SET accounts_json=excluded.accounts_json,updated_at=CURRENT_TIMESTAMP',
        )
        .bind(company, JSON.stringify(mapping)),
      audit,
    ]);
    return reply({ ok: true });
  }
  throw new HttpError(404, 'Funktionen findes ikke.');
}
