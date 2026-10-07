// Reads one paid Flatpay payout with its settlements and their transactions, scoped to the saved agreement.
// A payout usually covers one settlement, but Flatpay pays several out together (e.g. on Monday for the
// weekend): the payment's `settlements` then lists them all. Every settlement must belong to the agreement and
// together they must add up to the bank payout (checkFlatpayReport). Shared by bookkeeping
// (production-proposals.ts) and payout reports (documents.ts) so both use the same checked source for the PDF.
import { unseal } from './connections';
import { flatpayRead } from './flatpay-read';
import { checkFlatpayReport, type FlatpayReportSource } from './flatpay-report';
import { flatpaySettlementNumbers } from './flatpay-draft';
import { HttpError, type PlatformEnv } from './types';

export async function readFlatpayPayout(
  env: PlatformEnv,
  company: string,
  shop: string,
  id: string,
  settlementNumbers: unknown,
) {
  // flatpayRead and checkFlatpayReport report with plain errors whose texts are our own; they are shown as they
  // are (409) rather than as an unexpected error with only an error ID.
  try {
    return await readPayout(env, company, shop, id, settlementNumbers);
  } catch (error) {
    if (
      error instanceof HttpError ||
      !(error instanceof Error) ||
      !error.message
    )
      throw error;
    throw new HttpError(409, 'Flatpay: ' + error.message);
  }
}

async function readPayout(
  env: PlatformEnv,
  company: string,
  shop: string,
  id: string,
  settlementNumbers: unknown,
) {
  const fail = (message: string): never => {
    throw new HttpError(409, message);
  };
  const connection = await env.PLATFORM_DB.prepare(
    "SELECT * FROM payment_connections WHERE company_id=? AND webshop_id=? AND provider='flatpay'",
  )
    .bind(company, shop)
    .first<any>();
  if (!connection) fail('Forbind Flatpay først.');
  const metadata = JSON.parse(connection.metadata_json),
    access = await unseal(
      env,
      [company, shop, 'flatpay', connection.identity],
      connection.credentials_encrypted,
    );
  const credentials = { username: access.username, password: access.password };
  const numbers =
    flatpaySettlementNumbers(settlementNumbers) ??
    fail('Udbetalingens afregninger kan ikke læses. Hent udbetalingen igen.');
  const payments = await flatpayRead(credentials, 'payments', {
    SettlementNumber: numbers[0],
  });
  const matches = payments.filter(
    (p) =>
      p.paymentID === id &&
      p.merchantID === metadata.merchantID &&
      p.agreementNumber === metadata.agreementNumber,
  );
  if (matches.length !== 1)
    fail('Udbetalingen tilhører ikke den gemte Flatpay-aftale.');
  const p = matches[0];
  // The payment must still list exactly the settlements it was saved with.
  const current = flatpaySettlementNumbers(p.settlements);
  if (
    !current ||
    current.length !== numbers.length ||
    current.some((n) => !numbers.includes(n))
  )
    fail('Udbetalingen er ændret. Hent den igen.');
  const owned = (s: Record<string, unknown>) =>
    s.merchantID === metadata.merchantID &&
    (s.agreementNumber === metadata.agreementNumber ||
      s.agreementID === metadata.agreementId) &&
    (s.agreementNumber == null ||
      s.agreementNumber === metadata.agreementNumber) &&
    (s.agreementID == null || s.agreementID === metadata.agreementId);
  const settlements: Record<string, unknown>[] = [],
    transactions: Record<string, unknown>[] = [];
  for (const number of numbers) {
    const found = (
      await flatpayRead(credentials, 'settlements', {
        SettlementNumber: number,
        AgreementNumber: metadata.agreementNumber,
      })
    ).filter((s) => s.settlementNumber === number && owned(s));
    if (found.length !== 1)
      fail(`Afregning ${number} kan ikke afstemmes entydigt.`);
    const raw = found[0];
    settlements.push({
      ...Object.fromEntries(
        Object.entries(raw).filter(
          ([k, v]) =>
            typeof v === 'number' && !['transactions', 'batches'].includes(k),
        ),
      ),
      settlementNumber: number,
      currency: raw.currency,
      transactions: String(raw.transactions),
      preArbitration: raw.preArbitration,
    });
    transactions.push(
      ...(
        await flatpayRead(credentials, 'transactions', {
          SettlementNumber: number,
        })
      )
        .filter(
          (t) =>
            t.settlementNumber === number &&
            t.merchantID === metadata.merchantID &&
            t.agreementID === metadata.agreementId,
        )
        .map((t) =>
          Object.fromEntries(
            [
              'transactionID',
              'settlementNumber',
              'purchaseDate',
              'transactionCode',
              'currency',
              'grossAmount',
              'fees',
              'netAmount',
            ].map((k) => [k, t[k]]),
          ),
        ),
    );
  }
  transactions.sort((a, b) =>
    String(a.transactionID).localeCompare(String(b.transactionID)),
  );
  const source: FlatpayReportSource = {
    payment: {
      paymentID: String(p.paymentID),
      paidDate: String(p.paidDate),
      currency: String(p.currency),
      payoutAmount: Number(p.payoutAmount),
      settlements: numbers.join(','),
    },
    settlements,
    transactions,
  };
  // Every settlement belongs to the payout and together they make exactly the bank payout.
  checkFlatpayReport(source);
  return { connection, payment: p, settlements, source };
}
