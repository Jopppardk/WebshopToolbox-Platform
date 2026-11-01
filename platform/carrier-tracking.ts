import type { ShipmentEvent } from './tier1/src/lib/shipments';
import { trackingTime, type PublicTracking } from './public-tracking';

// GLS and DAO read from the carriers' own open lookups. Shipmondo's public pages only link on to them since 29
// October 2026, the Shipment Monitor webhook needs a Shipmondo plan above Essentials, and the carriers' APIs need
// customer agreements René does not have. Neither lookup is documented, so any change in layout is rejected and the
// last good snapshot is kept, as for Shipmondo's page.

// The lookup found no parcel yet (GLS answers once the parcel is scanned, DAO once it is registered). Not an error.
export const notYet = 'not yet';

const text = (value: unknown, max: number) =>
  typeof value === 'string' ? value.trim().slice(0, max) : '';

async function readJson(url: string, allowed: number[] = []) {
  const response = await fetch(url, {
    method: 'GET',
    redirect: 'manual',
    signal: AbortSignal.timeout(8000),
    headers: { Accept: 'application/json', 'Accept-Language': 'da-DK' },
  });
  if (
    (!response.ok && !allowed.includes(response.status)) ||
    !response.headers.get('content-type')?.includes('application/json')
  ) {
    await response.body?.cancel();
    throw Error('response');
  }
  const raw = await response.text();
  if (raw.length > 512000) throw Error('size');
  return { status: response.status, data: JSON.parse(raw) };
}

// GLS statuses in the vocabulary the timeline maps. DELIVEREDPS is "delivered to the parcel shop": waiting there.
const glsStatuses: Record<string, string> = Object.assign(Object.create(null), {
  PREADVICE: 'INFORMED',
  INTRANSIT: 'EN_ROUTE',
  INWAREHOUSE: 'EN_ROUTE',
  INDELIVERY: 'EN_ROUTE',
  DELIVEREDPS: 'READY_FOR_PICKUP',
  DELIVERED: 'DELIVERED',
});

type GlsAnswer = {
  tuStatus?: Array<{
    arrivalTime?: { name?: unknown; value?: unknown };
    progressBar?: {
      statusInfo?: unknown;
      statusText?: unknown;
      statusBar?: Array<{ imageStatus?: unknown; imageText?: unknown }>;
    };
  }>;
};
type DaoAnswer = {
  found?: unknown;
  parcel?: {
    barcode?: unknown;
    events?: Array<{
      raw?: { tidspunkt?: unknown; haendelse?: unknown; beskrivelse?: unknown };
    }>;
  };
};

/**
 * GLS' open lookup (rstt029) gives the current status and, once delivered, its time; not the scans. A new status is
 * therefore timed when it is first seen (or at GLS' delivery time), and earlier statuses are kept from the snapshot.
 */
export function parseGlsTracking(
  data: GlsAnswer | null | undefined,
  shippedAt: string,
  previous: PublicTracking | null,
  now = new Date().toISOString(),
): PublicTracking {
  const parcel = Array.isArray(data?.tuStatus) ? data.tuStatus[0] : null,
    bar = parcel?.progressBar,
    raw = text(bar?.statusInfo, 40);
  if (!parcel || !bar || !/^[A-Z_]{2,40}$/.test(raw)) throw Error('format');
  const current = Array.isArray(bar.statusBar)
      ? bar.statusBar.find((s) => s?.imageStatus === 'CURRENT')
      : null,
    found = text(bar.statusText, 200) || text(current?.imageText, 200) || raw,
    label = found[0].toUpperCase() + found.slice(1),
    status = glsStatuses[raw] || raw;
  // "Leveret den: 29-10-2026  klokken 10:36" (Danish wall-clock time).
  const arrival = text(parcel.arrivalTime?.value, 60).match(
      /^(\d{2})-(\d{2})-(\d{4})\s+klokken\s+(\d{2}):(\d{2})$/,
    ),
    at =
      arrival &&
      /^Leveret/i.test(text(parcel.arrivalTime?.name, 40)) &&
      ['READY_FOR_PICKUP', 'DELIVERED'].includes(status)
        ? trackingTime(
            `${arrival[1]}/${arrival[2]}/${arrival[3]} ${arrival[4]}:${arrival[5]}`,
          )
        : now;
  const events: ShipmentEvent[] = [...(previous?.events || [])];
  if (events.at(-1)?.status !== status || events.at(-1)?.label !== label)
    events.push({
      status,
      label,
      at,
      message: null,
    });
  // A delivery time from GLS can be earlier than when an earlier status was first seen here.
  const last = events.at(-1)!;
  for (const e of events) if (e.at > last.at) e.at = last.at;
  if (Date.parse(last.at) < Date.parse(shippedAt) - 86400000)
    throw Error('old parcel');
  return { status, text: last.label, shipmentId: '', events };
}

export async function fetchGlsTracking(
  number: string,
  shippedAt: string,
  previous: PublicTracking | null,
) {
  if (!/^\d{8,20}$/.test(number)) throw Error('number');
  const { status, data } = await readJson(
    'https://gls-group.eu/app/service/open/rest/DK/da/rstt029?match=' + number,
    [404],
  );
  // E206: "Din søgning gav desværre intet resultat" until the parcel's first scan.
  if (status === 404)
    throw Error(data?.lastError === 'E206' ? notYet : 'response');
  return parseGlsTracking(data, shippedAt, previous);
}

// DAO event codes ("haendelse") seen on DAO's own tracking page. Unknown codes are read from their description;
// anything else stays raw and is shown as a problem with DAO's text.
const daoCodes: Record<string, string> = Object.assign(Object.create(null), {
  '1': 'INFORMED',
  '11': 'EN_ROUTE',
  '12': 'EN_ROUTE',
  '16': 'EN_ROUTE',
  '23': 'EN_ROUTE',
  '25': 'EN_ROUTE',
  '26': 'EN_ROUTE',
  '32': 'READY_FOR_PICKUP',
  '51': 'DELIVERED',
});
function daoStatus(code: string, description: string) {
  if (daoCodes[code]) return daoCodes[code];
  if (/ikke|fejl|retur|skade|forsink|adresse/i.test(description))
    return 'DAO-' + code;
  if (/^(pakken er )?(udleveret|leveret)\b/i.test(description))
    return 'DELIVERED';
  if (/klar til afhentning/i.test(description)) return 'READY_FOR_PICKUP';
  if (
    /på vej|sorteret|ankommet|indleveret|afhentet|under levering|ude at køre/i.test(
      description,
    )
  )
    return 'EN_ROUTE';
  return 'DAO-' + code;
}

/** DAO's own tracking page lookup. Only the events are kept; the recipient and parcel shop in the answer are not. */
export function parseDaoTracking(
  data: DaoAnswer | null | undefined,
  number: string,
  shippedAt: string,
): PublicTracking {
  if (data?.found === false) throw Error(notYet);
  const parcel = data?.parcel;
  if (data?.found !== true || parcel?.barcode !== number)
    throw Error('mismatch');
  if (!parcel || !Array.isArray(parcel.events) || !parcel.events.length)
    throw Error(notYet);
  if (parcel.events.length > 300) throw Error('size');
  // DAO lists the newest event first. Reversed before the stable sort, events with the same time keep DAO's order.
  const events: ShipmentEvent[] = [...parcel.events]
    .reverse()
    .map((e) => {
      const code = text(e?.raw?.haendelse, 10),
        label = text(e?.raw?.beskrivelse, 400);
      if (!/^\d{1,4}$/.test(code) || !label) throw Error('event');
      return {
        status: daoStatus(code, label),
        label,
        at: trackingTime(e.raw?.tidspunkt),
        message: null,
      };
    })
    .sort((a: ShipmentEvent, b: ShipmentEvent) => a.at.localeCompare(b.at));
  if (Date.parse(events.at(-1)!.at) < Date.parse(shippedAt) - 86400000)
    throw Error('old parcel');
  return {
    status: events.at(-1)!.status,
    text: events.at(-1)!.label,
    shipmentId: '',
    events,
  };
}

export async function fetchDaoTracking(number: string, shippedAt: string) {
  if (!/^\d{8,30}$/.test(number)) throw Error('number');
  const { data } = await readJson(
    'https://dao.as/wp-json/dao-wp/v1/track-parcel?lang=DA&barcode=' + number,
  );
  return parseDaoTracking(data, number, shippedAt);
}
