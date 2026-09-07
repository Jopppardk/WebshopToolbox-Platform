import { database } from './database';
import { loadHistory } from './history';

type Progress = { after: string | null; scope: string; leaseUntil: number; owner: string };
type Page = { hasNextPage: boolean; endCursor?: string | null };
const tenant = 'sablen.dk';
const leaseMs = 10 * 60 * 1000;
const pagesPerRun = 5;

// A bounded sweep revisits the entire history, including orders fulfilled after
// newer orders were created. Checkpoint only pages the import route committed.
export async function runPaginatedSync(job: string, fetchPage: (after: string | null) => Promise<Response>) {
  const db = database(), settingKey = `sync_progress:${job}`;
  const scope = JSON.stringify(await loadHistory(db));
  const row = await db.prepare('SELECT setting_value FROM app_settings WHERE tenant=? AND setting_key=?')
    .bind(tenant, settingKey).first<{ setting_value: string }>();
  const previous = row ? JSON.parse(row.setting_value) as Progress : null;
  if (previous && previous.leaseUntil > Date.now()) {
    return { status: 'skipped' as const, complete: false, message: 'Synkroniseringen udføres allerede af et andet job.' };
  }
  let state: Progress = {
    after: previous?.scope === scope ? previous.after : null,
    scope, owner: crypto.randomUUID(), leaseUntil: Date.now() + leaseMs,
  };
  let raw = JSON.stringify(state);
  const claim = row
    ? await db.prepare('UPDATE app_settings SET setting_value=?,updated_at=CURRENT_TIMESTAMP WHERE tenant=? AND setting_key=? AND setting_value=?')
      .bind(raw, tenant, settingKey, row.setting_value).run()
    : await db.prepare('INSERT INTO app_settings(tenant,setting_key,setting_value) VALUES(?,?,?) ON CONFLICT DO NOTHING')
      .bind(tenant, settingKey, raw).run();
  if (claim.meta.changes !== 1) return { status: 'skipped' as const, complete: false, message: 'Et andet job overtog synkroniseringen.' };

  async function save(next: Progress) {
    const nextRaw = JSON.stringify(next);
    const result = await db.prepare('UPDATE app_settings SET setting_value=?,updated_at=CURRENT_TIMESTAMP WHERE tenant=? AND setting_key=? AND setting_value=?')
      .bind(nextRaw, tenant, settingKey, raw).run();
    if (result.meta.changes !== 1) throw new Error('Synkroniseringens status blev ændret af et andet job.');
    state = next; raw = nextRaw;
  }

  const cursors = new Set<string>();
  if (state.after) cursors.add(state.after);
  try {
    for (let page = 0; page < pagesPerRun; page++) {
      const response = await fetchPage(state.after);
      if (!response.ok) throw new Error('Importen fejlede. Næste kørsel fortsætter fra den senest gemte side.');
      const result = await response.json() as Page;
      if (typeof result?.hasNextPage !== 'boolean') throw new Error('Importen returnerede ikke en gyldig sidestatus.');
      const after = result.hasNextPage ? result.endCursor : null;
      if (result.hasNextPage && (typeof after !== 'string' || !after || after.length > 2048 || cursors.has(after))) {
        throw new Error('Importen returnerede en ugyldig eller gentaget fortsættelse.');
      }
      await save({ ...state, after: after ?? null, leaseUntil: Date.now() + leaseMs });
      if (!result.hasNextPage) return { status: 'succeeded' as const, complete: true, message: `${page + 1} sider blev hentet; hele gennemgangen er afsluttet.` };
      cursors.add(after!);
    }
    return { status: 'skipped' as const, complete: false, message: `${pagesPerRun} sider blev hentet. Flere sider afventer; næste kørsel fortsætter automatisk.` };
  } finally {
    // CAS prevents an expired worker from releasing a newer worker's lease.
    await save({ ...state, leaseUntil: 0 });
  }
}
