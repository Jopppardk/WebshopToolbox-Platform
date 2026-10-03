'use client';
import { PayoutLog } from './payout-log';
export function OrderLog({ externalId }: { externalId: string }) {
  return <PayoutLog externalId={externalId} provider="shopify" kind="sale" />;
}
