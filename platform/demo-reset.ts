// Nightly rebuild of the demo account (see demo.ts). Kept apart because it renders PDFs.
import { buildInvoicePdf } from './invoice-pdf';
import { creditNoteNumber } from './credit-notes';
import type { OrderRefund } from './order-refunds';
import { checkInvoice, invoiceFingerprint } from './order-check';
import { invoiceDesign } from './invoice-design';
import { buildPayoutReport } from './payout-pdf';
import { accountKeys, defaultAutomation } from './tier1/src/lib/admin-settings';
import { danishDate } from './tier1/src/lib/history-policy';
import { COMPANY_NAME, DEMO_COMPANY, DEMO_EMAIL, DEMO_SHOP, DEMO_USER, ORGANIZATION, PUBLIC_DOMAIN, SHOP_DOMAIN, SHOP_NAME, addDays, chart, demoCollections, demoDataset, demoPayouts, invoiceSource, orderSnapshot, plainMoney } from './demo';
import type { PlatformEnv } from './types';

// Children before parents, so foreign keys hold. The company, user and webshop rows are kept.
export const demoTables = ['order_refunds', 'order_refund_checks', 'platform_credit_notes', 'order_markets', 'operation_acknowledgements', 'record_events', 'payment_records', 'payment_connections', 'operation_runs', 'operation_snapshots', 'invoice_orders', 'platform_invoices',
  'platform_payout_documents', 'production_receipts', 'production_jobs', 'production_attempts', 'booking_start_dates', 'tier1_preferences', 'product_feeds', 'feed_folders', 'emballage_connections',
  'packaging_snapshots', 'packaging_sync', 'platform_packaging', 'platform_packaging_prices', 'stocktakes', 'accounting_reconciliations', 'source_records', 'webshop_connections', 'accounting_connections',
  'accounting_mapping', 'company_accounting', 'company_integrations', 'integration_history', 'invoice_settings', 'company_mail', 'mail_test_deliveries', 'finance_ledger', 'support_ticket_messages',
  'support_tickets', 'audit_events'];

export async function resetDemo(env: PlatformEnv, today = danishDate()) {
  const db = env.PLATFORM_DB, run = async (statements: D1PreparedStatement[]) => { for (let i = 0; i < statements.length; i += 50) await db.batch(statements.slice(i, i + 50)); };
  const now = new Date().toISOString(), since = addDays(today + 'T00:00:00Z', -120).slice(0, 10);
  const { orders } = demoDataset(today), payouts = demoPayouts(orders, today);
  await run([
    db.prepare("INSERT INTO companies(id,name,status,demo) VALUES(?,?,'active',1) ON CONFLICT(id) DO UPDATE SET name=excluded.name,status='active',demo=1").bind(DEMO_COMPANY, COMPANY_NAME),
    db.prepare("INSERT INTO users(id,identity_issuer,identity_subject,email,status,company_id,full_name,phone) VALUES(?,'urn:webshop-toolbox:customer',?,?,'active',?,'Peter Andersen','+45 20 30 40 50') ON CONFLICT(id) DO UPDATE SET full_name='Peter Andersen',phone='+45 20 30 40 50'").bind(DEMO_USER, DEMO_USER, DEMO_EMAIL, DEMO_COMPANY),
    db.prepare("INSERT OR IGNORE INTO company_memberships(company_id,user_id,role) VALUES(?,?,'admin')").bind(DEMO_COMPANY, DEMO_USER),
    db.prepare("INSERT INTO webshops(id,company_id,name,domain,status) VALUES(?,?,?,?,'active') ON CONFLICT(id) DO UPDATE SET name=excluded.name,status='active'").bind(DEMO_SHOP, DEMO_COMPANY, SHOP_NAME, PUBLIC_DOMAIN),
    db.prepare("INSERT OR IGNORE INTO webshop_memberships(company_id,webshop_id,user_id,role) VALUES(?,?,?,'admin')").bind(DEMO_COMPANY, DEMO_SHOP, DEMO_USER),
    ...demoTables.map(table => db.prepare(`DELETE FROM ${table} WHERE company_id=?`).bind(DEMO_COMPANY)),
    db.prepare('DELETE FROM finance_state WHERE tenant=?').bind(DEMO_COMPANY),
  ]);
  if (env.PLATFORM_DOCUMENTS.list) {
    const old = await env.PLATFORM_DOCUMENTS.list({ prefix: `companies/${DEMO_COMPANY}/` });
    if (old.objects.length) await env.PLATFORM_DOCUMENTS.delete(old.objects.map(o => o.key));
  }
  // Integrations, settings and history: connected but never reachable (credentials are placeholders and every call is intercepted).
  const accounts = Object.fromEntries(accountKeys.map(key => [key, ({ vatCode: 'U25', noVatCode: 'none', goodsVat: '1000', goodsNoVat: '1100', shippingVat: '1010', shippingNoVat: '1100', servicesVat: '1000', servicesNoVat: '1100', refundGoodsVat: '1200', refundGoodsNoVat: '1200', refundShippingVat: '1200', refundShippingNoVat: '1200', refundServicesVat: '1200', refundServicesNoVat: '1200', fees: '7000', clearing: '58010', bank: '55000', shopifyPaymentsClearing: '58000', viaBillClearing: '58010', flatpayClearing: '58010', inventory: '5820', inventoryAdjustment: '5825' } as Record<string, string>)[key] || '']));
  const automation = { ...defaultAutomation, sales: true, refunds: true, payouts: true, invoiceEmails: true, attachments: true };
  const invoiceIssuer = { name: COMPANY_NAME, address: 'Havnegade 12, 8000 Aarhus C', cvr: '12345678', contact: 'kontakt@demo.webshoptoolbox.dk · +45 70 20 30 40' };
  const setup = [
    db.prepare("INSERT INTO company_accounting(company_id,provider,account_name) VALUES(?,'dinero',?)").bind(DEMO_COMPANY, COMPANY_NAME),
    db.prepare("INSERT INTO accounting_connections(company_id,organization_id,credentials_encrypted,revision,chart_json,verified_at) VALUES(?,?,'demo','demo',?,CURRENT_TIMESTAMP)").bind(DEMO_COMPANY, ORGANIZATION, JSON.stringify(chart.map(([number, name, vatCode]) => ({ number, name, vatCode: vatCode === 'none' ? '' : vatCode, kind: Number(number) >= 55000 ? 'deposit' : 'entry', hidden: false })))),
    db.prepare('INSERT INTO accounting_mapping(company_id,accounts_json) VALUES(?,?)').bind(DEMO_COMPANY, JSON.stringify(accounts)),
    db.prepare("INSERT INTO webshop_connections(company_id,webshop_id,provider,shop_domain,credentials_encrypted,verified_at) VALUES(?,?,'shopify',?,'demo',CURRENT_TIMESTAMP)").bind(DEMO_COMPANY, DEMO_SHOP, SHOP_DOMAIN),
    db.prepare("INSERT INTO tier1_preferences(company_id,webshop_id,preferences_json,revision) VALUES(?,?,?,'demo')").bind(DEMO_COMPANY, DEMO_SHOP, JSON.stringify({ automation, syncIntervalMinutes: 15 })),
    ...['shopify', 'dinero'].map(provider => db.prepare('INSERT INTO booking_start_dates(company_id,webshop_id,provider,start_date) VALUES(?,?,?,?)').bind(DEMO_COMPANY, DEMO_SHOP, provider, since)),
    db.prepare("INSERT INTO invoice_settings(company_id,name,address,cvr,contact,subject,body,months,design_json) VALUES(?,?,?,?,?,?,?,36,'{}')").bind(DEMO_COMPANY, invoiceIssuer.name, invoiceIssuer.address, invoiceIssuer.cvr, invoiceIssuer.contact, 'Faktura {{fakturanummer}} fra Demofirma', 'Hej {{kundenavn}}\n\nTak for din ordre hos Demofirma.\n\nVedhæftet finder du faktura {{fakturanummer}} for ordre {{ordrenummer}}.\n\nVenlig hilsen\nDemofirma A/S'),
    db.prepare("INSERT INTO product_feeds(id,company_id,webshop_id,name,file_name,service,config_json,enabled,public_token) VALUES('de000000-fee0-4000-8000-000000000001',?,?,'PartnerAds','partnerads','partnerads',?,1,?)").bind(DEMO_COMPANY, DEMO_SHOP, JSON.stringify({ allProducts: false, collections: demoCollections.slice(0, 2), products: [], shippingCost: '49.00', freeShippingFrom: '499.00', deliveryTime: '1-3 hverdage', category: '' }), 'd'.repeat(64)),
    db.prepare("INSERT INTO platform_packaging_prices(company_id,webshop_id,household,commercial) VALUES(?,?,2.05,NULL)").bind(DEMO_COMPANY, DEMO_SHOP),
  ];
  // Orders, invoices, bookkeeping and packaging events.
  const records: D1PreparedStatement[] = [], pdfs: Array<{ key: string; bytes: Uint8Array }> = [];
  for (const o of orders) {
    const snapshot = JSON.stringify(orderSnapshot(o));
    records.push(db.prepare("INSERT INTO operation_snapshots(company_id,webshop_id,module,external_id,occurred_at,payload_json) VALUES(?,?,'orders',?,?,?)").bind(DEMO_COMPANY, DEMO_SHOP, o.id, o.createdAt, snapshot));
    records.push(db.prepare('INSERT INTO invoice_orders(company_id,webshop_id,external_id,name,created_at,payload_json) VALUES(?,?,?,?,?,?)').bind(DEMO_COMPANY, DEMO_SHOP, o.id, o.name, o.createdAt, snapshot));
    // Every fifth order went to Sweden and was paid in SEK (fictional rate 1,45).
    const swedish = Number(o.name.slice(1)) % 5 === 0;
    records.push(db.prepare('INSERT INTO order_markets(company_id,webshop_id,external_id,country,currency,presentment_total) VALUES(?,?,?,?,?,?)').bind(DEMO_COMPANY, DEMO_SHOP, o.id, swedish ? 'SE' : 'DK', swedish ? 'SEK' : 'DKK', ((swedish ? 1.45 : 1) * (o.cancelledAt ? 0 : o.totalMinor - o.refundedMinor) / 100).toFixed(2)));
    if (!o.fulfilledAt) continue;
    // Orders fulfilled more than a day ago are booked; the newest wait for the next run.
    if (Date.parse(o.fulfilledAt) < Date.parse(today + 'T00:00:00Z')) records.push(db.prepare("INSERT INTO production_receipts(company_id,webshop_id,provider,module,external_id,destination,phase,version,payload_json) VALUES(?,?,'shopify','orders',?,?,'booked','demo',?)").bind(DEMO_COMPANY, DEMO_SHOP, o.id, ORGANIZATION, JSON.stringify({ sourceJson: snapshot, voucher: 'Demo-bilag ' + o.name })));
    {
      // Refunded orders were invoiced before the refund, so they are invoiced in full and credited below.
      const source = invoiceSource(o), doc = `demo-invoice-${o.name.slice(1)}`, key = `companies/${DEMO_COMPANY}/webshops/${DEMO_SHOP}/invoices/${doc}.pdf`;
      const issuer = { ...invoiceIssuer, webshopName: SHOP_NAME, design: invoiceDesign({}) };
      pdfs.push({ key, bytes: await buildInvoicePdf(source, issuer) });
      records.push(db.prepare("INSERT INTO platform_invoices(company_id,webshop_id,external_id,id,fingerprint,status,r2_key,issuer_json,source_json) VALUES(?,?,?,?,?,'generated',?,?,?)").bind(DEMO_COMPANY, DEMO_SHOP, o.id, doc, await invoiceFingerprint(checkInvoice(source)), key, JSON.stringify(issuer), JSON.stringify(source)));
      if (o.refundedMinor) {
        // One unit of the first product returned three days after shipping, with its credit note and booking.
        const n = Number(o.name.slice(1)), tax = Math.round(o.refundedMinor / 5), at = addDays(o.fulfilledAt, 3);
        const refund: OrderRefund = { id: 'gid://shopify/Refund/' + (880000 + n), orderId: o.id, orderName: o.name, processedAt: at, currency: 'DKK', gross: o.refundedMinor, full: false, sequence: 1, note: null,
          gateways: [{ gateway: o.gateway, name: o.gateway === 'shopify_payments' ? 'Shopify Payments' : o.gateway, amount: o.refundedMinor }],
          lines: [{ kind: 'goods', title: o.lines[0].product.title, quantity: 1, net: o.refundedMinor - tax, tax }], problem: null };
        const refundJson = JSON.stringify(refund), number = creditNoteNumber(o.name, 1), noteKey = `companies/${DEMO_COMPANY}/webshops/${DEMO_SHOP}/credit-notes/demo-credit-${n}.pdf`;
        records.push(db.prepare('INSERT INTO order_refunds(company_id,webshop_id,external_id,order_id,occurred_at,payload_json) VALUES(?,?,?,?,?,?)').bind(DEMO_COMPANY, DEMO_SHOP, refund.id, o.id, at, refundJson));
        pdfs.push({ key: noteKey, bytes: await buildInvoicePdf(source, issuer, undefined, { number, date: at, invoiceNumber: o.name.slice(1), currency: 'DKK', lines: refund.lines }) });
        records.push(db.prepare("INSERT INTO platform_credit_notes(company_id,webshop_id,external_id,id,order_id,number,status,r2_key,source_json) VALUES(?,?,?,?,?,?,'generated',?,?)").bind(DEMO_COMPANY, DEMO_SHOP, refund.id, 'demo-credit-' + n, o.id, number, noteKey, refundJson));
        if (Date.parse(at) < Date.parse(today + 'T00:00:00Z')) records.push(db.prepare("INSERT INTO production_receipts(company_id,webshop_id,provider,module,external_id,destination,phase,version,payload_json) VALUES(?,?,'shopify','order_refunds',?,?,'booked','demo',?)").bind(DEMO_COMPANY, DEMO_SHOP, refund.id, ORGANIZATION, JSON.stringify({ sourceJson: refundJson, voucher: 'Demo-bilag tilbagebetaling ' + o.name })));
      }
    }
    o.lines.forEach((l, i) => {
      const event = `${o.id}:${i}`, row = { audience: 'household', eventId: event, fulfillmentId: 'gid://shopify/Fulfillment/' + (7100000 + Number(o.name.slice(1))), fulfilledAt: o.fulfilledAt, date: o.fulfilledAt!.slice(0, 10), orderId: o.id, orderName: o.name, productId: 'gid://shopify/Product/' + (63000 + l.product.id), product: l.product.title, variantId: 'gid://shopify/ProductVariant/' + (62000 + l.product.id), variant: 'Default Title', quantity: l.quantity, weightGrams: Math.round(l.product.weight * 0.18), reportable: 'yes', supplier: 'Demofirma A/S', supplierCountry: 'DK', supplierCvr: '12345678', snapshottedAt: now };
      records.push(db.prepare('INSERT INTO packaging_snapshots(company_id,webshop_id,event_id,payload_json) VALUES(?,?,?,?)').bind(DEMO_COMPANY, DEMO_SHOP, event, JSON.stringify(row)));
    });
  }
  records.push(db.prepare('INSERT INTO packaging_sync(company_id,webshop_id,coverage_start,coverage_end,synced_at) VALUES(?,?,?,?,CURRENT_TIMESTAMP)').bind(DEMO_COMPANY, DEMO_SHOP, since, today));
  // Refunds and Shopify Payments charges as balance transactions.
  for (const o of orders.filter(o => o.refundedMinor && o.fulfilledAt)) {
    const at = addDays(o.fulfilledAt!, 3), payout = payouts.find(p => p.transactions.some(t => t.type === 'REFUND' && t.orderName === o.name))?.snapshot;
    records.push(db.prepare("INSERT INTO operation_snapshots(company_id,webshop_id,module,external_id,occurred_at,payload_json) VALUES(?,?,'refunds',?,?,?)").bind(DEMO_COMPANY, DEMO_SHOP, 'gid://shopify/ShopifyPaymentsBalanceTransaction/' + (900000 + Number(o.name.slice(1)) * 10 + 1), at,
      JSON.stringify({ id: 'gid://shopify/ShopifyPaymentsBalanceTransaction/' + (900000 + Number(o.name.slice(1)) * 10 + 1), type: 'REFUND', test: false, transactionDate: at, amount: plainMoney(-o.refundedMinor), fee: plainMoney(0), net: plainMoney(-o.refundedMinor), associatedOrder: { id: o.id, name: o.name }, associatedPayout: payout ? { id: payout.id, status: payout.status } : null, sourceOrderTransactionId: null })));
  }
  for (const p of payouts) {
    records.push(db.prepare("INSERT INTO operation_snapshots(company_id,webshop_id,module,external_id,occurred_at,payload_json) VALUES(?,?,'payouts',?,?,?)").bind(DEMO_COMPANY, DEMO_SHOP, p.snapshot.id, p.snapshot.issuedAt, JSON.stringify(p.snapshot)));
    for (const t of p.transactions.filter(t => t.type === 'CHARGE')) records.push(db.prepare("INSERT INTO operation_snapshots(company_id,webshop_id,module,external_id,occurred_at,payload_json) VALUES(?,?,'payments',?,?,?)").bind(DEMO_COMPANY, DEMO_SHOP, 'gid://shopify/ShopifyPaymentsBalanceTransaction/' + t.id, t.processedAt,
      JSON.stringify({ id: 'gid://shopify/ShopifyPaymentsBalanceTransaction/' + t.id, type: 'CHARGE', test: false, transactionDate: t.processedAt, amount: t.amount, fee: t.fee, net: t.net, associatedOrder: { id: 'gid://shopify/Order/' + t.orderId, name: t.orderName }, associatedPayout: { id: p.snapshot.id, status: p.snapshot.status }, sourceOrderTransactionId: null })));
    if (p.snapshot.status !== 'PAID') continue;
    records.push(db.prepare("INSERT INTO production_receipts(company_id,webshop_id,provider,module,external_id,destination,phase,version,payload_json) VALUES(?,?,'shopify','payouts',?,?,'booked','demo',?)").bind(DEMO_COMPANY, DEMO_SHOP, p.snapshot.id, ORGANIZATION, JSON.stringify({ sourceJson: JSON.stringify(p.snapshot), voucher: 'Demo-bilag udbetaling' })));
    const source = { ...p.snapshot, provider: 'shopify_payments', transactions: p.transactions }, doc = `demo-payout-${p.snapshot.id.split('/').pop()}`, key = `companies/${DEMO_COMPANY}/webshops/${DEMO_SHOP}/payout-reports/${doc}.pdf`;
    pdfs.push({ key, bytes: await buildPayoutReport(source, COMPANY_NAME) });
    records.push(db.prepare("INSERT INTO platform_payout_documents(company_id,webshop_id,external_id,id,status,r2_key,source_json) VALUES(?,?,?,?,'generated',?,?)").bind(DEMO_COMPANY, DEMO_SHOP, p.snapshot.id, doc, key, JSON.stringify(source)));
  }
  // A few finished job runs so sync status and the bell look like a live shop.
  for (const [k, module] of ['auto.import.orders', 'auto.import.payouts', 'auto.sales.queue', 'auto.invoice.queue', 'auto.reports'].entries()) records.push(db.prepare("INSERT INTO operation_runs(id,company_id,webshop_id,module,status,count,message,started_at,finished_at) VALUES(?,?,?,?,'success',?,'',datetime('now',?),datetime('now',?))").bind(`demo-run-${k}`, DEMO_COMPANY, DEMO_SHOP, module, 3 + k, `-${10 + k} minutes`, `-${9 + k} minutes`));
  records.push(db.prepare("INSERT INTO support_tickets(id,company_id,created_by,subject,status,priority,version) VALUES('demo-ticket-1',?,?,'Hvordan vises MobilePay på fakturaen?','resolved','normal',1)").bind(DEMO_COMPANY, DEMO_USER),
    db.prepare("INSERT INTO support_ticket_messages(id,company_id,ticket_id,author_id,author_kind,body) VALUES('demo-message-1',?,'demo-ticket-1',?,'customer','Hej, vises betalingsmåden på kundens faktura, når der er betalt med MobilePay?')").bind(DEMO_COMPANY, DEMO_USER),
    db.prepare("INSERT INTO support_ticket_messages(id,company_id,ticket_id,author_id,author_kind,body) VALUES('demo-message-2',?,'demo-ticket-1',?,'support','Hej Peter. Ja, betalingsmåden hentes fra ordren i Shopify og står under totalen på fakturaen. Venlig hilsen WebshopToolbox')").bind(DEMO_COMPANY, DEMO_USER));
  for (const pdf of pdfs) await env.PLATFORM_DOCUMENTS.put(pdf.key, pdf.bytes, { httpMetadata: { contentType: 'application/pdf' } });
  await run([...setup, ...records, db.prepare("INSERT INTO demo_state(id,reset_day) VALUES('demo',?) ON CONFLICT(id) DO UPDATE SET reset_day=excluded.reset_day,reset_at=CURRENT_TIMESTAMP").bind(today)]);
  return { orders: orders.length, payouts: payouts.length, documents: pdfs.length };
}
/** Called by the scheduler: creates the demo on first run and resets it once a night after 03:00 Danish time. */
export async function resetDemoIfDue(env: PlatformEnv, now = new Date()) {
  const today = danishDate(now), hour = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Copenhagen', hour: '2-digit', hourCycle: 'h23' }).format(now));
  const state = await env.PLATFORM_DB.prepare("SELECT reset_day FROM demo_state WHERE id='demo'").first<{ reset_day: string }>();
  if (state && (state.reset_day === today || hour < 3)) return null;
  return resetDemo(env, today);
}
