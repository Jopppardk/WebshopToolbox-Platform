export const integrationCatalog = [
  {id:'shopify',name:'Shopify',description:'Hent salg, tilbagebetalinger, udbetalinger, lager og emballagedata.',category:'Webshop'},
  {id:'dinero',name:'Dinero',description:'Overfør bilag, hent kontoplan og følg økonomien på dashboardet.',category:'Regnskab'},
  {id:'viabill',name:'ViaBill',description:'Forbind din Merchant Account og hent betalinger og afregningsdata.',category:'Betaling'},
] as const;
export type IntegrationId = typeof integrationCatalog[number]['id'];
export type IntegrationSelection = {selected:IntegrationId[];connected:IntegrationId[]};
