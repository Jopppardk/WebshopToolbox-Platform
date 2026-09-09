export const integrationCatalog = [
  {id:'shopify',name:'Shopify',description:'Hent salg, tilbagebetalinger, udbetalinger, lager og emballagedata.',category:'Webshop'},
  {id:'dinero',name:'Dinero',description:'Overfør bilag, hent kontoplan og følg økonomien på dashboardet.',category:'Regnskab'},
  {id:'viabill',name:'ViaBill',description:'Forbind din Merchant Account og hent betalinger og afregningsdata.',category:'Betaling'},
  {id:'emballage',name:'Emballage Indberetning',description:'Indberet kvartalets emballage til husholdning og erhverv, og følg status.',category:'Producentansvar'},
] as const;
export type IntegrationId = typeof integrationCatalog[number]['id'];
export type IntegrationSelection = {selected:IntegrationId[];connected:IntegrationId[]};
