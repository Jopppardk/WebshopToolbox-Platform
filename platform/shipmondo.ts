import { compactVerify } from 'jose';
import { requireCompany, requireWebshop } from './auth';
import { seal, unseal } from './connections';
import { jsonBody } from './invitations';
import { HttpError, reply, type Actor, type PlatformEnv } from './types';
import type { ShipmentList } from './tier1/src/lib/shipments';

type Credentials = { apiUser: string; apiKey: string; sandbox: boolean };
type Connection = { credentials_encrypted: string; revision: string; webhook_id: string; webhook_secret_encrypted: string; verified_at: string; last_event_at: string | null };
export type MonitorEvent = { shipment_id: string; tracking_number: string; carrier: string; occurred_at: string; status: string; status_text: string; state: string };
const scope = (company: string, shop: string) => [company, shop, 'shipmondo'];
const pathFor = (id: string) => '/webhooks/shipmondo/' + id;
const text = (value: unknown, max: number) => typeof value === 'string' ? value.trim().slice(0, max) : '';
const carrierCode = (value: string) => ({ post_nord: 'postnord', pdk: 'postnord' } as Record<string,string>)[value] || value;
const connection = (env: PlatformEnv, company: string, shop: string) => env.PLATFORM_DB.prepare("SELECT * FROM shipping_connections WHERE company_id=? AND webshop_id=? AND provider='shipmondo'").bind(company, shop).first<Connection>();

// Deliberately read-only; shipment creation needs a separate, idempotent write adapter later.
export async function verifyShipmondo(credentials: Credentials) {
  const base = credentials.sandbox ? 'https://sandbox.shipmondo.com' : 'https://app.shipmondo.com';
  let response: Response;
  try { response = await fetch(base + '/api/public/v3/shipments?per_page=1&page=1', {
    method: 'GET', redirect: 'error', signal: AbortSignal.timeout(12000),
    headers: { Authorization: 'Basic ' + btoa(credentials.apiUser + ':' + credentials.apiKey), Accept: 'application/json' },
  }); } catch { throw new HttpError(502, 'Shipmondo kunne ikke kontaktes. Den tidligere forbindelse er bevaret.'); }
  if (!response.ok) {
    await response.body?.cancel();
    throw new HttpError(response.status === 429 ? 429 : 409, [401,403].includes(response.status) ? 'Shipmondo afviste API-bruger eller API-nøgle.' : response.status === 429 ? 'Shipmondo begrænser antallet af kald. Vent et minut og prøv igen.' : 'Shipmondo kunne ikke kontrollere forbindelsen. Prøv igen senere.');
  }
  let data: unknown; try { data = await response.json(); } catch { throw new HttpError(502, 'Shipmondo returnerede et ugyldigt svar.'); }
  if (!Array.isArray(data)) throw new HttpError(502, 'Shipmondo returnerede en ugyldig forsendelsesliste.');
}

export async function handleShipmondo(request: Request, env: PlatformEnv, actor: Actor, company: string, shop: string) {
  await requireCompany(env.PLATFORM_DB, actor, company, true);
  await requireWebshop(env.PLATFORM_DB, actor, company, shop);
  if (actor.support || actor.platformAdmin) throw new HttpError(403, 'Forbindelsen administreres af virksomhedens administrator.');
  const db = env.PLATFORM_DB, saved = await connection(env, company, shop);
  if (request.method === 'GET') {
    if (!saved) return reply({ connected: false, revision: null });
    const credentials = await unseal(env, scope(company, shop), saved.credentials_encrypted) as Credentials;
    return reply({ connected: true, revision: saved.revision, sandbox: credentials.sandbox, verifiedAt: saved.verified_at, lastEventAt: saved.last_event_at,
      webhookUrl: new URL(pathFor(saved.webhook_id), request.url).href,
      webhookSecret: await unseal(env, [...scope(company, shop), 'webhook'], saved.webhook_secret_encrypted) });
  }
  if (!['POST','DELETE'].includes(request.method)) throw new HttpError(405, 'Brug Test og forbind eller Afbryd forbindelse.');
  const body = await jsonBody(request, 5000);
  if ((body.revision ?? null) !== (saved?.revision ?? null)) throw new HttpError(409, 'Forbindelsen er ændret. Genindlæs siden.');
  const audit = (action: string) => db.prepare('INSERT INTO audit_events(id,company_id,actor_id,action,resource_id,details_json) VALUES(?,?,?,?,?,?)').bind(crypto.randomUUID(), company, actor.id, action, shop, '{}');
  if (request.method === 'DELETE') {
    if (saved) await db.batch([db.prepare("DELETE FROM shipping_connections WHERE company_id=? AND webshop_id=? AND provider='shipmondo' AND revision=?").bind(company, shop, saved.revision), audit('shipmondo.disconnected')]);
    return reply({ connected: false });
  }
  const apiUser = text(body.apiUser, 256), apiKey = text(body.apiKey, 512);
  if (!apiUser || !apiKey || !/^[\x21-\x7e]+$/.test(apiUser + apiKey) || apiUser.includes(':') || typeof body.sandbox !== 'boolean') throw new HttpError(400, 'Angiv API-bruger, API-nøgle og miljø fra Shipmondo.');
  const credentials = { apiUser, apiKey, sandbox: body.sandbox };
  await verifyShipmondo(credentials);
  // Rotate the webhook on credential replacement: old-account tracking must never leak into a new connection.
  const id = crypto.randomUUID(), revision = crypto.randomUUID(), secret = crypto.randomUUID() + crypto.randomUUID();
  const encrypted = await seal(env, scope(company, shop), credentials), webhookSecret = await seal(env, [...scope(company, shop), 'webhook'], secret);
  const mutation = saved
    ? db.prepare("UPDATE shipping_connections SET credentials_encrypted=?,revision=?,webhook_id=?,webhook_secret_encrypted=?,verified_at=CURRENT_TIMESTAMP,last_event_at=NULL WHERE company_id=? AND webshop_id=? AND provider='shipmondo' AND revision=?").bind(encrypted, revision, id, webhookSecret, company, shop, saved.revision)
    : db.prepare("INSERT INTO shipping_connections(company_id,webshop_id,provider,credentials_encrypted,revision,webhook_id,webhook_secret_encrypted) VALUES(?,?,'shipmondo',?,?,?,?) ON CONFLICT DO NOTHING").bind(company, shop, encrypted, revision, id, webhookSecret);
  const results = await db.batch([mutation,
    db.prepare('DELETE FROM shipping_events WHERE company_id=? AND webshop_id=? AND EXISTS(SELECT 1 FROM shipping_connections WHERE webhook_id=? AND revision=?)').bind(company,shop,id,revision),
    db.prepare("INSERT INTO audit_events(id,company_id,actor_id,action,resource_id,details_json) SELECT ?,company_id,?,'shipmondo.connected',webshop_id,'{}' FROM shipping_connections WHERE webhook_id=? AND revision=?").bind(crypto.randomUUID(),actor.id,id,revision),
  ]);
  if (!results[0].meta.changes) throw new HttpError(409, 'Forbindelsen blev ændret imens. Genindlæs siden.');
  return reply({ connected: true, revision, webhookUrl: new URL(pathFor(id), request.url).href, webhookSecret: secret, sandbox: credentials.sandbox });
}

export function parseMonitor(data: any): MonitorEvent {
  if (!data || !/^[0-9]+$/.test(String(data.shipment_id)) || !text(data.carrier_track_id, 150) || !text(data.carrier_code, 60) || !text(data.current_status, 80) || typeof data.current_status_registered_at !== 'string') throw new HttpError(400, 'Ugyldig trackinghændelse.');
  const time = Date.parse(data.current_status_registered_at);
  if (!Number.isFinite(time) || time > Date.now() + 300000) throw new HttpError(400, 'Ugyldigt trackingtidspunkt.');
  return { shipment_id: String(data.shipment_id), tracking_number: text(data.carrier_track_id, 150), carrier: carrierCode(text(data.carrier_code, 60).toLowerCase()), occurred_at: new Date(time).toISOString(), status: text(data.current_status, 80), status_text: text(data.current_status_text, 500), state: text(data.current_state, 60) };
}

export async function shipmondoWebhook(request: Request, env: PlatformEnv) {
  if (request.method !== 'POST') throw new HttpError(405, 'Brug POST.');
  const url = new URL(request.url), id = url.pathname.slice('/webhooks/shipmondo/'.length);
  if (!/^[a-f0-9-]{36}$/.test(id)) throw new HttpError(404, 'Webhook findes ikke.');
  const saved = await env.PLATFORM_DB.prepare("SELECT s.* FROM shipping_connections s JOIN companies c ON c.id=s.company_id JOIN webshops w ON w.company_id=s.company_id AND w.id=s.webshop_id WHERE s.webhook_id=? AND c.status='active' AND c.demo=0 AND w.status='active'").bind(id).first<Connection & {company_id:string;webshop_id:string}>();
  if (!saved) throw new HttpError(404, 'Webhook findes ikke.');
  if (!request.headers.get('content-type')?.startsWith('application/json')) throw new HttpError(415, 'Brug JSON.');
  const reader = request.body?.getReader();
  if (!reader) throw new HttpError(400, 'Webhook mangler data.');
  let raw = '', size = 0; const decoder = new TextDecoder();
  while (true) { const chunk = await reader.read(); if (chunk.done) break; size += chunk.value.byteLength; if (size > 16000) { await reader.cancel(); throw new HttpError(413, 'Webhook er for stor.'); } raw += decoder.decode(chunk.value, {stream:true}); }
  raw += decoder.decode();
  let body: any; try { body = JSON.parse(raw); } catch { throw new HttpError(400, 'Ugyldig JSON.'); }
  let payload: any;
  try {
    const secret = await unseal(env, [...scope(saved.company_id, saved.webshop_id), 'webhook'], saved.webhook_secret_encrypted);
    const verified = await compactVerify(String(body.data || ''), new TextEncoder().encode(secret), { algorithms: ['HS256'] });
    payload = JSON.parse(new TextDecoder().decode(verified.payload));
    if (typeof payload === 'string') payload = JSON.parse(payload);
    if (payload.url !== url.href) throw new Error('Wrong destination');
  } catch { throw new HttpError(401, 'Ugyldig webhook-signatur eller destination.'); }
  const event = parseMonitor(payload.data);
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(event)));
  const eventId = Array.from(new Uint8Array(digest), x => x.toString(16).padStart(2,'0')).join('');
  await env.PLATFORM_DB.batch([
    env.PLATFORM_DB.prepare("INSERT OR IGNORE INTO shipping_events(company_id,webshop_id,event_id,shipment_id,tracking_number,carrier,occurred_at,status,status_text,state) SELECT company_id,webshop_id,?,?,?,?,?,?,?,? FROM shipping_connections WHERE webhook_id=? AND revision=?").bind(eventId, event.shipment_id, event.tracking_number, event.carrier, event.occurred_at, event.status, event.status_text, event.state, id, saved.revision),
    env.PLATFORM_DB.prepare('UPDATE shipping_connections SET last_event_at=CURRENT_TIMESTAMP WHERE webhook_id=? AND revision=?').bind(id, saved.revision),
  ]);
  return reply({ received: true });
}

export function enrichShipmentList(list: ShipmentList, events: MonitorEvent[]): ShipmentList {
  return { ...list, shipments: list.shipments.map(shipment => {
    if (!shipment.trackingNumber || !shipment.carrier) return shipment;
    const matches = events.filter(e => e.tracking_number === shipment.trackingNumber && e.carrier === shipment.carrier && Date.parse(e.occurred_at) >= Date.parse(shipment.shippedAt)).sort((a,b) => a.occurred_at.localeCompare(b.occurred_at));
    if (!matches.length || new Set(matches.map(e => e.shipment_id)).size !== 1) return shipment;
    const latest = matches[matches.length - 1];
    // Only DELIVERED is documented as a final status. Other provider statuses are displayed verbatim,
    // without guessing their meaning or inventing scan times/collection deadlines.
    const delivered = latest.status === 'DELIVERED';
    const result = { ...shipment, shipmondo: { shipmentId: latest.shipment_id, status: latest.status, text: latest.status_text, at: latest.occurred_at },
      events: [...shipment.events, ...matches.map(e => ({status:e.status,label:'Shipmondo · '+e.status,at:e.occurred_at,message:e.status_text || null}))].sort((a,b) => a.at.localeCompare(b.at)) };
    if (delivered && (!shipment.deliveredAt || Date.parse(latest.occurred_at) >= Date.parse(shipment.deliveredAt))) {
      result.delivered = true; result.deliveredAt = latest.occurred_at; result.current = 'delivered'; result.issue = null;
      result.steps = shipment.steps.map(step => ({...step,reached:true,at:step.key === 'delivered' ? latest.occurred_at : step.at}));
    }
    return result;
  }) };
}

export async function enrichShipmondo(env: PlatformEnv, company: string, shop: string, list: ShipmentList) {
  const saved = await connection(env, company, shop);
  if (!saved) return list;
  // All data stays behind the customer gateway. No matching on order number or customer name.
  const rows = (await env.PLATFORM_DB.prepare('SELECT shipment_id,tracking_number,carrier,occurred_at,status,status_text,state FROM shipping_events WHERE company_id=? AND webshop_id=? AND occurred_at>=? ORDER BY occurred_at DESC LIMIT 5000').bind(company, shop, list.since).all<MonitorEvent>()).results;
  return { ...enrichShipmentList(list, rows), shipmondo: { connected: true, lastEventAt: saved.last_event_at, limited: rows.length === 5000 } };
}
