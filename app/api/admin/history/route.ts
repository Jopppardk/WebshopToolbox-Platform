import { NextRequest, NextResponse } from 'next/server';
import { prepareDatabase } from '@/db/database';
import { loadHistory } from '@/db/history';
import { historyWindow, validateHistory, type HistoryPolicy } from '@/lib/history-policy';
const reply = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
export async function GET() {
  try { const policy = await loadHistory(await prepareDatabase()); return reply({ policy, ...historyWindow(policy) }); }
  catch { return reply({ error: 'Historikindstillinger kunne ikke hentes' }, 500); }
}
export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as HistoryPolicy & { confirmDeletion?: boolean; confirmStartDateChange?: boolean };
    const policy = validateHistory(body); const db = await prepareDatabase(); const previous = await loadHistory(db);
    if (policy.months < previous.months && body.confirmDeletion !== true) throw new Error('Bekræft sletning af ældre lokale poster og PDF-fakturaer');
    if (policy.startDate !== previous.startDate && body.confirmStartDateChange !== true) throw new Error('Bekræft ændringen af startdatoen. Den kan påvirke tidligere håndterede bilag.');
    await db.prepare("INSERT INTO app_settings (tenant, setting_key, setting_value, updated_at) VALUES ('sablen.dk', 'history_policy', ?, CURRENT_TIMESTAMP) ON CONFLICT(tenant, setting_key) DO UPDATE SET setting_value = excluded.setting_value, updated_at = CURRENT_TIMESTAMP").bind(JSON.stringify(policy)).run();
    return reply({ policy, ...historyWindow(policy) });
  } catch (error) { return reply({ error: error instanceof Error ? error.message : 'Indstillingerne kunne ikke gemmes' }, 400); }
}
