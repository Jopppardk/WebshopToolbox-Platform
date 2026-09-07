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
async function ensureReferenceNumbers(
  db: Awaited<ReturnType<typeof prepareDatabase>>,
) {
  const missing = await db
    .prepare(
      `SELECT f.id FROM feature_requests f LEFT JOIN feature_request_numbers n ON n.tenant = f.tenant AND n.feature_request_id = f.id WHERE f.tenant = ? AND n.feature_request_id IS NULL ORDER BY f.created_at ASC, f.id ASC LIMIT 300`,
    )
    .bind(tenant)
    .all<{ id: string }>();
  if (!missing.results.length) return;
  const maximum = await db
    .prepare(
      `SELECT COALESCE(MAX(reference_number), 0) AS value FROM feature_request_numbers WHERE tenant = ?`,
    )
    .bind(tenant)
    .first<{ value: number }>();
  const start = Number(maximum?.value || 0);
  await db.batch(
    missing.results.map((item, index) =>
      db
        .prepare(
          `INSERT OR IGNORE INTO feature_request_numbers (reference_number, tenant, feature_request_id) VALUES (?, ?, ?)`,
        )
        .bind(start + index + 1, tenant, item.id),
    ),
  );
}
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
    await ensureReferenceNumbers(db);
    const result = await db
      .prepare(
        `SELECT f.id, n.reference_number, f.title, f.description, f.desired_outcome, f.area, f.priority, f.status, f.created_by, f.created_at, f.updated_at FROM feature_requests f JOIN feature_request_numbers n ON n.tenant = f.tenant AND n.feature_request_id = f.id WHERE f.tenant = ? ORDER BY CASE f.priority WHEN 'critical' THEN 1 WHEN 'high' THEN 2 WHEN 'medium' THEN 3 ELSE 4 END, f.updated_at DESC LIMIT 300`,
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
    await ensureReferenceNumbers(db);
    const maximum = await db
      .prepare(
        `SELECT COALESCE(MAX(reference_number), 0) AS value FROM feature_request_numbers WHERE tenant = ?`,
      )
      .bind(tenant)
      .first<{ value: number }>();
    const referenceNumber = Number(maximum?.value || 0) + 1;
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
    await db
      .prepare(
        `INSERT INTO feature_request_numbers (tenant, feature_request_id, reference_number) VALUES (?, ?, ?)`,
      )
      .bind(tenant, id, referenceNumber)
      .run();
    return reply({ created: true, id, referenceNumber }, 201);
  } catch {
    return reply({ error: 'Forslaget kunne ikke gemmes.' }, 503);
  }
}

export async function PATCH(request: NextRequest) {
  const denied = authorizeWrite(request);
  if (denied) return denied;
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const id = clean(body.id, 100);
    if (!id) return reply({ error: 'Ugyldigt forslag.' }, 400);
    const db = await prepareDatabase();
    let result;
    if (body.title !== undefined) {
      const title = clean(body.title, 140),
        description = clean(body.description, 4000),
        desiredOutcome = clean(body.desiredOutcome, 2000),
        area = clean(body.area, 80),
        priority = clean(body.priority, 20),
        status = clean(body.status, 30);
      if (
        title.length < 3 ||
        description.length < 5 ||
        !areas.includes(area as (typeof areas)[number]) ||
        !priorities.includes(priority as (typeof priorities)[number]) ||
        !statuses.includes(status as (typeof statuses)[number])
      ) return reply({ error: 'Kontrollér titel, beskrivelse, område, prioritet og status.' }, 400);
      result = await db.prepare(
        'UPDATE feature_requests SET title = ?, description = ?, desired_outcome = ?, area = ?, priority = ?, status = ?, updated_at = CURRENT_TIMESTAMP WHERE tenant = ? AND id = ?',
      ).bind(title, description, desiredOutcome || null, area, priority, status, tenant, id).run();
    } else {
      const status = clean(body.status, 30);
      if (!statuses.includes(status as (typeof statuses)[number]))
        return reply({ error: 'Ugyldig status.' }, 400);
      result = await db
        .prepare('UPDATE feature_requests SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE tenant = ? AND id = ?')
        .bind(status, tenant, id)
        .run();
    }
    if (!result.meta.changes)
      return reply({ error: 'Forslaget findes ikke længere.' }, 404);
    return reply({ updated: true });
  } catch {
    return reply({ error: 'Status kunne ikke opdateres.' }, 503);
  }
}
