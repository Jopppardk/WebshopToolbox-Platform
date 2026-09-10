import { NextRequest, NextResponse } from 'next/server';
import { database } from '@/db/database';
import { loadHistory } from '@/db/history';
import { historyWindow } from '@/lib/history-policy';
import { loadCompleteOrder } from '@/db/shopify-order';
import { loadDineroChart } from '@/db/dinero-chart';
import { checkInvoice, invoiceFingerprint, InvoiceCheckError } from '@/lib/invoice-check';
import { salesDraft } from '@/lib/sales-preview';
import { emptyAccounts, validateSettings } from '@/lib/admin-settings';

// Read-only: no cleanup, PDF generation, status changes, or Dinero bookkeeping.
export async function POST(request: NextRequest) {
  const json = (data: unknown, status = 200) => NextResponse.json(data, { status, headers: { 'Cache-Control': 'no-store' } });
  try {
    const { externalId, mode = 'sale' } = await request.json() as { externalId?: unknown; mode?: string };
    if (typeof externalId !== 'string' || !/^gid:\/\/shopify\/Order\/\d+$/.test(externalId) || !['sale', 'invoice'].includes(mode)) return json({ error: 'Ugyldig ordre eller kontroltype.' }, 400);
    const db = database();
    const { cutoff } = historyWindow(await loadHistory(db, 'shopify'));
    const stored = await db.prepare("SELECT external_id FROM integration_records WHERE tenant = 'sablen.dk' AND record_type = 'order' AND external_id = ? AND occurred_at >= ?").bind(externalId, cutoff).first();
    if (!stored) return json({ error: 'Ordren er ikke indlæst eller ligger uden for den valgte historik.' }, 404);
    const source = await loadCompleteOrder(externalId);
    if (source.createdAt < cutoff) return json({ error: 'Ordren ligger uden for den valgte historik.' }, 404);
    const invoice = checkInvoice(source);
    const notes: string[] = ['Kontrollen bruger friske Shopify-data. Ingen PDF ændres, og intet bogføres.'];
    const saved = await db.prepare("SELECT payload_json FROM integration_records WHERE tenant = 'sablen.dk' AND record_type = 'invoice' AND external_id = ?").bind(externalId).first<{ payload_json: string }>();
    if (saved) {
      const snapshot = JSON.parse(saved.payload_json);
      if (!snapshot.invoiceFingerprint) notes.push('En ældre PDF findes. Dens indhold er ikke godkendt af denne kontrol og bevares uændret.');
      else if (snapshot.invoiceFingerprint !== await invoiceFingerprint(invoice)) notes.push('Den gemte PDF afviger fra den aktuelle ordre. Den bevares; afklar rettelse/kreditnota før videre behandling.');
      else notes.push('Den gemte fakturas beløb, linjer og kundeoplysninger svarer til de kontrollerede data.');
    } else notes.push('Der er endnu ikke registreret en gemt PDF for ordren.');
    if (mode === 'invoice') return json({ invoice, notes, checkedAt: new Date().toISOString(), readOnly: true });
    const settings = await db.prepare("SELECT setting_value FROM app_settings WHERE tenant = 'sablen.dk' AND setting_key = 'admin_settings'").first<{ setting_value: string }>();
    const validated = settings ? validateSettings(JSON.parse(settings.setting_value)) : null;
    const accounts = validated?.accounts ?? emptyAccounts;
    let chart: NonNullable<Awaited<ReturnType<typeof loadDineroChart>>>['accounts'] = [];
    let chartError: string | null = null;
    try { const snapshot = await loadDineroChart(); if (!snapshot) throw new Error('missing'); chart = snapshot.accounts; notes.push(`Kontoforslaget bruger den gemte kontoplan fra ${snapshot.fetchedAt}. Synkronisér under Administration ved ændringer i Dinero.`); }
    catch { chartError = 'Ingen læsbar kontoplan for den tilsluttede organisation. Synkronisér kontoplanen under Administration.'; }
    const draft = salesDraft(invoice, accounts, chart, validated?.automation.inventory === true);
    if (chartError) { draft.blockers.unshift(chartError); draft.ready = false; }
    if (saved && (!JSON.parse(saved.payload_json).invoiceFingerprint || JSON.parse(saved.payload_json).invoiceFingerprint !== await invoiceFingerprint(invoice))) { draft.blockers.push('Eksisterende PDF skal gennemgås før en senere bogføring.'); draft.ready = false; }
    return json({ invoice, draft, notes, checkedAt: new Date().toISOString(), readOnly: true });
  } catch (error) {
    return json({ error: error instanceof InvoiceCheckError ? error.message : 'Kontrollen kunne ikke gennemføres. Kontrollér Shopify-forbindelsen og prøv igen. Ingen data er ændret.' }, 422);
  }
}

