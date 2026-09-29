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
