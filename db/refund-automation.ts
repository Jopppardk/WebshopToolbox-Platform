import { env } from 'cloudflare:workers';
import { database } from './database';
import { loadCredentials } from './credentials';
import { getShopifyAccess } from './shopify';
import { readDineroAccounts } from './dinero-accounts';
import { dineroClient } from './dinero-client';
import { recordFailure } from './errors';
import { validateSettings } from '@/lib/admin-settings';
import { minorUnits } from '@/lib/shopify-payments';
import { refundVoucher, type RefundPart } from '@/lib/refund-voucher';
import {
  TransferError,
  verifyVoucher,
  type Voucher,
  type Expected,
} from '@/lib/dinero-sale';

type State = {
  phase: 'creating' | 'draft' | 'booking' | 'booked' | 'uncertain';
  version: string;
  updatedAt: string;
  externalId: string;
  organizationId: string;
  snapshot: { voucher: Voucher; expected: Expected };
  guid?: string;
  voucherNumber?: number;
  message?: string;
};
type Money = { amount: string; currencyCode: string };
type Refund = {
  id: string;
  processedAt: string;
  refundLineItems: {
    nodes: Array<{
      subtotalSet: { shopMoney: Money };
      totalTaxSet: { shopMoney: Money };
    }>;
  };
  refundShippingLines: {
    nodes: Array<{
      subtotalAmountSet: { shopMoney: Money };
      taxAmountSet: { shopMoney: Money };
    }>;
  };
  orderAdjustments: {
    nodes: Array<{
      amountSet: { shopMoney: Money };
      taxAmountSet: { shopMoney: Money };
    }>;
  };
  transactions: {
    nodes: Array<{
      id: string;
      kind: string;
      status: string;
      test: boolean;
      amountSet: { shopMoney: Money };
    }>;
  };
};
const tenant = 'sablen.dk',
  stateKey = (id: string) => `refund_production:${id}`,
  day = (v: string) =>
    new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Europe/Copenhagen',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date(v));
async function read(id: string) {
  const row = await database()
    .prepare(
      'SELECT setting_value FROM app_settings WHERE tenant=? AND setting_key=?',
    )
    .bind(tenant, stateKey(id))
    .first<{ setting_value: string }>();
  return row
    ? { raw: row.setting_value, state: JSON.parse(row.setting_value) as State }
    : null;
}
async function save(
  id: string,
  previous: Awaited<ReturnType<typeof read>>,
  value: Omit<State, 'version' | 'updatedAt'>,
) {
  const state = {
      ...value,
      version: crypto.randomUUID(),
      updatedAt: new Date().toISOString(),
    } as State,
    raw = JSON.stringify(state);
  const result = previous
    ? await database()
        .prepare(
          'UPDATE app_settings SET setting_value=?,updated_at=CURRENT_TIMESTAMP WHERE tenant=? AND setting_key=? AND setting_value=?',
        )
        .bind(raw, tenant, stateKey(id), previous.raw)
        .run()
    : await database()
        .prepare(
          'INSERT INTO app_settings(tenant,setting_key,setting_value) VALUES(?,?,?) ON CONFLICT DO NOTHING',
        )
        .bind(tenant, stateKey(id), raw)
        .run();
  return result.meta.changes === 1 ? { raw, state } : null;
}
async function details(
  orderId: string,
  sourceTransactionId: string,
  gross: number,
  currency: string,
) {
  const { shop, accessToken } = await getShopifyAccess();
  const response = await fetch(
    `https://${shop}/admin/api/2026-07/graphql.json`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Access-Token': accessToken,
      },
      body: JSON.stringify({
        query: `query RefundDetails($id:ID!){order(id:$id){refunds{id processedAt refundLineItems(first:100){nodes{subtotalSet{shopMoney{amount currencyCode}} totalTaxSet{shopMoney{amount currencyCode}}} pageInfo{hasNextPage}} refundShippingLines(first:100){nodes{subtotalAmountSet{shopMoney{amount currencyCode}} taxAmountSet{shopMoney{amount currencyCode}}} pageInfo{hasNextPage}} orderAdjustments(first:100){nodes{amountSet{shopMoney{amount currencyCode}} taxAmountSet{shopMoney{amount currencyCode}}} pageInfo{hasNextPage}} transactions(first:100){nodes{id kind status test amountSet{shopMoney{amount currencyCode}}} pageInfo{hasNextPage}}}}}`,
        variables: { id: orderId },
      }),
      redirect: 'manual',
      signal: AbortSignal.timeout(20000),
    },
  );
  const payload = (await response.json()) as {
    data?: {
      order?: {
        refunds: Array<
          Refund & {
            refundLineItems: {
              nodes: Refund['refundLineItems']['nodes'];
              pageInfo: { hasNextPage: boolean };
            };
            refundShippingLines: {
              nodes: Refund['refundShippingLines']['nodes'];
              pageInfo: { hasNextPage: boolean };
            };
            orderAdjustments: {
              nodes: Refund['orderAdjustments']['nodes'];
              pageInfo: { hasNextPage: boolean };
            };
            transactions: {
              nodes: Refund['transactions']['nodes'];
              pageInfo: { hasNextPage: boolean };
            };
          }
        >;
      };
    };
    errors?: Array<{ message: string }>;
  };
  if (!response.ok || payload.errors?.length)
    throw new TransferError(
      payload.errors?.[0]?.message ||
        'Shopify kunne ikke hente refunderingslinjerne.',
    );
  const matches = (payload.data?.order?.refunds || []).filter((refund) =>
    refund.transactions.nodes.some(
      (transaction) =>
        transaction.id === sourceTransactionId &&
        transaction.kind === 'REFUND' &&
        transaction.status === 'SUCCESS' &&
        !transaction.test,
    ),
  );
  if (matches.length !== 1)
    throw new TransferError(
      'Shopify-refunderingen kunne ikke knyttes entydigt til betalingstransaktionen.',
    );
  const refund = matches[0];
  if (
    refund.refundLineItems.pageInfo.hasNextPage ||
    refund.refundShippingLines.pageInfo.hasNextPage ||
    refund.orderAdjustments.pageInfo.hasNextPage ||
    refund.transactions.pageInfo.hasNextPage
  )
    throw new TransferError(
      'Refunderingen er for stor til én sikker bogføring.',
    );
  const transaction = refund.transactions.nodes.find(
    (item) => item.id === sourceTransactionId,
  )!;
  if (
    transaction.amountSet.shopMoney.currencyCode !== currency ||
    Math.abs(minorUnits(transaction.amountSet.shopMoney.amount, currency)) !==
      gross
  )
    throw new TransferError(
      'Shopify-transaktionen stemmer ikke med tilbagebetalingen.',
    );
  const parts: RefundPart[] = [];
  const add = (kind: RefundPart['kind'], net: Money, tax: Money) => {
    if (net.currencyCode !== currency || tax.currencyCode !== currency)
      throw new TransferError('Refunderingen indeholder flere valutaer.');
    const n = Math.abs(minorUnits(net.amount, currency)),
      t = Math.abs(minorUnits(tax.amount, currency));
    if (n || t) parts.push({ kind, net: n, tax: t, description: kind });
  };
  refund.refundLineItems.nodes.forEach((x) =>
    add('goods', x.subtotalSet.shopMoney, x.totalTaxSet.shopMoney),
  );
  refund.refundShippingLines.nodes.forEach((x) =>
    add('shipping', x.subtotalAmountSet.shopMoney, x.taxAmountSet.shopMoney),
  );
  refund.orderAdjustments.nodes.forEach((x) =>
    add('services', x.amountSet.shopMoney, x.taxAmountSet.shopMoney),
  );
  return { parts, date: day(refund.processedAt) };
}
async function processRefund(
  row: {
    external_id: string;
    amount_minor: number;
    currency: string;
    payload_json: string;
  },
  credentials: Record<string, string>,
) {
  let current = await read(row.external_id);
  try {
    const item = JSON.parse(row.payload_json);
    if (
      row.currency !== 'DKK' ||
      row.amount_minor >= 0 ||
      !item.associatedOrder?.id ||
      !item.sourceOrderTransactionId
    )
      throw new TransferError(
        'Tilbagebetalingen mangler sikre Shopify-kontroldata.',
      );
    const setting = await database()
      .prepare(
        "SELECT setting_value FROM app_settings WHERE tenant=? AND setting_key='admin_settings'",
      )
      .bind(tenant)
      .first<{ setting_value: string }>();
    if (!setting)
      throw new TransferError('Gem refunderingskontiene under Indstillinger.');
    const settings = validateSettings(JSON.parse(setting.setting_value)),
      book = settings.automation.refundsBookDinero;
    if (current?.state.phase === 'booked') {
      await database()
        .prepare(
          "UPDATE integration_records SET booking_status='booked' WHERE tenant=? AND record_type='refund' AND external_id=?",
        )
        .bind(tenant, row.external_id)
        .run();
      return true;
    }
    if (current && current.state.phase !== 'draft')
      throw new TransferError(
        'Tilbagebetalingen har en igangværende eller usikker Dinero-status. Kontrollér Dinero og fejloversigten før et nyt forsøg.',
      );
    if (current && !book) return true;
    const detail = await details(
        item.associatedOrder.id,
        item.sourceOrderTransactionId,
        Math.abs(row.amount_minor),
        row.currency,
      ),
      proposal = refundVoucher(
        {
          transactionId: row.external_id,
          orderName: item.associatedOrder.name,
          date: detail.date,
          gross: Math.abs(row.amount_minor),
          parts: detail.parts,
        },
        settings.accounts,
      );
    const chart = await readDineroAccounts(credentials);
    for (const number of new Set(proposal.accounts)) {
      const account = chart.find(
        (entry) => Number(entry.number) === number && !entry.hidden,
      );
      if (!account)
        throw new TransferError(
          `Konto ${number} findes ikke som aktiv konto i Dinero.`,
        );
    }
    const client = await dineroClient(credentials);
    if (!current) {
      current = await save(row.external_id, null, {
        phase: 'creating',
        externalId: row.external_id,
        organizationId: credentials.organizationId,
        snapshot: { voucher: proposal.voucher, expected: proposal.expected },
      });
      if (!current) return false;
      const raw = (await client(
        'vouchers/manuel',
        'POST',
        proposal.voucher,
      )) as { Guid?: string };
      if (
        raw.Guid &&
        /^[\da-f]{8}(-[\da-f]{4}){3}-[\da-f]{12}$/i.test(raw.Guid)
      ) {
        const saved = await save(row.external_id, current, {
          ...current.state,
          guid: raw.Guid,
        });
        if (!saved)
          throw new TransferError(
            'Refunderingsstatus blev ændret under oprettelsen.',
          );
        current = saved;
      }
      const draft = verifyVoucher(raw, proposal.voucher, proposal.expected);
      if (draft.Status !== 'Draft' || !current.state.guid)
        throw new TransferError('Dinero bekræftede ikke refunderingskladden.');
      current = (await save(row.external_id, current, {
        ...current.state,
        phase: 'draft',
      }))!;
      if (!book) return true;
    }
    if (!current.state.guid)
      throw new TransferError('Refunderingskladdens ID mangler.');
    const before = verifyVoucher(
      await client(`vouchers/manuel/${current.state.guid}`, 'GET'),
      current.state.snapshot.voucher,
      current.state.snapshot.expected,
    );
    current = (await save(row.external_id, current, {
      ...current.state,
      phase: 'booking',
    }))!;
    const booked = verifyVoucher(
      await client(`vouchers/manuel/${before.Guid}/book`, 'POST', {
        Timestamp: before.Timestamp,
      }),
      current.state.snapshot.voucher,
      current.state.snapshot.expected,
    );
    if (booked.Status !== 'Booked')
      throw new TransferError(
        'Dinero bekræftede ikke refunderingsbogføringen.',
      );
    await save(row.external_id, current, {
      ...current.state,
      phase: 'booked',
      voucherNumber: booked.VoucherNumber,
    });
    await database()
      .prepare(
        "UPDATE integration_records SET booking_status='booked' WHERE tenant=? AND record_type='refund' AND external_id=?",
      )
      .bind(tenant, row.external_id)
      .run();
    return true;
  } catch (error) {
    if (current)
      try {
        await save(row.external_id, current, {
          ...current.state,
          phase: 'uncertain',
          message: error instanceof Error ? error.message : 'Ukendt fejl',
        });
      } catch {}
    await recordFailure('Dinero · automatisk tilbagebetaling');
    return false;
  }
}
export async function runRefundAutomation() {
  const runtime = env as unknown as {
    DINERO_REFUND_WRITES_ENABLED?: string;
    DINERO_REFUND_AUTOMATION_ENABLED?: string;
  };
  if (
    runtime.DINERO_REFUND_WRITES_ENABLED !== 'true' ||
    runtime.DINERO_REFUND_AUTOMATION_ENABLED !== 'true'
  )
    return {
      status: 'skipped' as const,
      message: 'Tilbagebetalingsautomatikken er deaktiveret i driftsmiljøet.',
    };
  const setting = await database()
    .prepare(
      "SELECT setting_value FROM app_settings WHERE tenant=? AND setting_key='admin_settings'",
    )
    .bind(tenant)
    .first<{ setting_value: string }>();
  const automation = setting
    ? validateSettings(JSON.parse(setting.setting_value)).automation
    : null;
  if (automation?.refunds !== true)
    return {
      status: 'skipped' as const,
      message: 'Tilbagebetalingsautomatikken er fravalgt under Indstillinger.',
    };
  const start = await database()
    .prepare(
      "SELECT setting_value FROM app_settings WHERE tenant=? AND setting_key='refund_automation_started_at'",
    )
    .bind(tenant)
    .first<{ setting_value: string }>();
  if (!start)
    return {
      status: 'skipped' as const,
      message: 'Tilbagebetalingsautomatikken mangler en sikker startdato.',
    };
  const credentials = await loadCredentials('dinero', true);
  if (!credentials?.organizationId)
    throw new Error('Dinero-forbindelsen mangler.');
  const rows = await database()
    .prepare(
      `SELECT r.external_id,r.amount_minor,r.currency,r.payload_json FROM integration_records r
       LEFT JOIN app_settings s ON s.tenant=r.tenant AND s.setting_key='refund_production:'||r.external_id
       WHERE r.tenant=? AND r.record_type='refund' AND r.occurred_at>=? AND r.booking_status!='booked'
       AND (s.setting_key IS NULL OR (?=1 AND json_extract(s.setting_value,'$.phase')='draft'))
       ORDER BY r.occurred_at ASC, r.external_id ASC LIMIT 5`,
    )
    .bind(tenant, start.setting_value, automation.refundsBookDinero ? 1 : 0)
    .all<{
      external_id: string;
      amount_minor: number;
      currency: string;
      payload_json: string;
    }>();
  let completed = 0,
    failed = 0;
  for (const row of rows.results) {
    const state = await read(row.external_id);
    if (state?.state.phase === 'draft' && !automation.refundsBookDinero) continue;
    if (await processRefund(row, credentials)) completed++;
    else failed++;
  }
  if (failed)
    throw new Error(
      `${failed} tilbagebetalinger kunne ikke overføres; ${completed} blev gennemført.`,
    );
  return {
    status: 'succeeded' as const,
    message: completed
      ? `${completed} tilbagebetalinger blev ${automation.refundsBookDinero ? 'bogført' : 'oprettet som kladde'}.`
      : `Ingen nye tilbagebetalinger ventede på ${automation.refundsBookDinero ? 'bogføring' : 'kladdeoprettelse'}.`,
  };
}

export async function runSingleRefund(externalId: string) {
  const runtime = env as unknown as { DINERO_REFUND_WRITES_ENABLED?: string };
  if (runtime.DINERO_REFUND_WRITES_ENABLED !== 'true')
    throw new TransferError(
      'Overførsel af tilbagebetalinger til Dinero er deaktiveret.',
    );
  const row = await database()
    .prepare(
      "SELECT external_id,amount_minor,currency,payload_json FROM integration_records WHERE tenant=? AND record_type='refund' AND external_id=?",
    )
    .bind(tenant, externalId)
    .first<{
      external_id: string;
      amount_minor: number;
      currency: string;
      payload_json: string;
    }>();
  if (!row) throw new TransferError('Tilbagebetalingen findes ikke.');
  const credentials = await loadCredentials('dinero', true);
  if (!credentials?.organizationId)
    throw new TransferError('Dinero-forbindelsen mangler.');
  const ok = await processRefund(row, credentials);
  if (!ok)
    throw new TransferError(
      'Tilbagebetalingen kunne ikke overføres. Se fejloversigten, og kontrollér Dinero før et nyt forsøg.',
    );
  const state = await read(externalId);
  return {
    message:
      state?.state.phase === 'booked'
        ? 'Tilbagebetalingen er bogført i Dinero.'
        : 'Tilbagebetalingen er oprettet som kladde i Dinero.',
  };
}
