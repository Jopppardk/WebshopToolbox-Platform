import { TransferError } from './dinero-sale';
import { asText } from './tier1/src/lib/format';
import {
  handleProductionBooking,
  type BookingContext,
  type PreparedBooking,
} from './production-booking';
import { bookingDate } from './production-policy';
import { shopAccess, orderQuery } from './invoice-source';
import { readDineroAccounts } from './dinero-read';
import { payoutBreakdown, payoutSummaryFields } from './payout-calculations';
import { fetchPayoutTransactions } from './payout-source';
import { buildPayoutReport } from './payout-pdf';
import { minorUnits } from './money';
import { refundVoucher, type RefundPart } from './refund-voucher';
import { flatpayDraft } from './flatpay-draft';
import { readFlatpayPayout } from './flatpay-payout';
import { existingPayoutReport, registerPayoutReport } from './documents';
import { buildFlatpayReport } from './flatpay-report';
import {
  readOrderRefunds,
  saleBookedSql,
  type OrderRefund,
} from './order-refunds';
import { ensureCreditNote } from './credit-notes';
import {
  paymentVoucher,
  readOrderPayments,
  type OrderPayment,
} from './order-payments';
import { foreignHold, isForeignOrder } from './order-markets';
import { HttpError, type Actor, type PlatformEnv } from './types';
const fail = (message: string): never => {
  throw new HttpError(409, message);
};
const num = (value: unknown) => {
  const n = Number(asText(value || '').match(/^\d+/)?.[0]);
  if (!Number.isSafeInteger(n) || n <= 0)
    fail('Vælg gyldige konti i kontoplanen.');
  return n;
};
async function chartFor(ctx: BookingContext, accounts: number[]) {
  const chart = await readDineroAccounts(ctx.credentials);
  if (
    new Set(accounts).size !== accounts.length ||
    accounts.some(
      (n) =>
        !chart.some((a) => Number(a.number) === n && !a.hidden && !a.vatCode),
    )
  )
    fail('Kontiene skal være forskellige, aktive og uden moms i Dinero.');
  return chart;
}
// One report per payout: reuse the one on Udbetalingsrapporter, or store this one and register it there.
async function reportFile(
  ctx: BookingContext,
  externalId: string,
  source: unknown,
  bytes: () => Promise<Uint8Array>,
) {
  const shown = await existingPayoutReport(
    ctx.env,
    ctx.company,
    ctx.shop,
    externalId,
  );
  const reused = shown
    ? await ctx.env.PLATFORM_DOCUMENTS.get(shown.r2_key)
    : null;
  if (shown && reused && reused.size <= 6000000)
    return { file: reused, pdfKey: shown.r2_key, pdfEtag: reused.etag };
  const digest = Array.from(
    new Uint8Array(
      await crypto.subtle.digest(
        'SHA-256',
        new TextEncoder().encode(JSON.stringify(source)),
      ),
    ),
    (x) => x.toString(16).padStart(2, '0'),
  ).join('');
  const key = `companies/${ctx.company}/webshops/${ctx.shop}/production-reports/${digest}.pdf`;
  let file = await ctx.env.PLATFORM_DOCUMENTS.get(key);
  if (!file) {
    await ctx.env.PLATFORM_DOCUMENTS.put(key, await bytes(), {
      httpMetadata: { contentType: 'application/pdf' },
    });
    file = await ctx.env.PLATFORM_DOCUMENTS.get(key);
  }
  if (!file || file.size > 6000000)
    fail('Bilagsrapporten kunne ikke gemmes og kontrolleres.');
  await registerPayoutReport(
    ctx.env,
    ctx.company,
    ctx.shop,
    externalId,
    key,
    source,
  );
  return { file: file!, pdfKey: key, pdfEtag: file!.etag };
}
async function payout(ctx: BookingContext): Promise<PreparedBooking> {
  const { env, company, shop, id } = ctx,
    access = await shopAccess(env, company, shop);
  const result = await orderQuery<{ node: any }>(
    access,
    `query ToolboxProductionPayout($id:ID!){node(id:$id){... on ShopifyPaymentsPayout{id issuedAt status transactionType net{amount currencyCode} summary{${payoutSummaryFields.map((f) => f + '{amount currencyCode}').join(' ')}}}}}`,
    { id },
  );
  const p = result.node;
  if (
    p?.id !== id ||
    p.status !== 'PAID' ||
    p.transactionType !== 'DEPOSIT' ||
    p.net?.currencyCode !== 'DKK'
  )
    fail('Kun gennemførte Shopify Payments-udbetalinger i DKK kan bogføres.');
  const date = await bookingDate(env, company, shop, 'shopify', p.issuedAt),
    b = payoutBreakdown(p.summary, p.net);
  if (b.net <= 0) fail('Udbetalingen skal være positiv.');
  const a = JSON.parse(ctx.mapping.accounts_json),
    prefs = JSON.parse(ctx.prefs.preferences_json).automation;
  const bank = num(a.bank),
    clearing = num(a.clearing),
    gateway = num(a.shopifyPaymentsClearing),
    fees = num(a.fees);
  await chartFor(ctx, [bank, clearing, gateway, fees]);
  const movements = [
    {
      label: 'Betalinger',
      amount: b.charges,
      account: gateway,
      balancing: clearing,
    },
    {
      label: 'Refunderinger',
      amount: b.refunds,
      account: gateway,
      balancing: clearing,
    },
    { label: 'Gebyrer', amount: b.fees, account: fees, balancing: gateway },
    { label: 'Udbetaling', amount: b.net, account: bank, balancing: gateway },
  ].filter((x) => x.amount);
  const voucher = {
    VoucherDate: date,
    ExternalReference: `wtb:${shop}:payout:${id.split('/').pop()}`,
    Lines: movements.map((x) => ({
      Description: `Shopify ${id.split('/').pop()} - ${x.label}`,
      AccountNumber: x.account,
      BalancingAccountNumber: x.balancing,
      Amount: x.amount / 100,
      AccountVatCode: 'none',
      BalancingAccountVatCode: 'none',
    })),
  };
  const source = {
    ...p,
    provider: 'shopify_payments',
    transactions: await fetchPayoutTransactions(id, 'DKK', b.net, access),
  };
  const companyRow = await env.PLATFORM_DB.prepare(
    'SELECT name FROM companies WHERE id=?',
  )
    .bind(company)
    .first<{ name: string }>();
  const report = await reportFile(ctx, id, source, () =>
    buildPayoutReport(source, companyRow!.name, undefined, ctx.webshopName),
  );
  return {
    file: prefs.attachments ? report.file : undefined,
    snapshot: {
      voucher,
      expected: movements.map((x) => ({
        net: x.amount,
        tax: 0,
        gross: x.amount,
      })),
      source,
      pdfKey: report.pdfKey,
      pdfEtag: report.pdfEtag,
      book: prefs.payoutsBookDinero === true,
      attach: prefs.attachments === true,
    },
  };
}
async function refund(ctx: BookingContext): Promise<PreparedBooking> {
  const { env, company, shop, id } = ctx,
    access = await shopAccess(env, company, shop);
  const result = await orderQuery<{ node: any }>(
    access,
    'query ToolboxProductionRefund($id:ID!){node(id:$id){... on ShopifyPaymentsBalanceTransaction{id type test transactionDate amount{amount currencyCode} associatedOrder{id name} sourceOrderTransactionId}}}',
    { id },
  );
  const item = result.node;
  if (
    item?.id !== id ||
    item.type !== 'REFUND' ||
    item.test ||
    item.amount?.currencyCode !== 'DKK' ||
    !item.associatedOrder?.id ||
    !item.sourceOrderTransactionId
  )
    fail('Refunderingen mangler sikre Shopify-kontroldata.');
  const gross = -minorUnits(item.amount.amount, 'DKK');
  if (gross <= 0) fail('Ugyldigt refunderingsbeløb.');
  const sourceId = String(item.sourceOrderTransactionId);
  if (
    !/^\d{1,30}$/.test(sourceId) ||
    (typeof item.sourceOrderTransactionId === 'number' &&
      !Number.isSafeInteger(item.sourceOrderTransactionId))
  )
    fail('Ugyldigt kilde-ID på refunderingen.');
  const transactionId = 'gid://shopify/OrderTransaction/' + sourceId;
  const details = await orderQuery<{ order: any }>(
    access,
    `query ToolboxRefundDetails($id:ID!){order(id:$id){refunds{id processedAt refundLineItems(first:100){nodes{subtotalSet{shopMoney{amount currencyCode}} totalTaxSet{shopMoney{amount currencyCode}}} pageInfo{hasNextPage}} refundShippingLines(first:100){nodes{subtotalAmountSet{shopMoney{amount currencyCode}} taxAmountSet{shopMoney{amount currencyCode}}} pageInfo{hasNextPage}} orderAdjustments(first:100){nodes{amountSet{shopMoney{amount currencyCode}} taxAmountSet{shopMoney{amount currencyCode}}} pageInfo{hasNextPage}} transactions(first:100){nodes{id kind status test amountSet{shopMoney{amount currencyCode}}} pageInfo{hasNextPage}}}}}`,
    { id: item.associatedOrder.id },
  );
  const matches = (details.order?.refunds || []).filter((r: any) =>
    r.transactions?.nodes?.some(
      (t: any) =>
        t.id === transactionId &&
        t.kind === 'REFUND' &&
        t.status === 'SUCCESS' &&
        !t.test,
    ),
  );
  if (matches.length !== 1)
    fail('Refunderingen kan ikke knyttes entydigt til ordren.');
  const r = matches[0];
  // Refunds are now booked per order (order_refund); never book the same refund through both.
  if (
    await env.PLATFORM_DB.prepare(
      "SELECT 1 FROM production_receipts WHERE company_id=? AND webshop_id=? AND provider='shopify' AND module='order_refunds' AND external_id=? AND phase<>'prepared'",
    )
      .bind(company, shop, r.id)
      .first()
  )
    fail(
      'Tilbagebetalingen er allerede bogført under Tilbagebetalinger → Ordrer.',
    );
  for (const field of [
    'refundLineItems',
    'refundShippingLines',
    'orderAdjustments',
    'transactions',
  ])
    if (
      !Array.isArray(r[field]?.nodes) ||
      r[field].pageInfo?.hasNextPage !== false
    )
      fail('Refunderingen er ufuldstændig.');
  const transaction = r.transactions.nodes.find(
    (t: any) => t.id === transactionId,
  );
  if (
    transaction.amountSet?.shopMoney?.currencyCode !== 'DKK' ||
    Math.abs(minorUnits(transaction.amountSet.shopMoney.amount, 'DKK')) !==
      gross
  )
    fail('Transaktionen stemmer ikke med refunderingen.');
  const parts: RefundPart[] = [];
  const add = (kind: RefundPart['kind'], net: any, tax: any) => {
    if (net?.currencyCode !== 'DKK' || tax?.currencyCode !== 'DKK')
      fail('Uventet valuta.');
    const n = Math.abs(minorUnits(net.amount, 'DKK')),
      t = Math.abs(minorUnits(tax.amount, 'DKK'));
    if (n || t) parts.push({ kind, net: n, tax: t, description: kind });
  };
  r.refundLineItems.nodes.forEach((x: any) =>
    add('goods', x.subtotalSet.shopMoney, x.totalTaxSet.shopMoney),
  );
  r.refundShippingLines.nodes.forEach((x: any) =>
    add('shipping', x.subtotalAmountSet.shopMoney, x.taxAmountSet.shopMoney),
  );
  r.orderAdjustments.nodes.forEach((x: any) =>
    add('services', x.amountSet.shopMoney, x.taxAmountSet.shopMoney),
  );
  const date = await bookingDate(env, company, shop, 'shopify', r.processedAt),
    mapping = JSON.parse(ctx.mapping.accounts_json);
  mapping.vatCode = String(mapping.vatCode || '').split(' ')[0];
  mapping.noVatCode = String(mapping.noVatCode || '')
    .split(' ')[0]
    .toLowerCase();
  if (
    (parts.some((p) => p.tax > 0) && mapping.vatCode !== 'U25') ||
    (parts.some((p) => p.tax === 0) && mapping.noVatCode !== 'none')
  )
    fail('Vælg U25 og eksplicit ingen moms til refunderingerne.');
  const proposal = refundVoucher(
    {
      transactionId: id,
      orderName: item.associatedOrder.name,
      date,
      gross,
      parts,
    },
    mapping,
  );
  const chart = await readDineroAccounts(ctx.credentials);
  for (const line of proposal.voucher.Lines) {
    const account = chart.find(
      (a) => Number(a.number) === line.AccountNumber && !a.hidden,
    );
    if (
      !account ||
      (account.vatCode || 'none').toLowerCase() !==
        line.AccountVatCode.toLowerCase()
    )
      fail('Refunderingskonto eller momskode stemmer ikke med Dinero.');
  }
  proposal.voucher.ExternalReference = `wtb:${shop}:refund:${id.split('/').pop()}`;
  return {
    snapshot: {
      voucher: proposal.voucher,
      expected: proposal.expected,
      source: { item, refund: r },
      book:
        JSON.parse(ctx.prefs.preferences_json).automation.refundsBookDinero ===
        true,
    },
  };
}
// A refund of a Shopify order, whatever the gateway: credits the clearing account (also for an order on payment
// terms, whose payments were moved from the receivables account to the bank or the clearing account),
// against the refund accounts per line, with the refund's credit note attached when the order was invoiced.
async function orderRefund(ctx: BookingContext): Promise<PreparedBooking> {
  const { env, company, shop, id } = ctx,
    db = env.PLATFORM_DB,
    stored = JSON.parse(ctx.sourceRow.payload_json) as OrderRefund;
  if (await isForeignOrder(db, company, shop, stored.orderId))
    fail(foreignHold);
  const legacy = await db
    .prepare(
      "SELECT 1 FROM production_receipts WHERE company_id=? AND webshop_id=? AND provider='shopify' AND module='refunds' AND phase<>'prepared' AND json_extract(payload_json,'$.source.refund.id')=?",
    )
    .bind(company, shop, id)
    .first();
  if (legacy)
    fail(
      'Tilbagebetalingen er allerede bogført som Shopify Payments-tilbagebetaling.',
    );
  // The refund credits the clearing account the sale debited, so the sale must be in Dinero first.
  if (
    !(await db
      .prepare(
        'SELECT 1 FROM order_refunds s WHERE s.company_id=? AND s.webshop_id=? AND s.external_id=? AND ' +
          saleBookedSql,
      )
      .bind(company, shop, id)
      .first())
  )
    fail(
      'Salget på ordren er ikke bogført endnu. Tilbagebetalingen bogføres, når salget er bogført.',
    );
  // Always booked from Shopify's current data, never from the stored copy alone.
  const r = (
    await readOrderRefunds(await shopAccess(env, company, shop), stored.orderId)
  ).find((x) => x.id === id);
  if (!r) fail('Tilbagebetalingen findes ikke længere på ordren i Shopify.');
  if (r!.problem) fail(r!.problem!);
  if (r!.currency !== 'DKK')
    fail(
      'Tilbagebetalinger i andre valutaer end DKK bogføres ikke automatisk.',
    );
  const parts: RefundPart[] = r!.lines.map((l) => ({
    kind: l.kind,
    net: l.net,
    tax: l.tax,
    description: l.title,
  }));
  const date = await bookingDate(env, company, shop, 'shopify', r!.processedAt),
    mapping = JSON.parse(ctx.mapping.accounts_json);
  mapping.vatCode = String(mapping.vatCode || '').split(' ')[0];
  mapping.noVatCode = String(mapping.noVatCode || '')
    .split(' ')[0]
    .toLowerCase();
  if (
    (parts.some((p) => p.tax !== 0) && mapping.vatCode !== 'U25') ||
    (parts.some((p) => p.tax === 0) && mapping.noVatCode !== 'none')
  )
    fail('Vælg U25 og eksplicit ingen moms til refunderingerne.');
  const proposal = refundVoucher(
    {
      transactionId: id,
      orderName: r!.orderName,
      date,
      gross: r!.gross,
      parts,
    },
    mapping,
  );
  const chart = await readDineroAccounts(ctx.credentials);
  for (const line of proposal.voucher.Lines) {
    const account = chart.find(
      (a) => Number(a.number) === line.AccountNumber && !a.hidden,
    );
    if (
      !account ||
      (account.vatCode || 'none').toLowerCase() !==
        line.AccountVatCode.toLowerCase()
    )
      fail('Refunderingskonto eller momskode stemmer ikke med Dinero.');
  }
  proposal.voucher.ExternalReference = `wtb:${shop}:orderrefund:${id.split('/').pop()}`;
  const automation = JSON.parse(ctx.prefs.preferences_json).automation,
    attach = automation.attachments === true;
  const note = attach ? await ensureCreditNote(env, company, shop, r!) : null;
  if (note && note.file.size > 6000000)
    fail('Kreditnotaen er for stor til Dinero.');
  return {
    file: note?.file,
    snapshot: {
      attach,
      voucher: proposal.voucher,
      expected: proposal.expected,
      source: { refund: r },
      creditNote: note
        ? {
            id: note.id,
            number: note.number,
            pdfKey: note.key,
            pdfEtag: note.file.etag,
          }
        : null,
      book: automation.refundsBookDinero === true,
    },
  };
}
// A payment of an order sold on payment terms (B2B invoice): from the receivables account the sale debited, to the
// bank (manual payment such as a bank transfer) or to the clearing account (a gateway, whose payout clears it).
async function orderPayment(ctx: BookingContext): Promise<PreparedBooking> {
  const { env, company, shop, id } = ctx,
    db = env.PLATFORM_DB,
    stored = JSON.parse(ctx.sourceRow.payload_json) as OrderPayment;
  if (await isForeignOrder(db, company, shop, stored.orderId))
    fail(foreignHold);
  const sale = await db
    .prepare(
      "SELECT json_extract(payload_json,'$.receivable.account') account FROM production_receipts WHERE company_id=? AND webshop_id=? AND provider='shopify' AND module='orders' AND external_id=? AND phase IN ('draft','booking','booked')",
    )
    .bind(company, shop, stored.orderId)
    .first<{ account: string | null }>();
  if (!sale?.account)
    fail(
      'Salget på ordren er ikke bogført på debitorkontoen. Betalingen bogføres, når salget er bogført.',
    );
  // Always booked from Shopify's current data, never from the stored copy alone.
  const p = (
    await readOrderPayments(
      await shopAccess(env, company, shop),
      stored.orderId,
    )
  ).find((x) => x.id === id);
  if (!p) fail('Betalingen findes ikke længere på ordren i Shopify.');
  const date = await bookingDate(env, company, shop, 'shopify', p!.processedAt);
  let proposal: ReturnType<typeof paymentVoucher>;
  try {
    proposal = paymentVoucher(
      p!,
      date,
      sale!.account!,
      JSON.parse(ctx.mapping.accounts_json),
    );
  } catch (error) {
    if (error instanceof TransferError) throw new HttpError(409, error.message);
    throw error;
  }
  await chartFor(ctx, proposal.accounts);
  proposal.voucher.ExternalReference = `wtb:${shop}:orderpayment:${id.split('/').pop()}`;
  return {
    snapshot: {
      voucher: proposal.voucher,
      expected: proposal.expected,
      source: { payment: p },
      book:
        JSON.parse(ctx.prefs.preferences_json).automation.salesBookDinero ===
        true,
    },
  };
}
async function flatpay(ctx: BookingContext): Promise<PreparedBooking> {
  const { env, company, shop, id } = ctx,
    saved = JSON.parse(ctx.sourceRow.payload_json);
  const {
    connection,
    payment: p,
    settlements,
    source,
  } = await readFlatpayPayout(env, company, shop, id, saved.settlements);
  const date = await bookingDate(
    env,
    company,
    shop,
    'flatpay',
    String(p.paidDate),
  );
  if (date < connection.start_date)
    fail('Udbetalingen er ændret. Hent den igen.');
  const a = JSON.parse(ctx.mapping.accounts_json),
    accounts = {
      bank: num(a.bank),
      fees: num(a.fees),
      clearing: num(a.clearing),
      flatpay: num(a.flatpayClearing),
    };
  await chartFor(ctx, Object.values(accounts));
  let proposal: ReturnType<typeof flatpayDraft>;
  try {
    proposal = flatpayDraft(p, settlements, accounts);
  } catch (error) {
    // The voucher check explains what does not add up; show it rather than an unexpected error.
    if (error instanceof TransferError) throw new HttpError(409, error.message);
    throw error;
  }
  proposal.voucher.VoucherDate = date;
  proposal.voucher.ExternalReference = `wtb:${shop}:flatpay:${id}`;
  const companyRow = await env.PLATFORM_DB.prepare(
    'SELECT name FROM companies WHERE id=?',
  )
    .bind(company)
    .first<{ name: string }>();
  const report = await reportFile(ctx, 'flatpay:' + id, source, () =>
    buildFlatpayReport(source, undefined, companyRow!.name, ctx.webshopName),
  );
  const attach =
    JSON.parse(ctx.prefs.preferences_json).automation.attachments === true;
  return {
    file: attach ? report.file : undefined,
    snapshot: {
      attach,
      voucher: proposal.voucher,
      expected: proposal.expected,
      source,
      pdfKey: report.pdfKey,
      pdfEtag: report.pdfEtag,
      paymentRevision: connection.revision,
      book:
        JSON.parse(ctx.prefs.preferences_json).automation.payoutsBookDinero ===
        true,
    },
  };
}
export function handleProductionOther(
  request: Request,
  env: PlatformEnv,
  actor: Actor,
  company: string,
  shop: string,
  kind: string,
) {
  if (kind === 'payout')
    return handleProductionBooking(
      request,
      env,
      actor,
      company,
      shop,
      kind,
      'payouts',
      'shopify',
      /^gid:\/\/shopify\/ShopifyPaymentsPayout\/\d{1,30}$/,
      payout,
    );
  if (kind === 'refund')
    return handleProductionBooking(
      request,
      env,
      actor,
      company,
      shop,
      kind,
      'refunds',
      'shopify',
      /^gid:\/\/shopify\/ShopifyPaymentsBalanceTransaction\/\d{1,30}$/,
      refund,
    );
  if (kind === 'order_refund')
    return handleProductionBooking(
      request,
      env,
      actor,
      company,
      shop,
      kind,
      'order_refunds',
      'shopify',
      /^gid:\/\/shopify\/Refund\/\d{1,30}$/,
      orderRefund,
    );
  if (kind === 'order_payment')
    return handleProductionBooking(
      request,
      env,
      actor,
      company,
      shop,
      kind,
      'order_payments',
      'shopify',
      /^gid:\/\/shopify\/OrderTransaction\/\d{1,30}$/,
      orderPayment,
    );
  if (kind === 'flatpay')
    return handleProductionBooking(
      request,
      env,
      actor,
      company,
      shop,
      kind,
      'payments',
      'flatpay',
      /^\d{1,30}$/,
      flatpay,
    );
  throw new HttpError(400, 'Ukendt bogføringstype.');
}
