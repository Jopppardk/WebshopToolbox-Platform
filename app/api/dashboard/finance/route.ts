import { NextResponse } from 'next/server';
import { prepareDatabase } from '@/db/database';
import { dashboardFinance, syncDashboardFinance } from '@/db/dashboard-finance';
export async function GET() {
  try {
    await prepareDatabase();
    await syncDashboardFinance().catch(() => undefined);
    return NextResponse.json(await dashboardFinance(), { headers:{'Cache-Control':'no-store'} });
  } catch { return NextResponse.json({ error:'Regnskabstal kunne ikke hentes.' }, {status:503,headers:{'Cache-Control':'no-store'}}); }
}
