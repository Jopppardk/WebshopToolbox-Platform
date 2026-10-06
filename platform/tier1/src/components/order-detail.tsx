'use client';
// Salg → click an order: everything about it in one place. The invoice and its mail, the booking in Dinero,
// each refund with its credit note, mail and booking, and the order's log.
import { useEffect, useState, type ReactNode } from 'react';
import {
  BookOpenCheck,
  CircleAlert,
  FileDown,
  LoaderCircle,
  Mail,
  ReceiptText,
  RotateCcw,
} from 'lucide-react';
import { tier1Fetch as fetch, tier1Url } from '@/platform/transport';
import { formatDateTime } from '@/lib/format';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { CountryFlag } from '@/components/country-flag';
import type { PayoutLogData } from '@/lib/payout-log';

type Booking = {
  phase: string;
  voucherNumber: number | string | null;
  guid: string | null;
  reference: string | null;
  organizationId: string | null;
  at: string | null;
  reconciled?: boolean;
  legacy?: boolean;
} | null;
type MailState = {
  phase: string;
  recipient: string | null;
  from: string | null;
  at: string | null;
} | null;
type Detail = {
  order: {
    externalId: string;
    name: string;
    createdAt: string;
    country: string | null;
    currency: string;
    customer: string | null;
    amount: number;
    realized: number | null;
    customerTotal: { amount: number; currency: string } | null;
    paymentProvider: string;
    financial: string | null;
    shipped: string;
    status: string;
    market: { name: string; storeName: string; currency: string } | null;
  };
  invoice: {
    id: string;
    status: string;
    createdAt: string | null;
    currency: string;
    mail: MailState;
  } | null;
  booking: Booking;
  refunds: Array<{
    id: string;
    date: string;
    amount: number;
    currency: string;
    full: boolean;
    gateways: string[];
    problem: string | null;
    creditNote: { number: string; mail: MailState } | null;
    booking: Booking;
    status: string;
  }>;
};
const money = (amount: number, currency: string) =>
  new Intl.NumberFormat('da-DK', { style: 'currency', currency }).format(
    amount,
  );
const when = (value: string | null | undefined) =>
  value ? formatDateTime(value, value) : '—';
const bookingText: Record<string, string> = {
  booked: 'Bogført i Dinero',
  draft: 'Kladde i Dinero',
  prepared: 'Forberedt, ikke overført',
  creating: 'Overføres…',
  booking: 'Bogføres…',
  uncertain: 'Uafklaret – kræver kontrol',
};
const mailText: Record<string, string> = {
  accepted: 'Sendt',
  sending: 'Sendes…',
  uncertain: 'Uafklaret – kontrollér før ny afsendelse',
};

function Section({
  icon,
  title,
  children,
}: {
  icon: ReactNode;
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="rounded-xl border bg-white p-4">
      <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold">
        {icon}
        {title}
      </h3>
      {children}
    </section>
  );
}
function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)] gap-3 py-1 text-sm">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="break-words text-right">{children}</dd>
    </div>
  );
}
function BookingRows({ booking }: { booking: Booking }) {
  if (!booking) return <Row label="Bogføring">Ikke bogført endnu</Row>;
  return (
    <dl>
      <Row label="Status">
        <Badge
          variant="secondary"
          className={
            booking.phase === 'booked'
              ? 'badge-booked'
              : booking.phase === 'uncertain'
                ? 'bg-red-50 text-red-800'
                : 'badge-pending'
          }
        >
          {booking.legacy
            ? 'Bogført via Shopify Payments-posten'
            : booking.reconciled
              ? booking.phase === 'booked'
                ? 'Afstemt med eksisterende bilag'
                : 'Afstemt med eksisterende kladde'
              : bookingText[booking.phase] || booking.phase}
        </Badge>
      </Row>
      {booking.voucherNumber != null && (
        <Row label="Bilagsnummer i Dinero">{booking.voucherNumber}</Row>
      )}
      {booking.reference && <Row label="Reference">{booking.reference}</Row>}
      {booking.guid && (
        <Row label="Dinero bilags-ID">
          <span className="font-mono text-xs">{booking.guid}</span>
        </Row>
      )}
      {booking.at && <Row label="Senest ændret">{when(booking.at)}</Row>}
    </dl>
  );
}
function MailRows({ mail, missing }: { mail: MailState; missing: string }) {
  if (!mail) return <Row label="Mail til kunden">{missing}</Row>;
  return (
    <dl>
      <Row label="Mail til kunden">
        <Badge
          variant="secondary"
          className={
            mail.phase === 'accepted'
              ? 'badge-booked'
              : mail.phase === 'uncertain'
                ? 'bg-red-50 text-red-800'
                : 'badge-pending'
          }
        >
          {mailText[mail.phase] || mail.phase}
        </Badge>
      </Row>
      {mail.recipient && <Row label="Modtager">{mail.recipient}</Row>}
      {mail.from && <Row label="Afsender">{mail.from}</Row>}
      <Row label="Tidspunkt">{when(mail.at)}</Row>
    </dl>
  );
}

export function OrderDetail({
  externalId,
  label,
}: {
  externalId: string;
  label: ReactNode;
}) {
  const [open, setOpen] = useState(false),
    [detail, setDetail] = useState<Detail | null>(null),
    [log, setLog] = useState<PayoutLogData | null>(null),
    [error, setError] = useState(''),
    [revision, setRevision] = useState(0);
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    setError('');
    void (async () => {
      try {
        const [d, l] = await Promise.all([
          fetch(
            '/api/orders/detail?externalId=' + encodeURIComponent(externalId),
            { cache: 'no-store', signal: controller.signal },
          ),
          fetch(
            '/api/sales/log?provider=shopify&externalId=' +
              encodeURIComponent(externalId),
            { cache: 'no-store', signal: controller.signal },
          ),
        ]);
        const dd = (await d.json()) as Detail & { error?: string },
          ll = (await l.json()) as PayoutLogData & { error?: string };
        if (!d.ok) throw Error(dd.error || 'Ordren kunne ikke hentes.');
        if (!controller.signal.aborted) {
          setDetail(dd);
          setLog(l.ok ? ll : null);
        }
      } catch (e) {
        if (!controller.signal.aborted)
          setError(
            e instanceof Error ? e.message : 'Ordren kunne ikke hentes.',
          );
      }
    })();
    return () => controller.abort();
  }, [open, externalId, revision]);
  const o = detail?.order;
  return (
    <>
      <button
        type="button"
        className="font-semibold text-[#365f08] underline-offset-4 hover:underline"
        onClick={() => {
          setDetail(null);
          setLog(null);
          setOpen(true);
        }}
        title="Vis alt om ordren"
      >
        {label}
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {o?.country && <CountryFlag code={o.country} />}Ordre{' '}
              {o?.name || ''}
            </DialogTitle>
            <DialogDescription>
              {o
                ? `${when(o.createdAt)} · ${o.paymentProvider} · ${o.shipped}`
                : 'Henter ordren…'}
            </DialogDescription>
          </DialogHeader>
          {error && (
            <p
              role="alert"
              className="flex items-center gap-2 rounded-xl bg-red-50 p-3 text-sm text-red-800"
            >
              <CircleAlert className="size-4" />
              {error}
              <Button
                size="sm"
                variant="outline"
                className="ml-auto"
                onClick={() => setRevision((v) => v + 1)}
              >
                Prøv igen
              </Button>
            </p>
          )}
          {!detail && !error && (
            <p
              role="status"
              className="flex items-center gap-2 text-sm text-muted-foreground"
            >
              <LoaderCircle className="size-4 animate-spin" />
              Henter faktura, bogføring og log…
            </p>
          )}
          {detail && o && (
            <div className="grid gap-4">
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="rounded-xl border bg-[#fcfbf9] p-3">
                  <p className="text-xs text-muted-foreground">Ordrebeløb</p>
                  <p className="mt-1 text-lg font-semibold tabular-nums">
                    {money(o.amount, o.currency)}
                  </p>
                  {o.customerTotal && (
                    <p className="text-xs text-muted-foreground">
                      Kunden betalte{' '}
                      {money(o.customerTotal.amount, o.customerTotal.currency)}
                    </p>
                  )}
                </div>
                <div className="rounded-xl border bg-[#fcfbf9] p-3">
                  <p className="text-xs text-muted-foreground">Realiseret</p>
                  <p className="mt-1 text-lg font-semibold tabular-nums">
                    {o.realized != null ? money(o.realized, o.currency) : '—'}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Efter tilbagebetalinger
                  </p>
                </div>
                <div className="rounded-xl border bg-[#fcfbf9] p-3">
                  <p className="text-xs text-muted-foreground">Status</p>
                  <p className="mt-1 text-sm font-semibold">{o.status}</p>
                  {o.market && (
                    <p className="text-xs text-muted-foreground">
                      Marked: {o.market.storeName} ({o.market.currency})
                    </p>
                  )}
                </div>
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                <Section
                  icon={<ReceiptText className="size-4 text-[#9a7440]" />}
                  title="Faktura"
                >
                  {detail.invoice?.status === 'generated' ? (
                    <>
                      <dl>
                        <Row label="Fakturanummer">
                          {o.name.replace(/^#/, '')}
                        </Row>
                        {o.customer && <Row label="Kunde">{o.customer}</Row>}
                        <Row label="Valuta">{detail.invoice.currency}</Row>
                        <Row label="Dannet">
                          {when(detail.invoice.createdAt)}
                        </Row>
                      </dl>
                      <MailRows
                        mail={detail.invoice.mail}
                        missing="Ikke sendt"
                      />
                      <Button
                        className="mt-3"
                        size="sm"
                        variant="outline"
                        render={
                          <a
                            href={tier1Url(
                              '/api/invoices/pdf?externalId=' +
                                encodeURIComponent(o.externalId),
                            )}
                            target="_blank"
                            rel="noreferrer"
                          />
                        }
                      >
                        <FileDown />
                        Faktura (PDF)
                      </Button>
                    </>
                  ) : (
                    <p className="text-sm text-muted-foreground">
                      {detail.invoice
                        ? 'Fakturaen er under dannelse eller kræver kontrol.'
                        : 'Der er ikke dannet en faktura endnu.'}
                    </p>
                  )}
                </Section>
                <Section
                  icon={<BookOpenCheck className="size-4 text-[#9a7440]" />}
                  title="Bogføring af salget"
                >
                  <BookingRows booking={detail.booking} />
                </Section>
              </div>
              <Section
                icon={<RotateCcw className="size-4 text-[#9a7440]" />}
                title={`Tilbagebetalinger og kreditnotaer (${detail.refunds.length})`}
              >
                {!detail.refunds.length ? (
                  <p className="text-sm text-muted-foreground">
                    Ingen tilbagebetalinger på ordren.
                  </p>
                ) : (
                  <div className="grid gap-3">
                    {detail.refunds.map((r) => (
                      <div key={r.id} className="rounded-lg border p-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <p className="text-sm font-medium">
                            {when(r.date)} · {r.full ? 'Fuld' : 'Delvis'} ·{' '}
                            {r.gateways.join(', ') || '—'}
                          </p>
                          <p className="font-semibold tabular-nums">
                            {money(r.amount, r.currency)}
                          </p>
                        </div>
                        {r.problem && (
                          <p className="mt-1 text-xs text-red-700">
                            {r.problem}
                          </p>
                        )}
                        <div className="mt-2 grid gap-3 md:grid-cols-2">
                          <div>
                            {r.creditNote ? (
                              <>
                                <dl>
                                  <Row label="Kreditnota">
                                    {r.creditNote.number}
                                  </Row>
                                </dl>
                                <MailRows
                                  mail={r.creditNote.mail}
                                  missing="Ikke sendt"
                                />
                                <Button
                                  className="mt-2"
                                  size="sm"
                                  variant="outline"
                                  render={
                                    <a
                                      href={tier1Url(
                                        '/api/order-refunds/credit-note?externalId=' +
                                          encodeURIComponent(r.id),
                                      )}
                                      target="_blank"
                                      rel="noreferrer"
                                    />
                                  }
                                >
                                  <FileDown />
                                  Kreditnota (PDF)
                                </Button>
                              </>
                            ) : (
                              <p className="text-sm text-muted-foreground">
                                {detail.invoice?.status === 'generated'
                                  ? 'Kreditnotaen dannes ved bogføring eller afsendelse.'
                                  : 'Ingen kreditnota – ordren er ikke faktureret her.'}
                              </p>
                            )}
                          </div>
                          <div>
                            <BookingRows booking={r.booking} />
                            {!r.booking && (
                              <p className="text-xs text-muted-foreground">
                                {r.status}
                              </p>
                            )}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </Section>
              <Section
                icon={<Mail className="size-4 text-[#9a7440]" />}
                title="Log"
              >
                {!log ? (
                  <p className="text-sm text-muted-foreground">
                    Loggen kunne ikke hentes.
                  </p>
                ) : (
                  <ol className="ml-2 space-y-4 border-l py-1">
                    {log.events.map((event) => (
                      <li key={event.id} className="relative pl-5">
                        <span
                          className={
                            'absolute -left-1.5 top-1.5 size-3 rounded-full border-2 border-white ' +
                            (event.tone === 'success'
                              ? 'bg-emerald-500'
                              : event.tone === 'warning'
                                ? 'bg-amber-500'
                                : 'bg-slate-400')
                          }
                        />
                        <p className="text-sm font-medium">{event.title}</p>
                        <p className="text-xs text-muted-foreground">
                          {when(event.at)}
                          {event.detail ? ' · ' + event.detail : ''}
                        </p>
                      </li>
                    ))}
                  </ol>
                )}
              </Section>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
