'use client';

import { ArrowRight, Link2 } from 'lucide-react';
import { Button } from '@/components/ui/button';

const providerNames: Record<string, string> = {
  shopify: 'Shopify',
  dinero: 'Dinero',
  flatpay: 'Flatpay',
  viabill: 'ViaBill',
  pensopay: 'Pensopay',
};

export function IntegrationRequired({
  title,
  providers,
  onIntegrations,
}: {
  title: string;
  providers: readonly string[];
  onIntegrations: () => void;
}) {
  const names = providers.map(
    (provider) => providerNames[provider] || provider,
  );
  const providerText =
    names.length === 1
      ? names[0]
      : `${names.slice(0, -1).join(', ')} eller ${names.at(-1)}`;
  return (
    <div className="mx-auto max-w-[1440px] px-5 py-7 md:px-8 md:py-9">
      <section className="grid min-h-[460px] place-items-center rounded-3xl border border-dashed border-[#d8c8b1] bg-[radial-gradient(circle_at_top,#fffaf2,white_65%)] p-8 text-center">
        <div className="max-w-lg">
          <span className="mx-auto grid size-20 place-items-center rounded-3xl bg-[#f4eadc] text-[#8a6636] shadow-sm">
            <Link2 className="size-9" aria-hidden="true" />
          </span>
          <p className="eyebrow mt-7">Integration mangler</p>
          <h1 className="page-title mt-2">
            Forbind {providerText} for at bruge {title}
          </h1>
          <p className="mt-4 text-sm leading-6 text-muted-foreground">
            Siden bliver klar, så snart den relevante integration er testet og
            forbundet. Dine integrationsoplysninger administreres samlet under
            Indstillinger.
          </p>
          <Button className="mt-7" onClick={onIntegrations}>
            Gå til integrationer
            <ArrowRight />
          </Button>
        </div>
      </section>
    </div>
  );
}
