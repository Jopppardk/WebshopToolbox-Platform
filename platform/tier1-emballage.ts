import { asText } from './tier1/src/lib/format';
import { productionEmballage } from './production-emballage';
import { productionWrites } from './production-policy';
import { requireCompany, requireWebshop } from './auth';
import { seal, unseal } from './connections';
import {
  eiConnectionError,
  eiRequest,
  eiReports,
  isSubmitted,
  type EIContext,
  type EISchema,
} from './emballage-read';
import { jsonBody } from './invitations';
import { handlePackaging } from './packaging';
import { syncPackaging } from './packaging-source';
import { dataStartDate } from './tier1-history';
import { HttpError, reply, type Actor, type PlatformEnv } from './types';

export async function handleTier1Emballage(
  request: Request,
  env: PlatformEnv,
  actor: Actor,
  company: string,
  shop: string,
  path: string,
) {
  if (shop === 'none') throw new HttpError(409, 'Forbind en webshop først.');
  const db = env.PLATFORM_DB,
    url = new URL(request.url),
    get = request.method === 'GET';
  const saved = await db
    .prepare(
      'SELECT * FROM emballage_connections WHERE company_id=? AND webshop_id=?',
    )
    .bind(company, shop)
    .first<any>();
  let context: EIContext | null = saved ? JSON.parse(saved.context_json) : null,
    config = saved
      ? JSON.parse(saved.config_json)
      : { startDate: '', responsibility: '', mappings: {} },
    key = '';
  if (saved)
    key = (
      await unseal(
        env,
        [company, shop, 'emballage', saved.identity],
        saved.credentials_encrypted,
      )
    ).apiKey;
  if (!get) {
    if (request.method !== 'POST') throw new HttpError(405, 'Brug Gem.');
    await requireCompany(db, actor, company, true);
    const b = await jsonBody(request, 16000);
    if (path === '/emballage/reporting') {
      if (b.action !== 'sync')
        return productionEmballage(request, env, actor, company, shop, b);
      const input = {
        action: 'sync',
        start: await dataStartDate(env, company, shop),
        end: new Date().toISOString().slice(0, 10),
      };
      const response = await handlePackaging(
        new Request(request.url, {
          method: 'POST',
          headers: request.headers,
          body: JSON.stringify(input),
        }),
        env,
        actor,
        company,
        shop,
      );
      if (!response.ok) return response;
    } else if (b.action === 'connect') {
      if (b.copyFrom !== undefined) {
        // The same organisation as another of the company's webshops: the key is copied and sealed on the
        // server, never sent to the browser. Its quarterly reports then cover both webshops together.
        const from = asText(b.copyFrom);
        if (!from || from === shop)
          throw new HttpError(400, 'Vælg en anden webshop.');
        await requireWebshop(db, actor, company, from);
        const source = await db
          .prepare(
            'SELECT identity,credentials_encrypted FROM emballage_connections WHERE company_id=? AND webshop_id=?',
          )
          .bind(company, from)
          .first<{ identity: string; credentials_encrypted: string }>();
        if (!source)
          throw new HttpError(
            409,
            'Den valgte webshop har ingen forbindelse til Emballage Indberetning.',
          );
        key = (
          await unseal(
            env,
            [company, from, 'emballage', source.identity],
            source.credentials_encrypted,
          )
        ).apiKey;
      } else {
        if (
          typeof b.apiKey !== 'string' ||
          !b.apiKey.trim() ||
          b.apiKey.length > 2048
        )
          throw new HttpError(400, 'Angiv en gyldig API-nøgle.');
        key = b.apiKey.trim();
      }
      let verified: EIContext;
      try {
        verified = (await eiRequest<EIContext>(key, '/me')).data;
      } catch (error) {
        throw new HttpError(409, eiConnectionError(error));
      }
      if (
        !Number.isSafeInteger(verified.organisation?.id) ||
        typeof verified.organisation.name !== 'string' ||
        typeof verified.api_key?.is_test !== 'boolean' ||
        !Array.isArray(verified.responsibilities)
      )
        throw new HttpError(
          409,
          'Tjenesten returnerede ufuldstændige virksomhedsoplysninger.',
        );
      const identity = String(verified.organisation.id);
      if (saved && saved.identity !== identity)
        throw new HttpError(
          409,
          'Forbindelsen kan ikke skiftes til en anden organisation.',
        );
      const encrypted = await seal(
        env,
        [company, shop, 'emballage', identity],
        { apiKey: key },
      );
      const result = await db
        .prepare(
          'INSERT INTO emballage_connections(company_id,webshop_id,identity,credentials_encrypted,context_json,config_json) VALUES(?,?,?,?,?,?) ON CONFLICT(company_id,webshop_id) DO UPDATE SET credentials_encrypted=excluded.credentials_encrypted,context_json=excluded.context_json,revision=emballage_connections.revision+1 WHERE emballage_connections.identity=excluded.identity AND emballage_connections.revision=?',
        )
        .bind(
          company,
          shop,
          identity,
          encrypted,
          JSON.stringify(verified),
          JSON.stringify(config),
          saved?.revision || 0,
        )
        .run();
      if (!result.meta.changes)
        throw new HttpError(409, 'Forbindelsen blev ændret. Genindlæs.');
      context = verified;
    } else if (b.action === 'settings') {
      if (!saved) throw new HttpError(409, 'Forbind tjenesten først.');
      const input = b.config as any;
      if (
        !input ||
        typeof input.startDate !== 'string' ||
        !/^\d{4}-(01|04|07|10)-01$/.test(input.startDate) ||
        !context!.responsibilities.some((r) => r.code === input.responsibility)
      )
        throw new HttpError(
          400,
          'Vælg et kvartals startdato og virksomhedens producentansvar.',
        );
      config = {
        startDate: input.startDate,
        responsibility: input.responsibility,
        mappings: config.mappings || {},
      };
      if (b.reportId) {
        const reports = await eiReports(key);
        if (
          !reports.some(
            (r) =>
              r.id === b.reportId &&
              r.responsibility.code === config.responsibility,
          )
        )
          throw new HttpError(
            403,
            'Rapporten tilhører ikke dette producentansvar.',
          );
        const schema = (
            await eiRequest<EISchema>(
              key,
              `/reports/${encodeURIComponent(asText(b.reportId))}/schema`,
            )
          ).data,
          mapping = b.mapping as any;
        if (
          !mapping ||
          !schema.fields.some((f) => f.name === mapping.household) ||
          !schema.fields.some((f) => f.name === mapping.commercial) ||
          mapping.household === mapping.commercial
        )
          throw new HttpError(
            400,
            'Vælg to forskellige felter fra rapportens formular.',
          );
        config.mappings[String(schema.form_version_id)] = {
          household: mapping.household,
          commercial: mapping.commercial,
        };
      }
      const firstConfiguration =
        !saved.config_json || !JSON.parse(saved.config_json).startDate;
      let initialHistory: null | { count: number; stored: number } = null;
      if (firstConfiguration) {
        try {
          initialHistory = await syncPackaging(
            env,
            company,
            shop,
            config.startDate,
            new Date().toISOString().slice(0, 10),
          );
        } catch (e) {
          if (e instanceof HttpError) throw e;
          throw new HttpError(
            409,
            'Den tidligere emballagehistorik kunne ikke hentes komplet. Opsætningen er ikke gemt; kontrollér Shopify-adgangen og prøv igen.',
          );
        }
      }
      const update = await db
        .prepare(
          'UPDATE emballage_connections SET config_json=?,revision=revision+1 WHERE company_id=? AND webshop_id=? AND revision=?',
        )
        .bind(JSON.stringify(config), company, shop, saved.revision)
        .run();
      if (!update.meta.changes)
        throw new HttpError(409, 'Opsætningen er ændret. Genindlæs.');
      if (initialHistory) return reply({ ok: true, initialHistory });
    } else throw new HttpError(400, 'Ugyldig handling.');
  }
  const reports = key ? await eiReports(key) : [];
  if (path === '/emballage/connection') {
    if (url.searchParams.has('reportId')) {
      const id = Number(url.searchParams.get('reportId'));
      if (!reports.some((r) => r.id === id))
        throw new HttpError(404, 'Rapporten findes ikke.');
      return reply({
        schema: (await eiRequest<EISchema>(key, `/reports/${id}/schema`)).data,
      });
    }
    // The company's other webshops with a connection; this webshop can use the same organisation.
    // Only company administrators see the other webshops.
    const admin = await requireCompany(db, actor, company, true).then(
      () => true,
      () => false,
    );
    const reusable = !admin
      ? []
      : (
          await db
            .prepare(
              "SELECT w.id,w.name,e.identity FROM emballage_connections e JOIN webshops w ON w.company_id=e.company_id AND w.id=e.webshop_id WHERE e.company_id=? AND e.webshop_id<>? AND w.status='active' ORDER BY w.name,w.id",
            )
            .bind(company, shop)
            .all<{ id: string; name: string; identity: string }>()
        ).results;
    return reply({
      connected: !!context,
      reusable: reusable
        .filter((r) => !saved || r.identity !== saved.identity)
        .map(({ id, name }) => ({ id, name })),
      sharedWith: saved
        ? reusable
            .filter((r) => r.identity === saved.identity)
            .map((r) => r.name)
        : [],
      testMode: context?.api_key.is_test,
      organisation: context?.organisation.name,
      config,
      responsibilities: context?.responsibilities || [],
      reports,
    });
  }
  const now = new Date(),
    year = now.getUTCFullYear(),
    quarter = Math.floor(now.getUTCMonth() / 3),
    quarters = [];
  for (let i = 1; i <= 5; i++) {
    const start = new Date(Date.UTC(year, quarter * 3 - i * 3, 1))
        .toISOString()
        .slice(0, 10),
      end = new Date(Date.UTC(year, quarter * 3 - i * 3 + 3, 0))
        .toISOString()
        .slice(0, 10);
    const next = new URL(request.url);
    next.searchParams.set('from', start);
    next.searchParams.set('to', end);
    const result = await handlePackaging(
      new Request(next, { headers: request.headers }),
      env,
      actor,
      company,
      shop,
    );
    const value = (await result.json()) as any;
    if (!result.ok) return reply(value, result.status);
    const report = reports.find(
      (r) =>
        r.period.start_date === start &&
        r.period.end_date === end &&
        r.responsibility.code === config.responsibility,
    );
    const p = value.period;
    const reason = !productionWrites(env)
      ? 'Dev: ekstern indberetning er blokeret.'
      : !config.startDate || start < config.startDate
        ? 'Før integrationens startdato.'
        : !report
          ? 'Perioden findes ikke hos udbyderen.'
          : !report.accepts_writes
            ? 'Perioden er lukket.'
            : !value.sync ||
                value.sync.coverage_start > start ||
                value.sync.coverage_end < end
              ? 'Hent komplet historik først.'
              : p.unknownAudienceGrams
                ? 'Afklar emballagelinjerne først: kundetypen (husholdning/erhverv) mangler for nogle linjer.'
                : '';
    quarters.push({
      id:
        start.slice(0, 4) +
        '-Q' +
        (Math.floor((Number(start.slice(5, 7)) - 1) / 3) + 1),
      label: start + ' – ' + end,
      start,
      end,
      householdGrams: p.householdGrams || 0,
      commercialGrams: p.commercialGrams || 0,
      reportableGrams: p.reportableGrams,
      unknownAudienceGrams: p.unknownAudienceGrams || 0,
      warning: p.unresolved
        ? `${p.unresolved} ${p.unresolved === 1 ? 'linje mangler' : 'linjer mangler'} emballagevægt eller indberetningspligt og kommer ikke med. Mængden kan derfor være for lav.`
        : '',
      submitted: !!report && isSubmitted(report.status),
      submittedAt: report?.submitted_at || null,
      reason,
      canSubmit: !reason && !!report && !isSubmitted(report.status),
      unresolved: p.unconfiguredProductLines,
    });
  }
  return reply({
    connected: !!context,
    testMode: context?.api_key.is_test,
    organisation: context?.organisation.name,
    startDate: config.startDate,
    quarters,
  });
}
