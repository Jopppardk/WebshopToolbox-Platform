import { NextResponse } from 'next/server';
import {
  reportingOverview,
  prepareEIReport,
  submitEIReport,
  getEIConfig,
} from '@/db/emballage';
import { prepareDatabase } from '@/db/database';
import { syncPackaging } from '@/app/api/shopify/packaging/route';
import { danishDate } from '@/lib/history-policy';
const reply = (data: unknown, status = 200) =>
  NextResponse.json(data, { status, headers: { 'Cache-Control': 'no-store' } });
export async function GET() {
  try {
    return reply(await reportingOverview());
  } catch (e) {
    return reply(
      {
        error:
          e instanceof Error ? e.message : 'Indberetninger kunne ikke hentes.',
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
    return reply({ error: 'Start handlingen fra emballagesiden.' }, 403);
  try {
    const body = (await request.json()) as {
      action: string;
      quarter: string;
      token: string;
    };
    if (body.action === 'sync') {
      const db = await prepareDatabase(),
        config = await getEIConfig(db);
      if (!config.startDate || !config.cvrField)
        throw Error('Gem integrationens startdato og CVR-felt først.');
      await syncPackaging(config.startDate, danishDate(), true);
      return reply(await reportingOverview());
    }
    if (body.action === 'preview') {
      const p = await prepareEIReport(body.quarter);
      return reply({ token: p.token, ...p.summary });
    }
    if (body.action === 'submit' && typeof body.token === 'string')
      return reply(await submitEIReport(body.quarter, body.token));
    return reply({ error: 'Ugyldig handling.' }, 400);
  } catch (e) {
    return reply(
      {
        error:
          e instanceof Error
            ? e.message
            : 'Indberetningen kunne ikke gennemføres. Opdatér status før et nyt forsøg.',
      },
      422,
    );
  }
}
