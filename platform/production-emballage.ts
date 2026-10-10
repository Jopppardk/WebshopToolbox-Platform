import { requireCompany, requireWebshop } from './auth';
import { unseal } from './connections';
import {
  eiRequest,
  eiReports,
  isSubmitted,
  type EIContext,
  type EISchema,
  type EIReceipt,
} from './emballage-read';
import { handlePackaging } from './packaging';
import { dataStartDate } from './tier1-history';
import { productionWrites } from './production-policy';
import {
  readReceipt,
  saveReceipt,
  uncertainReceipt,
  type ReceiptKey,
} from './production-receipts';
import { HttpError, reply, type Actor, type PlatformEnv } from './types';
const fail = (message: string): never => {
  throw new HttpError(409, message);
};
export async function productionEmballage(
  request: Request,
  env: PlatformEnv,
  actor: Actor,
  company: string,
  shop: string,
  input: Record<string, unknown>,
) {
  await requireCompany(env.PLATFORM_DB, actor, company, true);
  await requireWebshop(env.PLATFORM_DB, actor, company, shop);
  if (!productionWrites(env) || actor.platformAdmin || actor.support)
    throw new HttpError(403, 'Indberetning er ikke aktiveret her.');
  if (
    !['preview', 'submit'].includes(String(input.action)) ||
    !/^\d{4}-Q[1-4]$/.test(String(input.quarter))
  )
    throw new HttpError(400, 'Vælg et afsluttet kvartal.');
  const [year, quarter] = String(input.quarter).split('-Q').map(Number),
    start = new Date(Date.UTC(year, (quarter - 1) * 3, 1))
      .toISOString()
      .slice(0, 10),
    end = new Date(Date.UTC(year, quarter * 3, 0)).toISOString().slice(0, 10);
  if (year < 2000 || end >= new Date().toISOString().slice(0, 10))
    fail('Kvartalet er endnu ikke afsluttet.');
  const db = env.PLATFORM_DB,
    saved = await db
      .prepare(
        'SELECT * FROM emballage_connections WHERE company_id=? AND webshop_id=?',
      )
      .bind(company, shop)
      .first<any>();
  if (!saved) fail('Forbind Emballage Indberetning først.');
  const config = JSON.parse(saved.config_json);
  // Webshops connected to the same organisation share its quarterly report, so it covers all of them together.
  const sharers = (
    await db
      .prepare(
        "SELECT e.webshop_id,e.config_json,e.revision,w.name FROM emballage_connections e JOIN webshops w ON w.company_id=e.company_id AND w.id=e.webshop_id WHERE e.company_id=? AND e.identity=? AND (w.status='active' OR e.webshop_id=?) ORDER BY e.webshop_id",
      )
      .bind(company, saved.identity, shop)
      .all<{
        webshop_id: string;
        config_json: string;
        revision: number;
        name: string;
      }>()
  ).results;
  if (!sharers.some((s) => s.webshop_id === shop))
    fail('Forbind Emballage Indberetning først.');
  const named = (s: { name: string }) =>
    sharers.length > 1 ? ` for ${s.name}` : '';
  for (const s of sharers) {
    const startDate = JSON.parse(s.config_json || '{}').startDate;
    if (
      !startDate ||
      start < startDate ||
      start < (await dataStartDate(env, company, s.webshop_id))
    )
      fail(`Kvartalet ligger før den valgte historikstart${named(s)}.`);
  }
  const key = (
    await unseal(
      env,
      [company, shop, 'emballage', saved.identity],
      saved.credentials_encrypted,
    )
  ).apiKey;
  const context = (await eiRequest<EIContext>(key, '/me')).data;
  if (
    String(context.organisation?.id) !== saved.identity ||
    typeof context.api_key?.is_test !== 'boolean'
  )
    fail('Organisationen kunne ikke bekræftes.');
  const reports = (await eiReports(key)).filter(
    (r) =>
      r.period.start_date === start &&
      r.period.end_date === end &&
      r.responsibility.code === config.responsibility &&
      r.responsibility.product_area.slug === 'packaging',
  );
  if (reports.length !== 1)
    fail('Der skal være præcis én rapport for perioden og producentansvaret.');
  const report = reports[0],
    keyFor = (webshop: string): ReceiptKey => ({
      company,
      shop: webshop,
      provider: 'emballage',
      module: 'report',
      externalId: String(report.id),
      destination:
        saved.identity + ':' + (context.api_key.is_test ? 'test' : 'live'),
    }),
    // One receipt per organisation and report, kept on the first of the sharing webshops; earlier
    // receipts kept on another webshop (before it shared the organisation) still count.
    receiptKey = keyFor(sharers[0].webshop_id);
  const priors = (
      await Promise.all(
        sharers.map((s) => readReceipt(env, keyFor(s.webshop_id))),
      )
    ).filter((r) => r !== null),
    prior = priors.find((r) => r?.phase === 'accepted') || priors[0] || null;
  if (prior?.phase === 'accepted')
    return reply({
      receipt: prior.payload.receipt,
      testMode: context.api_key.is_test,
    });
  if (prior)
    fail(
      'Et tidligere indberetningsforsøg afventer afklaring hos udbyderen. Der sendes ikke igen.',
    );
  if (
    isSubmitted(report.status) ||
    report.status !== 'draft' ||
    !report.accepts_writes
  )
    fail('Rapporten er indberettet eller lukket hos udbyderen.');
  const url = new URL(request.url);
  url.searchParams.set('from', start);
  url.searchParams.set('to', end);
  const periods: any[] = [];
  for (const s of sharers) {
    const result = await handlePackaging(
      new Request(url, { headers: request.headers }),
      env,
      actor,
      company,
      s.webshop_id,
    );
    if (!result.ok) return result;
    const value = (await result.json()) as any;
    if (
      !value.sync ||
      value.sync.coverage_start > start ||
      value.sync.coverage_end < end
    )
      fail(`Hent komplet historik til indberetning først${named(s)}.`);
    periods.push(value.period);
  }
  const sum = (field: string) =>
      periods.reduce((total, period) => total + (period[field] || 0), 0),
    p: Record<string, number> = {
      householdGrams: sum('householdGrams'),
      commercialGrams: sum('commercialGrams'),
      unknownAudienceGrams: sum('unknownAudienceGrams'),
      unresolved: sum('unresolved'),
    };
  if (p.unknownAudienceGrams)
    fail(
      'Afklar kundetypen (husholdning/erhverv) for alle emballagelinjer før indberetning.',
    );
  // Lines without weight or reportability are left out of the amounts. That is allowed, but must be accepted explicitly.
  if (
    input.action === 'submit' &&
    p.unresolved &&
    input.acceptIncomplete !== true
  )
    fail(
      'Bekræft, at linjer uden emballageoplysninger ikke kommer med i indberetningen.',
    );
  const schema = (
      await eiRequest<EISchema>(key, `/reports/${report.id}/schema`)
    ).data,
    mapping = config.mappings?.[String(schema.form_version_id)],
    answers: Record<string, number> = {};
  if (
    !mapping ||
    !mapping.household ||
    mapping.household === mapping.commercial
  )
    fail('Vælg forskellige kg-felter for husholdning og erhverv.');
  for (const audience of ['household', 'commercial']) {
    const field = schema.fields.find((f) => f.name === mapping[audience]),
      grams = p[audience + 'Grams'],
      kg = grams / 1000;
    if (
      !field ||
      field.type !== 'number' ||
      field.unit?.trim().toLowerCase() !== 'kg' ||
      !Number.isSafeInteger(grams) ||
      grams < 0
    )
      fail('Kontrollér mængder og feltopsætning.');
    const c = field!.constraints || {};
    if (
      (c.integer && !Number.isInteger(kg)) ||
      (typeof c.min === 'number' && kg < c.min) ||
      (typeof c.max === 'number' && kg > c.max)
    )
      fail('Mængden overholder ikke formularens grænser.');
    answers[field!.name] = kg;
  }
  if (schema.fields.some((f) => f.required && !(f.name in answers)))
    fail('Formularen kræver yderligere oplysninger hos udbyderen.');
  const payload = { answers },
    token = Array.from(
      new Uint8Array(
        await crypto.subtle.digest(
          'SHA-256',
          new TextEncoder().encode(
            JSON.stringify({
              revisions: sharers.map((s) => [s.webshop_id, s.revision]),
              schema,
              report,
              periods,
              payload,
            }),
          ),
        ),
      ),
      (n) => n.toString(16).padStart(2, '0'),
    ).join('');
  if (input.action === 'preview')
    return reply({
      token,
      quarter: String(input.quarter),
      householdKg: p.householdGrams / 1000,
      commercialKg: p.commercialGrams / 1000,
      ignoredLines: p.unresolved || 0,
      testMode: context.api_key.is_test,
      organisation: context.organisation.name,
      webshops: sharers.map((s) => s.name),
    });
  if (input.token !== token)
    fail('Data eller opsætning er ændret. Åbn kontrollen igen.');
  const latest = (
    await db
      .prepare(
        'SELECT webshop_id,revision FROM emballage_connections WHERE company_id=? AND identity=? ORDER BY webshop_id',
      )
      .bind(company, saved.identity)
      .all<{ webshop_id: string; revision: number }>()
  ).results;
  if (
    sharers.some(
      (s) =>
        latest.find((l) => l.webshop_id === s.webshop_id)?.revision !==
        s.revision,
    )
  )
    fail('Forbindelsen er ændret.');
  let claim = await saveReceipt(env, receiptKey, null, 'sending', {
    token,
    requestKey: crypto.randomUUID(),
    payload,
  });
  try {
    const receipt = (
      await eiRequest<EIReceipt>(
        key,
        `/reports/${report.id}/submit`,
        'POST',
        payload,
        claim.payload.requestKey,
        env,
      )
    ).data;
    if (
      !receipt?.submission_number ||
      !receipt.completed_at ||
      (context.api_key.is_test
        ? receipt.report_status !== 'draft'
        : !isSubmitted(receipt.report_status))
    )
      fail('Udbyderen returnerede ikke en gyldig kvittering.');
    claim = await saveReceipt(env, receiptKey, claim, 'accepted', {
      ...claim.payload,
      receipt,
    });
    return reply({ receipt, testMode: context.api_key.is_test });
  } catch {
    await uncertainReceipt(env, receiptKey, claim);
    return fail(
      'Indberetningens status er uafklaret. Kontrollér hos udbyderen; den genafsendes ikke automatisk.',
    );
  }
}
