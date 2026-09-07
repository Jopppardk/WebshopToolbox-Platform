import { env } from 'cloudflare:workers';
import { database } from './database';
import { loadCredentials } from './credentials';
import { loadCompleteOrder } from './shopify-order';
import { readDineroAccounts } from './dinero-accounts';
import { loadHistory } from './history';
import { historyWindow } from '@/lib/history-policy';
import { checkInvoice, invoiceFingerprint } from '@/lib/invoice-check';
import { validateSettings } from '@/lib/admin-settings';
import { salesDraft } from '@/lib/sales-preview';
import { rejectTransfer, TransferError, voucherFor, verifyVoucher, type Voucher, type Expected } from '@/lib/dinero-sale';
import { dineroClient } from './dinero-client';
import { recordFailure } from './errors';

type Phase = 'prepared' | 'creating' | 'draft' | 'booking' | 'booked' | 'uncertain' | 'archived';
type Snapshot = { occurredAt: string; fingerprint: string; revision: string; pdfKey: string; pdfEtag: string; attach: boolean; voucher: Voucher; expected: Expected; gross: number; invoiceNumber: string };
type State = { phase: Phase; version: string; updatedAt: string; organizationId: string; externalId: string; snapshot: Snapshot; draftTest?: boolean; guid?: string; voucherNumber?: number; message?: string; approvedBy?: string; approvedAt?: string };
const tenant = 'sablen.dk';
const runtime = () => env as unknown as { INVOICES: R2Bucket; DINERO_SALES_WRITES_ENABLED?: string; DINERO_DRAFT_TEST_ORDER_ID?: string };
export const salesWritesEnabled = () => runtime().DINERO_SALES_WRITES_ENABLED === 'true';
const draftTestAllowed = (externalId: string) => /^gid:\/\/shopify\/Order\/\d+$/.test(externalId) && runtime().DINERO_DRAFT_TEST_ORDER_ID === externalId;
const keyFor = (externalId: string) => `sales_transfer:${externalId}`;
async function read(externalId: string) {
  const row = await database().prepare('SELECT setting_value FROM app_settings WHERE tenant = ? AND setting_key = ?').bind(tenant, keyFor(externalId)).first<{ setting_value: string }>();
  return row ? { raw: row.setting_value, state: JSON.parse(row.setting_value) as State } : null;
}
// Durable compare-and-swap: only one tab/request can claim an external write.
// A tiny transfer receipt remains even if order history is purged; never reuse an order ID.
async function save(externalId: string, previous: Awaited<ReturnType<typeof read>>, value: Omit<State, 'version' | 'updatedAt'>) {
  const state: State = { ...value, version: crypto.randomUUID(), updatedAt: new Date().toISOString() };
  const raw = JSON.stringify(state), db = database();
  const result = previous
    ? await db.prepare('UPDATE app_settings SET setting_value = ?, updated_at = CURRENT_TIMESTAMP WHERE tenant = ? AND setting_key = ? AND setting_value = ?').bind(raw, tenant, keyFor(externalId), previous.raw).run()
    : await db.prepare('INSERT INTO app_settings (tenant, setting_key, setting_value) VALUES (?, ?, ?) ON CONFLICT(tenant, setting_key) DO NOTHING').bind(tenant, keyFor(externalId), raw).run();
  if (result.meta.changes !== 1) rejectTransfer('En anden handling har ændret overførslen. Hent status igen.');
  return { state, raw };
}
export async function transferStatus(externalId: string) {
  return { state: (await read(externalId))?.state ?? null, enabled: salesWritesEnabled(), draftTestAllowed: draftTestAllowed(externalId) };
}
async function inspect(externalId: string, date: string, credentials: Record<string, string>, draftTest = false): Promise<Snapshot> {
  const db = database(), { cutoff } = historyWindow(await loadHistory(db));
  const stored = await db.prepare("SELECT booking_status FROM integration_records WHERE tenant = ? AND record_type = 'order' AND external_id = ? AND occurred_at >= ?").bind(tenant, externalId, cutoff).first<{ booking_status: string }>();
  if (!stored || stored.booking_status === 'booked') rejectTransfer('Ordren mangler, er uden for historikken eller er allerede bogført.');
  const source = await loadCompleteOrder(externalId);
  if (source.createdAt < cutoff) rejectTransfer('Ordren er uden for historikken.');
  const invoice = checkInvoice(source), fingerprint = await invoiceFingerprint(invoice);
  const saved = await db.prepare("SELECT payload_json FROM integration_records WHERE tenant = ? AND record_type = 'invoice' AND external_id = ?").bind(tenant, externalId).first<{ payload_json: string }>();
  const pdf = saved ? JSON.parse(saved.payload_json) : null;
  const pdfKey = `invoices/${encodeURIComponent(externalId)}.pdf`;
  if (!pdf || pdf.invoiceFingerprint !== fingerprint || pdf.r2Key !== pdfKey) rejectTransfer('Generér en kontrolleret faktura, som svarer til den aktuelle ordre, før overførsel.');
  const object = await runtime().INVOICES.head(pdfKey);
  if (!object || object.size > 6000000) rejectTransfer('Faktura-PDF mangler eller er større end Dineros grænse på 6 MB.');
  const setting = await db.prepare("SELECT setting_value FROM app_settings WHERE tenant = ? AND setting_key = 'admin_settings'").bind(tenant).first<{ setting_value: string }>();
  if (!setting) rejectTransfer('Gem kontoopsætningen under Administration først.');
  const rawSettings = JSON.parse(setting!.setting_value), settings = validateSettings(rawSettings);
  // Revalidate against Dinero now, not only the cached chart displayed in the UI.
  const chart = await readDineroAccounts(credentials);
  const draft = salesDraft(invoice, settings.accounts, chart, settings.automation.inventory);
  const { voucher, expected } = voucherFor(invoice, draft, date);
  if (draftTest) {
    voucher.ExternalReference = `sablen:test-sale:${externalId.split('/').pop()}`;
    voucher.Lines = voucher.Lines.map(line => ({ ...line, Description: `TESTKLADDE - MÅ IKKE BOGFØRES · ${line.Description}`.slice(0, 250) }));
  }
  return { occurredAt: source.createdAt, fingerprint, revision: rawSettings.revision, pdfKey, pdfEtag: object!.etag, attach: true, voucher, expected, gross: invoice.gross, invoiceNumber: invoice.number };
}
async function markBooked(state: State) {
  await database().prepare("UPDATE integration_records SET booking_status = 'booked' WHERE tenant = ? AND record_type = 'order' AND external_id = ?").bind(tenant, state.externalId).run();
}
export async function runTransfer(body: { externalId: string; action: string; date?: string; version?: string; noOtherBooking?: boolean; storebuddyStopped?: boolean; confirmNumber?: string; draftTestAcknowledged?: boolean }, actor: string) {
  const { externalId, action } = body;
  let current = await read(externalId);
  if (action === 'status') return transferStatus(externalId);
  const credentials = await loadCredentials('dinero', true);
  if (!credentials?.organizationId) rejectTransfer('Forbind Dinero først.');
  const organizationId = credentials!.organizationId;
  if (current && current.state.organizationId !== organizationId) rejectTransfer('Denne ordre har en overførsel til en anden Dinero-organisation. Afklar den først.');
  if (action === 'prepare') {
    if (current && current.state.phase !== 'prepared') return transferStatus(externalId);
    const draftTest = draftTestAllowed(externalId);
    const snapshot = await inspect(externalId, body.date || '', credentials!, draftTest);
    current = await save(externalId, current, { phase: 'prepared', externalId, organizationId, snapshot, draftTest });
    return transferStatus(externalId);
  }
  if (!current) rejectTransfer('Forbered overførslen først.');
  if (current!.state.phase === 'archived') rejectTransfer('Denne tidligere overførsel er arkiveret og kan ikke gentages. Kontrollér regnskabet manuelt.');
  if (action === 'reconcile') {
    if (current!.state.phase === 'booked') { await markBooked(current!.state); return transferStatus(externalId); }
    if (['creating', 'booking'].includes(current!.state.phase) && Date.now() - Date.parse(current!.state.updatedAt) < 120000) rejectTransfer('Overførslen arbejder stadig. Vent og hent status igen.');
    if (!current!.state.guid) rejectTransfer('Der er ikke et sikkert bilags-ID. Kontrollér Dinero manuelt; løsningen opretter ikke et nyt bilag.');
    const client = await dineroClient(credentials!), state = current!.state;
    const remote = verifyVoucher(await client(`vouchers/manuel/${state.guid}`, 'GET'), state.snapshot.voucher, state.snapshot.expected);
    if (state.draftTest && remote.Status === 'Booked') rejectTransfer('Testkladden er blevet bogført i Dinero uden om løsningen. Afklar manuelt; ordren markeres ikke automatisk som bogført her.');
    if (remote.Guid.toLowerCase() !== state.guid!.toLowerCase()) rejectTransfer('Bilags-ID stemmer ikke.');
    current = await save(externalId, current, { ...state, phase: remote.Status === 'Booked' ? 'booked' : 'draft', message: undefined, voucherNumber: remote.VoucherNumber });
    if (current.state.phase === 'booked') await markBooked(current.state);
    return transferStatus(externalId);
  }
  if (!['create', 'book'].includes(action)) rejectTransfer('Ugyldig handling.');
  if (action === 'book' && current!.state.draftTest) rejectTransfer('En testkladde må aldrig bogføres fra løsningen. Slet den i Dinero efter kontrollen.');
  if (action === 'book') {
    const settingsRow = await database().prepare("SELECT setting_value FROM app_settings WHERE tenant=? AND setting_key='admin_settings'").bind(tenant).first<{ setting_value: string }>();
    if (settingsRow && validateSettings(JSON.parse(settingsRow.setting_value)).automation.bookDinero === false)
      rejectTransfer('Bogføring er fravalgt under Indstillinger. Kladden bliver stående i Dinero.');
  }
  const testCreate = action === 'create' && current!.state.draftTest === true && draftTestAllowed(externalId);
  if (current!.state.draftTest && !testCreate) rejectTransfer('Kladdetesten er ikke åben for denne ordre.');
  if (!salesWritesEnabled() && !testCreate) rejectTransfer('Overførsel til Dinero er låst, indtil den første produktionsbogføring er aftalt.');
  if (body.version !== current!.state.version || current!.state.phase !== (action === 'create' ? 'prepared' : 'draft')) rejectTransfer('Forslaget er ændret eller allerede behandlet. Hent status igen.');
  if (testCreate) {
    if (body.draftTestAcknowledged !== true || body.confirmNumber !== current!.state.snapshot.invoiceNumber) rejectTransfer('Bekræft fakturanummeret og at testkladden ikke må bogføres.');
  } else if (body.noOtherBooking !== true || body.storebuddyStopped !== true || body.confirmNumber !== current!.state.snapshot.invoiceNumber) rejectTransfer('Bekræft fakturanummer, stop af Storebuddy-salgsbogføring og at ordren ikke allerede er bogført.');
  if (action === 'create' && Date.now() - Date.parse(current!.state.updatedAt) > 600000) rejectTransfer('Forslaget er udløbet. Forbered det igen.');
  const snapshot = await inspect(externalId, current!.state.snapshot.voucher.VoucherDate, credentials!, current!.state.draftTest);
  const original = { ...current!.state.snapshot, voucher: { ...current!.state.snapshot.voucher } }; delete original.voucher.FileGuid;
  if (JSON.stringify(snapshot) !== JSON.stringify(original)) rejectTransfer('Ordre, PDF eller kontoopsætning er ændret. Forbered forslaget igen; eksisterende Dinero-kladde skal afklares manuelt.');
  const client = await dineroClient(credentials!);
  current = await save(externalId, current, { ...current!.state, phase: action === 'create' ? 'creating' : 'booking', approvedBy: actor, approvedAt: new Date().toISOString() });
  try {
    if (action === 'create') {
      if (snapshot.attach) {
        const pdf = await runtime().INVOICES.get(snapshot.pdfKey);
        if (!pdf || pdf.etag !== snapshot.pdfEtag) rejectTransfer('PDF er ændret under overførslen.');
        const form = new FormData(); form.append('file', new Blob([await pdf!.arrayBuffer()], { type: 'application/pdf' }), `${snapshot.invoiceNumber.replace(/[^\w-]/g, '') || 'faktura'}.pdf`);
        const uploaded = await client('files', 'POST', form) as { FileGuid?: string };
        if (!uploaded?.FileGuid || !/^[\w-]{10,128}$/.test(uploaded.FileGuid)) rejectTransfer('Dinero returnerede ikke et sikkert fil-ID.');
        current = await save(externalId, current, { ...current.state, snapshot: { ...snapshot, voucher: { ...snapshot.voucher, FileGuid: uploaded.FileGuid } } });
      }
      const raw = await client('vouchers/manuel', 'POST', current.state.snapshot.voucher) as { Guid?: string };
      // Save ID before validating: a failed validation must not lose an existing draft.
      if (raw?.Guid && /^[\da-f]{8}(-[\da-f]{4}){3}-[\da-f]{12}$/i.test(raw.Guid)) current = await save(externalId, current, { ...current.state, guid: raw.Guid });
      const remote = verifyVoucher(raw, current.state.snapshot.voucher, snapshot.expected);
      if (remote.Status !== 'Draft') rejectTransfer('Et nyt bilag havde uventet status. Kontrollér Dinero.');
      current = await save(externalId, current, { ...current.state, phase: 'draft', message: undefined });
    } else {
      if (!current.state.guid) rejectTransfer('Bilags-ID mangler.');
      const wanted = current.state.snapshot;
      const remote = verifyVoucher(await client(`vouchers/manuel/${current.state.guid}`, 'GET'), wanted.voucher, wanted.expected);
      if (remote.Guid.toLowerCase() !== current.state.guid!.toLowerCase()) rejectTransfer('Bilags-ID stemmer ikke.');
      const booked = remote.Status === 'Booked' ? remote : verifyVoucher(await client(`vouchers/manuel/${remote.Guid}/book`, 'POST', { Timestamp: remote.Timestamp }), wanted.voucher, wanted.expected);
      if (booked.Status !== 'Booked' || booked.Guid.toLowerCase() !== remote.Guid.toLowerCase()) rejectTransfer('Bogføringen er ikke bekræftet af Dinero.');
      current = await save(externalId, current, { ...current.state, phase: 'booked', voucherNumber: booked.VoucherNumber, message: undefined });
      await markBooked(current.state);
    }
  } catch (error) {
    const message = error instanceof TransferError ? error.message : 'Overførslen blev afbrudt. Kontrollér status i Dinero før et nyt forsøg.';
    // Never move a persisted booked receipt backwards if the order-status write failed.
    if (current.state.phase !== 'booked') {
      try { await save(externalId, current, { ...current.state, phase: 'uncertain', message }); } catch { /* Existing durable claim still blocks duplicate creation. */ }
    }
    await recordFailure('Dinero · salgsoverførsel');
    throw new TransferError(message);
  }
  return transferStatus(externalId);
}
