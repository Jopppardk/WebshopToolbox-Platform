import {
  readReceipt,
  saveReceipt,
  uncertainReceipt,
  type ReceiptKey,
} from './production-receipts';
import { requireCompany, requireWebshop } from './auth';
import { seal, unseal } from './connections';
import {
  cloudflareSend,
  connectionSender,
  domainOf,
  mailAddress,
  mailConnection,
  verifiedDomains,
} from './mail-connection';
import { jsonBody } from './invitations';
import { webshopInvoiceRow } from './invoice-profiles';
import { HttpError, reply, type Actor, type PlatformEnv } from './types';

export { domainOf, mailAddress };

type MailRow = {
  company_id: string;
  sender_name: string;
  reply_to: string;
  custom_from: string;
  account_id: string;
  credentials_encrypted: string | null;
  revision: string;
  verified_revision: string | null;
};
function senderName(value: unknown) {
  if (
    typeof value !== 'string' ||
    !value.trim() ||
    value.length > 120 ||
    /[\x00-\x1f<>]/.test(value)
  )
    throw new HttpError(400, 'Angiv et gyldigt afsendernavn.');
  return value.trim();
}
/**
 * Whose sender (Indstillinger → Faktura-afsendelse): a market's own (shop + market), a webshop's own (shop, when it
 * has its own invoice settings), or the company's (none).
 */
export type MailScope = { shop: string; market?: string } | undefined;
const mailTable = (scope: MailScope) =>
  scope?.market ? 'market_mail' : scope ? 'webshop_mail' : 'company_mail';
const mailWhere = (scope: MailScope) =>
  scope?.market
    ? 'company_id=? AND webshop_id=? AND market_id=?'
    : scope
      ? 'company_id=? AND webshop_id=?'
      : 'company_id=?';
const mailKeys = (company: string, scope: MailScope) =>
  scope?.market
    ? [company, scope.shop, scope.market]
    : scope
      ? [company, scope.shop]
      : [company];
async function row(env: PlatformEnv, company: string, scope?: MailScope) {
  return env.PLATFORM_DB.prepare(
    `SELECT * FROM ${mailTable(scope)} WHERE ${mailWhere(scope)}`,
  )
    .bind(...mailKeys(company, scope))
    .first<MailRow>();
}
/**
 * The sender a mail goes out with, and the scope holding it. A market, and a webshop with its own invoice settings,
 * send with their own sender only; until one is saved they use the standard sender (never another one's domain).
 * A webshop without its own settings sends as the company.
 */
export async function senderSettings(
  env: PlatformEnv,
  company: string,
  scope?: MailScope,
): Promise<{ settings: MailRow | null; own: MailScope }> {
  if (
    scope &&
    !scope.market &&
    !(await webshopInvoiceRow(env, company, scope.shop))
  )
    scope = undefined;
  return { settings: await row(env, company, scope), own: scope };
}
function standardFrom(env: PlatformEnv) {
  return mailAddress(env.PLATFORM_MAIL_FROM || 'faktura@webshoptoolbox.dk');
}
/** Whether the scope's older sender, saved with its own Cloudflare credentials, is approved. */
const legacyApproved = (s: MailRow | null) =>
  !!s?.custom_from &&
  !!s.credentials_encrypted &&
  s.verified_revision === s.revision;
/** Opens the Cloudflare account and token an own address is sent with; null is the standard sender. */
type Transport = (() => Promise<{ account: string; token: string }>) | null;
/**
 * The address and name a scope's mails go out with, and how they are sent: an own address on a domain approved in
 * Integrationer → Cloudflare E-mail (with that account), an older approved sender with its own credentials, or the
 * standard sender. `wanted` asks for another address; it must be on an approved domain (or the older sender's domain).
 */
export async function resolveSender(
  env: PlatformEnv,
  company: string,
  scope: MailScope,
  wanted?: string,
) {
  const { settings, own } = await senderSettings(env, company, scope);
  const name =
    settings?.sender_name || (await defaultSenderName(env, company, own));
  const address = wanted ? mailAddress(wanted) : settings?.custom_from || '';
  let from = standardFrom(env),
    transport: Transport = null,
    kind: 'connection' | 'legacy' | 'standard' = 'standard';
  if (address) {
    // Domains limited to other webshops are not used here, also when the webshop sends as the company.
    const connection = await connectionSender(
      env,
      company,
      address,
      scope?.shop,
    );
    if (connection) {
      from = address;
      transport = connection;
      kind = 'connection';
    } else if (
      legacyApproved(settings) &&
      domainOf(address) === domainOf(settings!.custom_from) &&
      // A domain the integration knows (but limits to other webshops) never falls back to older credentials.
      !(await verifiedDomains(env, company)).includes(domainOf(address))
    ) {
      from = address;
      transport = legacyTransport(env, company, settings!);
      kind = 'legacy';
    } else if (wanted)
      throw new HttpError(
        409,
        `Afsenderadressen ${address} er ikke på et godkendt domæne.`,
      );
  }
  return { settings, own, from, name, transport, kind };
}
function legacyTransport(
  env: PlatformEnv,
  company: string,
  settings: MailRow,
): Transport {
  return async () => {
    const { token } = (await unseal(
      env,
      [company, 'mail', settings.custom_from, settings.account_id],
      settings.credentials_encrypted!,
    )) as { token: string };
    return { account: settings.account_id, token };
  };
}
/** Sends one mail with Cloudflare (own domain) or the standard binding; returns the receipt or throws when unconfirmed. */
async function sendVia(
  env: PlatformEnv,
  transport: Transport,
  message: {
    from: string;
    name: string;
    to: string;
    replyTo?: string;
    subject: string;
    text: string;
    html?: string;
    attachments?: {
      content: ArrayBuffer;
      filename: string;
      type: string;
      disposition: 'attachment';
    }[];
  },
) {
  if (transport) {
    const { account, token } = await transport();
    return cloudflareSend(account, token, message);
  }
  const result = await env.PLATFORM_MAIL_TEST!.send({
    from: { email: message.from, name: message.name },
    to: message.to,
    ...(message.replyTo ? { replyTo: message.replyTo } : {}),
    subject: message.subject,
    text: message.text,
    ...(message.html ? { html: message.html } : {}),
    ...(message.attachments ? { attachments: message.attachments } : {}),
  });
  if (!result?.messageId) throw Error('Missing receipt');
  return result.messageId;
}
async function defaultSenderName(
  env: PlatformEnv,
  company: string,
  scope?: MailScope,
) {
  const own = scope && (await webshopInvoiceRow(env, company, scope.shop));
  if (own && own.name) return own.name;
  const value = await env.PLATFORM_DB.prepare(
    `SELECT COALESCE(NULLIF(i.name,''),c.name) AS name FROM companies c LEFT JOIN invoice_settings i ON i.company_id=c.id WHERE c.id=?`,
  )
    .bind(company)
    .first<{ name: string }>();
  return value!.name;
}
async function info(
  env: PlatformEnv,
  company: string,
  actor: Actor,
  scope?: MailScope,
) {
  const own = await row(env, company, scope),
    settings = own;
  const fallbackName = await defaultSenderName(env, company, scope);
  const from = standardFrom(env),
    domains = await verifiedDomains(env, company, scope?.shop);
  const allowed = (env.PLATFORM_MAIL_TEST_RECIPIENTS || '')
    .split(',')
    .includes(actor.email.toLowerCase());
  const approved =
    !!settings?.custom_from &&
    (domains.includes(domainOf(settings.custom_from)) ||
      legacyApproved(settings));
  return {
    senderName: settings?.sender_name || fallbackName,
    replyTo: settings?.reply_to || '',
    customFrom: settings?.custom_from || '',
    accountId: settings?.account_id || '',
    credentialsSaved: !!settings?.credentials_encrypted,
    status: !settings?.custom_from
      ? 'standard'
      : approved
        ? 'verified'
        : 'pending',
    // Domains approved in Integrationer → Cloudflare E-mail; an own address is chosen on one of them.
    connected: !!(await mailConnection(env, company)),
    domains,
    standardFrom: from,
    effectiveFrom: approved ? settings!.custom_from : from,
    testRecipient: actor.email,
    testEnabled:
      !actor.support && (env.PLATFORM_ENV === 'local-test' || allowed),
    localPreview: env.PLATFORM_ENV === 'local-test',
    // A market or webshop without its own sender sends from the standard sender until one is saved.
    ...(scope ? { inherited: !own } : {}),
  };
}
function audit(
  env: PlatformEnv,
  company: string,
  actor: Actor,
  action: string,
  details: Record<string, unknown>,
) {
  return env.PLATFORM_DB.prepare(
    'INSERT INTO audit_events(id,company_id,actor_id,action,resource_id,details_json) VALUES(?,?,?,?,?,?)',
  ).bind(
    crypto.randomUUID(),
    company,
    actor.id,
    action,
    company,
    JSON.stringify(details),
  );
}
export async function handleMail(
  request: Request,
  env: PlatformEnv,
  actor: Actor,
  company: string,
  action?: string,
  invoice?: {
    subject: string;
    text: string;
    allowAnyRecipient?: boolean;
    attachment: {
      content: ArrayBuffer;
      filename: string;
      type: string;
      disposition: 'attachment';
    };
  },
  scope?: MailScope,
) {
  await requireCompany(
    env.PLATFORM_DB,
    actor,
    company,
    request.method !== 'GET',
  );
  if (request.method === 'GET' && !action)
    return reply(await info(env, company, actor, scope));
  if (actor.support)
    throw new HttpError(
      403,
      'Afslut impersonering før mailopsætning eller testmail.',
    );
  const input = await jsonBody(request);
  if (request.method === 'PUT' && !action) {
    const current = await row(env, company, scope),
      name = senderName(input.senderName),
      replyTo = mailAddress(input.replyTo, true),
      custom = mailAddress(input.customFrom, true);
    const token =
      typeof input.apiToken === 'string' ? input.apiToken.trim() : '';
    const legacyInput =
      !!token ||
      (typeof input.accountId === 'string' && !!input.accountId.trim());
    const revision = crypto.randomUUID();
    let account = '',
      credentials: string | null = null,
      verified: string | null = null;
    if (custom && !legacyInput) {
      // The address is on a domain approved in Integrationer → Cloudflare E-mail; that connection sends it.
      if (
        (await verifiedDomains(env, company, scope?.shop)).includes(
          domainOf(custom),
        )
      )
        verified = revision;
      else if (
        current?.custom_from === custom &&
        current.credentials_encrypted
      ) {
        // An older sender with its own credentials keeps them until its domain is approved in the integration.
        account = current.account_id;
        credentials = current.credentials_encrypted;
        verified =
          current.verified_revision === current.revision ? revision : null;
      } else
        throw new HttpError(
          400,
          `Domænet ${domainOf(custom)} er ikke godkendt. Forbind Cloudflare E-mail under Integrationer og godkend domænet først.`,
        );
    } else if (custom) {
      account =
        typeof input.accountId === 'string' ? input.accountId.trim() : '';
      if (!/^[a-f0-9]{32}$/.test(account))
        throw new HttpError(400, 'Angiv Cloudflare Account ID (32 tegn).');
      if (token) {
        if (!/^[A-Za-z0-9_-]{20,256}$/.test(token))
          throw new HttpError(400, 'Angiv et gyldigt Cloudflare API-token.');
        credentials = await seal(env, [company, 'mail', custom, account], {
          token,
        });
      } else if (
        current?.custom_from === custom &&
        current.account_id === account
      )
        credentials = current.credentials_encrypted;
      if (!credentials)
        throw new HttpError(
          400,
          'Indtast et API-token til kundens Cloudflare Email Sending.',
        );
      verified =
        current?.custom_from === custom &&
        current.account_id === account &&
        !token &&
        current.verified_revision === current.revision
          ? revision
          : null;
    }
    await env.PLATFORM_DB.batch([
      scope?.market
        ? env.PLATFORM_DB.prepare(`INSERT INTO market_mail(company_id,webshop_id,market_id,sender_name,reply_to,custom_from,account_id,credentials_encrypted,revision,verified_revision) VALUES(?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(company_id,webshop_id,market_id) DO UPDATE SET sender_name=excluded.sender_name,reply_to=excluded.reply_to,custom_from=excluded.custom_from,account_id=excluded.account_id,credentials_encrypted=excluded.credentials_encrypted,revision=excluded.revision,verified_revision=excluded.verified_revision,updated_at=CURRENT_TIMESTAMP`).bind(
            company,
            scope.shop,
            scope.market,
            name,
            replyTo,
            custom,
            account,
            credentials,
            revision,
            verified,
          )
        : scope
          ? env.PLATFORM_DB.prepare(`INSERT INTO webshop_mail(company_id,webshop_id,sender_name,reply_to,custom_from,account_id,credentials_encrypted,revision,verified_revision) VALUES(?,?,?,?,?,?,?,?,?)
    ON CONFLICT(company_id,webshop_id) DO UPDATE SET sender_name=excluded.sender_name,reply_to=excluded.reply_to,custom_from=excluded.custom_from,account_id=excluded.account_id,credentials_encrypted=excluded.credentials_encrypted,revision=excluded.revision,verified_revision=excluded.verified_revision,updated_at=CURRENT_TIMESTAMP`).bind(
              company,
              scope.shop,
              name,
              replyTo,
              custom,
              account,
              credentials,
              revision,
              verified,
            )
          : env.PLATFORM_DB.prepare(`INSERT INTO company_mail(company_id,sender_name,reply_to,custom_from,account_id,credentials_encrypted,revision,verified_revision) VALUES(?,?,?,?,?,?,?,?)
    ON CONFLICT(company_id) DO UPDATE SET sender_name=excluded.sender_name,reply_to=excluded.reply_to,custom_from=excluded.custom_from,account_id=excluded.account_id,credentials_encrypted=excluded.credentials_encrypted,revision=excluded.revision,verified_revision=excluded.verified_revision,updated_at=CURRENT_TIMESTAMP`).bind(
              company,
              name,
              replyTo,
              custom,
              account,
              credentials,
              revision,
              verified,
            ),
      audit(env, company, actor, 'mail.settings.saved', {
        mode: custom ? 'custom' : 'standard',
      }),
    ]);
    return reply(await info(env, company, actor, scope));
  }
  if (request.method !== 'POST' || action !== 'test')
    throw new HttpError(404, 'Mailfunktionen findes ikke.');
  // Sender checks stay self-only. The invoice demo may use an explicit, validated recipient,
  // but its subject, text and attachment are still generated exclusively on the server.
  const allowAnyRecipient = invoice?.allowAnyRecipient === true;
  if (
    (!allowAnyRecipient && input.recipient !== undefined) ||
    input.to !== undefined ||
    input.subject !== undefined ||
    input.text !== undefined
  )
    throw new HttpError(
      400,
      'Testmailens indhold eller modtager kan ikke ændres her.',
    );
  const id = typeof input.requestId === 'string' ? input.requestId : '';
  if (!/^[a-f0-9-]{36}$/.test(id))
    throw new HttpError(400, 'Testmail mangler et gyldigt forespørgsels-ID.');
  if (!['standard', 'custom'].includes(String(input.mode)))
    throw new HttpError(400, 'Vælg afsender til testmail.');
  const recipient = mailAddress(
      allowAnyRecipient ? input.recipient : actor.email,
    ),
    local = env.PLATFORM_ENV === 'local-test';
  const selfAllowed = (env.PLATFORM_MAIL_TEST_RECIPIENTS || '')
    .split(',')
    .includes(recipient);
  if (
    !local &&
    (!env.PLATFORM_MAIL_TEST || (!allowAnyRecipient && !selfAllowed))
  )
    throw new HttpError(
      403,
      'Denne adresse er ikke godkendt til afsendertest.',
    );
  const previous = await env.PLATFORM_DB.prepare(
    'SELECT actor_id,status,recipient,sender FROM mail_test_deliveries WHERE company_id=? AND request_id=?',
  )
    .bind(company, id)
    .first<{
      actor_id: string;
      status: string;
      recipient: string;
      sender: string;
    }>();
  if (previous) {
    if (previous.actor_id !== actor.id)
      throw new HttpError(409, 'Testmailen tilhører en anden session.');
    return reply(previous);
  }
  const custom = input.mode === 'custom',
    resolved = await resolveSender(env, company, scope),
    { settings, own, name } = resolved;
  let { transport, kind } = resolved;
  if (custom && kind === 'standard') {
    // An older sender not yet approved is approved by this test; an address on a domain the integration has not
    // approved cannot be tested here.
    if (!settings?.custom_from || !settings.credentials_encrypted)
      throw new HttpError(
        400,
        settings?.custom_from
          ? `Domænet ${domainOf(settings.custom_from)} er ikke godkendt i Integrationer → Cloudflare E-mail.`
          : 'Gem din egen afsender først.',
      );
    kind = 'legacy';
    transport = legacyTransport(env, company, settings);
  }
  if (!custom) transport = null;
  const from = custom ? settings!.custom_from : standardFrom(env);
  const message = {
    from,
    name,
    to: recipient,
    ...(settings?.reply_to ? { replyTo: settings.reply_to } : {}),
    subject: 'Testmail fra ' + name + ' · WebshopToolbox',
    text: `Dette er en test af din mailopsætning i WebshopToolbox.\n\nAfsender: ${name} <${from}>\nSvaradresse: ${settings?.reply_to || from}\n\nDer er ingen faktura vedhæftet, og der er ikke foretaget bogføring.`,
  };
  if (invoice) {
    message.subject = invoice.subject;
    message.text = invoice.text;
  }
  const now = Math.floor(Date.now() / 1000);
  // Atomic claim and company-wide cooldown serialize concurrent tabs and hold uncertain sends.
  const claim =
    await env.PLATFORM_DB.prepare(`INSERT INTO mail_test_deliveries(company_id,request_id,actor_id,recipient,sender,mode,status,created_at)
  SELECT ?,?,?,?,?,?,'uncertain',? WHERE NOT EXISTS(SELECT 1 FROM mail_test_deliveries WHERE company_id=? AND created_at>?) ON CONFLICT DO NOTHING`)
      .bind(
        company,
        id,
        actor.id,
        recipient,
        from,
        input.mode,
        now,
        company,
        now - 60,
      )
      .run();
  if (claim.meta.changes !== 1)
    throw new HttpError(
      429,
      'Vent mindst ét minut mellem testmails. Et uafklaret forsøg genafsendes ikke automatisk.',
    );
  if (local) {
    await env.PLATFORM_DB.prepare(
      "UPDATE mail_test_deliveries SET status='preview' WHERE company_id=? AND request_id=?",
    )
      .bind(company, id)
      .run();
    return reply({
      status: 'preview',
      recipient,
      sender: from,
      preview: message,
    });
  }
  if (local) {
    await env.PLATFORM_DB.prepare(
      "UPDATE mail_test_deliveries SET status='preview' WHERE company_id=? AND request_id=?",
    )
      .bind(company, id)
      .run();
    return reply({
      status: 'preview',
      recipient,
      sender: from,
      preview: {
        from: { email: from, name },
        to: recipient,
        ...(message.replyTo ? { replyTo: message.replyTo } : {}),
        subject: message.subject,
        text: message.text,
      },
    });
  }
  // Only an older sender's own credentials are approved by its test; a connection domain is approved in the integration.
  const legacy = custom && kind === 'legacy';
  try {
    const receipt = await sendVia(env, transport, {
      ...message,
      ...(invoice ? { attachments: [invoice.attachment] } : {}),
    });
    await env.PLATFORM_DB.batch([
      env.PLATFORM_DB.prepare(
        "UPDATE mail_test_deliveries SET status='accepted',receipt=? WHERE company_id=? AND request_id=?",
      ).bind(receipt, company, id),
      ...(legacy
        ? [
            env.PLATFORM_DB.prepare(
              `UPDATE ${mailTable(own)} SET verified_revision=revision WHERE ${mailWhere(own)} AND revision=?`,
            ).bind(...mailKeys(company, own), settings!.revision),
          ]
        : []),
      audit(env, company, actor, 'mail.test.accepted', {
        requestId: id,
        mode: input.mode,
        recipient,
      }),
    ]);
    return reply({ status: 'accepted', recipient, sender: from });
  } catch {
    // Any send may have been accepted. Keep the durable claim and invalidate an older custom sender until an explicit
    // new test succeeds.
    if (legacy)
      await env.PLATFORM_DB.prepare(
        `UPDATE ${mailTable(own)} SET verified_revision=NULL WHERE ${mailWhere(own)} AND revision=?`,
      )
        .bind(...mailKeys(company, own), settings!.revision)
        .run();
    return reply({ status: 'uncertain', recipient, sender: from });
  }
}

// Ordinary invoice delivery is separate from the demo endpoint and can only use
// the Shopify-derived recipient and a persisted invoice selected by the server.
export async function sendCustomerInvoice(
  env: PlatformEnv,
  actor: Actor,
  company: string,
  shop: string,
  invoiceId: string,
  recipientValue: string,
  subject: string,
  text: string,
  attachment: {
    content: ArrayBuffer;
    filename: string;
    type: string;
    disposition: 'attachment';
  },
  kind: 'invoice' | 'credit' = 'invoice',
  scope?: MailScope,
) {
  await requireCompany(env.PLATFORM_DB, actor, company, true);
  if (
    actor.support ||
    actor.platformAdmin ||
    env.PLATFORM_ENV !== 'production' ||
    String(env.PLATFORM_CUSTOMER_EMAIL) !== 'enabled'
  )
    throw new HttpError(403, 'Kundeafsendelse er ikke aktiveret her.');
  await requireWebshop(env.PLATFORM_DB, actor, company, shop);
  // A credit note is sent like an invoice, with its own receipt so each document is mailed at most once.
  const invoice = await env.PLATFORM_DB.prepare(
    `SELECT id FROM ${kind === 'credit' ? 'platform_credit_notes' : 'platform_invoices'} WHERE company_id=? AND webshop_id=? AND id=? AND status='generated'`,
  )
    .bind(company, shop, invoiceId)
    .first();
  if (!invoice)
    throw new HttpError(
      404,
      kind === 'credit'
        ? 'Den genererede kreditnota findes ikke i webshoppen.'
        : 'Den genererede faktura findes ikke i webshoppen.',
    );
  const recipient = mailAddress(recipientValue),
    { settings, from, name, transport } = await resolveSender(
      env,
      company,
      scope,
    );
  const key: ReceiptKey = {
    company,
    shop,
    provider: 'invoice',
    module: kind === 'credit' ? 'credit_email' : 'email',
    externalId: invoiceId,
    destination: 'customer',
  };
  let current = await readReceipt(env, key);
  if (current?.phase === 'accepted')
    return reply({
      sent: true,
      recipient: current.payload.recipient,
      existing: true,
      status: 'accepted',
    });
  if (current)
    throw new HttpError(
      409,
      'Fakturamailen er allerede under afsendelse eller har et uafklaret resultat. Den genafsendes ikke automatisk.',
    );
  if (!transport && !env.PLATFORM_MAIL_TEST)
    throw new HttpError(503, 'Mailtjenesten er ikke konfigureret.');
  current = await saveReceipt(env, key, null, 'sending', {
    recipient,
    from,
    invoiceId,
    actorId: actor.id,
  });
  try {
    const receipt = await sendVia(env, transport, {
      from,
      name,
      to: recipient,
      ...(settings?.reply_to ? { replyTo: settings.reply_to } : {}),
      subject,
      text,
      attachments: [attachment],
    });
    current = await saveReceipt(env, key, current, 'accepted', {
      ...current.payload,
      receipt,
    });
  } catch {
    await uncertainReceipt(env, key, current);
    throw new HttpError(
      409,
      'Mailafsendelsen er uafklaret. Kontrollér leveringsloggen før yderligere handling.',
    );
  }
  return reply({ sent: true, recipient, status: 'accepted' });
}

/**
 * Sends one HTML mail (with a plain text version) from the sender of the scope (see resolveSender): its own address via its
 * Cloudflare account, otherwise the standard sender. Returns the sender and the provider's receipt, and throws when
 * the provider did not confirm the mail: the caller then treats the send as uncertain and never repeats it on its own.
 * Callers check access, recipient and whether customer mail is allowed before calling this.
 */
export async function deliverMail(
  env: PlatformEnv,
  company: string,
  scope: MailScope,
  message: { to: string; subject: string; html: string; text: string },
  override: { from?: string; name?: string } = {},
): Promise<{ from: string; receipt: string }> {
  const recipient = mailAddress(message.to),
    { settings, from, name, transport } = await resolveSender(
      env,
      company,
      scope,
      override.from,
    );
  if (!transport && !env.PLATFORM_MAIL_TEST)
    throw new HttpError(503, 'Mailtjenesten er ikke konfigureret.');
  const receipt = await sendVia(env, transport, {
    from,
    name: override.name || name,
    to: recipient,
    ...(settings?.reply_to ? { replyTo: settings.reply_to } : {}),
    subject: message.subject,
    text: message.text,
    html: message.html,
  });
  return { from, receipt };
}
/**
 * The address a scope's mails go out from now, and the domains another address may be chosen on: those approved in
 * Integrationer → Cloudflare E-mail, and the domain of an older approved sender of the scope.
 */
export async function currentSender(
  env: PlatformEnv,
  company: string,
  scope: MailScope,
) {
  const { settings, from, name, kind } = await resolveSender(
    env,
    company,
    scope,
  );
  const domains = await verifiedDomains(env, company, scope?.shop);
  if (kind === 'legacy' && !domains.includes(domainOf(settings!.custom_from)))
    domains.push(domainOf(settings!.custom_from));
  return { from, name, domains };
}
