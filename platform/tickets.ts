import { requireCompany } from './auth';
import { jsonBody } from './invitations';
import { HttpError, reply, type Actor, type PlatformEnv } from './types';

function field(value: unknown, max: number) {
  if (
    typeof value !== 'string' ||
    !value.trim() ||
    value.length > max ||
    /[\x00-\x08\x0b-\x1f]/.test(value)
  )
    throw new HttpError(400, 'Udfyld emne og besked korrekt.');
  return value.trim();
}
export async function handleTickets(
  request: Request,
  env: PlatformEnv,
  actor: Actor,
  company?: string,
  id?: string,
) {
  const db = env.PLATFORM_DB,
    url = new URL(request.url),
    write = request.method !== 'GET';
  if (company) await requireCompany(db, actor, company);
  else if (!actor.platformAdmin || actor.support)
    throw new HttpError(403, 'Kræver Toolbox-administrator.');
  if (write && actor.support)
    throw new HttpError(
      403,
      'Afslut impersonering før du skriver til support.',
    );
  const audit = (action: string, resource: string, owner: string) =>
    db
      .prepare(
        'INSERT INTO audit_events(id,company_id,actor_id,action,resource_id,details_json) VALUES(?,?,?,?,?,?)',
      )
      .bind(crypto.randomUUID(), owner, actor.id, action, resource, '{}');
  if (!id && request.method === 'GET') {
    const offset = Number(url.searchParams.get('offset') || 0),
      status = url.searchParams.get('status') || '';
    if (
      !Number.isSafeInteger(offset) ||
      offset < 0 ||
      !['', 'open', 'waiting_customer', 'resolved'].includes(status)
    )
      throw new HttpError(400, 'Ugyldigt filter.');
    const rows = await db
      .prepare(
        `SELECT t.*,c.name company_name,u.full_name creator_name FROM support_tickets t JOIN companies c ON c.id=t.company_id JOIN users u ON u.id=t.created_by WHERE (? IS NULL OR t.company_id=?) AND (?='' OR t.status=?) ORDER BY t.updated_at DESC,t.id LIMIT 51 OFFSET ?`,
      )
      .bind(company || null, company || null, status, status, offset)
      .all();
    return reply({
      tickets: rows.results.slice(0, 50),
      hasMore: rows.results.length > 50,
      offset,
    });
  }
  if (!id && request.method === 'POST' && company) {
    const b = await jsonBody(request, 12000),
      subject = field(b.subject, 160),
      message = field(b.message, 6000);
    if (/[\r\n]/.test(subject))
      throw new HttpError(400, 'Emnet skal være på én linje.');
    const ticket = crypto.randomUUID();
    await db.batch([
      db
        .prepare(
          'INSERT INTO support_tickets(id,company_id,created_by,subject) VALUES(?,?,?,?)',
        )
        .bind(ticket, company, actor.id, subject),
      db
        .prepare(
          'INSERT INTO support_ticket_messages(id,company_id,ticket_id,author_id,author_kind,body) VALUES(?,?,?,?,?,?)',
        )
        .bind(
          crypto.randomUUID(),
          company,
          ticket,
          actor.id,
          actor.platformAdmin ? 'support' : 'customer',
          message,
        ),
      audit('ticket.created', ticket, company),
    ]);
    return reply({ id: ticket }, 201);
  }
  if (!id) throw new HttpError(405, 'Handlingen er ikke understøttet.');
  const t = await db
    .prepare(
      'SELECT * FROM support_tickets WHERE id=? AND (? IS NULL OR company_id=?)',
    )
    .bind(id, company || null, company || null)
    .first<{
      id: string;
      company_id: string;
      version: number;
      status: string;
      priority: string;
    }>();
  if (!t) throw new HttpError(404, 'Supportsagen findes ikke.');
  if (request.method === 'GET') {
    const messages = await db
      .prepare(
        'SELECT m.id,m.body,m.author_kind,m.created_at,u.full_name author_name FROM support_ticket_messages m JOIN users u ON u.id=m.author_id WHERE m.company_id=? AND m.ticket_id=? ORDER BY m.created_at,m.rowid',
      )
      .bind(t.company_id, id)
      .all();
    return reply({ ticket: t, messages: messages.results });
  }
  if (request.method !== 'PATCH')
    throw new HttpError(405, 'Brug Gem eller Send svar.');
  const b = await jsonBody(request, 12000),
    message = b.message === undefined ? '' : field(b.message, 6000);
  const status =
    b.status === undefined
      ? message
        ? actor.platformAdmin
          ? 'waiting_customer'
          : 'open'
        : t.status
      : b.status;
  const priority = b.priority === undefined ? t.priority : b.priority;
  if (
    !['open', 'waiting_customer', 'resolved'].includes(String(status)) ||
    !['normal', 'high'].includes(String(priority)) ||
    (!actor.platformAdmin &&
      (status === 'waiting_customer' || priority !== t.priority))
  )
    throw new HttpError(
      403,
      'Du kan svare, lukke eller genåbne din sag. Prioritet ændres af support.',
    );
  if (b.version !== t.version)
    throw new HttpError(409, 'Sagen er ændret. Genindlæs før du gemmer.');
  // Claim the version and append its reply in the same D1 transaction.
  const result = await db.batch([
    db
      .prepare(
        "UPDATE support_tickets SET status=?,priority=?,version=version+1,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=? AND company_id=? AND version=?",
      )
      .bind(status, priority, id, t.company_id, t.version),
    db
      .prepare(
        "INSERT INTO audit_events(id,company_id,actor_id,action,resource_id,details_json) SELECT ?,?,?,'ticket.updated',?,'{}' WHERE changes()=1",
      )
      .bind(crypto.randomUUID(), t.company_id, actor.id, id),
    db
      .prepare(
        "INSERT INTO support_ticket_messages(id,company_id,ticket_id,author_id,author_kind,body) SELECT ?,?,?,?,?,? WHERE changes()=1 AND ?<>''",
      )
      .bind(
        crypto.randomUUID(),
        t.company_id,
        id,
        actor.id,
        actor.platformAdmin ? 'support' : 'customer',
        message,
        message,
      ),
  ]);
  if (result[0].meta.changes !== 1)
    throw new HttpError(409, 'Sagen er ændret. Genindlæs før du gemmer.');
  return reply({ ok: true });
}
