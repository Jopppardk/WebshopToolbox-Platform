export type IntegrationGuide = {
  title: string;
  needs: string;
  note?: string;
  steps: string[];
  troubleshoot: string;
  sources: { label: string; url: string }[];
};

// Provider documentation checked 2026-09-28. UI labels below match this portal.
export const integrationGuides: Record<string, IntegrationGuide> = {
  Shopify: {
    title: 'Shopify og Shopify Payments',
    needs:
      'Butikkens myshopify.com-adresse, Client ID og Client Secret fra en app i din egen Shopify-organisation.',
    note: 'Appen og butikken skal tilhøre samme Shopify-organisation. Denne opsætning bruger Client Credentials Grant. Et Storefront-token eller en midlertidig Admin API-tokenværdi kan ikke indsættes i Client Secret-feltet.',
    steps: [
      'Log ind i Shopify Dev Dashboard med en bruger, som må udvikle og installere apps. Vælg den organisation, der ejer din butik.',
      'Åbn Apps → Create app → Start from Dev Dashboard. Giv appen et genkendeligt navn, fx WebshopToolbox, og vælg Create.',
      'Opret en version under Versions. Appen bruges uden indlejret brugerflade; Shopifys officielle standard-App URL er https://shopify.dev/apps/default-app-home. Vælg rettighederne nedenfor til de moduler, du bruger, og vælg Release.',
      'Til salg og tilbagebetalinger: read_orders. Til produktfeeds: read_products. Til lager: read_inventory og read_products samt adgang til kostpriser; read_locations giver lokationernes navne (ellers vises de som "Lokation" og et nummer). Til Shopify Payments: read_shopify_payments_accounts og read_shopify_payments_payouts. Lageroptælling, der skal ændre antal i Shopify, kræver desuden write_inventory. Til emballage: read_products samt write_products, så WebshopToolbox kan oprette de fem emballagefelter på produkterne (kun feltdefinitionerne; produkter og værdier ændres ikke). Giv kun de relevante rettigheder.',
      'Ordrehistorik ældre end 60 dage kræver også read_all_orders og Shopifys godkendelse. Adgang til beskyttede kundeoplysninger, fx fakturanavn og adresse, kan kræve særskilt godkendelse; read_orders alene giver ikke nødvendigvis alle oplysninger.',
      'Til Tools → Performance: besøg og ordrer hentes fra Shopify Analytics. Det kræver read_reports samt Level 2-adgang til beskyttede kundedata (navn, adresse, telefon og e-mail), som Shopify kræver til ShopifyQL. Manglende adgang vises på rapporten og ændrer ikke de øvrige integrationer.',
      'Vælg Install app, vælg den rigtige butik, og godkend installationen. Ved senere ændringer af rettigheder skal den nye version udgives, og rettighederne godkendes i butikken.',
      'Åbn appens Settings i Dev Dashboard, og kopiér Client ID og Client secret. Find butikkens permanente adresse, som ender på .myshopify.com, i Shopify-administrationen.',
      'Åbn Integrationer → Shopify i WebshopToolbox. Indsæt butiksadresse, Client ID og Client Secret i de tilsvarende felter, og vælg Test og forbind. WebshopToolbox henter selv de kortlivede adgangstokens.',
      'Shopify Payments bruger samme Shopify-forbindelse og kræver ingen separat API-nøgle. Shopify Payments skal være tilgængelig på butikken. En godkendt forbindelsestest kontrollerer butikkens navn; kontrollér også hentning af de relevante moduldata bagefter.',
    ],
    troubleshoot:
      'Ved afvist adgang: kontrollér organisation, installation og Client Secret. Mangler kun ordrer, lager eller udbetalinger, kontrollér modulets rettigheder og eventuelle Shopify-godkendelser. Forny hemmeligheder via Shopify og opdatér derefter forbindelsen i portalen.',
    sources: [
      {
        label: 'Shopify: opret og installér en app',
        url: 'https://shopify.dev/docs/apps/build/dev-dashboard/create-apps-using-dev-dashboard',
      },
      {
        label: 'Shopify: Client ID, secret og tokens',
        url: 'https://shopify.dev/docs/apps/build/authentication-authorization/client-credentials-grant',
      },
      {
        label: 'Shopify: rettigheder og ordrehistorik',
        url: 'https://shopify.dev/docs/api/usage/access-scopes',
      },
      {
        label: 'Shopify: rapportadgang til Performance',
        url: 'https://shopify.dev/docs/api/admin-graphql/2026-07/queries/shopifyqlQuery',
      },
    ],
  },
  Dinero: {
    title: 'Dinero – adgang skal afklares',
    needs:
      'Den nuværende formular har Client ID, Client secret, API-nøgle og Organisation-ID. Det er Dineros personlige integrationsmodel.',
    note: 'Dinero angiver, at en integration, der markedsføres og sælges til flere kunder, skal bruge OAuth2 frem for personlige API-nøgler. WebshopToolbox har endnu ikke denne kommercielle Visma Connect-tilslutning. Kontakt WebshopToolbox før ny kundetilslutning; opret ikke personlige nøgler som genvej.',
    steps: [
      'Kontrollér med WebshopToolbox, hvilken Dinero-tilslutning der er godkendt til din virksomhed. API-adgang kræver ifølge Dinero et gyldigt Pro- eller Total-abonnement.',
      'Kun hvis Dinero har bekræftet, at din konkrete anvendelse er en personlig integration: gå til Integrationer → Se og opret API-nøgler → Personlig Integration → Anmod om API-credentials i Dinero.',
      'Gem det viste Client ID og Secret sikkert, og afvent Dineros godkendelse. Opret derefter en API-nøgle til præcis det regnskab, der skal forbindes. Brug et særskilt testregnskab til afprøvning.',
      'Find regnskabets Organisation-ID. Hvis du er i tvivl, få det bekræftet hos Dinero; CVR-nummeret er ikke en erstatning for Organisation-ID.',
      'Efter afklaret adgang: indsæt de fire værdier i de tilsvarende Dinero-felter i WebshopToolbox, og vælg Test og forbind. Værdierne skal indtastes som udleveret; du skal ikke selv Base64-kode dem eller hente et access token.',
      'Kontrollér, at det rigtige regnskab er forbundet, før kontoplan, startdato og bogføring sættes op. En forbindelsestest er ikke en prøvebogføring.',
    ],
    troubleshoot:
      'Afvises adgangen, kontrollér abonnement, godkendelse og sammenhængen mellem nøgle og regnskab. Visma Connect-credentials kan ikke bruges direkte i den nuværende personlige formular.',
    sources: [
      {
        label: 'Dinero: personlig kontra kommerciel integration',
        url: 'https://developer.dinero.dk/news/personal-integration/',
      },
      {
        label: 'Dinero: personlig adgang og nøgler',
        url: 'https://developer.dinero.dk/documentation/personal-integration/',
      },
      {
        label: 'Dinero: OAuth2-autorisation',
        url: 'https://developer.dinero.dk/documentation/authorization/',
      },
    ],
  },
  Flatpay: {
    title: 'Flatpay via Saga/Valitor',
    needs:
      'Et Saga API-brugernavn, en API-adgangskode og adgang til den relevante indløsningsaftale.',
    note: 'Denne forbindelse læser afregningsdata gennem Saga/Valitor. Den opsætter ikke kortbetaling i webshoppen. Flatpay-aftaler kan have forskellige indløsere; få bekræftet, at din aftale understøtter denne adgang.',
    steps: [
      'Kontakt din Flatpay-kontakt og bed om Saga/Valitor API-adgang til transaktioner, afregninger og udbetalinger for din aftale. Bed om en separat API-bruger med adgang til netop din virksomhed.',
      'Rapyds officielle Saga-dokumentation beskriver HTTP Basic-adgang med brugernavn og adgangskode, som udstedes gennem partnerorganisationen. Der er ikke i den undersøgte dokumentation en generel selvbetjeningsknap til at generere en Flatpay-nøgle.',
      'Modtag API-brugernavn og API-adgangskode sikkert fra leverandøren. Brug de udleverede API-oplysninger; dit almindelige Flatpay-login eller en betalingsgateway-nøgle er ikke nødvendigvis gyldig.',
      'Åbn Integrationer → Flatpay i WebshopToolbox. Gem først de ønskede historik- og bogføringsdatoer. Udfyld API-brugernavn og API-adgangskode.',
      'Vælg Kontrollér adgang og hent aftaler. Vælg den aftale, der tilhører din webshop; kontrollér aftalenummer og valuta.',
      'Vælg Validér og gem forbindelse. Kontrollér derefter de hentede afregninger mod leverandørens oversigt.',
    ],
    troubleshoot:
      'Hvis ingen aftaler vises, skal leverandøren kontrollere API-brugerens aftaleadgang og miljø. Ved udskiftning af adgangskode skal forbindelsen valideres og gemmes igen.',
    sources: [
      {
        label: 'Rapyd/Valitor: Saga-adgang og autentificering',
        url: 'https://specs.valitor.is/introduction/iso/',
      },
    ],
  },
  ViaBill: {
    title: 'ViaBill',
    needs: 'API key, tilhørende Secret og virksomhedens Merchant Account ID.',
    note: 'ViaBills officielle modulguide bekræfter API key og Secret, men dokumenterer ikke en generel menusti til selvbetjent nøgleoprettelse eller rettigheder til vores afregnings-API. Få derfor adgangstypen bekræftet hos ViaBill.',
    steps: [
      'Log ind på virksomhedens ViaBill-konto, eller kontakt jeres ViaBill-kontakt. Bed om API key og Secret til læsning af Merchant Account, betalinger og afregninger samt det korrekte Merchant Account ID.',
      'Har du allerede API-oplysninger til webshoppen, få bekræftet, at de også giver adgang til afregningsdata. Installér ikke Drupal eller et nyt betalingsmodul for at følge referenceguiden.',
      'Åbn Integrationer → ViaBill i WebshopToolbox. Angiv forbindelsens startdato, og indsæt API key og Secret i hver sit felt.',
      'Vælg Test og hent konti. Vælg virksomhedens Merchant Account ID fra listen. Kræver portalen manuel indtastning, brug det ID, ViaBill har bekræftet; brug ikke et tilfældigt forhandler- eller CVR-nummer.',
      'Vælg Validér og gem forbindelse. Kontrollér, at den viste konto og afregningerne tilhører den rigtige virksomhed. Forbindelsen ændrer ikke din eksisterende ViaBill-betalingsopsætning i Shopify.',
    ],
    troubleshoot:
      'Forkert key/Secret-par eller manglende adgang til afregninger skal afklares hos ViaBill. Nøgler fra forskellige konti eller miljøer kan ikke blandes.',
    sources: [
      {
        label: 'ViaBill: officiel modulguide med API-credentials (PDF)',
        url: 'https://viabill.com/user-guides/drupal_commerce_viabill_payments.pdf',
      },
      {
        label: 'ViaBill: integrationer og API',
        url: 'https://www.viabill.com/dk/integrationer/',
      },
    ],
  },
  Pensopay: {
    title: 'Pensopay',
    needs: 'En API-nøgle fra virksomhedens Pensopay-konto.',
    note: 'Forbindelsen læser kun betalinger og afregninger. Den kan ikke capture, refundere eller annullere betalinger. Bogføring i Dinero er endnu ikke aktiveret for Pensopay.',
    steps: [
      'Log ind på app.pensopay.com med en bruger, der må administrere API-nøgler.',
      'Gå til Indstillinger → Keys, og vælg Create New token under API keys. Kopiér nøglen med det samme; Pensopay viser den ikke igen.',
      'Åbn Integrationer → Pensopay i WebshopToolbox. Angiv forbindelsens startdato, og indsæt API-nøglen.',
      'Vælg Test nøglen. Kontrollér, at den viste konto er virksomhedens egen Pensopay-konto.',
      'Vælg Forbind. Hent derefter afregninger under Udbetalinger (vælg Pensopay).',
    ],
    troubleshoot:
      'HTTP 401 betyder, at nøglen er forkert eller tilbagekaldt; opret en ny under Indstillinger → Keys. HTTP 403 betyder, at nøglen mangler adgang; kontrollér dens rettigheder hos Pensopay.',
    sources: [
      {
        label: "Pensopay: kom i gang med API'et",
        url: 'https://docs.pensopay.com/reference/getting-started',
      },
      {
        label: 'Pensopay: afregninger (settlements)',
        url: 'https://docs.pensopay.com/reference/getsettlements-1',
      },
    ],
  },
  'Emballage Indberetning': {
    title: 'Emballage Indberetning',
    needs:
      'En samlet API-nøgle i formatet esk_….secret fra virksomhedens ejerkonto.',
    steps: [
      'Log ind som organisationens ejer på app.emballageindberetning.dk, og kontrollér, at den rigtige virksomhed er valgt.',
      'Åbn Settings → Developer (Indstillinger → Udvikler). Den officielle adresse til nøgleopsætning er /settings/developer.',
      'Opret en særskilt nøgle til WebshopToolbox. Vælg test til afprøvning eller live til rigtig indberetning. Valget kan ikke ændres på en eksisterende nøgle. Vælg eventuel udløbsdato, og planlæg udskiftning inden udløb.',
      'Kopiér hele nøglen, inklusive esk_-præfiks, punktum og secret. Den vises kun én gang og kan ikke hentes igen. Gem den i en adgangskodeadministrator.',
      'Åbn Integrationer → Emballage Indberetning i WebshopToolbox. Indsæt hele værdien i API-nøgle uden mellemrum omkring punktummet og uden teksten Bearer. Vælg Validér og gem forbindelse.',
      'Under Felter i Shopify: vælg Opret felter i Shopify. WebshopToolbox opretter fem produktfelter (custom.emballage_indberetning, custom.emballage_vaegt_gram, custom.emballage_leverandor, custom.emballage_leverandorland og custom.emballage_leverandor_cvr). Det kræver, at Shopify-appen har write_products; se vejledningen til Shopify. Felterne oprettes kun fra produktionsportalen.',
      'Udfyld felterne pr. produkt i Shopify under produktets Metafelter, eller for mange produkter ad gangen med masseredigering. Indberetningspligtig er ja/nej, vægten angives i hele gram pr. solgt enhed, og leverandørland som landekode, fx DK.',
      'Kontrollér virksomhedsnavn og test/live-status. Vælg første kvartals startdato, producentansvar og felterne til husholdning/erhverv. Ved første opsætning henter portalen Shopify-historik fra den valgte start; kontrollér perioden før du gemmer.',
      'Forbindelsen er ikke i sig selv en indberetning. Kontrollér data og modtagerfelter i indberetningsforløbet før endelig afsendelse. Testnøgler må ikke forveksles med en rigtig indberetning.',
      'Ved nøgleskift: opret en ny nøgle, gem og kontrollér den nye forbindelse i WebshopToolbox, og tilbagekald derefter den gamle nøgle hos leverandøren. En bortkommet nøgle skal erstattes.',
    ],
    troubleshoot:
      '401: kontrollér hele nøglen, udløb og tilbagekaldelse. 403: få API-adgangen afklaret hos leverandøren. 429: vent før nyt forsøg. Oplys eventuelt fejlens request-reference til support, aldrig selve nøglen.',
    sources: [
      {
        label: 'Emballage Indberetning: officiel Public API-guide',
        url: 'https://app.emballageindberetning.dk/docs/public-api',
      },
      {
        label: 'Shopify: metafelter på produkter',
        url: 'https://help.shopify.com/da/manual/custom-data/metafields',
      },
    ],
  },
};
