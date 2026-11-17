import { requireCompany } from './auth';
import { seal, unseal } from './connections';
import { jsonBody } from './invitations';
import { HttpError, reply, type Actor, type PlatformEnv } from './types';

/**
 * Integrationer → Cloudflare E-mail: the company's Cloudflare account and API token for Email Sending, and the
 * domains it may send from. Faktura-afsendelse, Anmeldelser and later features choose an address and a name on one of
 * these domains; they never hold Cloudflare credentials themselves.
 */
export type MailConnection = {
  company_id: string;
  account_id: string;
  credentials_encrypted: string;
  revision: string;
  source: 'token' | 'migrated';
  discovery: number;
  updated_at: string;
};
const api = 'https://api.cloudflare.com/client/v4';
const connectionScope = (company: string, account: string) => [
  company,
  'mail-connection',
  account,
];

export function mailAddress(value: unknown, optional = false) {
  const s = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (optional && !s) return '';
  if (
    s.length > 254 ||
    !/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(
      s,
    )
  )
    throw new HttpError(400, 'Angiv en gyldig mailadresse.');
  return s;
}
export const domainOf = (address: string) =>
  address.slice(address.lastIndexOf('@') + 1).toLowerCase();
const domainName = (value: unknown) =>
  typeof value === 'string' &&
  value.length <= 253 &&
  /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(value)
    ? value
    : null;

/** One mail through the Cloudflare Email Sending REST API; returns the receipt, throws when it was not confirmed. */
export async function cloudflareSend(
  account: string,
  token: string,
  message: {
    from: string;
    name: string;
    to: string;
    subject: string;
    text: string;
    html?: string;
    replyTo?: string;
    attachments?: {
      content: ArrayBuffer;
      filename: string;
      type: string;
      disposition: 'attachment';
    }[];
  },
) {
  // Customer-supplied account credentials authorize only this fixed Cloudflare endpoint; never follow redirects.
  const response = await fetch(
    `${api}/accounts/${account}/email/sending/send`,
    {
      method: 'POST',
      redirect: 'manual',
      signal: AbortSignal.timeout(15000),
      headers: {
        Authorization: 'Bearer ' + token,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: { address: message.from, name: message.name },
        to: message.to,
        subject: message.subject,
        ...(message.html ? { html: message.html } : {}),
        text: message.text,
        ...(message.replyTo ? { reply_to: message.replyTo } : {}),
        ...(message.attachments
          ? {
              attachments: message.attachments.map((a) => ({
                ...a,
                content: btoa(
                  Array.from(new Uint8Array(a.content), (b) =>
                    String.fromCharCode(b),
                  ).join(''),
                ),
              })),
            }
          : {}),
      }),
    },
  );
  const result = (await response.json()) as {
    success?: boolean;
    result?: {
      delivered?: string[];
      queued?: string[];
      permanent_bounces?: string[];
    };
  };
  if (
    !response.ok ||
    result.success !== true ||
    !result.result ||
    result.result.permanent_bounces?.includes(message.to) ||
    !(
      result.result.delivered?.includes(message.to) ||
      result.result.queued?.includes(message.to)
    )
  )
    throw Error('Unconfirmed delivery');
  return JSON.stringify(result.result);
}

type LegacyRow = {
  custom_from: string;
  account_id: string;
  credentials_encrypted: string;
};
/**
 * Moves the company's older sender credentials (saved per address under Faktura-afsendelse) to the connection once:
 * the first approved sender gives the account and token, and every approved sender on that account gives its domain.
 * The older rows are left as they were. Nothing is moved when none is approved or the token cannot be read.
 */
async function migrateLegacy(env: PlatformEnv, company: string) {
  const db = env.PLATFORM_DB,
    approved =
      "custom_from<>'' AND credentials_encrypted IS NOT NULL AND verified_revision=revision AND company_id=?";
  const rows = (
    await db
      .prepare(
        `SELECT custom_from,account_id,credentials_encrypted,0 AS o FROM company_mail WHERE ${approved}
         UNION ALL SELECT custom_from,account_id,credentials_encrypted,1 FROM webshop_mail WHERE ${approved}
         UNION ALL SELECT custom_from,account_id,credentials_encrypted,2 FROM market_mail WHERE ${approved} ORDER BY 4,1`,
      )
      .bind(company, company, company)
      .all<LegacyRow>()
  ).results.filter((r) => /^[a-f0-9]{32}$/.test(r.account_id));
  if (!rows.length) return null;
  const first = rows[0];
  let token: string;
  try {
    token = (
      (await unseal(
        env,
        [company, 'mail', first.custom_from, first.account_id],
        first.credentials_encrypted,
      )) as { token: string }
    ).token;
  } catch {
    return null;
  }
  const domains = [
    ...new Set(
      rows
        .filter((r) => r.account_id === first.account_id)
        .map((r) => domainOf(r.custom_from)),
    ),
  ];
  await db.batch([
    db
      .prepare(
        "INSERT INTO mail_connections(company_id,account_id,credentials_encrypted,revision,source) VALUES(?,?,?,?,'migrated') ON CONFLICT DO NOTHING",
      )
      .bind(
        company,
        first.account_id,
        await seal(env, connectionScope(company, first.account_id), { token }),
        crypto.randomUUID(),
      ),
    ...domains.map((d) =>
      db
        .prepare(
          "INSERT INTO mail_domains(company_id,domain,source) SELECT ?,?,'migrated' WHERE EXISTS(SELECT 1 FROM mail_connections WHERE company_id=? AND account_id=?) ON CONFLICT DO NOTHING",
        )
        .bind(company, d, company, first.account_id),
    ),
    // The integration appears on Integrationer with the moved connection.
    db
      .prepare(
        "INSERT OR IGNORE INTO company_integrations(company_id,integration_id) VALUES(?,'cloudflare')",
      )
      .bind(company),
  ]);
  return stored(env, company);
}
const stored = (env: PlatformEnv, company: string) =>
  env.PLATFORM_DB.prepare('SELECT * FROM mail_connections WHERE company_id=?')
    .bind(company)
    .first<MailConnection>();

/** The company's Cloudflare connection; older approved senders are moved to it the first time it is read. */
export async function mailConnection(env: PlatformEnv, company: string) {
  return (await stored(env, company)) || migrateLegacy(env, company);
}
/** The domains the company may send from with its connection (none without a connection). */
export async function verifiedDomains(env: PlatformEnv, company: string) {
  if (!(await mailConnection(env, company))) return [];
  return (
    await env.PLATFORM_DB.prepare(
      'SELECT domain FROM mail_domains WHERE company_id=? ORDER BY domain',
    )
      .bind(company)
      .all<{ domain: string }>()
  ).results.map((r) => r.domain);
}
/** Opens the account and token to send from one of the connection's domains, or null when the domain is not approved. */
export async function connectionSender(
  env: PlatformEnv,
  company: string,
  address: string,
) {
  const connection = await mailConnection(env, company);
  if (
    !connection ||
    !(await verifiedDomains(env, company)).includes(domainOf(address))
  )
    return null;
  // Opened only when a mail is sent.
  return async () => {
    const { token } = (await unseal(
      env,
      connectionScope(company, connection.account_id),
      connection.credentials_encrypted,
    )) as { token: string };
    return { account: connection.account_id, token };
  };
}

async function cloudflareGet(path: string, token: string) {
  const response = await fetch(api + path, {
    redirect: 'manual',
    signal: AbortSignal.timeout(15000),
    headers: { Authorization: 'Bearer ' + token },
  });
  const body = (await response.json().catch(() => ({}))) as {
    success?: boolean;
    result?: unknown;
  };
  return response.ok && body.success === true ? body.result : null;
}
/** Whether Cloudflare accepts the token (an account token, or a user token with access to the account). */
async function tokenValid(account: string, token: string) {
  const active = (r: unknown) =>
    !!r && (r as { status?: string }).status === 'active';
  return (
    active(await cloudflareGet(`/accounts/${account}/tokens/verify`, token)) ||
    active(await cloudflareGet('/user/tokens/verify', token))
  );
}
/**
 * The sending domains Cloudflare lists as enabled on the account's zones, or null when the token may not list zones
 * (it only needs Email Sending; then a domain is approved by a test mail from it).
 */
async function discoverDomains(account: string, token: string) {
  const zones = await cloudflareGet(
    `/zones?account.id=${account}&per_page=50`,
    token,
  );
  if (!Array.isArray(zones)) return null;
  const found: string[] = [];
  for (const zone of zones.slice(0, 50) as { id?: unknown }[]) {
    if (typeof zone?.id !== 'string' || !/^[a-f0-9]{32}$/.test(zone.id))
      continue;
    const subdomains = await cloudflareGet(
      `/zones/${zone.id}/email/sending/subdomains`,
      token,
    );
    if (!Array.isArray(subdomains)) continue;
    for (const s of subdomains as { name?: unknown; enabled?: unknown }[]) {
      const name = domainName(
        typeof s?.name === 'string' ? s.name.toLowerCase() : null,
      );
      if (name && s.enabled !== false) found.push(name);
    }
  }
  return [...new Set(found)];
}

async function info(env: PlatformEnv, company: string, actor: Actor) {
  const connection = await mailConnection(env, company);
  const domains = connection
    ? (
        await env.PLATFORM_DB.prepare(
          'SELECT domain,source,verified_at FROM mail_domains WHERE company_id=? ORDER BY domain',
        )
          .bind(company)
          .all<{ domain: string; source: string; verified_at: string }>()
      ).results
    : [];
  return {
    connected: !!connection,
    revision: connection?.revision ?? null,
    accountId: connection?.account_id ?? '',
    source: connection?.source ?? null,
    discovery: !!connection?.discovery,
    updatedAt: connection?.updated_at ?? null,
    domains,
    testRecipient: actor.email,
    localPreview: env.PLATFORM_ENV === 'local-test',
  };
}

/** /mail/connection (GET, PUT, DELETE), /mail/connection/refresh and /mail/connection/test (POST). */
export async function handleMailConnection(
  request: Request,
  env: PlatformEnv,
  actor: Actor,
  company: string,
  path: string,
) {
  await requireCompany(
    env.PLATFORM_DB,
    actor,
    company,
    request.method !== 'GET',
  );
  if (request.method === 'GET' && path === '/mail/connection')
    return reply(await info(env, company, actor));
  if (actor.support || actor.platformAdmin)
    throw new HttpError(
      403,
      'Forbindelsen administreres af virksomhedens administrator.',
    );
  const db = env.PLATFORM_DB,
    local = env.PLATFORM_ENV === 'local-test',
    body = await jsonBody(request, 5000),
    current = await mailConnection(env, company);
  const audit = (action: string, details: Record<string, unknown> = {}) =>
    db
      .prepare(
        'INSERT INTO audit_events(id,company_id,actor_id,action,resource_id,details_json) VALUES(?,?,?,?,?,?)',
      )
      .bind(
        crypto.randomUUID(),
        company,
        actor.id,
        action,
        company,
        JSON.stringify(details),
      );
  if ((body.revision ?? null) !== (current?.revision ?? null))
    throw new HttpError(409, 'Forbindelsen er ændret. Genindlæs siden.');

  if (path === '/mail/connection' && request.method === 'PUT') {
    const account =
      typeof body.accountId === 'string' ? body.accountId.trim() : '';
    if (!/^[a-f0-9]{32}$/.test(account))
      throw new HttpError(400, 'Angiv Cloudflare Account ID (32 tegn).');
    const token = typeof body.apiToken === 'string' ? body.apiToken.trim() : '';
    if (!/^[A-Za-z0-9_-]{20,256}$/.test(token))
      throw new HttpError(400, 'Angiv et gyldigt Cloudflare API-token.');
    let discovered: string[] | null = null;
    if (!local) {
      if (!(await tokenValid(account, token)))
        throw new HttpError(
          400,
          'Cloudflare godkendte ikke tokenet til kontoen. Kontrollér Account ID og at tokenet er aktivt.',
        );
      discovered = await discoverDomains(account, token);
    }
    // Domains approved on another account do not carry over.
    const keep = current?.account_id === account;
    await db.batch([
      db
        .prepare(
          `INSERT INTO mail_connections(company_id,account_id,credentials_encrypted,revision,source,discovery) VALUES(?,?,?,?,'token',?)
           ON CONFLICT(company_id) DO UPDATE SET account_id=excluded.account_id,credentials_encrypted=excluded.credentials_encrypted,revision=excluded.revision,source='token',discovery=excluded.discovery,updated_at=CURRENT_TIMESTAMP`,
        )
        .bind(
          company,
          account,
          await seal(env, connectionScope(company, account), { token }),
          crypto.randomUUID(),
          discovered ? 1 : 0,
        ),
      ...(keep
        ? []
        : [
            db
              .prepare('DELETE FROM mail_domains WHERE company_id=?')
              .bind(company),
          ]),
      ...(discovered || []).map((d) =>
        db
          .prepare(
            "INSERT INTO mail_domains(company_id,domain,source) VALUES(?,?,'cloudflare') ON CONFLICT DO NOTHING",
          )
          .bind(company, d),
      ),
      audit('mail.connection.saved', {
        discovery: !!discovered,
        domains: discovered?.length ?? 0,
      }),
    ]);
    return reply(await info(env, company, actor));
  }
  if (!current)
    throw new HttpError(404, 'Cloudflare E-mail er ikke forbundet.');

  if (path === '/mail/connection' && request.method === 'DELETE') {
    // Removing the connection also clears the older per-address credentials, so no mail is sent from the customer's
    // domains afterwards and nothing is moved back on the next read. Mails then go out from the standard sender.
    await db.batch([
      db.prepare('DELETE FROM mail_domains WHERE company_id=?').bind(company),
      db
        .prepare(
          'DELETE FROM mail_connections WHERE company_id=? AND revision=?',
        )
        .bind(company, current.revision),
      ...['company_mail', 'webshop_mail', 'market_mail'].map((t) =>
        db
          .prepare(
            `UPDATE ${t} SET credentials_encrypted=NULL,verified_revision=NULL WHERE company_id=? AND credentials_encrypted IS NOT NULL`,
          )
          .bind(company),
      ),
      audit('mail.connection.removed'),
    ]);
    return reply(await info(env, company, actor));
  }

  if (path === '/mail/connection/domain' && request.method === 'DELETE') {
    const domain = domainName(body.domain);
    if (!domain) throw new HttpError(400, 'Angiv et domæne.');
    await db.batch([
      db
        .prepare('DELETE FROM mail_domains WHERE company_id=? AND domain=?')
        .bind(company, domain),
      audit('mail.domain.removed', { domain }),
    ]);
    return reply(await info(env, company, actor));
  }

  if (path === '/mail/connection/refresh' && request.method === 'POST') {
    if (!local) {
      const { token } = (await unseal(
        env,
        connectionScope(company, current.account_id),
        current.credentials_encrypted,
      )) as { token: string };
      const discovered = await discoverDomains(current.account_id, token);
      await db.batch([
        db
          .prepare('UPDATE mail_connections SET discovery=? WHERE company_id=?')
          .bind(discovered ? 1 : 0, company),
        ...(discovered || []).map((d) =>
          db
            .prepare(
              "INSERT INTO mail_domains(company_id,domain,source) VALUES(?,?,'cloudflare') ON CONFLICT DO NOTHING",
            )
            .bind(company, d),
        ),
      ]);
    }
    return reply(await info(env, company, actor));
  }

  if (path === '/mail/connection/test' && request.method === 'POST') {
    // Approves a domain by sending a test mail from an address on it to the user's own address with the connection.
    const id = typeof body.requestId === 'string' ? body.requestId : '';
    if (!/^[a-f0-9-]{36}$/.test(id))
      throw new HttpError(400, 'Testmail mangler et gyldigt forespørgsels-ID.');
    const from = mailAddress(body.from),
      domain = domainOf(from),
      recipient = mailAddress(actor.email);
    const previous = await db
      .prepare(
        'SELECT actor_id,status,recipient,sender FROM mail_test_deliveries WHERE company_id=? AND request_id=?',
      )
      .bind(company, id)
      .first<{ actor_id: string; status: string }>();
    if (previous) {
      if (previous.actor_id !== actor.id)
        throw new HttpError(409, 'Testmailen tilhører en anden session.');
      return reply({ ...previous, ...(await info(env, company, actor)) });
    }
    const now = Math.floor(Date.now() / 1000);
    // Same company-wide cooldown and durable claim as the other test mails; an uncertain one is never resent.
    const claim = await db
      .prepare(
        `INSERT INTO mail_test_deliveries(company_id,request_id,actor_id,recipient,sender,mode,status,created_at)
         SELECT ?,?,?,?,?,'custom','uncertain',? WHERE NOT EXISTS(SELECT 1 FROM mail_test_deliveries WHERE company_id=? AND created_at>?) ON CONFLICT DO NOTHING`,
      )
      .bind(company, id, actor.id, recipient, from, now, company, now - 60)
      .run();
    if (claim.meta.changes !== 1)
      throw new HttpError(
        429,
        'Vent mindst ét minut mellem testmails. Et uafklaret forsøg genafsendes ikke automatisk.',
      );
    const approve = (status: string, receipt: string | null) =>
      db.batch([
        db
          .prepare(
            'UPDATE mail_test_deliveries SET status=?,receipt=? WHERE company_id=? AND request_id=?',
          )
          .bind(status, receipt, company, id),
        db
          .prepare(
            "INSERT INTO mail_domains(company_id,domain,source) SELECT ?,?,'test' WHERE EXISTS(SELECT 1 FROM mail_connections WHERE company_id=? AND revision=?) ON CONFLICT DO NOTHING",
          )
          .bind(company, domain, company, current.revision),
        audit('mail.domain.verified', { domain, requestId: id }),
      ]);
    if (local) {
      await approve('preview', null);
      return reply({
        status: 'preview',
        recipient,
        sender: from,
        ...(await info(env, company, actor)),
      });
    }
    const { token } = (await unseal(
      env,
      connectionScope(company, current.account_id),
      current.credentials_encrypted,
    )) as { token: string };
    try {
      const receipt = await cloudflareSend(current.account_id, token, {
        from,
        name: 'WebshopToolbox',
        to: recipient,
        subject: `Test af ${domain} · WebshopToolbox`,
        text: `Dette er en test af afsendelse fra ${from} med jeres Cloudflare-konto.\n\nNår mailen er modtaget, kan adresser på ${domain} vælges som afsender i WebshopToolbox.`,
      });
      await approve('accepted', receipt);
      return reply({
        status: 'accepted',
        recipient,
        sender: from,
        ...(await info(env, company, actor)),
      });
    } catch {
      return reply({
        status: 'uncertain',
        recipient,
        sender: from,
        ...(await info(env, company, actor)),
      });
    }
  }
  throw new HttpError(404, 'Funktionen findes ikke.');
}
