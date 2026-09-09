import { prepareDatabase } from '@/db/database';
import { loadCredentials } from '@/db/credentials';
import {
  eiRequest,
  eiReports,
  EIError,
  isSubmitted,
  type EIContext,
  type EIReport,
  type EISchema,
  type EIReceipt,
} from '@/lib/emballage-api';
import {
  emptyEIConfig,
  recentQuarters,
  quarterTotals,
  mappedAnswers,
  type EIConfig,
} from '@/lib/emballage-reporting';
import type { PackagingRow, ManualPackaging } from '@/lib/packaging';
const tenant = 'sablen.dk';
export async function getEIConfig(db: D1Database) {
  const r = await db
    .prepare(
      "SELECT setting_value FROM app_settings WHERE tenant=? AND setting_key='emballage_config'",
    )
    .bind(tenant)
    .first<{ setting_value: string }>();
  return r ? (JSON.parse(r.setting_value) as EIConfig) : emptyEIConfig;
}
export async function putEIConfig(db: D1Database, config: EIConfig) {
  await db
    .prepare(
      "INSERT INTO app_settings(tenant,setting_key,setting_value) VALUES(?,'emballage_config',?) ON CONFLICT(tenant,setting_key) DO UPDATE SET setting_value=excluded.setting_value,updated_at=CURRENT_TIMESTAMP",
    )
    .bind(tenant, JSON.stringify(config))
    .run();
}
export async function eiAccess() {
  const credentials = await loadCredentials('emballage', true);
  if (!credentials)
    throw Error('Tilføj og forbind Emballage Indberetning i indstillingerne.');
  const { data: context } = await eiRequest<EIContext>(
    credentials.apiKey,
    '/me',
  );
  if (
    String(context.organisation?.id) !== credentials.organisationId ||
    typeof context.api_key?.is_test !== 'boolean'
  )
    throw Error('API-nøglens organisation kunne ikke bekræftes.');
  return { key: credentials.apiKey, context };
}
export async function packagingSources(db: D1Database) {
  const r = await db
    .prepare(
      "SELECT setting_key,setting_value FROM app_settings WHERE tenant=? AND setting_key LIKE 'packaging:%' ORDER BY setting_key",
    )
    .bind(tenant)
    .all<{ setting_key: string; setting_value: string }>();
  return {
    rows: r.results
      .filter((x) => x.setting_key.startsWith('packaging:snapshot:'))
      .map((x) => JSON.parse(x.setting_value) as PackagingRow),
    manual: r.results
      .filter((x) => x.setting_key.startsWith('packaging:manual:'))
      .map((x) => JSON.parse(x.setting_value) as ManualPackaging),
    coverage: JSON.parse(
      r.results.find((x) => x.setting_key === 'packaging:reporting-coverage')
        ?.setting_value || 'null',
    ) as null | {
      start: string;
      end: string;
      cvrField: string;
      cvrSource: string;
      syncedAt: string;
    },
  };
}
function reportFor(
  reports: EIReport[],
  config: EIConfig,
  q: { start: string; end: string },
) {
  const matches = reports.filter(
    (r) =>
      r.responsibility?.code === config.responsibility &&
      r.responsibility.product_area?.slug === 'packaging' &&
      r.period.start_date === q.start &&
      r.period.end_date === q.end,
  );
  if (matches.length > 1)
    throw Error(
      'Flere indberetninger matcher samme kvartal. Kontakt udbyderen.',
    );
  return matches[0];
}
export async function reportingOverview() {
  const db = await prepareDatabase(),
    credentials = await loadCredentials('emballage', true);
  if (!credentials) return { connected: false, quarters: [] };
  const config = await getEIConfig(db),
    { context, key } = await eiAccess(),
    reports = await eiReports(key),
    source = await packagingSources(db);
  const journal=await db.prepare('SELECT report_id,state,receipt_json FROM emballage_submissions WHERE tenant=? AND organisation=? AND test_mode=?').bind(tenant,String(context.organisation.id),context.api_key.is_test?1:0).all<{report_id:number;state:string;receipt_json:string|null}>();
  const quarters = recentQuarters().map((q) => {
    const totals = quarterTotals(source.rows, source.manual, q.start, q.end),
      report = reportFor(reports, config, q),
      submitted = report && isSubmitted(report.status);
    let reason = '';
    if (!config.startDate) reason = 'Vælg startdato i indstillingerne.';
    else if (q.start < config.startDate)
      reason = 'Før integrationens startdato';
    else if (!report) reason = 'Perioden er ikke tilgængelig hos udbyderen.';
    else if (!report.accepts_writes && !submitted)
      reason = 'Perioden er lukket for indberetning.';
    else if (totals.unresolved)
      reason = `${totals.unresolved} emballagelinjer kræver afklaring.`;
    else if (
      !source.coverage ||
      source.coverage.start > q.start ||
      source.coverage.end < q.end ||
      source.coverage.cvrField !== config.cvrField ||
      source.coverage.cvrSource !== config.cvrSource
    )
      reason = 'Hent historikken til indberetning først.';
    return {
      ...q,
      householdGrams: totals.householdGrams,
      commercialGrams: totals.commercialGrams,
      unresolved: totals.unresolved,
      reportId: report?.id,
      submitted: Boolean(submitted),
      submittedAt: report?.submitted_at,
      dueAt: report?.due_at,
      reason,
      statusNote:journal.results.find(j=>j.report_id===report?.id)?.state==='tested'?'Test gennemført — ikke indberettet':journal.results.some(j=>j.report_id===report?.id&&['sending','uncertain'].includes(j.state))?'Tidligere forsøg afventer bekræftelse':'',
      canSubmit: !submitted && !reason,
    };
  });
  return {
    connected: true,
    testMode: context.api_key.is_test,
    organisation: context.organisation.name,
    startDate: config.startDate,
    quarters,
    coverage: source.coverage,
  };
}
async function digest(value: unknown) {
  return Array.from(
    new Uint8Array(
      await crypto.subtle.digest(
        'SHA-256',
        new TextEncoder().encode(JSON.stringify(value)),
      ),
    ),
  )
    .map((n) => n.toString(16).padStart(2, '0'))
    .join('');
}
export async function prepareEIReport(quarter: string) {
  const db = await prepareDatabase(),
    config = await getEIConfig(db),
    q = recentQuarters().find((x) => x.id === quarter);
  if (!q || !config.startDate || q.start < config.startDate)
    throw Error('Kvartalet ligger uden for integrationens periode.');
  const { context, key } = await eiAccess(),
    report = reportFor(await eiReports(key), config, q);
  if (!report) throw Error('Indberetningsperioden findes ikke hos udbyderen.');
  if (isSubmitted(report.status))
    throw Error('Kvartalet er allerede indberettet. Opdatér oversigten.');
  if (!report.accepts_writes || report.status !== 'draft')
    throw Error('Perioden er lukket for indberetning.');
  const source = await packagingSources(db),
    totals = quarterTotals(source.rows, source.manual, q.start, q.end),
    c = source.coverage;
  if (
    !c ||
    c.start > q.start ||
    c.end < q.end ||
    c.cvrField !== config.cvrField ||
    c.cvrSource !== config.cvrSource
  )
    throw Error('Hent historikken til indberetning først.');
  if (totals.unresolved)
    throw Error(
      'Afklar manglende vægte, indberetningspligt og kundetype før indberetning.',
    );
  const { data: schema } = await eiRequest<EISchema>(
      key,
      `/reports/${report.id}/schema`,
    ),
    answers = mappedAnswers(
      schema,
      config.mappings[String(schema.form_version_id)],
      totals,
    );
  const payload = { answers },
    token = await digest({
      organisation: context.organisation.id,
      test: context.api_key.is_test,
      report: report.id,
      schema,
      config,
      payload,
      sources: totals.sources,
    });
  return {
    db,
    key,
    context,
    report,
    payload,
    token,
    summary: {
      quarter: q.label,
      householdKg: totals.householdGrams / 1000,
      commercialKg: totals.commercialGrams / 1000,
      testMode: context.api_key.is_test,
      organisation: context.organisation.name,
    },
  };
}
export async function submitEIReport(quarter: string, token: string) {
  const p = await prepareEIReport(quarter);
  if (p.token !== token)
    throw Error(
      'Data eller opsætning er ændret. Åbn kontrollen igen før indberetning.',
    );
  const org = String(p.context.organisation.id),
    test = p.context.api_key.is_test ? 1 : 0,
    id = p.report.id,
    owner = crypto.randomUUID(),
    now = Date.now(),
    payload = JSON.stringify(p.payload);
  await p.db
    .prepare(
      "INSERT INTO emballage_submissions(tenant,organisation,test_mode,report_id,request_key,payload_json,state) VALUES(?,?,?,?,?,?,'ready') ON CONFLICT DO NOTHING",
    )
    .bind(tenant, org, test, id, crypto.randomUUID(), payload)
    .run();
  const locked = await p.db
    .prepare(
      'UPDATE emballage_submissions SET lock_owner=?,lock_until=? WHERE tenant=? AND organisation=? AND test_mode=? AND report_id=? AND lock_until<?',
    )
    .bind(owner, now + 300000, tenant, org, test, id, now)
    .run();
  if (!locked.meta.changes)
    throw Error('Indberetningen behandles allerede. Vent og opdatér status.');
  try {
    const row = await p.db
      .prepare(
        'SELECT request_key,payload_json,state,receipt_json FROM emballage_submissions WHERE tenant=? AND organisation=? AND test_mode=? AND report_id=?',
      )
      .bind(tenant, org, test, id)
      .first<{
        request_key: string;
        payload_json: string;
        state: string;
        receipt_json: string | null;
      }>();
    if (!row) throw Error('Indberetningens journal kunne ikke læses.');
    if (row.state === 'tested' && row.payload_json !== payload)
      row.state = 'rejected';
    if (row.state === 'submitted' || row.state === 'tested')
      return {
        receipt: JSON.parse(row.receipt_json!),
        testMode: Boolean(test),
      };
    if (row.payload_json !== payload && row.state !== 'rejected')
      throw Error(
        'Et tidligere forsøg afventer afklaring. Mængderne kan ikke ændres, før status er afklaret.',
      );
    let requestKey = row.request_key;
    if (row.state === 'rejected') {
      requestKey = crypto.randomUUID();
      await p.db
        .prepare(
          'UPDATE emballage_submissions SET request_key=?,payload_json=? WHERE tenant=? AND organisation=? AND test_mode=? AND report_id=? AND lock_owner=?',
        )
        .bind(requestKey, payload, tenant, org, test, id, owner)
        .run();
    }
    await p.db
      .prepare(
        "UPDATE emballage_submissions SET state='sending',updated_at=CURRENT_TIMESTAMP WHERE tenant=? AND organisation=? AND test_mode=? AND report_id=? AND lock_owner=?",
      )
      .bind(tenant, org, test, id, owner)
      .run();
    let receipt: EIReceipt;
    try {
      const result = await eiRequest<EIReceipt>(
        p.key,
        `/reports/${id}/submit`,
        'POST',
        p.payload,
        requestKey,
      );
      receipt = result.data;
      if (
        !receipt?.submission_number ||
        !receipt.completed_at ||
        (test
          ? receipt.report_status !== 'draft'
          : !isSubmitted(receipt.report_status))
      )
        throw new EIError(502, 'invalid_receipt');
    } catch (e) {
      const rejected =
        e instanceof EIError &&
        [400, 401, 403, 404, 422, 429].includes(e.status);
      await p.db
        .prepare(
          'UPDATE emballage_submissions SET state=? WHERE tenant=? AND organisation=? AND test_mode=? AND report_id=? AND lock_owner=?',
        )
        .bind(rejected ? 'rejected' : 'uncertain', tenant, org, test, id, owner)
        .run();
      throw e;
    }
    await p.db
      .prepare(
        'UPDATE emballage_submissions SET state=?,receipt_json=?,updated_at=CURRENT_TIMESTAMP WHERE tenant=? AND organisation=? AND test_mode=? AND report_id=? AND lock_owner=?',
      )
      .bind(
        test ? 'tested' : 'submitted',
        JSON.stringify(receipt),
        tenant,
        org,
        test,
        id,
        owner,
      )
      .run();
    return { receipt, testMode: Boolean(test) };
  } finally {
    await p.db
      .prepare(
        'UPDATE emballage_submissions SET lock_until=0,lock_owner=NULL WHERE tenant=? AND organisation=? AND test_mode=? AND report_id=? AND lock_owner=?',
      )
      .bind(tenant, org, test, id, owner)
      .run();
  }
}
