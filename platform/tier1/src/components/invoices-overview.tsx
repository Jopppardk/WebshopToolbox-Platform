'use client';
// Fakturaer: invoice generation, PDFs and customer mail for the orders on the page.
// Moved out of app/page.tsx unchanged.
import { PageTitle } from '@/platform/workspace';
import { useCapabilities } from '@/platform/capabilities';
import { tier1Fetch as fetch, tier1Url } from '@/platform/transport';
import { useEffect, useState } from 'react';
import { Check, FileText, Mail, RefreshCw, Search } from 'lucide-react';
import { RefreshButton } from '@/components/refresh-button';
import { Button, buttonVariants } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import type { OrderView } from '@/components/sales-orders';
export function Invoices({
  orders,
  onGenerated,
  onSync,
  pagination,
}: {
  pagination: React.ReactNode;
  orders: OrderView[];
  onGenerated: (count: number) => void;
  onSync: () => Promise<void>;
}) {
  const capabilities = useCapabilities();
  const [statuses, setStatuses] = useState<Record<string, string>>({});
  const [pdfVersions, setPdfVersions] = useState<Record<string, string>>({});
  const [emailing, setEmailing] = useState<Record<string, boolean>>({});
  const [query, setQuery] = useState('');
  const [generating, setGenerating] = useState(false);
  const [invoiceError, setInvoiceError] = useState('');
  const [invoiceMessage, setInvoiceMessage] = useState('');
  useEffect(() => {
    fetch('/api/invoices')
      .then(async (response) => {
        if (!response.ok) throw new Error('Fakturastatus kunne ikke indlæses');
        return response.json() as Promise<{
          statuses: Record<string, string>;
          versions?: Record<string, string>;
        }>;
      })
      .then((data) => {
        setStatuses(data.statuses || {});
        setPdfVersions(data.versions || {});
      })
      .catch((error) => setInvoiceError(error.message));
  }, []);
  const generate = async (order: OrderView, regenerate = false) => {
    if (!order.externalId) return;
    const previousStatus = statuses[order.externalId];
    setInvoiceError('');
    setGenerating(true);
    setStatuses((current) => ({
      ...current,
      [order.externalId!]: regenerate ? 'Regenererer…' : 'Genererer…',
    }));
    try {
      const response = await fetch('/api/invoices', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ externalId: order.externalId, regenerate }),
      });
      const data = (await response.json()) as {
        statuses: Record<string, string>;
        versions?: Record<string, string>;
        generated: number;
        error?: string;
      };
      if (!response.ok)
        throw new Error(data.error || 'Fakturaen kunne ikke genereres');
      setStatuses(data.statuses || {});
      setPdfVersions(data.versions || {});
      onGenerated(data.generated);
    } catch (error) {
      setInvoiceError(
        error instanceof Error
          ? error.message
          : 'Fakturaen kunne ikke genereres',
      );
      setStatuses((current) => ({
        ...current,
        [order.externalId!]:
          previousStatus === 'Genereret' ? 'Genereret' : 'Fejlet',
      }));
    } finally {
      setGenerating(false);
    }
  };
  const generateAll = async () => {
    setGenerating(true);
    setInvoiceError('');
    try {
      let offset = 0;
      let count = 0;
      let more = true;
      const warnings: string[] = [];
      while (more) {
        const response = await fetch('/api/invoices', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ all: true, offset }),
        });
        const data = (await response.json()) as {
          statuses: Record<string, string>;
          versions?: Record<string, string>;
          generated: number;
          warnings?: string[];
          hasMore: boolean;
          nextOffset: number;
          error?: string;
        };
        if (!response.ok) throw new Error(data.error);
        warnings.push(...(data.warnings || []));
        setStatuses(data.statuses || {});
        setPdfVersions(data.versions || {});
        count += data.generated || 0;
        more = data.hasMore;
        offset = data.nextOffset;
      }
      onGenerated(count);
      if (warnings.length)
        setInvoiceError(
          `${warnings.length} fakturaer kræver gennemgang. ${warnings.slice(0, 3).join(' ')} Se alle meddelelser under Indstillinger.`,
        );
    } catch (error) {
      setInvoiceError(
        error instanceof Error
          ? error.message
          : 'Fakturaerne kunne ikke genereres',
      );
    } finally {
      setGenerating(false);
    }
  };
  const sendInvoice = async (order: OrderView) => {
    if (!order.externalId) return;
    setInvoiceError('');
    setInvoiceMessage('');
    setEmailing((current) => ({ ...current, [order.externalId!]: true }));
    try {
      const response = await fetch('/api/invoices/email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ externalId: order.externalId }),
      });
      const data = (await response.json()) as {
        sent?: boolean;
        recipient?: string;
        invoiceNumber?: string;
        error?: string;
      };
      if (!response.ok || !data.sent)
        throw new Error(data.error || 'Fakturaen kunne ikke sendes');
      setInvoiceMessage(
        `Faktura ${data.invoiceNumber || order.id.replace(/^#/, '')} er sendt til ${data.recipient}.`,
      );
    } catch (error) {
      setInvoiceError(
        error instanceof Error ? error.message : 'Fakturaen kunne ikke sendes',
      );
    } finally {
      setEmailing((current) => ({ ...current, [order.externalId!]: false }));
    }
  };
  const visibleOrders = orders.filter((order) =>
    order.id.toLowerCase().includes(query.toLowerCase()),
  );

  return (
    <div className="mx-auto max-w-[1440px] px-5 py-7 md:px-8 md:py-9">
      <div className="mb-7 flex flex-col justify-between gap-5 sm:flex-row sm:items-end">
        <div>
          <p className="eyebrow">Dokumenter · Shopify</p>
          <PageTitle title="Fakturaer" />
          <p className="mt-2 text-sm text-muted-foreground">
            Fakturaer oprettes først, når hele ordren er markeret som afsendt i
            Shopify. Opdatér henter nye og ændrede ordrer fra Shopify.
          </p>
        </div>
        <div className="flex gap-2">
          <RefreshButton onRefresh={onSync} />
          <Button
            className="h-10 rounded-xl px-4"
            onClick={generateAll}
            disabled={generating || !orders.length}
          >
            <FileText />
            {generating ? 'Genererer…' : 'Generér alle manglende'}
          </Button>
        </div>
      </div>
      {invoiceError && (
        <p
          role="alert"
          className="mb-4 rounded-xl border border-red-200 p-4 text-sm text-red-700"
        >
          {invoiceError}
        </p>
      )}
      {invoiceMessage && (
        <p
          role="status"
          className="mb-4 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800"
        >
          {invoiceMessage}
        </p>
      )}
      <p className="mb-4 text-sm text-muted-foreground">
        En genereret faktura kan sendes manuelt til kundens mailadresse fra
        Shopify. Eksisterende PDF’er bevares, og ændrede fakturaer kræver
        særskilt gennemgang.
      </p>
      <section className="overflow-hidden rounded-2xl border bg-white">
        <div className="border-b p-4">
          <div className="relative max-w-[320px]">
            <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              className="h-10 bg-muted/50 pl-9"
              placeholder="Søg ordrenummer"
            />
          </div>
        </div>
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/45">
              <TableHead className="pl-5">Ordrenummer</TableHead>
              <TableHead>Ordredato</TableHead>
              <TableHead className="text-right">Beløb</TableHead>
              <TableHead>Fakturastatus</TableHead>
              <TableHead>
                <span className="sr-only">Handling</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {visibleOrders.map((order) => {
              const savedStatus = order.externalId
                ? statuses[order.externalId]
                : null;
              const status =
                savedStatus === 'Genereret'
                  ? savedStatus
                  : order.shipped === 'Annulleret'
                    ? 'Annulleret · ingen faktura'
                    : savedStatus ||
                      (order.shipped === 'Afsendt'
                        ? 'Afventer'
                        : 'Afventer afsendelse');
              return (
                <TableRow
                  key={order.id}
                  className={status === 'Fejlet' ? 'bg-red-50/35' : ''}
                >
                  <TableCell className="pl-5 font-semibold text-[#8a6636]">
                    {order.id}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {order.date}
                  </TableCell>
                  <TableCell className="text-right font-medium tabular-nums">
                    {order.amount} {order.currency || 'DKK'}
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant={
                        status === 'Fejlet' ? 'destructive' : 'secondary'
                      }
                      className={
                        status === 'Genereret'
                          ? 'badge-booked'
                          : 'badge-pending'
                      }
                    >
                      {status === 'Genereret' && <Check />}
                      {status}
                    </Badge>
                  </TableCell>
                  <TableCell className="pr-5 text-right">
                    {status === 'Genereret' ? (
                      <div className="flex flex-wrap justify-end gap-1">
                        <a
                          className={buttonVariants({
                            variant: 'outline',
                            size: 'sm',
                          })}
                          href={tier1Url(
                            `/api/invoices/pdf?externalId=${encodeURIComponent(order.externalId || '')}&v=${encodeURIComponent(pdfVersions[order.externalId || ''] || 'legacy')}`,
                          )}
                          target="_blank"
                          rel="noreferrer"
                        >
                          <FileText />
                          PDF
                        </a>
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={
                            !capabilities.customerEmail ||
                            emailing[order.externalId || '']
                          }
                          title={
                            capabilities.customerEmail
                              ? undefined
                              : 'Kundemail er blokeret i testmiljøet'
                          }
                          onClick={() => sendInvoice(order)}
                        >
                          <Mail />
                          {emailing[order.externalId || '']
                            ? 'Sender…'
                            : 'Send til kunde'}
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          disabled
                          title="Eksisterende bilag bevares uændret"
                          onClick={() => generate(order, true)}
                        >
                          <RefreshCw />
                          Regenerér
                        </Button>
                      </div>
                    ) : order.shipped === 'Annulleret' ? null : (
                      <div className="flex justify-end gap-1">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => generate(order)}
                          disabled={
                            generating ||
                            order.shipped !== 'Afsendt' ||
                            status === 'Genererer…' ||
                            status === 'Regenererer…'
                          }
                        >
                          <FileText />
                          {status === 'Fejlet' ? 'Generér igen' : 'Generér'}
                        </Button>
                      </div>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
        {pagination}
      </section>
      {!orders.length && (
        <div className="mt-4 rounded-xl border border-dashed bg-white p-8 text-center text-sm text-muted-foreground">
          Ingen Shopify-ordrer er hentet endnu. Forbind Shopify under
          Indstillinger, og vælg derefter “Opdatér”.
        </div>
      )}
    </div>
  );
}
