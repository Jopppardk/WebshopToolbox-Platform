// Payment provider records (Flatpay, ViaBill, Pensopay) and the payment, refund and payout overviews.
// Part of the Tier 1 data API (tier1-data.ts); called for paths of a connected webshop.
import { asText } from './tier1/src/lib/format';
import { payoutStatusLabel } from './tier1/src/lib/payout-status';
import { bookingStatuses } from './booking-onboarding';
import { flatpayRefund } from './flatpay-refunds';
import { jsonBody } from './invitations';
import { handleOperations } from './operations';
import { handlePayments } from './payments';
import { dataCutoff, dataStartDate } from './tier1-history';
import { HttpError, reply } from './types';
import {
  type DataContext,
  forwarded,
  minor,
  pageNumber,
} from './tier1-data-shared';

export async function providerRecordData({
  request,
  env,
  actor,
  company,
  shop,
  path,
  db,
  url,
  get,
}: DataContext): Promise<Response | null> {
  if (
    path === '/flatpay/records' ||
    path === '/flatpay/sync' ||
    path === '/flatpay/refunds' ||
    path === '/viabill/records' ||
    path === '/pensopay/records'
  ) {
    const provider = path.includes('flatpay')
      ? 'flatpay'
      : path.includes('pensopay')
        ? 'pensopay'
        : 'viabill';
    const paymentRows = async () => {
      const next = new URL(request.url);
      next.searchParams.set(
        'from',
        [
          next.searchParams.get('from') || '',
          await dataStartDate(env, company, shop, provider),
        ]
          .sort()
          .at(-1)!,
      );
      const response = await handlePayments(
        new Request(next, { headers: request.headers }),
        env,
        actor,
        company,
        shop,
        provider,
        'records',
      );
      if (!response.ok) return response;
      const d = (await response.json()) as any;
      const totals: Record<string, any> = {};
      for (const r of d.rows) {
        const t = (totals[r.currency] ??= {
          currency: r.currency,
          count: 0,
          amountMinor: 0,
        });
        t.count++;
        t.amountMinor += r.amountMinor || 0;
      }
      return reply({
        records: d.rows,
        totals: Object.values(totals),
        hasMore: d.hasMore,
      });
    };
    if (get) {
      if (provider === 'viabill' && url.searchParams.has('id')) {
        const row = await db
          .prepare(
            "SELECT payload_json FROM payment_records WHERE company_id=? AND webshop_id=? AND provider='viabill' AND kind=? AND json_extract(payload_json,'$.id')=?",
          )
          .bind(
            company,
            shop,
            url.searchParams.get('kind') || 'payout',
            url.searchParams.get('id'),
          )
          .first<{ payload_json: string }>();
        if (!row) throw new HttpError(404, 'Posten findes ikke.');
        return reply({ record: JSON.parse(row.payload_json) });
      }
      return paymentRows();
    }
    const b = await jsonBody(request),
      cutoff = await dataStartDate(env, company, shop, provider);
    const saved = await db
      .prepare(
        'SELECT start_date FROM payment_connections WHERE company_id=? AND webshop_id=? AND provider=?',
      )
      .bind(company, shop, provider)
      .first<{ start_date: string }>();
    const start = [
      asText(
        (provider === 'flatpay' && path === '/flatpay/sync'
          ? b.next
          : undefined) ||
          b.from ||
          b.start ||
          cutoff,
      ),
      cutoff,
      saved?.start_date || '',
    ]
      .sort()
      .at(-1)!;
    const end = asText(b.to || b.end || new Date().toISOString().slice(0, 10));
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(start) ||
      !Number.isFinite(Date.parse(start)) ||
      !/^\d{4}-\d{2}-\d{2}$/.test(end) ||
      !Number.isFinite(Date.parse(end))
    )
      throw new HttpError(400, 'Vælg en gyldig periode.');
    const boundedEnd =
      provider === 'flatpay' && path === '/flatpay/sync'
        ? [
            end,
            new Date(Date.parse(start) + 30 * 86400000)
              .toISOString()
              .slice(0, 10),
          ].sort()[0]
        : end;
    const response = await handlePayments(
      forwarded(request, {
        ...b,
        start,
        end: boundedEnd,
        kind:
          b.kind ||
          (path === '/flatpay/refunds'
            ? 'transactions'
            : provider === 'flatpay'
              ? 'payments'
              : provider === 'pensopay'
                ? 'settlements'
                : 'payout'),
        cursor: b.next || b.cursor,
      }),
      env,
      actor,
      company,
      shop,
      provider,
      'records',
    );
    if (!response.ok) return response;
    const data = (await response.json()) as any;
    if (path === '/flatpay/records') {
      const next = new URL(request.url);
      next.searchParams.set('kind', asText(b.kind || 'transactions'));
      next.searchParams.set('from', start);
      next.searchParams.set('to', end);
      const records: unknown[] = [];
      for (let offset = 0; offset <= 1000; offset += 50) {
        next.searchParams.set('offset', String(offset));
        const response = await handlePayments(
          new Request(next, { headers: request.headers }),
          env,
          actor,
          company,
          shop,
          provider,
          'records',
        );
        if (!response.ok) return response;
        const value = (await response.json()) as any;
        records.push(...value.rows);
        if (!value.hasMore) return reply({ records });
      }
      throw new HttpError(
        409,
        'Vælg en kortere periode med højst 1000 poster.',
      );
    }
    return reply({
      ...data,
      ...(path === '/flatpay/sync'
        ? {
            next:
              boundedEnd < end
                ? new Date(Date.parse(boundedEnd) + 86400000)
                    .toISOString()
                    .slice(0, 10)
                : null,
          }
        : {}),
      synced: data.count,
      skipped: 0,
      mismatches: 0,
      message: 'Poster hentet. Ingen bogføring udført.',
    });
  }
  if (!get) {
    const module = path.includes('payout')
      ? 'payouts'
      : path.includes('refund')
        ? 'refunds'
        : 'payments';
    const response = await handleOperations(
      request,
      env,
      actor,
      company,
      shop,
      module,
    );
    if (!response.ok) return response;
    const data = (await response.json()) as any;
    return reply({ ...data, synced: data.count });
  }
  const module = path.includes('payout')
    ? 'payouts'
    : path.includes('refund')
      ? 'refunds'
      : 'payments';
  const from = await dataCutoff(env, company, shop),
    offset = pageNumber(url.searchParams.get('offset'), 0),
    limit = pageNumber(url.searchParams.get('limit'), 50, 100) || 50;
  const rows = (
    await db
      .prepare(
        'SELECT payload_json FROM operation_snapshots WHERE company_id=? AND webshop_id=? AND module=? AND occurred_at>=? ORDER BY occurred_at DESC,external_id LIMIT 10001',
      )
      .bind(company, shop, module, from)
      .all<{ payload_json: string }>()
  ).results.map((r) => JSON.parse(r.payload_json));
  if (rows.length > 10000)
    throw new HttpError(409, 'Vælg en kortere historik.');
  // Receipts only for the posts this overview can show (Shopify Payments and the providers' own records in the
  // period), not every sales receipt of the webshop.
  const providerIds = (
    await db
      .prepare(
        'SELECT external_id FROM payment_records WHERE company_id=? AND webshop_id=? AND occurred_at>=?',
      )
      .bind(company, shop, from.slice(0, 10))
      .all<{ external_id: string }>()
  ).results.map((r) => r.external_id);
  const bookingStatus = await bookingStatuses(env, company, shop, [
    ...rows.map((r) => String(r.id)),
    ...providerIds,
  ]);
  if (module === 'payouts') {
    // Each provider stores its payouts under its own kind; Pensopay 'payments' are card payments, not payouts.
    const payments = (
      await db
        .prepare(
          "SELECT provider,kind,payload_json,occurred_at,external_id FROM payment_records WHERE company_id=? AND webshop_id=? AND ((provider='flatpay' AND kind='payments') OR (provider='viabill' AND kind='payout') OR (provider='pensopay' AND kind='settlements')) AND occurred_at>=? ORDER BY occurred_at DESC LIMIT 10001",
        )
        .bind(company, shop, from)
        .all<any>()
    ).results;
    const list = rows.map((p) => ({
      id: p.id,
      provider: 'shopify_payments',
      label: 'Shopify Payments',
      date: p.issuedAt,
      amount: Number(p.net.amount),
      currency: p.net.currencyCode,
      status: payoutStatusLabel(p.status),
      booking: bookingStatus(
        'shopify',
        'payouts',
        p.id,
        p.issuedAt,
        JSON.stringify(p),
        p.status !== 'PAID' &&
          !['FAILED', 'CANCELED', 'CANCELLED'].includes(p.status),
      ),
      canBook: false,
      detail: {},
    }));
    for (const row of payments) {
      const p = JSON.parse(row.payload_json);
      if (row.provider === 'pensopay') {
        list.push({
          id: row.external_id,
          provider: 'pensopay',
          label: 'Pensopay',
          date: p.payoutDate || p.date,
          amount: p.amountMinor / 100,
          currency: p.currency,
          status: p.cancelled
            ? 'Annulleret'
            : p.paidDate
              ? 'Udbetalt'
              : 'Kommende',
          booking: 'not_enabled',
          canBook: false,
          detail: p,
        });
        continue;
      }
      list.push({
        id: row.external_id,
        provider: row.provider,
        label: row.provider === 'flatpay' ? 'Flatpay' : 'ViaBill',
        date: row.occurred_at,
        amount:
          row.provider === 'flatpay'
            ? p.payoutAmount
            : p.amountMinor /
              10 **
                new Intl.NumberFormat('en', {
                  style: 'currency',
                  currency: p.currency,
                }).resolvedOptions().maximumFractionDigits!,
        currency: p.currency,
        status:
          row.provider === 'flatpay'
            ? p.paidDate
              ? 'Udbetalt'
              : 'Kommende'
            : 'Udbetalt',
        booking: bookingStatus(
          row.provider,
          row.kind,
          row.external_id,
          row.occurred_at,
          row.payload_json,
          row.provider === 'flatpay' && !p.paidDate,
        ),
        canBook: false,
        detail: p,
      });
    }
    list.sort((a, b) => b.date.localeCompare(a.date));
    return reply({
      total: list.length,
      payouts: list.slice(offset, offset + limit),
    });
  }
  const refundSources = new Map<string, { externalId: string; json: string }>();
  if (module === 'refunds') {
    const saved = await db
      .prepare(
        "SELECT metadata_json FROM payment_connections WHERE company_id=? AND webshop_id=? AND provider='flatpay'",
      )
      .bind(company, shop)
      .first<{ metadata_json: string }>();
    if (saved) {
      const metadata = JSON.parse(saved.metadata_json),
        cutoff = await dataStartDate(env, company, shop, 'flatpay');
      const records = (
        await db
          .prepare(
            "SELECT external_id,payload_json FROM payment_records WHERE company_id=? AND webshop_id=? AND provider='flatpay' AND kind='transactions' AND occurred_at>=? LIMIT 10001",
          )
          .bind(company, shop, cutoff)
          .all<{ external_id: string; payload_json: string }>()
      ).results;
      if (records.length > 10000)
        throw new HttpError(409, 'Vælg en kortere historik.');
      for (const r of records) {
        try {
          const p = flatpayRefund(
            JSON.parse(r.payload_json),
            metadata.merchantID,
            metadata.agreementId,
          );
          if (p) {
            rows.push(p);
            refundSources.set(p.id, {
              externalId: r.external_id,
              json: r.payload_json,
            });
          }
        } catch {
          throw new HttpError(
            409,
            'Flatpay-refunderingen kræver kontrol af beløbsgrundlaget.',
          );
        }
      }
    }
    rows.sort((a, b) => b.transactionDate.localeCompare(a.transactionDate));
  }
  const filtered = rows.filter(
    (p) =>
      (!url.searchParams.get('from') ||
        p.transactionDate.slice(0, 10) >= url.searchParams.get('from')!) &&
      (!url.searchParams.get('to') ||
        p.transactionDate.slice(0, 10) <= url.searchParams.get('to')!) &&
      (!url.searchParams.get('search') ||
        JSON.stringify(p)
          .toLowerCase()
          .includes(url.searchParams.get('search')!.toLowerCase())),
  );
  const summary: Record<string, any> = {};
  for (const p of filtered) {
    const c = p.amount.currencyCode;
    const s = (summary[c] ??= {
      currency: c,
      count: 0,
      gross: 0,
      fees: 0,
      net: 0,
    });
    s.count++;
    s.gross += minor(p.amount.amount, c);
    s.fees += minor(p.fee.amount, c);
    s.net += minor(p.net.amount, c);
  }
  return reply({
    payments: filtered.slice(offset, offset + limit).map((p) => ({
      ...p,
      logExternalId: refundSources.get(p.id)?.externalId || p.id,
      bookingStatus:
        module === 'payments'
          ? 'not_enabled'
          : bookingStatus(
              p.provider === 'flatpay' ? 'flatpay' : 'shopify',
              p.provider === 'flatpay' ? 'transactions' : 'refunds',
              refundSources.get(p.id)?.externalId || p.id,
              p.transactionDate,
              refundSources.get(p.id)?.json || JSON.stringify(p),
            ),
    })),
    summary: Object.values(summary),
  });
}
