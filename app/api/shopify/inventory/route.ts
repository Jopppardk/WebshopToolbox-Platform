import { NextRequest, NextResponse } from 'next/server';
import { getShopifyAccess } from '@/db/shopify';
import { orderQuery } from '@/db/shopify-order';
import { database } from '@/db/database';
import { loadCredentials } from '@/db/credentials';
import { readDineroAccounts } from '@/db/dinero-accounts';
import { dineroClient } from '@/db/dinero-client';
import { inventoryValueMinor, validateStocktakeChanges, type InventoryRow } from '@/lib/inventory';
import { validateSettings } from '@/lib/admin-settings';
import { verifyVoucher, type Expected, type Voucher } from '@/lib/dinero-sale';
import { recordFailure } from '@/db/errors';

const tenant = 'sablen.dk';
const reply = (data: unknown, status = 200) => NextResponse.json(data, { status, headers: { 'Cache-Control': 'no-store' } });
type Page = { inventoryItems: { nodes: Array<{ id: string; tracked: boolean; unitCost: null | { amount: string; currencyCode: string }; variant: null | { title: string; sku: string; product: { title: string; status: string } }; inventoryLevels: { nodes: Array<{ location: { id: string; name: string; isActive: boolean }; quantities: Array<{ name: string; quantity: number }> }> } }>; pageInfo: { hasNextPage: boolean; endCursor: string | null } } };
type StocktakeState = { phase: 'prepared' | 'approved' | 'shopify_updated' | 'creating' | 'draft' | 'booking' | 'booked' | 'uncertain'; version: string; operationId: string; changes: ReturnType<typeof validateStocktakeChanges>; adjustmentMinor: number; voucher: Voucher | null; expected: Expected; organizationId: string; approvedBy?: string; guid?: string; voucherNumber?: number; message?: string; updatedAt: string };

async function readInventory() {
  const access = await getShopifyAccess(true);
  const rows: InventoryRow[] = [], locations = new Map<string, string>();
  let after: string | null = null;
  for (let page = 0; page < 25; page++) {
    const data: Page = await orderQuery<Page>(access, `query InventoryStatus($after:String) { inventoryItems(first:100,after:$after) { nodes { id tracked unitCost { amount currencyCode } variant { title sku product { title status } } inventoryLevels(first:25) { nodes { location { id name isActive } quantities(names:["on_hand"]) { name quantity } } } } pageInfo { hasNextPage endCursor } } }`, { after }, 'Shopify kunne ikke hente lagerdata. Kontrollér read_inventory, read_products og adgang til kostpriser.');
    for (const item of data.inventoryItems.nodes) {
      if (!item.tracked || !item.variant || item.variant.product.status !== 'ACTIVE') continue;
      for (const level of item.inventoryLevels.nodes) {
        if (!level.location.isActive) continue;
        locations.set(level.location.id, level.location.name);
        const quantity = level.quantities.find(q => q.name === 'on_hand')?.quantity, amount = Number(item.unitCost?.amount);
        if (!Number.isSafeInteger(quantity) || !Number.isFinite(amount) || amount < 0 || !item.unitCost) continue;
        rows.push({ inventoryItemId: item.id, locationId: level.location.id, product: item.variant.product.title, variant: item.variant.title, sku: item.variant.sku || '', quantity: quantity!, unitCostMinor: Math.round(amount * 100), currency: item.unitCost.currencyCode });
      }
    }
    if (!data.inventoryItems.pageInfo.hasNextPage) break;
    after = data.inventoryItems.pageInfo.endCursor;
    if (!after || page === 24) throw new Error('Shopify-lageret er for stort til en sikker samlet indlæsning.');
  }
  rows.sort((a, b) => a.product.localeCompare(b.product, 'da') || a.variant.localeCompare(b.variant, 'da'));
  return { rows, locations: [...locations].map(([id, name]) => ({ id, name })), totalValueMinor: inventoryValueMinor(rows), fetchedAt: new Date().toISOString() };
}

const stocktakeKey = (id: string) => `stocktake_transfer:${id}`;
async function readState(id: string) {
  const row = await database().prepare('SELECT setting_value FROM app_settings WHERE tenant = ? AND setting_key = ?').bind(tenant, stocktakeKey(id)).first<{ setting_value: string }>();
  return row ? { raw: row.setting_value, state: JSON.parse(row.setting_value) as StocktakeState } : null;
}
async function saveState(id: string, previous: Awaited<ReturnType<typeof readState>>, value: Omit<StocktakeState, 'version' | 'updatedAt'>) {
  const state: StocktakeState = { ...value, version: crypto.randomUUID(), updatedAt: new Date().toISOString() }, raw = JSON.stringify(state), db = database();
  const result = previous
    ? await db.prepare('UPDATE app_settings SET setting_value = ?, updated_at = CURRENT_TIMESTAMP WHERE tenant = ? AND setting_key = ? AND setting_value = ?').bind(raw, tenant, stocktakeKey(id), previous.raw).run()
    : await db.prepare('INSERT INTO app_settings (tenant, setting_key, setting_value) VALUES (?, ?, ?) ON CONFLICT(tenant, setting_key) DO NOTHING').bind(tenant, stocktakeKey(id), raw).run();
  if (result.meta.changes !== 1) throw new Error('Lagerreguleringen blev ændret af en anden handling. Hent lagerstatus igen.');
  return { raw, state };
}
const accountNumber = (value: string | undefined) => Number(value?.match(/^\d+/)?.[0]);
const localDate = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Copenhagen', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());

async function prepareStocktake(rawChanges: unknown) {
  const changes = validateStocktakeChanges(rawChanges), inventory = await readInventory();
  const current = new Map(inventory.rows.map(row => [`${row.inventoryItemId}:${row.locationId}`, row]));
  let adjustmentMinor = 0;
  for (const change of changes) {
    const row = current.get(`${change.inventoryItemId}:${change.locationId}`);
    if (!row || row.quantity !== change.compareQuantity) throw new Error('Lageret har ændret sig siden indlæsningen. Hent lagerstatus igen.');
    if (row.currency !== 'DKK') throw new Error('Lagerregulering i andre valutaer end DKK kræver særskilt behandling.');
    adjustmentMinor += (change.quantity - row.quantity) * row.unitCostMinor;
  }
  if (!Number.isSafeInteger(adjustmentMinor)) throw new Error('Lagerreguleringens værdi er ugyldig.');
  const credentials = await loadCredentials('dinero', true);
  if (!credentials?.organizationId) throw new Error('Forbind Dinero først.');
  const setting = await database().prepare("SELECT setting_value FROM app_settings WHERE tenant = ? AND setting_key = 'admin_settings'").bind(tenant).first<{ setting_value: string }>();
  if (!setting) throw new Error('Gem lagerkontiene under System → Lager først.');
  const settings = validateSettings(JSON.parse(setting.setting_value)), inventoryAccount = accountNumber(settings.accounts.inventory), adjustmentAccount = accountNumber(settings.accounts.inventoryAdjustment);
  if (!Number.isSafeInteger(inventoryAccount) || !Number.isSafeInteger(adjustmentAccount) || inventoryAccount === adjustmentAccount) throw new Error('Vælg to forskellige, gyldige lagerkonti under System → Lager.');
  const chart = await readDineroAccounts(credentials), selected = [inventoryAccount, adjustmentAccount].map(number => chart.find(a => Number(a.number) === number && !a.hidden));
  if (selected.some(account => !account || account.kind !== 'entry' || account.vatCode)) throw new Error('Begge lagerkonti skal være aktive finanskonti uden moms i Dinero.');
  const operationId = crypto.randomUUID();
  const voucher: Voucher | null = adjustmentMinor === 0 ? null : { VoucherDate: localDate(), ExternalReference: `sablen:stocktake:${operationId}`, Lines: [{ Description: `Lagerregulering · ${changes.length} lagerlinje${changes.length === 1 ? '' : 'r'}`, AccountNumber: adjustmentAccount, BalancingAccountNumber: inventoryAccount, Amount: -adjustmentMinor / 100, AccountVatCode: 'none', BalancingAccountVatCode: 'none' }] };
  const expected: Expected = voucher ? [{ net: -adjustmentMinor, tax: 0, gross: -adjustmentMinor }] : [];
  const saved = await saveState(operationId, null, { phase: 'prepared', operationId, changes, adjustmentMinor, voucher, expected, organizationId: credentials.organizationId });
  return { operationId, version: saved.state.version, adjustmentMinor, changedLines: changes.length, willBook: Boolean(voucher) };
}

async function commitStocktake(body: { operationId?: unknown; version?: unknown; confirmation?: unknown }, actor: string) {
  const operationId = String(body.operationId || ''), version = String(body.version || '');
  if (!/^[\da-f-]{36}$/i.test(operationId) || body.confirmation !== true) throw new Error('Lagerreguleringen skal godkendes.');
  let current = await readState(operationId);
  if (!current || current.state.version !== version || current.state.phase !== 'prepared') throw new Error('Forslaget er ændret, udløbet eller allerede behandlet. Hent lagerstatus igen.');
  if (Date.now() - Date.parse(current.state.updatedAt) > 10 * 60_000) throw new Error('Forslaget er udløbet. Hent lagerstatus igen.');
  const credentials = await loadCredentials('dinero', true);
  if (!credentials?.organizationId || credentials.organizationId !== current.state.organizationId) throw new Error('Dinero-forbindelsen er ændret siden godkendelsen.');
  const setting = await database().prepare("SELECT setting_value FROM app_settings WHERE tenant = ? AND setting_key = 'admin_settings'").bind(tenant).first<{ setting_value: string }>();
  if (!setting) throw new Error('Indstillingerne kunne ikke læses før lagerreguleringen.');
  const settings = validateSettings(JSON.parse(setting.setting_value));
  current = await saveState(operationId, current, { ...current.state, phase: 'approved', approvedBy: actor });
  try {
    const quantities = current.state.changes.map(({ compareQuantity, ...change }) => ({ ...change, changeFromQuantity: compareQuantity }));
    const access = await getShopifyAccess();
    const result = await orderQuery<{ inventorySetQuantities: { inventoryAdjustmentGroup: null | { createdAt: string }; userErrors: Array<{ message: string }> } }>(access, `mutation SetStocktake($input:InventorySetQuantitiesInput!,$key:String!) { inventorySetQuantities(input:$input) @idempotent(key:$key) { inventoryAdjustmentGroup { createdAt } userErrors { message } } }`, { key: operationId, input: { name: 'on_hand', reason: 'correction', referenceDocumentUri: `logistics://integration.sablen.dk/stocktake/${operationId}`, quantities } }, 'Shopify kunne ikke opdatere lageret. Kontrollér write_inventory og lagerrettighederne.');
    if (result.inventorySetQuantities.userErrors.length || !result.inventorySetQuantities.inventoryAdjustmentGroup) throw new Error(result.inventorySetQuantities.userErrors.map(e => e.message).join(' ') || 'Shopify afviste lageroptællingen.');
    current = await saveState(operationId, current, { ...current.state, phase: 'shopify_updated' });
    if (!current.state.voucher) {
      current = await saveState(operationId, current, { ...current.state, phase: 'booked', message: 'Antallene er opdateret. Den samlede lagerværdi var uændret, så intet finansbilag var nødvendigt.' });
      return current.state;
    }
    const client = await dineroClient(credentials);
    current = await saveState(operationId, current, { ...current.state, phase: 'creating' });
    const raw = await client('vouchers/manuel', 'POST', current.state.voucher) as { Guid?: string };
    if (raw.Guid && /^[\da-f]{8}(-[\da-f]{4}){3}-[\da-f]{12}$/i.test(raw.Guid)) current = await saveState(operationId, current, { ...current.state, guid: raw.Guid });
    const draft = verifyVoucher(raw, current.state.voucher, current.state.expected);
    if (draft.Status !== 'Draft' || !current.state.guid) throw new Error('Dinero bekræftede ikke lagerkladden.');
    current = await saveState(operationId, current, { ...current.state, phase: 'draft', message: settings.automation.bookDinero ? undefined : 'Lageret er opdateret i Shopify, og lagerreguleringen er oprettet som kladde i Dinero.' });
    if (!settings.automation.bookDinero) return current.state;
    current = await saveState(operationId, current, { ...current.state, phase: 'booking' });
    const booked = verifyVoucher(await client(`vouchers/manuel/${current.state.guid}/book`, 'POST', { Timestamp: draft.Timestamp }), current.state.voucher, current.state.expected);
    if (booked.Status !== 'Booked' || booked.Guid.toLowerCase() !== current.state.guid.toLowerCase()) throw new Error('Dinero bekræftede ikke bogføringen af lagerreguleringen.');
    current = await saveState(operationId, current, { ...current.state, phase: 'booked', voucherNumber: booked.VoucherNumber, message: 'Lageret er opdateret i Shopify, og lagerreguleringen er bogført i Dinero.' });
    return current.state;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Lagerreguleringen blev afbrudt.';
    const failureSource = current.state.phase === 'approved' ? 'Shopify · lageroptælling' : 'Dinero · lagerregulering';
    if (!['booked', 'uncertain'].includes(current.state.phase)) { try { current = await saveState(operationId, current, { ...current.state, phase: 'uncertain', message }); } catch {} }
    await recordFailure(failureSource);
    throw new Error(`${message} Forsøg ikke igen, hvis Shopify allerede er opdateret; kontrollér fejloversigten og Dinero først.`);
  }
}

export async function GET() {
  try { return reply(await readInventory()); }
  catch { await recordFailure('Shopify · lagerstatus'); return reply({ error: 'Lagerstatus kunne ikke hentes. Kontrollér at Shopify-appen har read_inventory og adgang til kostpriser.' }, 502); }
}

export async function POST(request: NextRequest) {
  const origin = request.headers.get('origin');
  if (!origin || origin !== new URL(request.url).origin || !request.headers.get('content-type')?.startsWith('application/json')) return reply({ error: 'Handlingen skal startes fra integrationssiden.' }, 403);
  const actor = request.headers.get('cf-access-authenticated-user-email')?.trim().toLowerCase() || 'local-test';
  if (process.env.NODE_ENV === 'production' && actor !== 'rene@sablen.dk') return reply({ error: 'Adgang afvist.' }, 403);
  try {
    const body = await request.json() as { action?: string; changes?: unknown; operationId?: unknown; version?: unknown; confirmation?: unknown };
    if (body.action === 'prepare') return reply(await prepareStocktake(body.changes));
    if (body.action === 'commit') return reply(await commitStocktake(body, actor));
    return reply({ error: 'Ugyldig handling.' }, 400);
  } catch (error) {
    return reply({ error: error instanceof Error ? error.message : 'Lagerreguleringen kunne ikke gennemføres.' }, 422);
  }
}
