import { NextRequest, NextResponse } from 'next/server';
import { prepareDatabase } from '@/db/database';

const tenant = 'sablen.dk';
const priorities = ['low', 'medium', 'high', 'critical'] as const;
const statuses = [
  'proposed',
  'clarification',
  'ready',
  'in_progress',
  'testing',
  'production',
  'rejected',
] as const;
const areas = [
  'Generelt',
  'Salg',
  'Tilbagebetalinger',
  'Udbetalinger',
  'Fakturaer',
  'Lager',
  'Emballage',
  'Integrationer',
  'Drift og sikkerhed',
] as const;
const reply = (data: unknown, status = 200) =>
  NextResponse.json(data, { status, headers: { 'Cache-Control': 'no-store' } });
const clean = (value: unknown, max: number) =>
  typeof value === 'string' ? value.trim().slice(0, max) : '';
function authorizeWrite(request: NextRequest) {
  const origin = request.headers.get('origin');
  const actor = request.headers
    .get('cf-access-authenticated-user-email')
    ?.trim()
    .toLowerCase();
  if (
    !origin ||
    origin !== request.nextUrl.origin ||
    !request.headers.get('content-type')?.startsWith('application/json')
  )
    return reply(
      { error: 'Handlingen skal startes fra integrationssiden.' },
      403,
    );
  if (process.env.NODE_ENV === 'production' && actor !== 'rene@sablen.dk')
    return reply({ error: 'Adgang afvist.' }, 403);
  return null;
}

export async function GET() {
  try {
    const db = await prepareDatabase();
    const result = await db
      .prepare(
        `SELECT id, title, description, desired_outcome, area, priority, status, created_by, created_at, updated_at FROM feature_requests WHERE tenant = ? ORDER BY CASE priority WHEN 'critical' THEN 1 WHEN 'high' THEN 2 WHEN 'medium' THEN 3 ELSE 4 END, updated_at DESC LIMIT 300`,
      )
      .bind(tenant)
      .all();
    return reply({ requests: result.results });
  } catch {
    return reply({ error: 'Udviklingsforslagene kunne ikke indlæses.' }, 503);
  }
}

export async function POST(request: NextRequest) {
  const denied = authorizeWrite(request);
  if (denied) return denied;
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const title = clean(body.title, 140),
      description = clean(body.description, 4000),
      desiredOutcome = clean(body.desiredOutcome, 2000);
    const area = clean(body.area, 80),
      priority = clean(body.priority, 20);
    if (
      title.length < 3 ||
      description.length < 5 ||
      !areas.includes(area as (typeof areas)[number]) ||
      !priorities.includes(priority as (typeof priorities)[number])
    )
      return reply(
        { error: 'Udfyld titel, beskrivelse, område og prioritet.' },
        400,
      );
    const id = crypto.randomUUID();
    const createdBy =
      clean(request.headers.get('cf-access-authenticated-user-email'), 254) ||
      'rene@sablen.dk';
    const db = await prepareDatabase();
    await db
      .prepare(
        `INSERT INTO feature_requests (id, tenant, title, description, desired_outcome, area, priority, status, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, 'proposed', ?)`,
      )
      .bind(
        id,
        tenant,
        title,
        description,
        desiredOutcome || null,
        area,
        priority,
        createdBy,
      )
      .run();
    return reply({ created: true, id }, 201);
  } catch {
    return reply({ error: 'Forslaget kunne ikke gemmes.' }, 503);
  }
}

export async function PATCH(request: NextRequest) {
  const denied = authorizeWrite(request);
  if (denied) return denied;
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const id = clean(body.id, 100),
      status = clean(body.status, 30);
    if (!id || !statuses.includes(status as (typeof statuses)[number]))
      return reply({ error: 'Ugyldigt forslag eller status.' }, 400);
    const db = await prepareDatabase();
    const result = await db
      .prepare(
        'UPDATE feature_requests SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE tenant = ? AND id = ?',
      )
      .bind(status, tenant, id)
      .run();
    if (!result.meta.changes)
      return reply({ error: 'Forslaget findes ikke længere.' }, 404);
    return reply({ updated: true });
  } catch {
    return reply({ error: 'Status kunne ikke opdateres.' }, 503);
  }
}
