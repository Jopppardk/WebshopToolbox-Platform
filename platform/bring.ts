import { requireCompany, requireWebshop } from './auth';
import {
  bringConnection,
  bringScope,
  lookup,
  testParcel,
  text,
  type Credentials,
} from './bring-tracking';
import { seal, unseal } from './connections';
import { jsonBody } from './invitations';
import { HttpError, reply, type Actor, type PlatformEnv } from './types';

// Integrationer → Bring: the webshop's Mybring login and API key, verified against Bring's test parcel.
export async function handleBring(
  request: Request,
  env: PlatformEnv,
  actor: Actor,
  company: string,
  shop: string,
) {
  await requireCompany(env.PLATFORM_DB, actor, company, true);
  await requireWebshop(env.PLATFORM_DB, actor, company, shop);
  if (actor.support || actor.platformAdmin)
    throw new HttpError(
      403,
      'Forbindelsen administreres af virksomhedens administrator.',
    );
  const db = env.PLATFORM_DB,
    saved = await bringConnection(db, company, shop);
  const others = () =>
    db
      .prepare(
        "SELECT w.id,w.name FROM carrier_connections s JOIN webshops w ON w.company_id=s.company_id AND w.id=s.webshop_id WHERE s.company_id=? AND s.webshop_id<>? AND s.provider='bring' AND w.status='active' ORDER BY w.name,w.id",
      )
      .bind(company, shop)
      .all<{ id: string; name: string }>()
      .then((r) => r.results);
  if (request.method === 'GET') {
    if (!saved)
      return reply({
        connected: false,
        revision: null,
        reusable: await others(),
      });
    const credentials = (await unseal(
      env,
      bringScope(company, shop),
      saved.credentials_encrypted,
    )) as Credentials;
    return reply({
      connected: true,
      revision: saved.revision,
      uid: credentials.uid,
      verifiedAt: saved.verified_at,
      reusable: await others(),
    });
  }
  if (!['POST', 'DELETE'].includes(request.method))
    throw new HttpError(405, 'Brug Test og forbind eller Afbryd forbindelse.');
  const body = await jsonBody(request, 5000);
  if ((body.revision ?? null) !== (saved?.revision ?? null))
    throw new HttpError(409, 'Forbindelsen er ændret. Genindlæs siden.');
  const audit = (action: string) =>
    db
      .prepare(
        'INSERT INTO audit_events(id,company_id,actor_id,action,resource_id,details_json) VALUES(?,?,?,?,?,?)',
      )
      .bind(crypto.randomUUID(), company, actor.id, action, shop, '{}');
  if (request.method === 'DELETE') {
    if (saved)
      await db.batch([
        db
          .prepare(
            "DELETE FROM carrier_connections WHERE company_id=? AND webshop_id=? AND provider='bring' AND revision=?",
          )
          .bind(company, shop, saved.revision),
        audit('bring.disconnected'),
      ]);
    return reply({ connected: false });
  }
  let credentials: Credentials;
  if (body.copyFrom !== undefined) {
    // The same Mybring key as another of the company's webshops, copied and sealed on the server.
    const from = text(body.copyFrom, 100);
    if (!from || from === shop)
      throw new HttpError(400, 'Vælg en anden webshop.');
    await requireWebshop(db, actor, company, from);
    const source = await bringConnection(db, company, from);
    if (!source)
      throw new HttpError(
        409,
        'Den valgte webshop har ingen Bring-forbindelse.',
      );
    credentials = (await unseal(
      env,
      bringScope(company, from),
      source.credentials_encrypted,
    )) as Credentials;
  } else {
    const uid = text(body.uid, 256),
      apiKey = text(body.apiKey, 512);
    if (
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(uid) ||
      !apiKey ||
      !/^[\x21-\x7e]+$/.test(apiKey)
    )
      throw new HttpError(
        400,
        'Angiv dit Mybring-login (e-mail) og API-nøglen fra Mybring.',
      );
    credentials = { uid, apiKey };
  }
  const check = await lookup(credentials, testParcel);
  if (!Array.isArray(check?.consignmentSet))
    throw new HttpError(502, 'Bring returnerede et ugyldigt svar.');
  const revision = crypto.randomUUID(),
    encrypted = await seal(env, bringScope(company, shop), credentials);
  const mutation = saved
    ? db
        .prepare(
          "UPDATE carrier_connections SET credentials_encrypted=?,revision=?,verified_at=CURRENT_TIMESTAMP WHERE company_id=? AND webshop_id=? AND provider='bring' AND revision=?",
        )
        .bind(encrypted, revision, company, shop, saved.revision)
    : db
        .prepare(
          "INSERT INTO carrier_connections(company_id,webshop_id,provider,credentials_encrypted,revision) VALUES(?,?,'bring',?,?) ON CONFLICT DO NOTHING",
        )
        .bind(company, shop, encrypted, revision);
  const results = await db.batch([
    mutation,
    // Bring parcels that failed or waited for a key are looked up again on the next visit or cron run.
    db
      .prepare(
        "UPDATE shipment_tracking_cache SET next_check=0,attempted_at=NULL,error=NULL WHERE company_id=? AND webshop_id=? AND carrier='bring' AND terminal=0 AND EXISTS(SELECT 1 FROM carrier_connections WHERE company_id=? AND webshop_id=? AND provider='bring' AND revision=?)",
      )
      .bind(company, shop, company, shop, revision),
    db
      .prepare(
        "INSERT INTO audit_events(id,company_id,actor_id,action,resource_id,details_json) SELECT ?,company_id,?,'bring.connected',webshop_id,'{}' FROM carrier_connections WHERE company_id=? AND webshop_id=? AND provider='bring' AND revision=?",
      )
      .bind(crypto.randomUUID(), actor.id, company, shop, revision),
  ]);
  if (!results[0].meta.changes)
    throw new HttpError(
      409,
      'Forbindelsen blev ændret imens. Genindlæs siden.',
    );
  return reply({ connected: true, revision, uid: credentials.uid });
}
