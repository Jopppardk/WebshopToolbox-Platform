// Udbetalingsrapporter and Fakturaer.
// Part of the Tier 1 data API (tier1-data.ts); called for paths of a connected webshop.
import { jsonBody } from './invitations';
import { handleInvoices } from './invoices';
import { handleDocuments } from './documents';
import { dataCutoff } from './tier1-history';
import { HttpError, reply } from './types';
import { type DataContext, forwarded } from './tier1-data-shared';

export async function documentData({
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
  if (path === '/documents') {
    if (!get) return handleDocuments(request, env, actor, company, shop);
    const id = url.searchParams.get('externalId');
    if (id) {
      const doc = await db
        .prepare(
          'SELECT id FROM platform_payout_documents WHERE company_id=? AND webshop_id=? AND external_id=?',
        )
        .bind(company, shop, id)
        .first<{ id: string }>();
      if (!doc) throw new HttpError(404, 'Generér rapporten først.');
      const next = new URL(request.url);
      next.searchParams.set('id', doc.id);
      return handleDocuments(
        new Request(next, request),
        env,
        actor,
        company,
        shop,
      );
    }
    const rows = (
      await db
        .prepare(
          "SELECT s.external_id,s.payload_json,d.status FROM operation_snapshots s LEFT JOIN platform_payout_documents d ON d.company_id=s.company_id AND d.webshop_id=s.webshop_id AND d.external_id=s.external_id WHERE s.company_id=? AND s.webshop_id=? AND s.module='payouts' ORDER BY occurred_at DESC LIMIT 1000",
        )
        .bind(company, shop)
        .all<any>()
    ).results;
    const flatpay = (
      await db
        .prepare(
          "SELECT p.external_id,p.payload_json,d.status FROM payment_records p LEFT JOIN platform_payout_documents d ON d.company_id=p.company_id AND d.webshop_id=p.webshop_id AND d.external_id='flatpay:'||p.external_id WHERE p.company_id=? AND p.webshop_id=? AND p.provider='flatpay' AND p.kind='payments' AND (p.paid=1 OR p.external_id LIKE 'upcoming:%') ORDER BY p.occurred_at DESC LIMIT 1000",
        )
        .bind(company, shop)
        .all<any>()
    ).results;
    const failed = new Set(
      (
        await db
          .prepare(
            "SELECT external_id FROM production_attempts WHERE company_id=? AND webshop_id=? AND job='reports' AND failures>0",
          )
          .bind(company, shop)
          .all<{ external_id: string }>()
      ).results.map((r) => r.external_id),
    );
    const documents = [
      ...rows.map((r) => {
        const p = JSON.parse(r.payload_json);
        return {
          externalId: r.external_id,
          date: p.issuedAt,
          provider: 'shopify',
          amount: p.net,
          filename: r.external_id.split('/').pop() + '.pdf',
          ready: r.status === 'generated',
          status: p.status,
          failed: r.status !== 'generated' && failed.has(r.external_id),
        };
      }),
      // Upcoming Flatpay settlements are listed like Shopify's scheduled payouts; their report follows the payout.
      ...flatpay.map((r) => {
        const p = JSON.parse(r.payload_json),
          upcoming = r.external_id.startsWith('upcoming:');
        return {
          externalId: 'flatpay:' + r.external_id,
          date: upcoming ? p.scheduledDate : p.paidDate,
          provider: 'flatpay',
          amount: { amount: String(p.payoutAmount), currencyCode: p.currency },
          filename: upcoming
            ? 'Afregning ' + p.settlementNumber
            : 'flatpay-' + r.external_id + '.pdf',
          ready: r.status === 'generated',
          status: upcoming ? 'SCHEDULED' : 'PAID',
          failed:
            r.status !== 'generated' && failed.has('flatpay:' + r.external_id),
        };
      }),
    ];
    documents.sort((a, b) => String(b.date).localeCompare(String(a.date)));
    return reply({ documents });
  }
  if (path.startsWith('/invoices')) {
    const b: any = get
      ? Object.fromEntries(url.searchParams)
      : await jsonBody(request);
    if (path === '/invoices/pdf') {
      const next = new URL(request.url);
      next.searchParams.set('webshopId', shop);
      return handleInvoices(
        new Request(next, request),
        env,
        actor,
        company,
        'pdf',
      );
    }
    if (path === '/invoices/email-test') {
      if (request.method !== 'POST')
        throw new HttpError(405, 'Brug Send eksempelfaktura som test.');
      const response = await handleInvoices(
        forwarded(request, {
          webshopId: shop,
          recipient: b.recipient,
          requestId: b.requestId,
          ...(typeof b.marketId === 'string' ? { marketId: b.marketId } : {}),
        }),
        env,
        actor,
        company,
        'example-test',
      );
      if (!response.ok) return response;
      const result = (await response.json()) as any;
      if (result.status !== 'accepted')
        throw new HttpError(
          409,
          result.status === 'preview'
            ? 'Lokal test: mailen er kun forhåndsvist, ikke sendt.'
            : 'Mailafsendelsen er usikker. Kontrollér status før nyt forsøg.',
        );
      return reply({
        sent: true,
        recipient: result.recipient,
        invoiceNumber: 'EKSEMPEL-001',
      });
    }
    let generated = 0,
      hasMore = false,
      nextOffset = 0;
    const warnings: string[] = [];
    if (!get) {
      const cutoff = await dataCutoff(env, company, shop);
      const offset = Number(b.offset || 0);
      if (!Number.isSafeInteger(offset) || offset < 0)
        throw new HttpError(400, 'Ugyldig side.');
      const ids = b.all
        ? (
            await db
              .prepare(
                'SELECT external_id FROM invoice_orders WHERE company_id=? AND webshop_id=? AND created_at>=? ORDER BY created_at DESC,external_id LIMIT 6 OFFSET ?',
              )
              .bind(company, shop, cutoff, offset)
              .all<{ external_id: string }>()
          ).results
        : [{ external_id: b.externalId }];
      hasMore = ids.length > 5;
      nextOffset = offset + 5;
      for (const item of ids.slice(0, 5)) {
        if (
          !(await db
            .prepare(
              'SELECT 1 AS found FROM invoice_orders WHERE company_id=? AND webshop_id=? AND external_id=? AND created_at>=?',
            )
            .bind(company, shop, item.external_id, cutoff)
            .first())
        )
          throw new HttpError(404, 'Ordren findes ikke i den valgte historik.');
        try {
          const response = await handleInvoices(
            forwarded(request, {
              externalId: item.external_id,
              webshopId: shop,
            }),
            env,
            actor,
            company,
            'generate',
          );
          if (!response.ok) return response;
          generated++;
        } catch (e) {
          if (!b.all) throw e;
          warnings.push(
            e instanceof HttpError ? e.message : 'Fakturaen kræver kontrol.',
          );
        }
      }
    }
    const rows = (
      await db
        .prepare(
          'SELECT external_id,id,status,created_at FROM platform_invoices WHERE company_id=? AND webshop_id=? ORDER BY created_at DESC',
        )
        .bind(company, shop)
        .all()
    ).results;
    return reply({
      statuses: Object.fromEntries(
        rows.map((r: any) => [
          r.external_id,
          r.status === 'generated' ? 'Genereret' : 'Kræver kontrol',
        ]),
      ),
      versions: Object.fromEntries(rows.map((r: any) => [r.external_id, r.id])),
      generated,
      hasMore,
      nextOffset,
      warnings,
    });
  }
  return null;
}
