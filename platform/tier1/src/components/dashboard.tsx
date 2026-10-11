'use client';
import { formatDateTime } from '@/lib/format';
import { tier1Fetch as fetch } from '@/platform/transport';
import { useEffect, useState } from 'react';
import { ArrowRight, Landmark, ShoppingBag, CheckCircle2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { RefreshButton } from '@/components/refresh-button';
import { AttentionList, type AttentionView } from '@/components/attention-list';
import { WebshopCards } from '@/components/webshop-cards';
import {
  CompanyFinanceCard,
  ShopFinanceCards,
} from '@/components/finance-cards';
import { useWorkspace } from '@/platform/workspace';
import { type calculateFinance } from '@/lib/dashboard-finance';

type Finance = {
  ready: boolean;
  data: ReturnType<typeof calculateFinance> | null;
  message?: string;
  checkedAt?: string;
  through?: string;
  stale?: boolean;
};
const timestamp = (value: string) => formatDateTime(value);
type DashboardProps = {
  onIntegrations: (provider?: 'dinero' | 'shopify') => void;
  onOpen: (view: AttentionView) => void;
};
export function Dashboard(props: DashboardProps) {
  const [connections, setConnections] = useState<Set<string> | null>(null);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setError('');
    setConnections(null);
    fetch('/api/integrations', { cache: 'no-store', signal: controller.signal })
      .then(async (response) => {
        const data = (await response.json()) as {
          integrations?: Array<{ provider: string }>;
          error?: string;
        };
        if (!response.ok || !Array.isArray(data.integrations))
          throw new Error(
            data.error || 'Forbindelsesstatus kunne ikke hentes.',
          );
        if (!controller.signal.aborted)
          setConnections(
            new Set(data.integrations.map((item) => item.provider)),
          );
      })
      .catch((error) => {
        if (!controller.signal.aborted)
          setError(
            error instanceof Error
              ? error.message
              : 'Forbindelsesstatus kunne ikke hentes.',
          );
      });
    return () => controller.abort();
  }, [revision]);
  if (error)
    return (
      <div role="alert" className="rounded-2xl border bg-white p-8">
        <p>{error}</p>
        <Button
          className="mt-4"
          variant="outline"
          onClick={() => setRevision((value) => value + 1)}
        >
          Prøv igen
        </Button>
      </div>
    );
  if (!connections)
    return (
      <p role="status" className="p-8 text-muted-foreground">
        Kontrollerer dine forbindelser…
      </p>
    );
  if (connections.has('dinero') && connections.has('shopify'))
    return (
      <ConnectedDashboard
        {...props}
        onIntegrations={() => props.onIntegrations()}
      />
    );
  return (
    <section
      aria-labelledby="connect-heading"
      className="mx-auto max-w-4xl py-8 sm:py-14"
    >
      <div className="mb-8 text-center">
        <h2 id="connect-heading" className="text-2xl font-semibold">
          Forbind din virksomhed
        </h2>
        <p className="mt-3 text-muted-foreground">
          Forbind Dinero og din webshop for at komme i gang. Herefter vises dit
          dashboard her.
        </p>
      </div>
      <div className="grid gap-6 sm:grid-cols-2">
        {(
          [
            {
              provider: 'dinero',
              name: 'Dinero',
              description: 'Dit regnskabsprogram',
              Icon: Landmark,
            },
            {
              provider: 'shopify',
              name: 'Webshop',
              description: 'Forbind din Shopify-butik',
              Icon: ShoppingBag,
            },
          ] as const
        ).map(({ provider, name, description, Icon }) => {
          const connected = connections.has(provider);
          return (
            <button
              key={provider}
              type="button"
              onClick={() => props.onIntegrations(provider)}
              className="group flex min-h-72 flex-col items-center justify-center rounded-2xl border border-[#e9e2d7] bg-white p-8 text-center transition hover:border-[#c09960] hover:shadow-md focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring"
            >
              <span
                className={`mb-5 grid size-24 place-items-center rounded-3xl ${connected ? 'bg-emerald-50 text-emerald-700' : 'bg-[#f4eadb] text-[#9a7440]'}`}
              >
                <Icon className="size-12" aria-hidden="true" />
              </span>
              <span className="text-xl font-semibold">{name}</span>
              <span className="mt-2 text-sm text-muted-foreground">
                {description}
              </span>
              <span
                className={`mt-6 flex items-center gap-2 text-sm font-medium ${connected ? 'text-emerald-700' : 'text-[#9a7440]'}`}
              >
                {connected ? (
                  <>
                    <CheckCircle2 className="size-4" />
                    Forbundet · Se integration
                  </>
                ) : (
                  <>
                    Forbind {name}
                    <ArrowRight className="size-4" />
                  </>
                )}
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
function ConnectedDashboard({
  onIntegrations,
  onOpen,
}: {
  onIntegrations: () => void;
  onOpen: (view: AttentionView) => void;
}) {
  const { company } = useWorkspace();
  const [finance, setFinance] = useState<Finance | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({}),
    [revision, setRevision] = useState(0),
    [loading, setLoading] = useState(true);
  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    const load = async () => {
      setLoading(true);
      // Today's activity is read per webshop by the webshop cards.
      await Promise.all(
        ['finance'].map(async (kind) => {
          try {
            const response = await fetch('/api/dashboard/' + kind, {
              cache: 'no-store',
              signal: AbortSignal.any([
                controller.signal,
                AbortSignal.timeout(90000),
              ]),
            });
            const value = (await response.json()) as Finance & {
              error?: string;
            };
            if (!response.ok)
              throw new Error(value.error || 'Data kunne ikke hentes.');
            if (!active) return;
            setFinance(value);
            setErrors((current) => ({ ...current, [kind]: '' }));
          } catch (error) {
            if (active)
              setErrors((current) => ({
                ...current,
                [kind]:
                  error instanceof Error
                    ? error.message
                    : 'Data kunne ikke hentes.',
              }));
          }
        }),
      );
      if (active) setLoading(false);
    };
    let running = false;
    const refresh = async () => {
      if (running) return;
      running = true;
      try {
        await load();
      } finally {
        running = false;
      }
    };
    const initial = window.setTimeout(() => {
      void refresh();
    }, 0);
    const timer = window.setInterval(() => {
      if (!document.hidden) void refresh();
    }, 60000);
    return () => {
      active = false;
      controller.abort();
      window.clearTimeout(initial);
      window.clearInterval(timer);
    };
  }, [revision]);
  const data = errors.finance ? null : finance?.data;
  return (
    <div className="mx-auto max-w-[1440px] px-5 py-7 md:px-8 md:py-9">
      <header className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="eyebrow">WebshopToolbox · Overblik</p>
          <h1 className="page-title">Dashboard</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Din økonomi og drift, samlet ét sted.
          </p>
        </div>
        <RefreshButton
          onRefresh={() => setRevision((v) => v + 1)}
          disabled={loading}
        />
      </header>
      <WebshopCards revision={revision} onIntegrations={onIntegrations} />
      <AttentionList onOpen={onOpen} revision={revision} />
      <section aria-labelledby="finance-heading">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <h2 id="finance-heading" className="text-lg font-semibold">
            Økonomi
          </h2>
          <span className="rounded-full border bg-white px-3 py-1 text-xs text-muted-foreground">
            Omsætning ekskl. moms · sammenlignet med samme dato sidste år
          </span>
        </div>
        <ShopFinanceCards revision={revision} />
        <div className="mt-4">
          <CompanyFinanceCard
            name={company.name}
            notes={[errors.finance || finance?.message || ''].filter(Boolean)}
            figures={{
              periods: data?.periods ?? null,
              revenueMtd: data?.revenueMtd ?? null,
              revenueYtd: data?.revenueYtd ?? null,
              previousMtd: data?.previousMtd ?? null,
              previousYtd: data?.previousYtd ?? null,
              inventory: data?.inventory ?? null,
              profitMtd: data?.profitMtd ?? null,
              profitYtd: data?.profitYtd ?? null,
            }}
          />
        </div>
        <p className="mt-3 text-xs text-muted-foreground">
          {finance?.checkedAt
            ? 'Dinero senest hentet ' + timestamp(finance.checkedAt) + '. '
            : ''}
          {finance?.stale
            ? 'Data fra Dinero er forsinkede; opdatering afventes. '
            : ''}
          Webshoppernes omsætning kommer fra Shopify Analytics (salg inkl. fragt
          og gebyrer, efter rabatter og returneringer, ekskl. moms), og
          lagerværdien er kostpris gange lagerantal i Shopify. {company.name}{' '}
          samlet er de bogførte tal i Dinero for hele virksomheden, så summen af
          webshops kan afvige, fx på grund af bogføringstidspunkt eller salg
          uden for webshops. Overskud er før skat og efter bogførte
          omkostninger; ikke-fradragsberettiget moms kan indgå i omkostningerne.
          Måned og år til dato følger kalenderen til og med i dag. — betyder, at
          datagrundlaget mangler eller ligger før historikstart.
        </p>
      </section>
    </div>
  );
}
