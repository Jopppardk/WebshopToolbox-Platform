import { NextResponse } from 'next/server';
import { prepareDatabase } from '@/db/database';

export async function GET() {
  try {
    const db = await prepareDatabase();
    const result = await db
      .prepare(
        `SELECT id, source, message, created_at
         FROM system_errors
         WHERE tenant = ? AND resolved_at IS NULL
         ORDER BY created_at DESC
         LIMIT 20`,
      )
      .bind('sablen.dk')
      .all();
    return NextResponse.json({ errors: result.results });
  } catch {
    return NextResponse.json(
      { error: 'Fejloversigten kunne ikke indlæses' },
      { status: 503 },
    );
  }
}
