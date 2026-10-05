// Shipping labels from Salg: one click on the printer icon creates the order's shipment in Shipmondo ("Opret
// leverancer og forsendelser", with the product and pickup point Shipmondo already chose for the order) and prints
// its label on the webshop's chosen printer through the Shipmondo Print Client.
//
// A label costs freight, so it is never created twice: an order that already has a shipment in Shipmondo is only
// printed again, every creation is claimed in shipping_labels first, and a creation with an uncertain outcome
// (timeout, server error) is never retried automatically; it must be checked in Shipmondo.
import { requireCompany, requireWebshop } from './auth';
import { unseal } from './connections';
import { jsonBody } from './invitations';
import { sanitizeDiagnostic } from './tier1/src/lib/diagnostics';
import { HttpError, reply, type Actor, type PlatformEnv } from './types';

type Credentials = { apiUser: string; apiKey: string; sandbox: boolean };
export type LabelPrinter = { name: string; hostname: string; printer: string; labelFormat: '10x19_zpl' | '10x19_pdf' | 'a4_pdf' };
type SalesOrder = { id: number; order_id: string; order_status: string; archived?: boolean; shipment_template_id?: number | null; order_fulfillments?: Array<{ id: number; shipment_id?: number | null; cancelled?: boolean; created_at?: string }> };
type Label = { sales_order_id: number | null; shipment_id: number | null; phase: 'creating' | 'created' | 'uncertain'; print_count: number; printed_at: string | null; message: string | null; updated_at: string };

class Uncertain extends Error {}
const formats: Record<string, LabelPrinter['labelFormat']> = { zpl: '10x19_zpl', '10x19': '10x19_pdf', a4: 'a4_pdf' };

/** A Shipmondo API call. Network failures and server errors are uncertain for writes; 4xx answers say why. */
async function shipmondo<T>(credentials: Credentials, method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
  const base = credentials.sandbox ? 'https://sandbox.shipmondo.com' : 'https://app.shipmondo.com';
  let response: Response;
  try {
    response = await fetch(base + '/api/public/v3' + path, { method, redirect: 'manual', signal: AbortSignal.timeout(20000),
      headers: { Authorization: 'Basic ' + btoa(credentials.apiUser + ':' + credentials.apiKey), Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}) });
  } catch { throw new Uncertain('Shipmondo svarede ikke.'); }
  if (response.status >= 500 || response.status === 408 || (response.status >= 300 && response.status < 400)) { await response.body?.cancel(); throw new Uncertain(`Shipmondo svarede ikke entydigt (HTTP ${response.status}).`); }
  const data = await response.json().catch(() => null) as any;
  if (!response.ok) {
    if ([401, 403].includes(response.status)) throw new HttpError(409, 'Shipmondo afviste API-nøglen. Kontrollér forbindelsen under Integrationer.');
    if (response.status === 429) throw new HttpError(429, 'Shipmondo begrænser antallet af kald. Vent et minut og prøv igen.');
    const reason = typeof data?.error === 'string' ? data.error : typeof data?.message === 'string' ? data.message : Array.isArray(data?.errors) ? data.errors.join(' ') : '';
    throw new HttpError(409, 'Shipmondo afviste handlingen' + (reason ? ': ' + sanitizeDiagnostic(reason, 200) : '.'));
  }
  return data as T;
}

async function connection(env: PlatformEnv, company: string, shop: string) {
  const row = await env.PLATFORM_DB.prepare("SELECT credentials_encrypted,printer_json FROM shipping_connections WHERE company_id=? AND webshop_id=? AND provider='shipmondo'").bind(company, shop).first<{ credentials_encrypted: string; printer_json: string | null }>();
  if (!row) throw new HttpError(409, 'Forbind Shipmondo med API-bruger og API-nøgle under Integrationer først.');
  const credentials = await unseal(env, [company, shop, 'shipmondo'], row.credentials_encrypted) as Credentials;
  return { credentials, printer: row.printer_json ? JSON.parse(row.printer_json) as LabelPrinter : null };
}
/** Whether the printer icon is shown on Salg: Shipmondo connected with a printer chosen. */
export async function labelsEnabled(env: PlatformEnv, company: string, shop: string) {
  return !!await env.PLATFORM_DB.prepare("SELECT 1 FROM shipping_connections WHERE company_id=? AND webshop_id=? AND provider='shipmondo' AND printer_json IS NOT NULL").bind(company, shop).first();
}

/** GET/PUT /shipmondo/printer: the printers of the Print Client, and the one labels are printed on. */
export async function handleLabelPrinter(request: Request, env: PlatformEnv, actor: Actor, company: string, shop: string) {
  const db = env.PLATFORM_DB, write = request.method !== 'GET';
  await requireCompany(db, actor, company, write); await requireWebshop(db, actor, company, shop);
  const { credentials, printer } = await connection(env, company, shop);
  const list = (await shipmondo<any[]>(credentials, 'GET', '/printers')).filter(p => typeof p?.hostname === 'string' && typeof p?.printer === 'string')
    .map(p => ({ name: String(p.name || p.printer).slice(0, 120), hostname: String(p.hostname).slice(0, 200), printer: String(p.printer).slice(0, 200), labelFormat: formats[p.label_format] ?? '10x19_pdf' })) as LabelPrinter[];
  if (request.method === 'GET') return reply({ printers: list, printer });
  if (request.method !== 'PUT') throw new HttpError(405, 'Brug Gem.');
  if (actor.support) throw new HttpError(403, 'Afslut supportadgang før printeropsætning.');
  const b = await jsonBody(request, 4000);
  const chosen = b.hostname === null ? null : list.find(p => p.hostname === b.hostname && p.printer === b.printer);
  if (b.hostname !== null && !chosen) throw new HttpError(400, 'Vælg en printer fra Shipmondo Print Client.');
  await db.batch([
    db.prepare("UPDATE shipping_connections SET printer_json=? WHERE company_id=? AND webshop_id=? AND provider='shipmondo'").bind(chosen ? JSON.stringify(chosen) : null, company, shop),
    db.prepare('INSERT INTO audit_events(id,company_id,actor_id,action,resource_id,details_json) VALUES(?,?,?,?,?,?)').bind(crypto.randomUUID(), company, actor.id, 'shipmondo.printer.saved', shop, JSON.stringify(chosen ?? {})),
  ]);
  return reply({ printer: chosen });
}

/** POST /shipmondo/label {externalId}: create the order's shipment (once) and print its label. */
export async function handleLabel(request: Request, env: PlatformEnv, actor: Actor, company: string, shop: string) {
  const db = env.PLATFORM_DB;
  await requireWebshop(db, actor, company, shop);
  if (actor.support || actor.platformAdmin) throw new HttpError(403, 'Labels udskrives af virksomhedens egne brugere.');
  if (request.method !== 'POST') throw new HttpError(405, 'Brug Udskriv label.');
  const b = await jsonBody(request, 2000), id = String(b.externalId || '');
  if (!/^gid:\/\/shopify\/Order\/\d{1,30}$/.test(id)) throw new HttpError(400, 'Vælg en ordre.');
  const { credentials, printer } = await connection(env, company, shop);
  if (!printer) throw new HttpError(409, 'Vælg en printer under Shipmondo-integrationen først.');
  // Real labels cost freight: outside production only a Shipmondo sandbox account may be used.
  if (env.PLATFORM_ENV !== 'production' && !credentials.sandbox) throw new HttpError(403, 'Labels kan kun udskrives i produktionsportalen eller med en Shipmondo-sandbox.');
  const order = await db.prepare("SELECT json_extract(payload_json,'$.name') name,json_extract(payload_json,'$.cancelledAt') cancelled FROM operation_snapshots WHERE company_id=? AND webshop_id=? AND module='orders' AND external_id=?").bind(company, shop, id).first<{ name: string; cancelled: string | null }>();
  if (!order) throw new HttpError(404, 'Ordren findes ikke i denne webshop.');
  if (order.cancelled) throw new HttpError(409, 'Ordren er annulleret.');
  const key = [company, shop, id], event = (name: string, details: Record<string, unknown>) => db.prepare("INSERT INTO record_events(company_id,webshop_id,provider,module,external_id,event,details_json) VALUES(?,?,'shopify','orders',?,?,?)").bind(company, shop, id, name, JSON.stringify(details));
  let label = await db.prepare('SELECT * FROM shipping_labels WHERE company_id=? AND webshop_id=? AND order_id=?').bind(...key).first<Label>();
  if (label?.phase === 'creating' && Date.now() - Date.parse(label.updated_at.replace(' ', 'T') + 'Z') < 120000) throw new HttpError(409, 'Labelen er ved at blive oprettet. Vent et øjeblik.');

  // The order in Shipmondo (imported from Shopify), found by its order number.
  const number = String(order.name).replace(/^#/, '');
  const found = (await shipmondo<SalesOrder[]>(credentials, 'GET', '/sales_orders?order_id=' + encodeURIComponent(number) + '&per_page=5')).filter(o => o && String(o.order_id).replace(/^#/, '') === number);
  if (found.length !== 1) throw new HttpError(409, found.length ? `Ordre ${order.name} findes flere gange i Shipmondo. Opret labelen i Shipmondo.` : `Ordre ${order.name} er ikke hentet ind i Shipmondo endnu. Prøv igen om lidt.`);
  const salesOrder = found[0];
  const existing = (salesOrder.order_fulfillments || []).filter(f => !f.cancelled && f.shipment_id).sort((a, c) => String(c.created_at).localeCompare(String(a.created_at)))[0];
  let shipmentId = existing?.shipment_id ?? null;

  if (!shipmentId) {
    // An earlier creation with an uncertain outcome is only resolved by checking Shipmondo; it found no shipment.
    if (label?.phase === 'uncertain' && b.confirmedNoShipment !== true) throw new HttpError(409, `Et tidligere forsøg på ordre ${order.name} er uafklaret, og Shipmondo viser ingen forsendelse endnu. Kontrollér ordren i Shipmondo, før du prøver igen.`);
    if (!salesOrder.shipment_template_id) throw new HttpError(409, `Ordre ${order.name} har ikke et fragtprodukt i Shipmondo. Vælg det i Shipmondo først.`);
    // Claim the creation; a concurrent click loses here and creates nothing.
    const claim = label
      ? await db.prepare("UPDATE shipping_labels SET phase='creating',sales_order_id=?,message=NULL,actor_id=?,updated_at=CURRENT_TIMESTAMP WHERE company_id=? AND webshop_id=? AND order_id=? AND phase=? AND updated_at=?").bind(salesOrder.id, actor.id, ...key, label.phase, label.updated_at).run()
      : await db.prepare("INSERT INTO shipping_labels(company_id,webshop_id,order_id,sales_order_id,phase,actor_id) VALUES(?,?,?,?,'creating',?) ON CONFLICT DO NOTHING").bind(...key, salesOrder.id, actor.id).run();
    if (!claim.meta.changes) throw new HttpError(409, 'Labelen er ved at blive oprettet. Vent et øjeblik.');
    try {
      const created = await shipmondo<SalesOrder>(credentials, 'POST', `/sales_orders/${salesOrder.id}/create_shipment`);
      shipmentId = (created.order_fulfillments || []).filter(f => !f.cancelled && f.shipment_id).sort((a, c) => String(c.created_at).localeCompare(String(a.created_at)))[0]?.shipment_id ?? null;
      if (!shipmentId) throw new Uncertain('Shipmondo oprettede ingen forsendelse, der kunne genkendes.');
    } catch (error) {
      if (error instanceof Uncertain) {
        const message = `${error.message} Kontrollér ordre ${order.name} i Shipmondo; der oprettes ikke en ny label automatisk.`;
        await db.batch([db.prepare("UPDATE shipping_labels SET phase='uncertain',message=?,updated_at=CURRENT_TIMESTAMP WHERE company_id=? AND webshop_id=? AND order_id=?").bind(message, ...key), event('label.uncertain', { message })]);
        throw new HttpError(409, message);
      }
      // Shipmondo refused it, so nothing was created: release the claim.
      await db.prepare("DELETE FROM shipping_labels WHERE company_id=? AND webshop_id=? AND order_id=? AND phase='creating' AND shipment_id IS NULL").bind(...key).run();
      throw error;
    }
    await db.batch([db.prepare("UPDATE shipping_labels SET phase='created',shipment_id=?,message=NULL,updated_at=CURRENT_TIMESTAMP WHERE company_id=? AND webshop_id=? AND order_id=?").bind(shipmentId, ...key), event('label.created', { reference: 'Shipmondo-forsendelse ' + shipmentId })]);
  } else {
    // Already shipped in Shipmondo (from here or there): remember it and only print again.
    await db.prepare("INSERT INTO shipping_labels(company_id,webshop_id,order_id,sales_order_id,shipment_id,phase,actor_id) VALUES(?,?,?,?,?,'created',?) ON CONFLICT(company_id,webshop_id,order_id) DO UPDATE SET sales_order_id=excluded.sales_order_id,shipment_id=excluded.shipment_id,phase='created',message=NULL,updated_at=CURRENT_TIMESTAMP")
      .bind(...key, salesOrder.id, shipmentId, actor.id).run();
  }

  try {
    await shipmondo(credentials, 'POST', '/print_jobs', { document_id: shipmentId, document_type: 'shipment', host_name: printer.hostname, printer_name: printer.printer, label_format: printer.labelFormat });
  } catch (error) {
    const reason = error instanceof HttpError || error instanceof Uncertain ? error.message : 'Printeren kunne ikke nås.';
    await db.prepare('UPDATE shipping_labels SET message=?,updated_at=CURRENT_TIMESTAMP WHERE company_id=? AND webshop_id=? AND order_id=?').bind('Udskrift fejlede: ' + reason, ...key).run();
    throw new HttpError(409, `Forsendelsen er oprettet, men labelen kunne ikke sendes til printeren (${reason}). Tjek at Print Client kører, og tryk på printeren igen.`);
  }
  await db.batch([
    db.prepare('UPDATE shipping_labels SET print_count=print_count+1,printed_at=CURRENT_TIMESTAMP,message=NULL,updated_at=CURRENT_TIMESTAMP WHERE company_id=? AND webshop_id=? AND order_id=?').bind(...key),
    event('label.printed', { destination: printer.name, reference: 'Shipmondo-forsendelse ' + shipmentId }),
  ]);
  label = await db.prepare('SELECT * FROM shipping_labels WHERE company_id=? AND webshop_id=? AND order_id=?').bind(...key).first<Label>();
  return reply({ printed: true, shipmentId, reprint: !!existing, printer: printer.name, printCount: label?.print_count ?? 1 });
}
