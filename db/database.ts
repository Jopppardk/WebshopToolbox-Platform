import { env } from 'cloudflare:workers';
import { schemaStatements } from './schema';
import { cleanupHistory } from './history';

type RuntimeEnv = { DB: D1Database };

export function database() {
  return (env as unknown as RuntimeEnv).DB;
}

export async function prepareDatabase() {
  const db = database();
  await db.batch(schemaStatements.map((statement) => db.prepare(statement)));
  await cleanupHistory(db, (env as unknown as { INVOICES: R2Bucket }).INVOICES);
  return db;
}
