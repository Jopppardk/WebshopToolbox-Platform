import { NextRequest, NextResponse } from 'next/server';
import { prepareDatabase } from '@/db/database';
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
export async function GET() {
  try {
    const db = await prepareDatabase();
    const rows = await db.prepare("SELECT setting_value FROM app_settings WHERE tenant=? AND setting_key LIKE 'notice:emballage:%' AND json_extract(setting_value,'$.read')=0 ORDER BY json_extract(setting_value,'$.createdAt') DESC").bind('sablen.dk').all<{setting_value:string}>();
    return json({ notifications: rows.results.map(r => JSON.parse(r.setting_value)) });
  } catch { return json({error:'Beskeder kunne ikke hentes.'},503); }
}
export async function POST(request: NextRequest) {
  if (request.headers.get('origin') !== new URL(request.url).origin || !request.headers.get('content-type')?.startsWith('application/json')) return json({error:'Start handlingen fra løsningen.'},403);
  try {
    const body = await request.json() as { id?: unknown };
    if (typeof body.id !== 'string' || !/^notice:emballage:\d+:(test|live):\d+$/.test(body.id)) return json({error:'Ugyldig besked.'},400);
    const db = await prepareDatabase();
    await db.prepare("UPDATE app_settings SET setting_value=json_set(setting_value,'$.read',json('true')),updated_at=CURRENT_TIMESTAMP WHERE tenant=? AND setting_key=?").bind('sablen.dk',body.id).run();
    return json({ok:true});
  } catch { return json({error:'Beskeden kunne ikke markeres læst.'},503); }
}
