// Forsendelser: track & trace from Shopify's fulfillments. Shared by the server (reading) and the portal (display).
// Shopify only knows what the shipping app or carrier has reported; missing steps are shown as unknown, never guessed.
export type Carrier = 'dao' | 'gls' | 'postnord' | 'bring';
export type StepKey =
  | 'printed'
  | 'dropped'
  | 'transit'
  | 'ready'
  | 'delivered'
  | 'manual'
  | 'untracked';
export type ShipmentStep = {
  key: StepKey;
  label: string;
  at: string | null;
  reached: boolean;
};
export type ShipmentEvent = {
  status: string;
  label: string;
  at: string;
  message: string | null;
};
export type Shipment = {
  publicTracking?: {
    checkedAt: string | null;
    error: string | null;
    state: 'ok' | 'pending' | 'error' | 'unavailable';
    text: string;
    shipmentId?: string;
  };
  shipmondo?: { shipmentId: string; status: string; text: string; at: string };
  id: string;
  orderId: string;
  orderName: string;
  test: boolean;
  customer: string;
  city: string;
  country: string | null;
  carrier: Carrier | null;
  carrierName: string | null;
  trackingNumber: string | null;
  trackingUrl: string | null;
  pickupPoint: boolean;
  steps: ShipmentStep[];
  current: StepKey;
  issue: string | null;
  readyAt: string | null;
  delivered: boolean;
  deliveredAt: string | null;
  events: ShipmentEvent[];
  shippedAt: string;
  method: string | null;
};
export type ShipmentList = {
  checkedAt: string;
  days: number;
  since: string;
  truncated: boolean;
  shipments: Shipment[];
  shipmondo?: {
    connected: boolean;
    lastEventAt: string | null;
    limited: boolean;
  };
};
export const shipmentDays = [14, 30, 60] as const;

export const carriers: Record<
  Carrier,
  { name: string; short: string; color: string; text: string; holdDays: number }
> = {
  dao: {
    name: 'DAO',
    short: 'DAO',
    color: '#e30613',
    text: '#ffffff',
    holdDays: 7,
  },
  gls: {
    name: 'GLS',
    short: 'GLS',
    color: '#061ab1',
    text: '#ffd100',
    holdDays: 7,
  },
  postnord: {
    name: 'PostNord',
    short: 'PN',
    color: '#00a0d6',
    text: '#ffffff',
    holdDays: 7,
  },
  bring: {
    name: 'Bring',
    short: 'Bring',
    color: '#7bc144',
    text: '#ffffff',
    holdDays: 7,
  },
};

const eventLabels: Record<string, string> = {
  LABEL_PURCHASED: 'Label købt',
  LABEL_PRINTED: 'Label udskrevet',
  CONFIRMED: 'Bekræftet',
  CARRIER_PICKED_UP: 'Indleveret til fragtfirmaet',
  IN_TRANSIT: 'Under transport',
  OUT_FOR_DELIVERY: 'Ude til levering',
  READY_FOR_PICKUP: 'Klar til afhentning i pakkeshop',
  ATTEMPTED_DELIVERY: 'Leveringsforsøg mislykkedes',
  DELAYED: 'Forsinket',
  DELIVERED: 'Leveret',
  FAILURE: 'Fejl hos fragtfirmaet',
};
export const eventLabel = (status: string) =>
  eventLabels[status] || 'Opdatering fra fragtfirmaet';
const issues: Record<string, string> = {
  ATTEMPTED_DELIVERY: 'Leveringsforsøg mislykkedes',
  DELAYED: 'Forsinket',
  FAILURE: 'Fejl hos fragtfirmaet',
  NOT_DELIVERED: 'Ikke leveret',
};

/** The carrier from Shopify's tracking company, tracking link or shipping method, in that order. */
export function detectCarrier(
  ...hints: Array<string | null | undefined>
): Carrier | null {
  for (const hint of hints) {
    const text = (hint || '').toLocaleLowerCase('da');
    if (!text) continue;
    if (/post\s?nord|postdanmark|post danmark/.test(text)) return 'postnord';
    if (/\bgls\b|gls-/.test(text)) return 'gls';
    if (/\bdao\b|dao365|dao\.as/.test(text)) return 'dao';
    if (/\bbring\b|bring\.(dk|com|no|se)/.test(text)) return 'bring';
  }
  return null;
}

/** A parcel shop or locker delivery (not the customer's address, not pickup in the merchant's own store). */
export function isPickupPoint(method: string | null | undefined) {
  const text = (method || '').toLocaleLowerCase('da');
  if (/butik|i vores|lager|showroom|store pickup|local pickup/.test(text))
    return false;
  return /pakke\s?shop|pakkeboks|parcel\s?shop|parcel\s?locker|service\s?point|pick-?up\s?point|udleveringssted|posthus|døgnpost|pakkeautomat|afhentningssted|shop delivery/.test(
    text,
  );
}

type RawEvent = { status?: unknown; happenedAt?: unknown; message?: unknown };
export type RawFulfillment = {
  id: string;
  createdAt: string;
  status: string;
  displayStatus?: string | null;
  inTransitAt?: string | null;
  deliveredAt?: string | null;
  trackingInfo?: Array<{
    company?: string | null;
    number?: string | null;
    url?: string | null;
  }>;
  events?: { nodes?: RawEvent[] };
};
export type RawOrder = {
  id: string;
  name: string;
  test?: boolean;
  cancelledAt?: string | null;
  shippingAddress?: {
    name?: string | null;
    city?: string | null;
    countryCodeV2?: string | null;
  } | null;
  billingAddress?: { name?: string | null; city?: string | null } | null;
  shippingLine?: {
    title?: string | null;
    code?: string | null;
    source?: string | null;
    carrierIdentifier?: string | null;
  } | null;
  fulfillments?: RawFulfillment[];
};
const validTime = (value: unknown): value is string =>
  typeof value === 'string' && Number.isFinite(Date.parse(value));
const first = (events: ShipmentEvent[], ...statuses: string[]) =>
  events.find((e) => statuses.includes(e.status))?.at ?? null;
const last = (events: ShipmentEvent[], ...statuses: string[]) =>
  events.filter((e) => statuses.includes(e.status)).at(-1)?.at ?? null;
// Only http(s) links are handed to the browser; anything else from a shipping app is dropped.
const safeUrl = (value: unknown) => {
  if (typeof value !== 'string') return null;
  try {
    const u = new URL(value);
    return u.protocol === 'https:' || u.protocol === 'http:'
      ? u.toString()
      : null;
  } catch {
    return null;
  }
};

export function buildShipment(order: RawOrder, f: RawFulfillment): Shipment {
  const events: ShipmentEvent[] = (f.events?.nodes || [])
    .filter((e) => typeof e.status === 'string' && validTime(e.happenedAt))
    .map((e) => ({
      status: e.status as string,
      label: eventLabel(e.status as string),
      at: e.happenedAt as string,
      message:
        typeof e.message === 'string' && e.message.trim()
          ? e.message.trim().slice(0, 300)
          : null,
    }))
    .sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  const tracking =
    (f.trackingInfo || []).find((t) => t?.number || t?.url) ||
    f.trackingInfo?.[0] ||
    null;
  const line = order.shippingLine,
    method =
      [
        ...new Set([line?.title?.trim(), line?.code?.trim()].filter(Boolean)),
      ].join(' · ') || null;
  const trackingUrl = safeUrl(tracking?.url);
  const trackingNumber = (tracking?.number || '').trim() || null;
  const manual = !trackingNumber && f.status === 'SUCCESS';
  const carrier = detectCarrier(
    tracking?.company,
    trackingUrl,
    line?.carrierIdentifier,
    line?.source,
    line?.title,
    line?.code,
  );
  const display = f.displayStatus || '';
  const readyAt = last(events, 'READY_FOR_PICKUP');
  const pickupPoint =
    Boolean(readyAt) ||
    display === 'READY_FOR_PICKUP' ||
    display === 'PICKED_UP' ||
    isPickupPoint(method);
  const deliveredAt =
    (validTime(f.deliveredAt) ? f.deliveredAt : null) ||
    first(events, 'DELIVERED');
  const delivered =
    !manual &&
    (Boolean(deliveredAt) ||
      display === 'DELIVERED' ||
      display === 'PICKED_UP');
  const raw: Array<[StepKey, string, string | null, boolean]> = [
    [
      'printed',
      'Udskrevet',
      first(events, 'LABEL_PRINTED', 'LABEL_PURCHASED') || f.createdAt,
      true,
    ],
    [
      'dropped',
      pickupPoint ? 'Indleveret i pakkeshop' : 'Indleveret til fragtfirmaet',
      first(events, 'CARRIER_PICKED_UP'),
      display === 'CARRIER_PICKED_UP',
    ],
    [
      'transit',
      'Under transport',
      (validTime(f.inTransitAt) ? f.inTransitAt : null) ||
        first(events, 'IN_TRANSIT', 'OUT_FOR_DELIVERY'),
      [
        'IN_TRANSIT',
        'OUT_FOR_DELIVERY',
        'ATTEMPTED_DELIVERY',
        'DELAYED',
      ].includes(display),
    ],
    ...(pickupPoint
      ? [
          [
            'ready',
            'Klar i pakkeshop',
            readyAt,
            display === 'READY_FOR_PICKUP',
          ] as [StepKey, string, string | null, boolean],
        ]
      : []),
    [
      'delivered',
      pickupPoint ? 'Afhentet af kunden' : 'Leveret hos kunden',
      deliveredAt,
      delivered,
    ],
  ];
  // A later step implies the earlier ones happened, even when the carrier never reported them.
  let reachedIndex = 0;
  raw.forEach(([, , at, flag], i) => {
    if (at || flag) reachedIndex = i;
  });
  const steps = raw.map(([key, label, at], i) => ({
    key,
    label,
    at,
    reached: i <= reachedIndex,
  }));
  // A problem is shown while it is the carrier's latest word on the parcel.
  const issue = delivered
    ? null
    : issues[display] || issues[events.at(-1)?.status || ''] || null;
  const address = order.shippingAddress,
    billing = order.billingAddress;
  return {
    id: f.id,
    orderId: order.id,
    orderName: order.name,
    test: Boolean(order.test),
    customer:
      (address?.name || billing?.name || '').trim() || 'Ukendt modtager',
    city: (address?.city || billing?.city || '').trim(),
    country: address?.countryCodeV2 || null,
    carrier,
    carrierName: carrier
      ? carriers[carrier].name
      : (tracking?.company || '').trim() || null,
    trackingNumber,
    trackingUrl,
    pickupPoint: trackingNumber ? pickupPoint : false,
    steps: trackingNumber
      ? steps
      : [
          {
            key: manual ? 'manual' : 'untracked',
            label: manual
              ? 'Afsluttet – manuelt håndteret'
              : 'Afventer trackingnummer',
            at: null,
            reached: manual,
          },
        ],
    current: trackingNumber
      ? steps[reachedIndex].key
      : manual
        ? 'manual'
        : 'untracked',
    issue: trackingNumber ? issue : null,
    readyAt: trackingNumber ? readyAt : null,
    delivered,
    deliveredAt: delivered ? deliveredAt : null,
    events,
    shippedAt: f.createdAt,
    method,
  };
}

/** Successful fulfillments of an order, newest first. Cancelled orders and fulfillments are left out. */
export function orderShipments(order: RawOrder): Shipment[] {
  if (order.cancelledAt) return [];
  return (order.fulfillments || [])
    .filter((f) => f && f.status === 'SUCCESS' && validTime(f.createdAt))
    .flatMap((f) => {
      const parcels = (f.trackingInfo || []).filter((t) => t.number || t.url);
      if (parcels.length <= 1) return [buildShipment(order, f)];
      return parcels.map((t, i) =>
        buildShipment(order, {
          ...f,
          id: f.id + ':parcel:' + i,
          trackingInfo: [t],
        }),
      );
    });
}

const day = (value: string) =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Copenhagen',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(value));
const addDays = (date: string, days: number) => {
  const d = new Date(date + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};
const between = (from: string, to: string) =>
  Math.round(
    (Date.parse(to + 'T12:00:00Z') - Date.parse(from + 'T12:00:00Z')) /
      86400000,
  );

/**
 * Estimated last pickup day for a parcel waiting in a parcel shop. The carriers do not report the deadline to Shopify,
 * so it is the day it became ready plus the carrier's usual storage time. `soon` = 2 days or less left.
 */
export function pickupDeadline(
  s: Pick<Shipment, 'readyAt' | 'delivered' | 'carrier' | 'pickupPoint'>,
  today: string,
) {
  // Shopify may report a parcel as delivered or picked up without a date; it is never due for return then.
  if (!s.pickupPoint || !s.readyAt || s.delivered) return null;
  const holdDays = s.carrier ? carriers[s.carrier].holdDays : 7;
  const deadline = addDays(day(s.readyAt), holdDays),
    daysLeft = between(today, deadline);
  return {
    deadline,
    daysLeft,
    holdDays,
    state:
      daysLeft < 0
        ? ('overdue' as const)
        : daysLeft <= 2
          ? ('soon' as const)
          : ('ok' as const),
  };
}

/** Dashboard: shipments created today (Danish date), on the way, and waiting in a parcel shop. "Under transport"
 *  is the Forsendelser page's "På vej": everything not delivered, ready for pickup, manual or untracked. */
export function shipmentCounts(shipments: Shipment[], today: string) {
  const day = (value: string) =>
    new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Europe/Copenhagen',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date(value));
  return {
    created: shipments.filter(
      (s) =>
        Number.isFinite(Date.parse(s.shippedAt)) && day(s.shippedAt) === today,
    ).length,
    moving: shipments.filter(
      (s) => !['delivered', 'manual', 'untracked', 'ready'].includes(s.current),
    ).length,
    waiting: shipments.filter((s) => s.current === 'ready').length,
  };
}
