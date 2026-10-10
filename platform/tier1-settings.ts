import { requireCompany, requireWebshop } from './auth';
import { jsonBody } from './invitations';
import { HttpError, reply, type Actor, type PlatformEnv } from './types';
import {
  validateSettings,
  emptyAccounts,
  defaultAutomation,
  type AdminSettings,
} from './tier1/src/lib/admin-settings';
import { creditMailTemplates } from './invoice-profiles';

const defaults = {
  subject: 'Faktura {{fakturanummer}} fra {{virksomhedsnavn}}',
  body: 'Hej {{kundenavn}}\n\nTak for din ordre hos {{virksomhedsnavn}}.\n\nVedhæftet finder du faktura {{fakturanummer}} for ordre {{ordrenummer}}.\n\nVenlig hilsen\n{{virksomhedsnavn}}',
};
async function fingerprint(parts: string[]) {
  return Array.from(
    new Uint8Array(
      await crypto.subtle.digest(
        'SHA-256',
        new TextEncoder().encode(JSON.stringify(parts)),
      ),
    ),
    (n) => n.toString(16).padStart(2, '0'),
  ).join('');
}
// The Danish invoice mail texts are the company's, or the webshop's own when it has its own invoice settings.
async function textsOf(db: D1Database, company: string, shop: string) {
  const own = await db
    .prepare(
      'SELECT 1 AS own FROM webshop_invoice_settings WHERE company_id=? AND webshop_id=?',
    )
    .bind(company, shop)
    .first();
  return own
    ? {
        own: 1,
        table: 'webshop_invoice_settings',
        where: 'company_id=? AND webshop_id=?',
        keys: [company, shop],
      }
    : {
        own: 0,
        table: 'invoice_settings',
        where: 'company_id=?',
        keys: [company],
      };
}
async function state(db: D1Database, company: string, shop: string) {
  const texts = await textsOf(db, company, shop);
  const preference = await db
    .prepare(
      'SELECT preferences_json,revision FROM tier1_preferences WHERE company_id=? AND webshop_id=?',
    )
    .bind(company, shop)
    .first<{ preferences_json: string; revision: string }>();
  const mapping = await db
    .prepare('SELECT accounts_json FROM accounting_mapping WHERE company_id=?')
    .bind(company)
    .first<{ accounts_json: string }>();
  const invoice = await db
    .prepare(
      `SELECT subject,body,credit_subject,credit_body FROM ${texts.table} WHERE ${texts.where}`,
    )
    .bind(...texts.keys)
    .first<{
      subject: string;
      body: string;
      credit_subject: string | null;
      credit_body: string | null;
    }>();
  const revision = await fingerprint([
    String(texts.own),
    preference?.revision || '',
    mapping?.accounts_json || '',
    invoice?.subject || '',
    invoice?.body || '',
    invoice?.credit_subject || '',
    invoice?.credit_body || '',
  ]);
  // The credit-note mail text (Danmark) is kept next to the invoice mail text; without one the default is shown.
  const credit = {
    creditSubject: invoice?.credit_subject || creditMailTemplates.da.subject,
    creditBody: invoice?.credit_body || creditMailTemplates.da.body,
  };
  const preferences = preference
    ? JSON.parse(preference.preferences_json)
    : { automation: defaultAutomation, syncIntervalMinutes: 15 };
  return {
    texts,
    preference,
    mapping,
    invoice,
    revision,
    settings: validateSettings({
      ...preferences,
      accounts: {
        ...emptyAccounts,
        ...JSON.parse(mapping?.accounts_json || '{}'),
      },
      invoiceEmail: invoice
        ? { subject: invoice.subject, body: invoice.body, ...credit }
        : { ...defaults, ...credit },
    }),
  };
}

export async function handleTier1Settings(
  request: Request,
  env: PlatformEnv,
  actor: Actor,
  company: string,
  shop: string,
) {
  const db = env.PLATFORM_DB;
  await requireWebshop(db, actor, company, shop);
  await requireCompany(db, actor, company, true);
  if (actor.platformAdmin)
    throw new HttpError(
      403,
      'Indstillinger ændres af virksomhedsadministratoren.',
    );
  const old = await state(db, company, shop);
  if (request.method === 'GET')
    return reply({ settings: old.settings, revision: old.revision });
  if (actor.support)
    throw new HttpError(
      403,
      'Indstillinger ændres af virksomhedsadministratoren.',
    );
  if (request.method !== 'POST')
    throw new HttpError(405, 'Brug Gem indstillinger.');
  const input = await jsonBody(request, 16000);
  if (input.revision !== old.revision)
    throw new HttpError(
      409,
      'Indstillingerne er ændret i en anden fane. Genindlæs før du gemmer.',
    );
  let settings: AdminSettings;
  try {
    settings = validateSettings(input.settings);
  } catch {
    throw new HttpError(400, 'Kontrollér konti, modulvalg og mailskabelon.');
  }
  // Shared mapping/mail fields may be edited through the existing portal or a
  // different webshop while this request is in flight. Compare them inside the
  // transaction as well, before claiming the per-webshop preference revision.
  // Also that the webshop has not switched between the company's and its own invoice settings meanwhile.
  const { table, where, keys } = old.texts;
  const condition = `EXISTS(SELECT 1 FROM webshop_invoice_settings WHERE company_id=? AND webshop_id=?)=? AND COALESCE((SELECT accounts_json FROM accounting_mapping WHERE company_id=?),'')=? AND COALESCE((SELECT subject FROM ${table} WHERE ${where}),'')=? AND COALESCE((SELECT body FROM ${table} WHERE ${where}),'')=? AND COALESCE((SELECT credit_subject FROM ${table} WHERE ${where}),'')=? AND COALESCE((SELECT credit_body FROM ${table} WHERE ${where}),'')=?`;
  const guard = [
    company,
    shop,
    old.texts.own,
    company,
    old.mapping?.accounts_json || '',
    ...keys,
    old.invoice?.subject || '',
    ...keys,
    old.invoice?.body || '',
    ...keys,
    old.invoice?.credit_subject || '',
    ...keys,
    old.invoice?.credit_body || '',
  ];
  const preferences = JSON.stringify({
    automation: settings.automation,
    syncIntervalMinutes: settings.syncIntervalMinutes,
  });
  const revision = crypto.randomUUID();
  const claim = old.preference
    ? db
        .prepare(
          `UPDATE tier1_preferences SET preferences_json=?,revision=? WHERE company_id=? AND webshop_id=? AND revision=? AND ${condition}`,
        )
        .bind(
          preferences,
          revision,
          company,
          shop,
          old.preference.revision,
          ...guard,
        )
    : db
        .prepare(
          `INSERT INTO tier1_preferences(company_id,webshop_id,preferences_json,revision) SELECT ?,?,?,? WHERE ${condition} ON CONFLICT DO NOTHING`,
        )
        .bind(company, shop, preferences, revision, ...guard);
  const result = await db.batch([
    claim,
    db
      .prepare(
        'INSERT INTO accounting_mapping(company_id,accounts_json) SELECT ?,? WHERE changes()=1 ON CONFLICT(company_id) DO UPDATE SET accounts_json=excluded.accounts_json,updated_at=CURRENT_TIMESTAMP',
      )
      .bind(company, JSON.stringify(settings.accounts)),
    old.texts.own
      ? db
          .prepare(
            'UPDATE webshop_invoice_settings SET subject=?,body=?,credit_subject=?,credit_body=?,revision=revision+1,updated_at=CURRENT_TIMESTAMP WHERE company_id=? AND webshop_id=? AND changes()=1',
          )
          .bind(
            settings.invoiceEmail.subject,
            settings.invoiceEmail.body,
            settings.invoiceEmail.creditSubject,
            settings.invoiceEmail.creditBody,
            company,
            shop,
          )
      : db
          .prepare(
            "INSERT INTO invoice_settings(company_id,name,address,cvr,contact,subject,body,credit_subject,credit_body) SELECT id,name,'','','',?,?,?,? FROM companies WHERE id=? AND changes()=1 ON CONFLICT(company_id) DO UPDATE SET subject=excluded.subject,body=excluded.body,credit_subject=excluded.credit_subject,credit_body=excluded.credit_body",
          )
          .bind(
            settings.invoiceEmail.subject,
            settings.invoiceEmail.body,
            settings.invoiceEmail.creditSubject,
            settings.invoiceEmail.creditBody,
            company,
          ),
    db
      .prepare(
        "INSERT INTO audit_events(id,company_id,actor_id,action,resource_id,details_json) SELECT ?,?,?,'tier1.settings.saved',?,'{}' WHERE changes()=1",
      )
      .bind(crypto.randomUUID(), company, actor.id, shop),
  ]);
  if (result[0].meta.changes !== 1)
    throw new HttpError(
      409,
      'Indstillingerne er ændret. Genindlæs før du gemmer.',
    );
  const savedRevision = await fingerprint([
    String(old.texts.own),
    revision,
    JSON.stringify(settings.accounts),
    settings.invoiceEmail.subject,
    settings.invoiceEmail.body,
    settings.invoiceEmail.creditSubject,
    settings.invoiceEmail.creditBody,
  ]);
  return reply({
    settings,
    revision: savedRevision,
    message:
      env.PLATFORM_ENV === 'production'
        ? 'Indstillingerne er gemt. De valgte produktionsmoduler behandles automatisk.'
        : 'Indstillingerne er gemt. Automatik, bogføring og kundemail er blokeret i testmiljøet.',
  });
}
