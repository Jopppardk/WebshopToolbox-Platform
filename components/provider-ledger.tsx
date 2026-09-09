'use client';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Payments } from '@/components/payments';
import { LivePayouts } from '@/components/payouts';
import { ViaBillRecords } from '@/components/viabill-records';
export function ProviderLedger({ kind, syncRevision = 0 }: { kind: 'payment' | 'payout'; syncRevision?: number }) {
  return <Tabs defaultValue="shopify" className="gap-0">
    <div className="mx-auto w-full max-w-[1440px] px-5 pt-6 md:px-8"><TabsList aria-label="Betalingsudbyder"><TabsTrigger value="shopify" className="px-4">Shopify Payments</TabsTrigger><TabsTrigger value="viabill" className="px-4">ViaBill</TabsTrigger></TabsList></div>
    <TabsContent value="shopify">{kind === 'payment' ? <Payments syncRevision={syncRevision} /> : <LivePayouts syncRevision={syncRevision} />}</TabsContent>
    <TabsContent value="viabill"><ViaBillRecords kind={kind} /></TabsContent>
  </Tabs>;
}
