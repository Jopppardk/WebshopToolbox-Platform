import { env } from 'cloudflare:workers';
import { schemaStatements } from './schema';

type RuntimeEnv = { DB: D1Database };

export function database() {
  return (env as unknown as RuntimeEnv).DB;
}

export async function prepareDatabase() {
  const db = database();
  await db.batch(schemaStatements.map((statement) => db.prepare(statement)));
  await db
    .prepare("DELETE FROM integration_records WHERE expires_at <= datetime('now')")
    .run();
  return db;
}
