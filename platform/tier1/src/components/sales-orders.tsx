'use client';
// Salg: the order row (with order view, label printing and booking actions) and the summary tiles.
// Moved out of app/page.tsx unchanged.
import { OrderLog } from '@/components/order-log';
import { OrderDetail } from '@/components/order-detail';
import { LabelPrint, type LabelState } from '@/components/label-print';
import { SalesPreview } from '@/components/sales-preview';
import { ManualBookingAction } from '@/components/manual-booking-action';
import { CountryFlag } from '@/components/country-flag';
import { BookOpenCheck } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { TableCell, TableRow } from '@/components/ui/table';

export type OrderView = {
  id: string;
  date: string;
  shipped: string;
  amount: string;
  realized: string;
  status: string;
  externalId?: string;
  createdAt?: string;
  currency?: string;
  total?: string;
  customer?: {
    name?: string | null;
    address1?: string | null;
    address2?: string | null;
    zip?: string | null;
    city?: string | null;
    country?: string | null;
  } | null;
  lines?: Array<{
    name: string;
    quantity: number;
    discountedTotalSet: { shopMoney: { amount: string; currencyCode: string } };
  }>;
  shippingLines?: Array<{
    title: string;
    discountedPriceSet: { shopMoney: { amount: string; currencyCode: string } };
  }>;
  paymentProvider?: string;
  subtotal?: string;
  tax?: string;
  paymentStatus?: string | null;
  country?: string | null;
  customerCurrency?: string | null;
  customerTotal?: string | null;
  label?: LabelState;
};

export function Stat({
  label,
  value,
  note,
  tone,
}: {
  label: string;
  value: string;
  note: string;
  tone?: 'lime' | 'warn';
}) {
  return (
    <div className={`stat-card ${tone === 'lime' ? 'stat-lime' : ''}`}>
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs font-medium text-muted-foreground">{label}</p>
          <p className="mt-2 text-xl font-semibold tracking-tight">{value}</p>
        </div>
        {tone === 'warn' && (
          <span className="mt-1 size-2 rounded-full bg-amber-400" />
        )}
      </div>
      <p
        className={`mt-2 text-xs ${tone === 'lime' ? 'text-[#427209]' : 'text-muted-foreground'}`}
      >
        {note}
      </p>
    </div>
  );
}

export function OrderRow({
  order,
  labels,
  onBooked,
}: {
  order: OrderView;
  labels: boolean;
  onBooked: () => void;
}) {
  const state = order.status;
  const booked = state === 'Bogført';
  const handled = booked || state === 'Annulleret';
  return (
    <TableRow className={state === 'Fejlet' ? 'bg-red-50/35' : ''}>
      <TableCell className="pl-5 font-semibold text-[#365f08]">
        <span className="inline-flex items-center gap-2">
          {order.country ? (
            <CountryFlag code={order.country} />
          ) : (
            <span className="inline-block w-5" aria-hidden="true" />
          )}
          {order.externalId ? (
            <OrderDetail externalId={order.externalId} label={order.id} />
          ) : (
            order.id
          )}
        </span>
      </TableCell>
      <TableCell className="text-muted-foreground">{order.date}</TableCell>
      <TableCell>{order.paymentProvider || 'Afventer opdatering'}</TableCell>
      <TableCell>
        <span
          className={`status-dot ${order.shipped === 'Afsendt' ? 'ok' : 'wait'}`}
        />
        {order.shipped}
      </TableCell>
      <TableCell className="text-right font-medium tabular-nums">
        {order.amount} {order.currency || 'DKK'}
        {order.customerTotal && (
          <span className="block text-xs font-normal text-muted-foreground">
            Kunden betalte {order.customerTotal}
          </span>
        )}
      </TableCell>
      <TableCell className="text-muted-foreground">{order.realized}</TableCell>
      <TableCell>
        <Badge
          variant={state.startsWith('Fejlet') ? 'destructive' : 'secondary'}
          className={
            state === 'Bogført' || state === 'Annulleret'
              ? 'badge-booked'
              : state === 'Afventer' || state === 'Bogfører…'
                ? 'badge-pending'
                : ''
          }
        >
          {state === 'Bogført' && <BookOpenCheck />}
          {state}
        </Badge>
      </TableCell>
      <TableCell className="pr-5 text-right">
        {order.externalId && (
          <div className="flex flex-wrap items-start justify-end gap-2">
            {labels && order.shipped !== 'Annulleret' && (
              <div className="text-right">
                <LabelPrint
                  externalId={order.externalId}
                  orderName={order.id}
                  label={order.label ?? null}
                  onDone={onBooked}
                />
              </div>
            )}
            {order.shipped === 'Afsendt' && !handled && (
              <SalesPreview externalId={order.externalId} />
            )}
            <OrderLog externalId={order.externalId} />
            {order.shipped === 'Afsendt' && !handled && (
              <ManualBookingAction
                kind="sale"
                externalId={order.externalId}
                onDone={onBooked}
              />
            )}
          </div>
        )}
      </TableCell>
    </TableRow>
  );
}
