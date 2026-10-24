import { unseal } from './connections';
import { HttpError, type PlatformEnv } from './types';
import type { ShipmentEvent } from './tier1/src/lib/shipments';

// Bring tracking via the Mybring API. Shipmondo's public tracking pages only redirect Bring parcels to Bring's own
// site, and Bring's open JSON endpoints answer 401 without a key. A Mybring login (email) and API key are enough;
// no Bring customer agreement is needed to read the public events of any Bring parcel number.
export type Credentials = { uid: string; apiKey: string };
type Connection = {
  credentials_encrypted: string;
  revision: string;
  verified_at: string;
};
type BringEvent = {
  status?: unknown;
  description?: unknown;
  dateIso?: unknown;
};
type BringPackage = { packageNumber?: unknown; eventSet?: unknown };
type BringAnswer = {
  consignmentSet?: Array<{
    consignmentId?: unknown;
    error?: unknown;
    packageSet?: unknown;
  }>;
};
export type BringTracking = {
  status: string;
  text: string;
  shipmentId: string;
  events: ShipmentEvent[];
};
const api = 'https://api.bring.com/tracking/api/v2/tracking.json';
const clientUrl = 'https://portal.webshoptoolbox.dk';
// Bring's documented test parcel; verifying a key never looks up a customer's parcel.
export const testParcel = 'TESTPACKAGEATPICKUPPOINT';
export const bringScope = (company: string, shop: string) => [
  company,
  shop,
  'bring',
];
export const text = (value: unknown, max: number) =>
  typeof value === 'string' ? value.trim().slice(0, max) : '';

// Bring statuses in the vocabulary the timeline maps (INFORMED, EN_ROUTE, READY_FOR_PICKUP, DELIVERED). Problems
// (ATTEMPTED_DELIVERY, DEVIATION, RETURN, DELIVERED_SENDER) and unknown statuses stay raw and are shown as text.
const normalized: Record<string, string> = Object.assign(Object.create(null), {
  PRE_NOTIFIED: 'INFORMED',
  HANDED_IN: 'EN_ROUTE',
  COLLECTED: 'EN_ROUTE',
  IN_TRANSIT: 'EN_ROUTE',
  INTERNATIONAL: 'EN_ROUTE',
  CUSTOMS: 'EN_ROUTE',
  TRANSPORT_TO_RECIPIENT: 'EN_ROUTE',
  READY_FOR_PICKUP: 'READY_FOR_PICKUP',
  DELIVERED: 'DELIVERED',
});
// A pickup notice repeats that the parcel is waiting; it never changes where the parcel is.
const informational = new Set(['NOTIFICATION_SENT']);

export const bringConnection = (
  db: D1Database,
  company: string,
  shop: string,
) =>
  db
    .prepare(
      "SELECT credentials_encrypted,revision,verified_at FROM carrier_connections WHERE company_id=? AND webshop_id=? AND provider='bring'",
    )
    .bind(company, shop)
    .first<Connection>();

export async function lookup(credentials: Credentials, number: string) {
  let response: Response;
  try {
    response = await fetch(
      api + '?q=' + encodeURIComponent(number) + '&lang=da',
      {
        method: 'GET',
        redirect: 'manual',
        signal: AbortSignal.timeout(8000),
        headers: {
          Accept: 'application/json',
          'X-Mybring-API-Uid': credentials.uid,
          'X-Mybring-API-Key': credentials.apiKey,
          'X-Bring-Client-URL': clientUrl,
        },
      },
    );
  } catch {
    throw new HttpError(502, 'Bring kunne ikke kontaktes. Prøv igen senere.');
  }
  // Never follow a redirect carrying the API key.
  if (!response.ok) {
    await response.body?.cancel();
    throw new HttpError(
      response.status === 429 ? 429 : 409,
      [401, 403].includes(response.status)
        ? 'Bring afviste Mybring-login eller API-nøgle.'
        : response.status === 429
          ? 'Bring begrænser antallet af kald. Vent et minut og prøv igen.'
          : 'Bring kunne ikke svare på opslaget. Prøv igen senere.',
    );
  }
  const raw = await response.text();
  if (raw.length > 512000) throw new HttpError(502, 'Bring svarede for stort.');
  try {
    return JSON.parse(raw);
  } catch {
    throw new HttpError(502, 'Bring returnerede et ugyldigt svar.');
  }
}

/** The parcel's events from Bring, oldest first, with statuses in the shared tracking vocabulary. */
export function parseBringTracking(
  data: BringAnswer | null | undefined,
  number: string,
  shippedAt: string,
): BringTracking {
  const consignment = data?.consignmentSet?.[0];
  if (!consignment || consignment.error) throw Error('not found');
  const packages: BringPackage[] = Array.isArray(consignment.packageSet)
    ? consignment.packageSet
    : [];
  const parcel =
    packages.find((p) => p?.packageNumber === number) ||
    (packages.length === 1 ? packages[0] : null);
  if (!parcel || !Array.isArray(parcel.eventSet) || !parcel.eventSet.length)
    throw Error('no events');
  if (parcel.eventSet.length > 300) throw Error('size');
  const scans: Array<{ raw: string; event: ShipmentEvent }> = parcel.eventSet
    .map((e: BringEvent) => {
      const raw = text(e?.status, 80),
        at = text(e?.dateIso, 40);
      // Bring sends ISO 8601 with an offset; anything else or a time in the future is rejected.
      if (
        !raw ||
        !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,9})?)?(Z|[+-]\d{2}:?\d{2})$/.test(
          at,
        ) ||
        !(Date.parse(at) <= Date.now() + 300000)
      )
        throw Error('event');
      return {
        raw,
        event: {
          status: normalized[raw] || raw,
          label: text(e.description, 400) || raw,
          at: new Date(at).toISOString(),
          message: null,
        },
      };
    })
    .sort((a: { event: ShipmentEvent }, b: { event: ShipmentEvent }) =>
      a.event.at.localeCompare(b.event.at),
    );
  const events = scans.map((s) => s.event);
  if (Date.parse(events.at(-1)!.at) < Date.parse(shippedAt) - 86400000)
    throw Error('old parcel');
  const current = (
    scans.findLast((s) => !informational.has(s.raw)) || scans.at(-1)!
  ).event;
  return {
    status: current.status,
    text: current.label,
    shipmentId:
      typeof consignment.consignmentId === 'string' &&
      /^[\w-]{1,60}$/.test(consignment.consignmentId)
        ? consignment.consignmentId
        : '',
    events,
  };
}

/** Looks a parcel up for the webshop's Bring connection. Throws when there is no connection or no usable answer. */
export async function fetchBringTracking(
  env: PlatformEnv,
  company: string,
  shop: string,
  number: string,
  shippedAt: string,
) {
  if (!/^[a-zA-Z0-9-]{5,100}$/.test(number)) throw Error('number');
  const saved = await bringConnection(env.PLATFORM_DB, company, shop);
  if (!saved) throw Error('not connected');
  const credentials = (await unseal(
    env,
    bringScope(company, shop),
    saved.credentials_encrypted,
  )) as Credentials;
  return parseBringTracking(
    await lookup(credentials, number),
    number,
    shippedAt,
  );
}
