import { NextResponse } from 'next/server';
import { prepareDatabase } from '@/db/database';
import { loadCredentials, saveCredentials } from '@/db/credentials';
import { eiAccess, getEIConfig, putEIConfig } from '@/db/emballage';
import {
  eiRequest,
  eiReports,
  type EIContext,
  type EISchema,
} from '@/lib/emballage-api';
import { validateEIConfig, mappedAnswers } from '@/lib/emballage-reporting';
const reply = (data: unknown, status = 200) =>
  NextResponse.json(data, { status, headers: { 'Cache-Control': 'no-store' } });
export async function GET(request: Request) {
  try {
    const db = await prepareDatabase(),
      config = await getEIConfig(db),
      credentials = await loadCredentials('emballage', true);
    if (!credentials) return reply({ connected: false, config });
    const { context, key } = await eiAccess(),
      reports = (await eiReports(key)).filter(
        (r) => r.responsibility.product_area.slug === 'packaging',
      );
    const id = new URL(request.url).searchParams.get('reportId');
    if (id) {
      if (!reports.some((r) => String(r.id) === id))
        return reply({ error: 'Ugyldig indberetning.' }, 400);
      return reply({
        schema: (await eiRequest<EISchema>(key, `/reports/${id}/schema`)).data,
      });
    }
    return reply({
      connected: true,
      config,
      organisation: context.organisation.name,
      testMode: context.api_key.is_test,
      responsibilities: context.responsibilities.filter(
        (r) => r.product_area.slug === 'packaging',
      ),
      reports,
    });
  } catch (e) {
    return reply(
      {
        error:
          e instanceof Error ? e.message : 'Forbindelsen kunne ikke læses.',
      },
      503,
    );
  }
}
export async function POST(request: Request) {
  if (
    request.headers.get('origin') !== new URL(request.url).origin ||
    !request.headers.get('content-type')?.startsWith('application/json')
  )
    return reply({ error: 'Start handlingen fra indstillingerne.' }, 403);
  try {
    const body = (await request.json()) as Record<string, unknown>,
      db = await prepareDatabase();
    if (body.action === 'connect') {
      const key = typeof body.apiKey === 'string' ? body.apiKey.trim() : '';
      if (!/^esk_[^.\s]+\.[^\s]+$/.test(key) || key.length > 1000)
        throw Error('Indtast hele API-nøglen, inklusive punktum og secret.');
      const { data: context } = await eiRequest<EIContext>(key, '/me');
      if (
        !Number.isSafeInteger(context.organisation?.id) ||
        !context.organisation.name ||
        typeof context.api_key?.is_test !== 'boolean'
      )
        throw Error('Organisationen kunne ikke bekræftes.');
      if (
        !context.responsibilities?.some(
          (r) => r.product_area?.slug === 'packaging',
        )
      )
        throw Error('Nøglen har ikke et producentansvar for emballage.');
      const old = await loadCredentials('emballage', true);
      if (old && old.organisationId !== String(context.organisation.id))
        throw Error(
          'Nøglen tilhører en anden organisation. Forbindelsen blev ikke ændret.',
        );
      await saveCredentials(
        'emballage',
        { apiKey: key, organisationId: String(context.organisation.id) },
        context.organisation.name,
      );
      return reply({
        connected: true,
        testMode: context.api_key.is_test,
        name: context.organisation.name,
      });
    }
    if (body.action === 'settings') {
      const config = validateEIConfig(
          body.config as Parameters<typeof validateEIConfig>[0],
        ),
        { context, key } = await eiAccess();
      if (
        !context.responsibilities.some(
          (r) =>
            r.code === config.responsibility &&
            r.product_area.slug === 'packaging',
        )
      )
        throw Error('Vælg virksomhedens producentansvar for emballage.');
      const old = await getEIConfig(db);
      config.mappings =
        old.responsibility === config.responsibility ? old.mappings : {};
      if (body.reportId) {
        const report = (await eiReports(key)).find(
          (r) =>
            r.id === Number(body.reportId) &&
            r.responsibility.code === config.responsibility,
        );
        if (!report)
          throw Error('Vælg en indberetning til det valgte producentansvar.');
        const { data: schema } = await eiRequest<EISchema>(
            key,
            `/reports/${report.id}/schema`,
          ),
          mapping = body.mapping as { household: string; commercial: string };
        // Validate the field contract without submitting or rounding quantities.
        mappedAnswers(
          schema,
          mapping,
          { householdGrams: 0, commercialGrams: 0 },
          false,
        );
        config.mappings[String(schema.form_version_id)] = mapping;
      }
      await putEIConfig(db, config);
      return reply({ ok: true, config });
    }
    return reply({ error: 'Ugyldig handling.' }, 400);
  } catch (e) {
    return reply(
      {
        error:
          e instanceof Error ? e.message : 'Opsætningen kunne ikke gemmes.',
      },
      422,
    );
  }
}
