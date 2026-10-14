// Demokontoen: én fast, isoleret virksomhed med fiktive danske data til fremvisning.
// Den har ingen rigtige forbindelser. Alt, der ellers ville kalde Shopify, Dinero, mail eller
// andre udbydere, simuleres her eller afvises, og alle data dannes forfra hver nat.
import type { InvoiceSource } from './order-check';
import { productXml, type Product, type Variant } from './feed-format';
import type { PayoutTransaction } from './payout-source';
import { calculateFinance, type LedgerEntry } from './finance-calculations';
import {
  aggregateFinance,
  comparison,
  dailyComparison,
  missingDays,
  monthRange,
} from './performance-calculations';
import {
  inventoryValueMinor,
  type InventoryRow,
} from './tier1/src/lib/inventory';
import { danishDate } from './tier1/src/lib/history-policy';
import {
  orderShipments,
  type RawOrder,
  type ShipmentList,
} from './tier1/src/lib/shipments';
import { HttpError, reply, type PlatformEnv } from './types';

export const DEMO_EMAIL = 'demo@webshoptoolbox.dk';
export const DEMO_CODE = '10203040';
export const DEMO_COMPANY = 'demo-company',
  DEMO_USER = 'demo-user',
  DEMO_SHOP = 'demo-shop';
export const ORGANIZATION = '480123',
  SHOP_DOMAIN = 'demofirma.myshopify.com',
  PUBLIC_DOMAIN = 'https://demo.webshoptoolbox.dk';
export const COMPANY_NAME = 'Demofirma A/S',
  SHOP_NAME = 'Demofirma Shop';
export const demoMessage =
  'Demokonto: handlingen udføres ikke. Alle data er fiktive og nulstilles hver nat.';

export async function isDemoCompany(env: PlatformEnv, company: string) {
  return !!(await env.PLATFORM_DB.prepare(
    'SELECT 1 FROM companies WHERE id=? AND demo=1',
  )
    .bind(company)
    .first());
}
export async function isDemoUser(env: PlatformEnv, user: string) {
  return !!(await env.PLATFORM_DB.prepare(
    'SELECT 1 FROM users u JOIN companies c ON c.id=u.company_id WHERE u.id=? AND c.demo=1',
  )
    .bind(user)
    .first());
}

// ---------------------------------------------------------------- fiktive data
// A fixed seed gives the same shop every night; only dates move with the reset day.
function random(seed = 20260930) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const kr = (minor: number) => (minor / 100).toFixed(2);
const money = (minor: number) => ({
  shopMoney: { amount: kr(minor), currencyCode: 'DKK' },
});
export const plainMoney = (minor: number) => ({
  amount: kr(minor),
  currencyCode: 'DKK',
});
export const addDays = (iso: string, days: number) =>
  new Date(Date.parse(iso) + days * 86400000).toISOString();

export const demoCollections = [
  { id: 'gid://shopify/Collection/7001', title: 'Hjem & interiør' },
  { id: 'gid://shopify/Collection/7002', title: 'Køkken' },
  { id: 'gid://shopify/Collection/7003', title: 'Delikatesser' },
];
// Prices include 25 % moms, whole kroner so the moms share is exact.
export const demoProducts = [
  {
    id: 1,
    title: 'Uldplaid Klitrose',
    price: 749,
    compare: 899,
    cost: 310,
    collection: 0,
    weight: 950,
    sku: 'DF-1001',
    stock: 24,
  },
  {
    id: 2,
    title: 'Keramikkop Havgrå',
    price: 149,
    compare: null,
    cost: 48,
    collection: 1,
    weight: 420,
    sku: 'DF-1002',
    stock: 118,
  },
  {
    id: 3,
    title: 'Duftlys Skovbund',
    price: 199,
    compare: 249,
    cost: 62,
    collection: 0,
    weight: 380,
    sku: 'DF-1003',
    stock: 73,
  },
  {
    id: 4,
    title: 'Linnedviskestykke Sand, 2 stk.',
    price: 129,
    compare: null,
    cost: 35,
    collection: 1,
    weight: 160,
    sku: 'DF-1004',
    stock: 160,
  },
  {
    id: 5,
    title: 'Skærebræt i egetræ',
    price: 349,
    compare: null,
    cost: 128,
    collection: 1,
    weight: 1100,
    sku: 'DF-1005',
    stock: 41,
  },
  {
    id: 6,
    title: 'Kaffebønner Morgenmix, 500 g',
    price: 119,
    compare: null,
    cost: 44,
    collection: 2,
    weight: 540,
    sku: 'DF-1006',
    stock: 212,
  },
  {
    id: 7,
    title: 'Lynghonning fra Fyn, 450 g',
    price: 89,
    compare: null,
    cost: 31,
    collection: 2,
    weight: 610,
    sku: 'DF-1007',
    stock: 96,
  },
  {
    id: 8,
    title: 'Glasvase Fjord',
    price: 429,
    compare: 499,
    cost: 150,
    collection: 0,
    weight: 1250,
    sku: 'DF-1008',
    stock: 18,
  },
  {
    id: 9,
    title: 'Olivenolie Koldpresset, 500 ml',
    price: 159,
    compare: null,
    cost: 58,
    collection: 2,
    weight: 800,
    sku: 'DF-1009',
    stock: 64,
  },
  {
    id: 10,
    title: 'Stentøjsskål Mos, 4 stk.',
    price: 479,
    compare: null,
    cost: 176,
    collection: 1,
    weight: 2300,
    sku: 'DF-1010',
    stock: 27,
  },
  {
    id: 11,
    title: 'Pudebetræk i hør, 50x50',
    price: 279,
    compare: 329,
    cost: 88,
    collection: 0,
    weight: 300,
    sku: 'DF-1011',
    stock: 52,
  },
  {
    id: 12,
    title: 'Chokoladetrøfler Havsalt, 200 g',
    price: 139,
    compare: null,
    cost: 47,
    collection: 2,
    weight: 260,
    sku: 'DF-1012',
    stock: 0,
  },
];
const customers: Array<[string, string, string, string]> = [
  ['Mette Hansen', 'Nørregade 14', '8000', 'Aarhus C'],
  ['Lars Nielsen', 'Vestergade 3, 2. tv.', '5000', 'Odense C'],
  ['Sofie Jensen', 'Strandvejen 211', '2900', 'Hellerup'],
  ['Anders Pedersen', 'Algade 42', '9000', 'Aalborg'],
  ['Camilla Kristensen', 'Bredgade 8', '7400', 'Herning'],
  ['Mikkel Larsen', 'Søndergade 27', '8700', 'Horsens'],
  ['Ida Sørensen', 'Kongensgade 61', '6700', 'Esbjerg'],
  ['Rasmus Rasmussen', 'Adelgade 5', '8660', 'Skanderborg'],
  ['Emma Jørgensen', 'Frederiksberg Allé 90', '1820', 'Frederiksberg C'],
  ['Jonas Petersen', 'Havnegade 19', '4300', 'Holbæk'],
  ['Freja Madsen', 'Torvet 2', '6000', 'Kolding'],
  ['Christian Kristiansen', 'Østergade 33', '7100', 'Vejle'],
  ['Laura Olsen', 'Jernbanegade 11', '4000', 'Roskilde'],
  ['Magnus Thomsen', 'Skolevej 7', '7500', 'Holstebro'],
  ['Clara Christiansen', 'Møllevej 22', '3400', 'Hillerød'],
  ['Oliver Poulsen', 'Kirkestræde 4', '5700', 'Svendborg'],
  ['Alma Johansen', 'Lindevej 16', '8600', 'Silkeborg'],
  ['William Møller', 'Ringvejen 58', '4700', 'Næstved'],
  ['Karla Mortensen', 'Engtoften 9', '8900', 'Randers C'],
  ['Noah Knudsen', 'Bøgevej 31', '6400', 'Sønderborg'],
];
export type DemoOrder = {
  id: string;
  name: string;
  createdAt: string;
  fulfilledAt: string | null;
  cancelledAt: string | null;
  gateway: string;
  customer: [string, string, string, string];
  email: string;
  lines: Array<{ product: (typeof demoProducts)[number]; quantity: number }>;
  shippingMinor: number;
  totalMinor: number;
  refundedMinor: number;
  financial: string;
  fulfillment: string;
};

export function demoDataset(today = danishDate()) {
  const rand = random(),
    pick = <T>(list: T[]) => list[Math.floor(rand() * list.length)];
  const base = today + 'T12:00:00Z',
    orders: DemoOrder[] = [];
  for (let i = 0; i < 50; i++) {
    const created =
      addDays(base, -(i * 1.15 + rand() * 0.6)).slice(0, 11) +
      String(8 + Math.floor(rand() * 13)).padStart(2, '0') +
      ':' +
      String(Math.floor(rand() * 60)).padStart(2, '0') +
      ':00Z';
    const lines: DemoOrder['lines'] = [],
      count = 1 + Math.floor(rand() * 3);
    while (lines.length < count) {
      const product = pick(demoProducts.filter((p) => p.stock > 0));
      if (!lines.some((l) => l.product.id === product.id))
        lines.push({ product, quantity: rand() < 0.8 ? 1 : 2 });
    }
    const goods = lines.reduce(
        (sum, l) => sum + l.product.price * 100 * l.quantity,
        0,
      ),
      shippingMinor = goods >= 49900 ? 0 : 4900;
    const cancelled = i === 12 || i === 33,
      open = i < 3,
      refunded = [8, 24, 41].includes(i);
    const refundedMinor = refunded ? lines[0].product.price * 100 : 0,
      customer = customers[(i * 7) % customers.length];
    orders.push({
      id: 'gid://shopify/Order/' + (5200000000 + 1050 - i),
      name: '#' + (1050 - i),
      createdAt: created,
      fulfilledAt: cancelled || open ? null : addDays(created, 1),
      cancelledAt: cancelled ? addDays(created, 0.2) : null,
      gateway: i % 4 === 1 ? 'MobilePay' : 'shopify_payments',
      customer,
      email:
        customer[0]
          .toLowerCase()
          .replaceAll(' ', '.')
          .replaceAll('ø', 'oe')
          .replaceAll('æ', 'ae')
          .replaceAll('å', 'aa') + '@example.dk',
      lines,
      shippingMinor,
      totalMinor: goods + shippingMinor,
      refundedMinor,
      financial: cancelled
        ? 'VOIDED'
        : refunded
          ? 'PARTIALLY_REFUNDED'
          : 'PAID',
      fulfillment: cancelled || open ? 'UNFULFILLED' : 'FULFILLED',
    });
  }
  return { today, orders: orders.reverse() };
}
export function orderSnapshot(o: DemoOrder) {
  return {
    id: o.id,
    name: o.name,
    createdAt: o.createdAt,
    processedAt: o.createdAt,
    cancelledAt: o.cancelledAt,
    test: false,
    displayFinancialStatus: o.financial,
    displayFulfillmentStatus: o.fulfillment,
    fulfillments: o.fulfilledAt
      ? [{ createdAt: o.fulfilledAt, status: 'SUCCESS' }]
      : [],
    paymentGatewayNames: [o.gateway],
    currentTotalPriceSet: money(
      o.cancelledAt ? 0 : o.totalMinor - o.refundedMinor,
    ),
    totalRefundedSet: money(o.refundedMinor),
  };
}
export function invoiceSource(o: DemoOrder): InvoiceSource {
  const [name, address1, zip, city] = o.customer,
    vat = (minor: number) => Math.round(minor / 5);
  const goods = o.lines.reduce(
    (sum, l) => sum + l.product.price * 100 * l.quantity,
    0,
  );
  return {
    id: o.id,
    name: o.name,
    email: o.email,
    createdAt: o.createdAt,
    updatedAt: o.fulfilledAt!,
    processedAt: o.createdAt,
    fulfillments: [{ createdAt: o.fulfilledAt!, status: 'SUCCESS' }],
    test: false,
    edited: false,
    cancelledAt: null,
    taxesIncluded: true,
    displayFinancialStatus: 'PAID',
    displayFulfillmentStatus: 'FULFILLED',
    billingAddress: {
      name,
      address1,
      zip,
      city,
      country: 'Danmark',
      countryCodeV2: 'DK',
    },
    shippingAddress: null,
    currentTotalPriceSet: money(o.totalMinor),
    currentSubtotalPriceSet: money(goods),
    currentTotalTaxSet: money(vat(goods) + vat(o.shippingMinor)),
    totalPriceSet: money(o.totalMinor),
    totalTaxSet: money(vat(goods) + vat(o.shippingMinor)),
    totalRefundedSet: money(0),
    lineItems: {
      nodes: o.lines.map((l, i) => {
        const total = l.product.price * 100 * l.quantity;
        return {
          id: 'line' + (i + 1),
          name: l.product.title,
          quantity: l.quantity,
          currentQuantity: l.quantity,
          requiresShipping: true,
          isGiftCard: false,
          originalTotalSet: money(total),
          discountedTotalSet: money(total),
          discountAllocations: [],
          taxLines: [
            { priceSet: money(vat(total)), rate: 0.25, channelLiable: false },
          ],
        };
      }),
      pageInfo: { hasNextPage: false, endCursor: null },
    },
    shippingLines: {
      nodes: o.shippingMinor
        ? [
            {
              id: 'ship1',
              title: 'PostNord pakke',
              isRemoved: false,
              originalPriceSet: money(o.shippingMinor),
              discountedPriceSet: money(o.shippingMinor),
              discountAllocations: [],
              taxLines: [
                {
                  priceSet: money(vat(o.shippingMinor)),
                  rate: 0.25,
                  channelLiable: false,
                },
              ],
            },
          ]
        : [],
      pageInfo: { hasNextPage: false, endCursor: null },
    },
  } as unknown as InvoiceSource;
}
// Shopify Payments: 2,1 % + 1,80 kr. pr. betaling (fiktivt). MobilePay afregnes uden for Shopify.
const fee = (minor: number) => Math.round(minor * 0.021) + 180;
export function demoPayouts(orders: DemoOrder[], today: string) {
  const charges = orders.filter(
    (o) => o.gateway === 'shopify_payments' && !o.cancelledAt,
  );
  const refunds = orders.filter(
    (o) => o.gateway === 'shopify_payments' && o.refundedMinor,
  );
  const payouts: Array<{ snapshot: any; transactions: PayoutTransaction[] }> =
    [];
  const end = Date.parse(today + 'T23:59:59Z');
  for (let n = 9; n >= 0; n--) {
    const issued = new Date(end - n * 6 * 86400000 + 86400000 * 2),
      from = issued.getTime() - 6 * 86400000 - 2 * 86400000,
      to = issued.getTime() - 2 * 86400000;
    const inWindow = (iso: string) =>
      Date.parse(iso) > from && Date.parse(iso) <= to;
    const tx: PayoutTransaction[] = [];
    for (const o of charges.filter((o) => inWindow(o.createdAt)))
      tx.push({
        id: String(900000 + Number(o.name.slice(1)) * 10),
        type: 'CHARGE',
        processedAt: o.createdAt,
        amount: plainMoney(o.totalMinor),
        fee: plainMoney(fee(o.totalMinor)),
        net: plainMoney(o.totalMinor - fee(o.totalMinor)),
        sourceType: 'CHARGE',
        orderId: o.id.split('/').pop()!,
        orderName: o.name,
        adjustmentReason: null,
      });
    for (const o of refunds.filter(
      (o) => o.fulfilledAt && inWindow(addDays(o.fulfilledAt, 3)),
    ))
      tx.push({
        id: String(900000 + Number(o.name.slice(1)) * 10 + 1),
        type: 'REFUND',
        processedAt: addDays(o.fulfilledAt!, 3),
        amount: plainMoney(-o.refundedMinor),
        fee: plainMoney(0),
        net: plainMoney(-o.refundedMinor),
        sourceType: 'REFUND',
        orderId: o.id.split('/').pop()!,
        orderName: o.name,
        adjustmentReason: null,
      });
    if (!tx.length) continue;
    const sum = (type: string, key: 'amount' | 'fee') =>
      tx
        .filter((t) => t.type === type)
        .reduce((s, t) => s + Math.round(Number(t[key].amount) * 100), 0);
    const gross = sum('CHARGE', 'amount'),
      fees = sum('CHARGE', 'fee'),
      refunded = sum('REFUND', 'amount'),
      net = gross + refunded - fees;
    const zero = plainMoney(0),
      paid = issued.getTime() <= end - 86400000;
    payouts.push({
      transactions: tx.sort((a, b) =>
        a.processedAt.localeCompare(b.processedAt),
      ),
      snapshot: {
        id:
          'gid://shopify/ShopifyPaymentsPayout/' + (81000 + payouts.length + 1),
        issuedAt: issued.toISOString(),
        status: paid ? 'PAID' : 'SCHEDULED',
        transactionType: 'DEPOSIT',
        net: plainMoney(net),
        summary: {
          adjustmentsFee: zero,
          adjustmentsGross: zero,
          advanceFees: zero,
          advanceGross: zero,
          chargesFee: plainMoney(fees),
          chargesGross: plainMoney(gross),
          refundsFee: zero,
          refundsFeeGross: plainMoney(refunded),
          reservedFundsFee: zero,
          reservedFundsGross: zero,
          retriedPayoutsFee: zero,
          retriedPayoutsGross: zero,
          usdcRebateCreditAmount: zero,
        },
      },
    });
  }
  return payouts.slice(-10);
}
export const chart = [
  ['1000', 'Salg af varer, moms', 'U25'],
  ['1010', 'Salg af fragt, moms', 'U25'],
  ['1100', 'Salg af varer, momsfri', 'none'],
  ['1200', 'Returneret salg', 'U25'],
  ['2000', 'Vareforbrug', 'I25'],
  ['2100', 'Fragt og porto', 'I25'],
  ['2800', 'Emballage', 'I25'],
  ['3400', 'Annoncering', 'I25'],
  ['3600', 'Husleje', 'I25'],
  ['7000', 'Gebyrer, betalingsløsninger', 'none'],
  ['5820', 'Varelager', 'none'],
  ['5825', 'Lagerregulering', 'none'],
  ['55000', 'Bank', 'none'],
  ['58000', 'Mellemregning Shopify Payments', 'none'],
  ['58010', 'Mellemregning MobilePay', 'none'],
];
const categories: Record<number, string> = {
  1000: 'Turnover',
  1010: 'Turnover',
  1100: 'Turnover',
  1200: 'Turnover',
  2000: 'Variable Expenses',
  2100: 'Variable Expenses',
  2800: 'Variable Expenses',
  3400: 'Sales Expenses',
  3600: 'Property Expenses',
  7000: 'Charge',
  5820: 'Turnover Assets',
  5825: 'Variable Expenses',
  55000: 'Liquid Assets',
  58000: 'Liquid Assets',
  58010: 'Liquid Assets',
};
const suppliers = [
  ['10000000-0000-4000-8000-000000000001', 'Nordisk Tekstil ApS', 2000, 0.22],
  [
    '10000000-0000-4000-8000-000000000002',
    'Keramikværkstedet Mols ApS',
    2000,
    0.14,
  ],
  ['10000000-0000-4000-8000-000000000003', 'PostNord Danmark A/S', 2100, 0.06],
  ['10000000-0000-4000-8000-000000000004', 'Google Ireland Ltd.', 3400, 0.07],
  [
    '10000000-0000-4000-8000-000000000005',
    'Meta Platforms Ireland Ltd.',
    3400,
    0.05,
  ],
  [
    '10000000-0000-4000-8000-000000000006',
    'Ejendomsselskabet Havnen ApS',
    3600,
    0,
  ],
] as const;
// Two years of monthly bookkeeping: revenue with a Christmas season and growth, costs per supplier.
export function demoLedger(today: string) {
  const entries: Array<
    LedgerEntry & { contact: string | null; voucher: string | null }
  > = [];
  const year = Number(today.slice(0, 4)),
    rand = random(4711);
  let n = 0;
  for (let y = year - 1; y <= year; y++)
    for (let m = 1; m <= 12; m++) {
      const date = `${y}-${String(m).padStart(2, '0')}-15`;
      if (date > today) continue;
      const season = [
          0.8, 0.7, 0.85, 0.9, 1, 0.95, 0.85, 0.9, 1, 1.1, 1.45, 1.9,
        ][m - 1],
        growth = y === year ? 1.18 : 1;
      const revenue =
        Math.round(185000 * season * growth * (0.93 + rand() * 0.14)) * 100;
      const voucher = (k: number) =>
        `20000000-0000-4000-8000-${String(y * 1000 + m * 10 + k).padStart(12, '0')}`;
      const guid = () =>
        `30000000-0000-4000-8000-${String(++n).padStart(12, '0')}`;
      entries.push(
        {
          guid: guid(),
          account: 1000,
          date,
          minor: -revenue,
          type: 'Normal',
          contact: null,
          voucher: voucher(0),
        },
        {
          guid: guid(),
          account: 58000,
          date,
          minor: revenue,
          type: 'Normal',
          contact: null,
          voucher: voucher(0),
        },
      );
      suppliers.forEach(([id, , account, share], k) => {
        const amount = share
          ? Math.round((revenue * share * (0.9 + rand() * 0.2)) / 100) * 100
          : 1650000;
        entries.push(
          {
            guid: guid(),
            account,
            date,
            minor: amount,
            type: 'Normal',
            contact: id,
            voucher: voucher(k + 1),
          },
          {
            guid: guid(),
            account: 55000,
            date,
            minor: -amount,
            type: 'Normal',
            contact: id,
            voucher: voucher(k + 1),
          },
        );
      });
      const fees = Math.round((revenue * 0.017) / 100) * 100;
      entries.push(
        {
          guid: guid(),
          account: 7000,
          date,
          minor: fees,
          type: 'Normal',
          contact: null,
          voucher: voucher(9),
        },
        {
          guid: guid(),
          account: 58000,
          date,
          minor: -fees,
          type: 'Normal',
          contact: null,
          voucher: voucher(9),
        },
      );
    }
  entries.push({
    guid: '30000000-0000-4000-8000-999999999999',
    account: 5820,
    date: `${year}-01-01`,
    minor: 18450000,
    type: 'Normal',
    contact: null,
    voucher: null,
  });
  return {
    entries,
    ranges: [
      { from: `${year - 1}-01-01`, to: `${year - 1}-12-31` },
      { from: `${year}-01-01`, to: `${year}-12-31` },
    ],
    start: `${year - 1}-01-01`,
  };
}
export function demoFinance(today = danishDate()) {
  const { entries, ranges } = demoLedger(today);
  return {
    ready: true,
    data: calculateFinance(entries, categories, ranges, 5820),
    checkedAt: new Date().toISOString(),
    through: new Date().toISOString(),
    stale: false,
    message:
      'Demodata · bogførte posteringer · resultat før skat · lagerværdi fra konto 5820',
  };
}
// The demo has one webshop, so its card shows the Dinero turnover as Shopify revenue and the demo stock.
export function demoShopFinance(today = danishDate()) {
  const finance = demoFinance(today).data;
  return {
    periods: finance.periods,
    startDate: demoLedger(today).start,
    currency: 'DKK',
    revenue: {
      revenueMtd: finance.revenueMtd,
      revenueYtd: finance.revenueYtd,
      previousMtd: finance.previousMtd,
      previousYtd: finance.previousYtd,
    },
    inventory: {
      valueMinor: demoInventory().totalValueMinor,
      incomplete: 0,
      currency: 'DKK',
    },
    checkedAt: new Date().toISOString(),
  };
}
export function demoPerformance(
  kind: 'finance' | 'shop',
  year: number,
  today = danishDate(),
) {
  const { entries, ranges, start } = demoLedger(today);
  if (kind === 'finance')
    return {
      year,
      startDate: start,
      checkedAt: new Date().toISOString(),
      currency: 'DKK',
      ...aggregateFinance(
        entries,
        categories,
        ranges,
        year,
        today,
        start,
        new Map(suppliers.map(([id, name]) => [id, name] as [string, string])),
      ),
    };
  const rand = random(year),
    visits = new Map<string, number>(),
    orders = new Map<string, number>();
  for (let y = year - 1; y <= year; y++)
    for (let m = 1; m <= 12; m++) {
      const key = `${y}-${String(m).padStart(2, '0')}`,
        season = [0.8, 0.7, 0.85, 0.9, 1, 0.95, 0.85, 0.9, 1, 1.1, 1.45, 1.9][
          m - 1
        ],
        growth = y === Number(today.slice(0, 4)) ? 1.18 : 1;
      const v = Math.round(9200 * season * growth * (0.9 + rand() * 0.2));
      visits.set(key, v);
      orders.set(key, Math.round(v * (0.021 + rand() * 0.006)));
    }
  const series = (sums: Map<string, number>) => ({
    months: comparison(year, today, start, [{ from: start, to: today }], sums),
  });
  return {
    year,
    startDate: start,
    checkedAt: new Date().toISOString(),
    timezone: 'Europe/Copenhagen',
    visits: series(visits),
    orders: series(orders),
  };
}
// Performance → Salg pr. dag: fictitious daily sales with a weekly rhythm, a little higher this year.
export function demoDailySales(
  year: number,
  month: number,
  today = danishDate(),
) {
  const { start } = demoLedger(today),
    rand = random(year * 100 + month),
    sums = [new Map<string, number>(), new Map<string, number>()];
  for (const [i, y] of [year, year - 1].entries()) {
    const range = monthRange(y, month);
    for (let d = 1; d <= Number(range.to.slice(8)); d++) {
      const date = `${range.from.slice(0, 8)}${String(d).padStart(2, '0')}`,
        weekday = new Date(date + 'T12:00:00Z').getUTCDay(),
        rhythm = [1.35, 1.2, 0.95, 0.9, 0.95, 1.05, 0.8][weekday];
      sums[i].set(
        date,
        Math.round(420000 * rhythm * (i ? 1 : 1.15) * (0.75 + rand() * 0.5)),
      );
    }
  }
  const days = dailyComparison(year, month, today, start, sums[0], sums[1]);
  return {
    year,
    month,
    startDate: start,
    checkedAt: new Date().toISOString(),
    timezone: 'Europe/Copenhagen',
    currency: 'DKK',
    days,
    missingDays: missingDays(year, month, today, days),
  };
}
// Forsendelser: fictitious tracking for the fulfilled demo orders, spread over every step and carrier,
// including parcels waiting in a parcel shop close to being returned.
export function demoShipments(
  days: number,
  today = danishDate(),
  now = Date.now(),
): ShipmentList {
  const since = addDays(today + 'T12:00:00Z', -days).slice(0, 10),
    carriers = [
      [
        'PostNord',
        'https://tracking.postnord.com/dk/?id=',
        'PostNord Pakkeshop',
      ],
      [
        'GLS',
        'https://gls-group.com/DK/da/find-pakke?match=',
        'GLS ParcelShop',
      ],
      [
        'DAO',
        'https://www.dao.as/privat/find-din-pakke?stregkode=',
        'DAO Pakkeshop',
      ],
      ['Bring', 'https://tracking.bring.dk/tracking/', 'Bring Hjemmelevering'],
    ] as const;
  const shipments = demoDataset(today)
    .orders.filter((o) => o.fulfilledAt && o.fulfilledAt.slice(0, 10) >= since)
    .flatMap((o, i) => {
      const [company, link, method] = carriers[i % carriers.length],
        shipped = Date.parse(o.fulfilledAt!),
        number = String(70000000 + Number(o.name.slice(1)) * 137);
      const pickup = !/Hjemmelevering/.test(method),
        at = (hours: number) =>
          new Date(shipped + hours * 3600000).toISOString();
      const age = (now - shipped) / 3600000,
        events: Array<{
          status: string;
          happenedAt: string;
          message: string | null;
        }> = [{ status: 'LABEL_PRINTED', happenedAt: at(0), message: null }];
      // Every fourth parcel shop parcel waits uncollected, so the return warning can be seen.
      const waiting = pickup && i % 4 !== 3 && i % 3 === 0;
      for (const [hours, status] of [
        [3, 'CARRIER_PICKED_UP'],
        [14, 'IN_TRANSIT'],
        [30, pickup ? 'READY_FOR_PICKUP' : 'OUT_FOR_DELIVERY'],
        [pickup ? 70 : 34, 'DELIVERED'],
      ] as const)
        if (age > hours && !(waiting && status === 'DELIVERED'))
          events.push({
            status,
            happenedAt: at(hours),
            message:
              status === 'READY_FOR_PICKUP'
                ? 'Pakken er klar til afhentning i ' +
                  method +
                  ', ' +
                  o.customer[3]
                : null,
          });
      const raw: RawOrder = {
        id: o.id,
        name: o.name,
        test: false,
        cancelledAt: null,
        shippingAddress: {
          name: o.customer[0],
          city: o.customer[3],
          countryCodeV2: 'DK',
        },
        shippingLine: { title: method, code: method },
        fulfillments: [
          {
            id:
              'gid://shopify/Fulfillment/' +
              (7100000 + Number(o.name.slice(1))),
            createdAt: o.fulfilledAt!,
            status: 'SUCCESS',
            displayStatus: events.at(-1)!.status,
            deliveredAt: null,
            inTransitAt: null,
            trackingInfo: [{ company, number, url: link + number }],
            events: { nodes: events },
          },
        ],
      };
      return orderShipments(raw);
    })
    .sort((a, b) => Date.parse(b.shippedAt) - Date.parse(a.shippedAt));
  return {
    checkedAt: new Date(now).toISOString(),
    days,
    since,
    truncated: false,
    shipments,
  };
}
export function demoInventory() {
  const rows: InventoryRow[] = demoProducts.map(
    (p) =>
      ({
        inventoryItemId: 'gid://shopify/InventoryItem/' + (61000 + p.id),
        locationId: 'gid://shopify/Location/1',
        product: p.title,
        variant: 'Default Title',
        sku: p.sku,
        quantity: p.stock,
        unitCostMinor: p.cost * 100,
        currency: 'DKK',
      }) as InventoryRow,
  );
  const totalValueMinor = inventoryValueMinor(rows),
    today = danishDate();
  // A fictional Dinero balance a little off, so the demo shows a difference to regulate.
  return {
    rows,
    locations: [{ id: 'gid://shopify/Location/1', name: 'Lager Aarhus' }],
    totalValueMinor,
    incomplete: [],
    company: {
      shops: 1,
      valueMinor: totalValueMinor,
      incomplete: 0,
      dkk: true,
    },
    dinero: {
      account: 5800,
      valueMinor: totalValueMinor - 124_550,
      from: today.slice(0, 4) + '-01-01',
      to: today,
    },
    fetchedAt: new Date().toISOString(),
  };
}
function feedProduct(p: (typeof demoProducts)[number]): {
  product: Product;
  variant: Variant;
} {
  const variant: Variant = {
    id: 'gid://shopify/ProductVariant/' + (62000 + p.id),
    barcode: '57' + String(10000000000 + p.id * 7919).slice(-11),
    title: 'Default Title',
    price: p.price.toFixed(2),
    compareAtPrice: p.compare ? p.compare.toFixed(2) : null,
    availableForSale: p.stock > 0,
    inventoryQuantity: p.stock,
    selectedOptions: [],
    image: null,
  };
  return {
    variant,
    product: {
      id: 'gid://shopify/Product/' + (63000 + p.id),
      status: 'ACTIVE',
      title: p.title,
      handle: p.title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, ''),
      descriptionHtml: `<p>${p.title} fra Demofirma. Fiktivt demoprodukt.</p>`,
      vendor: 'Demofirma',
      featuredImage: null,
      gender: null,
      productType: demoCollections[p.collection].title,
      variants: { nodes: [variant] },
    },
  };
}
/** The demo feed is built from the fictional catalogue instead of Shopify. */
export function demoFeed(config: {
  allProducts: boolean;
  collections: Array<{ id: string }>;
  products: Array<{ id: string }>;
  shippingCost: string;
  freeShippingFrom: string | null;
  deliveryTime: string;
  category: string;
}) {
  const chosen = demoProducts.filter(
    (p) =>
      config.allProducts ||
      config.collections.some(
        (c) => c.id === demoCollections[p.collection].id,
      ) ||
      config.products.some(
        (x) => x.id === 'gid://shopify/Product/' + (63000 + p.id),
      ),
  );
  const entries = chosen
    .map(feedProduct)
    .filter((x) => x.variant.availableForSale)
    .map(({ product, variant }) =>
      productXml(product, variant, PUBLIC_DOMAIN, {
        SHOPIFY_COLLECTION_TITLE: config.category || product.productType || '',
        SHIPPING_COST: config.shippingCost,
        FREE_SHIPPING_FROM:
          config.freeShippingFrom === null
            ? null
            : Number(config.freeShippingFrom),
        DELIVERY_TIME: config.deliveryTime,
      }),
    );
  return {
    xml: `<?xml version="1.0" encoding="UTF-8"?>\n<produkter>\n${entries.join('\n')}\n</produkter>\n`,
    count: entries.length,
  };
}

// ---------------------------------------------------------------- Tier 1-værn
// Reads served straight from the demo company's own rows; everything else is simulated or refused.
const databaseReads = new Set([
  '/runtime',
  '/admin/sync-status',
  '/notifications',
  '/dinero/accounts',
  '/dashboard/platform',
  '/shopify/packaging',
  '/invoices/sender',
  '/invoices/preview',
  '/invoices/settings',
  '/invoices/logo',
  '/shopify/orders',
  '/shopify/refunds',
  '/shopify/payouts',
  '/shopify/payments',
  '/refunds/overview',
  '/payouts/overview',
  '/sales/log',
  '/payouts/log',
  '/refunds/log',
  '/documents',
  '/invoices',
  '/invoices/pdf',
  '/flatpay/records',
  '/viabill/records',
  '/pensopay/records',
  '/order-refunds',
  '/order-refunds/credit-note',
  '/markets/settings',
  '/orders/detail',
  '/integrations',
  '/integrations/selection',
  '/admin/history',
  '/integrations/start-date',
  '/admin/settings',
  '/feeds',
  '/feeds/file-name',
  '/admin/errors',
  '/admin/insights',
]);
const databaseWrites: Array<[string, RegExp]> = [
  ['POST', /^\/admin\/settings$/],
  ['PUT', /^\/markets\/settings$/],
  ['PUT', /^\/invoices\/settings$/],
  ['POST', /^\/notifications$/],
  ['POST', /^\/integrations\/selection$/],
  ['POST', /^\/feeds$/],
  ['PUT', /^\/feeds\/[a-f0-9-]{36}$/],
  ['DELETE', /^\/feeds\/[a-f0-9-]{36}$/],
  ['POST', /^\/feeds\/[a-f0-9-]{36}\/(refresh|rotate)$/],
];
/** The demo shop's Shopify markets: Denmark (primary) and Sweden. */
export function demoMarkets() {
  return [
    {
      id: 'gid://shopify/Market/1001',
      name: 'Danmark',
      countries: ['DK'],
      currency: 'DKK',
      url: 'https://' + PUBLIC_DOMAIN.replace(/^https?:\/\//, ''),
      locale: 'da',
      primary: true,
    },
    {
      id: 'gid://shopify/Market/1002',
      name: 'Sverige',
      countries: ['SE'],
      currency: 'SEK',
      url:
        'https://' +
        PUBLIC_DOMAIN.replace(/^https?:\/\//, '').replace(/\.dk$/, '.se'),
      locale: 'sv',
      primary: false,
    },
  ];
}
export async function demoTier1(
  request: Request,
  path: string,
): Promise<Response | null> {
  const url = new URL(request.url),
    get = request.method === 'GET' || request.method === 'HEAD';
  if (get) {
    if (path === '/runtime')
      return reply({
        production: true,
        bookkeeping: true,
        customerEmail: true,
        demo: true,
      });
    if (path === '/dashboard/finance') return reply(demoFinance());
    if (path === '/dashboard/shop') return reply(demoShopFinance());
    if (path === '/dinero/suppliers')
      return reply({
        suppliers: suppliers.map(([id, name]) => ({
          id,
          name,
          country: 'DK',
          vatNumber: '',
        })),
        fetchedAt: new Date().toISOString(),
      });
    if (path === '/performance/finance' || path === '/performance/shop') {
      const year = Number(url.searchParams.get('year')),
        current = Number(danishDate().slice(0, 4));
      if (!Number.isInteger(year) || year < current - 9 || year > current)
        throw new HttpError(400, 'Vælg et af de seneste ti kalenderår.');
      return reply(
        demoPerformance(path.endsWith('finance') ? 'finance' : 'shop', year),
      );
    }
    if (path === '/performance/daily') {
      const year = Number(url.searchParams.get('year')),
        month = Number(url.searchParams.get('month')),
        today = danishDate();
      if (
        !Number.isInteger(year) ||
        !Number.isInteger(month) ||
        year < Number(today.slice(0, 4)) - 9 ||
        month < 1 ||
        month > 12 ||
        `${year}-${String(month).padStart(2, '0')}` > today.slice(0, 7)
      )
        throw new HttpError(400, 'Vælg en måned, der er begyndt.');
      return reply(demoDailySales(year, month, today));
    }
    if (path === '/shipments') {
      const days = Number(url.searchParams.get('days') || 30);
      if (![14, 30, 60].includes(days))
        throw new HttpError(400, 'Vælg 14, 30 eller 60 dage.');
      return reply(demoShipments(days));
    }
    if (path === '/shopify/inventory' && !url.searchParams.has('history'))
      return reply(demoInventory());
    if (path === '/emballage/products')
      return reply({
        writes: true,
        canWrite: true,
        products: demoProducts.map((p) => ({
          id: 'gid://shopify/Product/' + (63000 + p.id),
          title: p.title,
          status: 'ACTIVE',
          weightGrams: [6, 9, 12].includes(p.id)
            ? null
            : p.id === 4
              ? 0
              : Math.round(p.weight * 0.18),
          reportable:
            [6, 9, 12].includes(p.id) || p.id === 4 ? 'unknown' : 'yes',
          openLines: [6, 9, 12].includes(p.id) ? 3 : 0,
        })),
      });
    if (path === '/feeds/markets') return reply({ markets: demoMarkets() });
    if (path === '/feeds/catalog') {
      const q = (url.searchParams.get('q') || '').toLocaleLowerCase('da'),
        kind = url.searchParams.get('kind');
      const items =
        kind === 'collections'
          ? demoCollections
          : demoProducts.map((p) => ({
              id: 'gid://shopify/Product/' + (63000 + p.id),
              title: p.title,
            }));
      return reply({
        items: items.filter((i) => i.title.toLocaleLowerCase('da').includes(q)),
        nextCursor: null,
      });
    }
    if (
      databaseReads.has(path) ||
      path === '/shopify/inventory' ||
      /^\/feeds\/[a-f0-9-]{36}\/preview$/.test(path) ||
      (/^\/[a-z]+\/connection$/.test(path) && path !== '/emballage/connection')
    )
      return null;
    throw new HttpError(409, demoMessage);
  }
  if (path === '/shopify/orders')
    return reply({
      count: 0,
      synced: 0,
      invoicesCreated: 0,
      orders: [],
      hasNextPage: false,
      endCursor: null,
      warning: 'Demokonto: ordrerne er fiktive og hentes ikke fra Shopify.',
    });
  if (path === '/order-refunds/sync')
    return reply({ synced: 0, orders: 0, more: false });
  if (path === '/shopify/orders/process')
    return reply({
      status: 'completed',
      invoices: 0,
      booked: 0,
      drafts: 0,
      sent: 0,
      failed: 0,
    });
  if (
    databaseWrites.some(
      ([method, pattern]) => method === request.method && pattern.test(path),
    )
  )
    return null;
  throw new HttpError(409, demoMessage);
}
