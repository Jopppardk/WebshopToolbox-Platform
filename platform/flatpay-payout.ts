// Reads one paid Flatpay payout with its single settlement and transactions, scoped to the
// saved agreement. Shared by bookkeeping (production-proposals.ts) and payout reports
// (documents.ts) so both use the same checked source for the PDF.
import { unseal } from './connections';
import { flatpayRead } from './flatpay-read';
import { checkFlatpayReport, type FlatpayReportSource } from './flatpay-report';
import { HttpError, type PlatformEnv } from './types';

export async function readFlatpayPayout(
  env: PlatformEnv,
  company: string,
  shop: string,
  id: string,
  settlementNumber: unknown,
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
  if (
    typeof settlementNumber !== 'string' ||
    !/^\d{1,30}$/.test(settlementNumber)
  )
    fail('Udbetalingen skal indeholde præcis en afregning.');
  const number = settlementNumber as string;
  const payments = await flatpayRead(credentials, 'payments', {
    SettlementNumber: number,
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
  if (p.settlements !== number) fail('Udbetalingen er ændret. Hent den igen.');
  const settlements = (
    await flatpayRead(credentials, 'settlements', {
      SettlementNumber: number,
      AgreementNumber: metadata.agreementNumber,
    })
  ).filter(
    (s) =>
      s.settlementNumber === number &&
      s.merchantID === metadata.merchantID &&
      (s.agreementNumber === metadata.agreementNumber ||
        s.agreementID === metadata.agreementId) &&
      (s.agreementNumber == null ||
        s.agreementNumber === metadata.agreementNumber) &&
      (s.agreementID == null || s.agreementID === metadata.agreementId),
  );
  if (settlements.length !== 1)
    fail('Afregningen kan ikke afstemmes entydigt.');
  const raw = settlements[0],
    settlement = {
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
    };
  const transactions = (
    await flatpayRead(credentials, 'transactions', { SettlementNumber: number })
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
    )
    .sort((a, b) =>
      String(a.transactionID).localeCompare(String(b.transactionID)),
    );
  const source: FlatpayReportSource = {
    payment: {
      paymentID: String(p.paymentID),
      paidDate: String(p.paidDate),
      currency: String(p.currency),
      payoutAmount: Number(p.payoutAmount),
      settlements: String(p.settlements),
    },
    settlements: [settlement],
    transactions,
  };
  checkFlatpayReport(source);
  return { connection, payment: p, settlement, source };
}
