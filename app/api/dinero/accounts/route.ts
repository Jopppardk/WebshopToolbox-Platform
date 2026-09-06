import { NextResponse } from 'next/server';
import { database } from '@/db/database';
import { loadDineroChart, syncDineroChart } from '@/db/dinero-chart';

async function recordError(message: string) {
  try {
    const db = database();
    await db
      .prepare(
        'INSERT INTO system_errors (tenant, source, message) VALUES (?, ?, ?)',
      )
      .bind('sablen.dk', 'Dinero', message)
      .run();
  } catch {
    // The original integration error remains the response if logging is unavailable.
  }
}

export async function GET() {
  try { return NextResponse.json(await loadDineroChart() ?? { accounts: [], fetchedAt: null }, { headers: { 'Cache-Control': 'no-store' } }); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : 'Den gemte kontoplan kunne ikke læses.' }, { status: 503 }); }
}
export async function POST() {
  try { return NextResponse.json(await syncDineroChart() ?? { accounts: [], fetchedAt: null }, { headers: { 'Cache-Control': 'no-store' } }); }
  catch (error) { const message = error instanceof Error ? error.message : 'Kontoplanen kunne ikke hentes.'; await recordError(message); return NextResponse.json({ error: message }, { status: 503 }); }
}
