import { NextRequest, NextResponse } from 'next/server';
import { prepareDatabase } from '@/db/database';

const defaultNotifications = { enabled: false, email: '' };
function notifications(value?: string) {
  try {
    const parsed = JSON.parse(value || '{}') as { enabled?: unknown; email?: unknown };
    return { enabled: parsed.enabled === true, email: typeof parsed.email === 'string' ? parsed.email : '' };
  } catch { return defaultNotifications; }
}

export async function GET() {
  try {
    const db = await prepareDatabase();
    const [result, count, notificationRow] = await Promise.all([db
      .prepare(
        `SELECT id, source, message, details_json, created_at
         FROM system_errors
         WHERE tenant = ? AND resolved_at IS NULL
         ORDER BY created_at DESC
         LIMIT 20`,
      )
      .bind('sablen.dk')
      .all(), db.prepare('SELECT COUNT(*) AS count FROM system_errors WHERE tenant = ? AND resolved_at IS NULL').bind('sablen.dk').first<{ count: number }>(), db.prepare("SELECT setting_value FROM app_settings WHERE tenant=? AND setting_key='error_notifications'").bind('sablen.dk').first<{ setting_value: string }>()]);
    const errors = result.results.map((row: Record<string, unknown>) => {
      let details = null;
      try { details = typeof row.details_json === 'string' ? JSON.parse(row.details_json) : null; } catch { details = null; }
      const { details_json: _detailsJson, ...safeRow } = row;
      return { ...safeRow, details };
    });
    return NextResponse.json({ errors, openCount: count?.count || 0, notifications: notifications(notificationRow?.setting_value) }, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return NextResponse.json(
      { error: 'Fejloversigten kunne ikke indlæses' },
      { status: 503 },
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as { action?: unknown; id?: number; enabled?: unknown; email?: unknown };
    if (body.action === 'notifications') {
      const enabled = body.enabled === true;
      const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
      if (typeof body.enabled !== 'boolean' || email.length > 254 || /[\r\n]/.test(email) || (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) || (enabled && !email)) return NextResponse.json({ error: 'Angiv en gyldig mailadresse.' }, { status: 400 });
      const db = await prepareDatabase();
      await db.prepare("INSERT INTO app_settings(tenant,setting_key,setting_value) VALUES ('sablen.dk','error_notifications',?) ON CONFLICT(tenant,setting_key) DO UPDATE SET setting_value=excluded.setting_value,updated_at=CURRENT_TIMESTAMP").bind(JSON.stringify({ enabled, email })).run();
      return NextResponse.json({ notifications: { enabled, email } }, { headers: { 'Cache-Control': 'no-store' } });
    }
    const id = body.id;
    if (!Number.isSafeInteger(id) || id <= 0) return NextResponse.json({ error: 'Ugyldigt fejlnummer' }, { status: 400 });
    const db = await prepareDatabase();
    await db.prepare("UPDATE system_errors SET resolved_at = CURRENT_TIMESTAMP WHERE tenant = ? AND id = ? AND resolved_at IS NULL").bind('sablen.dk', id).run();
    return NextResponse.json({ resolved: true }, { headers: { 'Cache-Control': 'no-store' } });
  } catch { return NextResponse.json({ error: 'Fejlen kunne ikke opdateres' }, { status: 503 }); }
}
