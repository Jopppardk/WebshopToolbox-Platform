export const integrationRequirements = {
  orders:{title:'Salg',providers:['shopify']},
  invoices:{title:'Fakturaer',providers:['shopify']},
  refunds:{title:'Tilbagebetalinger',providers:['shopify','flatpay']},
  payouts:{title:'Udbetalinger',providers:['shopify','flatpay','viabill','pensopay']},
  inventory:{title:'Lager',providers:['shopify']},
  packaging:{title:'Emballage',providers:['shopify']},
  documents:{title:'Udbetalingsrapporter',providers:['shopify','flatpay']},
  feeds:{title:'Produktfeeds',providers:['shopify']},
} as const;

export type IntegrationGatedView=keyof typeof integrationRequirements;

export function hasRequiredIntegration(view:IntegrationGatedView,connected:ReadonlySet<string>) {
  return integrationRequirements[view].providers.some(provider=>connected.has(provider));
}

// Modules an integration feeds but which need no gate: Dinero supplies the dashboard's
// finance figures, and Emballage Indberetning receives the packaging report.
const ungatedModules: Record<string, readonly string[]> = { dinero: ['Dashboard'], emballage: ['Emballage'] };

/** The modules an integration delivers data into, in menu order, e.g. "Understøtter: Salg og Lager". */
export function supportedModules(provider: string) {
  const titles = [...(ungatedModules[provider] || []), ...Object.values(integrationRequirements).filter(view => (view.providers as readonly string[]).includes(provider)).map(view => view.title)];
  const unique = [...new Set(titles)];
  return 'Understøtter: ' + (unique.length < 2 ? unique.join('') : `${unique.slice(0, -1).join(', ')} og ${unique.at(-1)}`);
}
