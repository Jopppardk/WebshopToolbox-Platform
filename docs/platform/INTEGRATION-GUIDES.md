# Guides til integrationsadgang

Kilder kontrolleret 28. september 2026. Guiderne findes også ved hver forbindelse under Integrationer.

Indsæt kun secrets i portalens forbindelsesfelter. Gem dem sikkert; del dem aldrig via mail eller chat. Brug adskilte test- og produktionsoplysninger.

## Shopify og Shopify Payments

Butikkens myshopify.com-adresse, Client ID og Client Secret fra en app i din egen Shopify-organisation.

> Appen og butikken skal tilhøre samme Shopify-organisation. Denne opsætning bruger Client Credentials Grant. Et Storefront-token eller en midlertidig Admin API-tokenværdi kan ikke indsættes i Client Secret-feltet.

1. Log ind i Shopify Dev Dashboard med en bruger, som må udvikle og installere apps. Vælg den organisation, der ejer din butik.
2. Åbn Apps → Create app → Start from Dev Dashboard. Giv appen et genkendeligt navn, fx WebshopToolbox, og vælg Create.
3. Opret en version under Versions. Appen bruges uden indlejret brugerflade; Shopifys officielle standard-App URL er https://shopify.dev/apps/default-app-home. Vælg rettighederne nedenfor til de moduler, du bruger, og vælg Release.
4. Til salg og tilbagebetalinger: read_orders. Til produktfeeds: read_products. Til lager: read_inventory og read_products samt adgang til kostpriser. Til Shopify Payments: read_shopify_payments_accounts og read_shopify_payments_payouts. Lageroptælling, der skal ændre antal i Shopify, kræver desuden write_inventory. Giv kun de relevante rettigheder.
5. Ordrehistorik ældre end 60 dage kræver også read_all_orders og Shopifys godkendelse. Adgang til beskyttede kundeoplysninger, fx fakturanavn og adresse, kan kræve særskilt godkendelse; read_orders alene giver ikke nødvendigvis alle oplysninger.
6. Vælg Install app, vælg den rigtige butik, og godkend installationen. Ved senere ændringer af rettigheder skal den nye version udgives, og rettighederne godkendes i butikken.
7. Åbn appens Settings i Dev Dashboard, og kopiér Client ID og Client secret. Find butikkens permanente adresse, som ender på .myshopify.com, i Shopify-administrationen.
8. Åbn Integrationer → Shopify i WebshopToolbox. Indsæt butiksadresse, Client ID og Client Secret i de tilsvarende felter, og vælg Test og forbind. WebshopToolbox henter selv de kortlivede adgangstokens.
9. Shopify Payments bruger samme Shopify-forbindelse og kræver ingen separat API-nøgle. Shopify Payments skal være tilgængelig på butikken. En godkendt forbindelsestest kontrollerer butikkens navn; kontrollér også hentning af de relevante moduldata bagefter.

**Fejlfinding:** Ved afvist adgang: kontrollér organisation, installation og Client Secret. Mangler kun ordrer, lager eller udbetalinger, kontrollér modulets rettigheder og eventuelle Shopify-godkendelser. Forny hemmeligheder via Shopify og opdatér derefter forbindelsen i portalen.

- [Shopify: opret og installér en app](https://shopify.dev/docs/apps/build/dev-dashboard/create-apps-using-dev-dashboard)
- [Shopify: Client ID, secret og tokens](https://shopify.dev/docs/apps/build/authentication-authorization/client-credentials-grant)
- [Shopify: rettigheder og ordrehistorik](https://shopify.dev/docs/api/usage/access-scopes)

## Dinero – adgang skal afklares

Den nuværende formular har Client ID, Client secret, API-nøgle og Organisation-ID. Det er Dineros personlige integrationsmodel.

> Dinero angiver, at en integration, der markedsføres og sælges til flere kunder, skal bruge OAuth2 frem for personlige API-nøgler. WebshopToolbox har endnu ikke denne kommercielle Visma Connect-tilslutning. Kontakt WebshopToolbox før ny kundetilslutning; opret ikke personlige nøgler som genvej.

1. Kontrollér med WebshopToolbox, hvilken Dinero-tilslutning der er godkendt til din virksomhed. API-adgang kræver ifølge Dinero et gyldigt Pro- eller Total-abonnement.
2. Kun hvis Dinero har bekræftet, at din konkrete anvendelse er en personlig integration: gå til Integrationer → Se og opret API-nøgler → Personlig Integration → Anmod om API-credentials i Dinero.
3. Gem det viste Client ID og Secret sikkert, og afvent Dineros godkendelse. Opret derefter en API-nøgle til præcis det regnskab, der skal forbindes. Brug et særskilt testregnskab til afprøvning.
4. Find regnskabets Organisation-ID. Hvis du er i tvivl, få det bekræftet hos Dinero; CVR-nummeret er ikke en erstatning for Organisation-ID.
5. Efter afklaret adgang: indsæt de fire værdier i de tilsvarende Dinero-felter i WebshopToolbox, og vælg Test og forbind. Værdierne skal indtastes som udleveret; du skal ikke selv Base64-kode dem eller hente et access token.
6. Kontrollér, at det rigtige regnskab er forbundet, før kontoplan, startdato og bogføring sættes op. En forbindelsestest er ikke en prøvebogføring.

**Fejlfinding:** Afvises adgangen, kontrollér abonnement, godkendelse og sammenhængen mellem nøgle og regnskab. Visma Connect-credentials kan ikke bruges direkte i den nuværende personlige formular.

- [Dinero: personlig kontra kommerciel integration](https://developer.dinero.dk/news/personal-integration/)
- [Dinero: personlig adgang og nøgler](https://developer.dinero.dk/documentation/personal-integration/)
- [Dinero: OAuth2-autorisation](https://developer.dinero.dk/documentation/authorization/)

## Flatpay via Saga/Valitor

Et Saga API-brugernavn, en API-adgangskode og adgang til den relevante indløsningsaftale.

> Denne forbindelse læser afregningsdata gennem Saga/Valitor. Den opsætter ikke kortbetaling i webshoppen. Flatpay-aftaler kan have forskellige indløsere; få bekræftet, at din aftale understøtter denne adgang.

1. Kontakt din Flatpay-kontakt og bed om Saga/Valitor API-adgang til transaktioner, afregninger og udbetalinger for din aftale. Bed om en separat API-bruger med adgang til netop din virksomhed.
2. Rapyds officielle Saga-dokumentation beskriver HTTP Basic-adgang med brugernavn og adgangskode, som udstedes gennem partnerorganisationen. Der er ikke i den undersøgte dokumentation en generel selvbetjeningsknap til at generere en Flatpay-nøgle.
3. Modtag API-brugernavn og API-adgangskode sikkert fra leverandøren. Brug de udleverede API-oplysninger; dit almindelige Flatpay-login eller en betalingsgateway-nøgle er ikke nødvendigvis gyldig.
4. Åbn Integrationer → Flatpay i WebshopToolbox. Gem først de ønskede historik- og bogføringsdatoer. Udfyld API-brugernavn og API-adgangskode.
5. Vælg Kontrollér adgang og hent aftaler. Vælg den aftale, der tilhører din webshop; kontrollér aftalenummer og valuta.
6. Vælg Validér og gem forbindelse. Kontrollér derefter de hentede afregninger mod leverandørens oversigt.

**Fejlfinding:** Hvis ingen aftaler vises, skal leverandøren kontrollere API-brugerens aftaleadgang og miljø. Ved udskiftning af adgangskode skal forbindelsen valideres og gemmes igen.

- [Rapyd/Valitor: Saga-adgang og autentificering](https://specs.valitor.is/introduction/iso/)

## ViaBill

API key, tilhørende Secret og virksomhedens Merchant Account ID.

> ViaBills officielle modulguide bekræfter API key og Secret, men dokumenterer ikke en generel menusti til selvbetjent nøgleoprettelse eller rettigheder til vores afregnings-API. Få derfor adgangstypen bekræftet hos ViaBill.

1. Log ind på virksomhedens ViaBill-konto, eller kontakt jeres ViaBill-kontakt. Bed om API key og Secret til læsning af Merchant Account, betalinger og afregninger samt det korrekte Merchant Account ID.
2. Har du allerede API-oplysninger til webshoppen, få bekræftet, at de også giver adgang til afregningsdata. Installér ikke Drupal eller et nyt betalingsmodul for at følge referenceguiden.
3. Åbn Integrationer → ViaBill i WebshopToolbox. Angiv forbindelsens startdato, og indsæt API key og Secret i hver sit felt.
4. Vælg Test og hent konti. Vælg virksomhedens Merchant Account ID fra listen. Kræver portalen manuel indtastning, brug det ID, ViaBill har bekræftet; brug ikke et tilfældigt forhandler- eller CVR-nummer.
5. Vælg Validér og gem forbindelse. Kontrollér, at den viste konto og afregningerne tilhører den rigtige virksomhed. Forbindelsen ændrer ikke din eksisterende ViaBill-betalingsopsætning i Shopify.

**Fejlfinding:** Forkert key/Secret-par eller manglende adgang til afregninger skal afklares hos ViaBill. Nøgler fra forskellige konti eller miljøer kan ikke blandes.

- [ViaBill: officiel modulguide med API-credentials (PDF)](https://viabill.com/user-guides/drupal_commerce_viabill_payments.pdf)
- [ViaBill: integrationer og API](https://www.viabill.com/dk/integrationer/)

## Emballage Indberetning

En samlet API-nøgle i formatet esk_….secret fra virksomhedens ejerkonto.

1. Log ind som organisationens ejer på app.emballageindberetning.dk, og kontrollér, at den rigtige virksomhed er valgt.
2. Åbn Settings → Developer (Indstillinger → Udvikler). Den officielle adresse til nøgleopsætning er /settings/developer.
3. Opret en særskilt nøgle til WebshopToolbox. Vælg test til afprøvning eller live til rigtig indberetning. Valget kan ikke ændres på en eksisterende nøgle. Vælg eventuel udløbsdato, og planlæg udskiftning inden udløb.
4. Kopiér hele nøglen, inklusive esk_-præfiks, punktum og secret. Den vises kun én gang og kan ikke hentes igen. Gem den i en adgangskodeadministrator.
5. Åbn Integrationer → Emballage Indberetning i WebshopToolbox. Indsæt hele værdien i API-nøgle uden mellemrum omkring punktummet og uden teksten Bearer. Vælg Validér og gem forbindelse.
6. Kontrollér virksomhedsnavn og test/live-status. Vælg første kvartals startdato, producentansvar og felterne til husholdning/erhverv. Ved første opsætning henter portalen Shopify-historik fra den valgte start; kontrollér perioden før du gemmer.
7. Forbindelsen er ikke i sig selv en indberetning. Kontrollér data og modtagerfelter i indberetningsforløbet før endelig afsendelse. Testnøgler må ikke forveksles med en rigtig indberetning.
8. Ved nøgleskift: opret en ny nøgle, gem og kontrollér den nye forbindelse i WebshopToolbox, og tilbagekald derefter den gamle nøgle hos leverandøren. En bortkommet nøgle skal erstattes.

**Fejlfinding:** 401: kontrollér hele nøglen, udløb og tilbagekaldelse. 403: få API-adgangen afklaret hos leverandøren. 429: vent før nyt forsøg. Oplys eventuelt fejlens request-reference til support, aldrig selve nøglen.

- [Emballage Indberetning: officiel Public API-guide](https://app.emballageindberetning.dk/docs/public-api)
## Cloudflare – afsendelse fra eget maildomæne

Den eksisterende guide åbnes under Indstillinger → Faktura-afsendelse → Afsender og eget maildomæne.

1. Brug din egen Cloudflare-konto, hvor afsenderdomænet ligger. Domænet skal bruge Cloudflare DNS.
2. Åbn Compute → Email Service → Email Sending → Onboard Domain. Vælg domænet og gennemgå de foreslåede DNS-poster. Bevar eksisterende mailopsætning; få mailansvarlig hjælp ved tvivl.
3. Find kontoens Account ID (ikke Zone ID) i Cloudflare. Søg eventuelt efter Copy account ID med Ctrl+K.
4. Åbn My Profile → API Tokens → Create Token → Create Custom Token. Navngiv tokenet WebshopToolbox mail.
5. Vælg Account → Email Sending → Edit, og afgræns Account Resources til Include → Specific account og den rigtige konto. Tokenet behøver ikke DNS- eller Worker-rettigheder.
6. Gennemgå oversigten, opret tokenet, og kopiér selve værdien, som kun vises én gang.
7. I WebshopToolbox: vælg eget afsenderdomæne, angiv afsenderadresse, Account ID og API-token, og gem afsenderen.
8. Send en testmail med eksempelfaktura til din egen adresse. Kontrollér både portalens resultat og indbakken/spam. En accepteret API-afsendelse garanterer ikke placering i indbakken.

Ved fejl: kontrollér konto-ID, tokenrettighed og godkendt afsenderdomæne. Standardafsenderen kræver ikke et personligt Cloudflare-token.

- [Cloudflare: opret token](https://developers.cloudflare.com/fundamentals/api/get-started/create-token/)
- [Cloudflare: send emails](https://developers.cloudflare.com/email-service/get-started/send-emails/)
- [Cloudflare: find Account ID](https://developers.cloudflare.com/fundamentals/account/find-account-and-zone-ids/)

## Partner-Ads – produktfeed uden separat API-nøgle

Denne forbindelse leverer en XML-fil via et feedlink. WebshopToolbox skal ikke have din Partner-Ads-adgangskode eller en separat Partner-Ads API-nøgle.

1. Forbind Shopify med read_products som beskrevet ovenfor.
2. Åbn Produktfeeds i WebshopToolbox. Opret et Partner-Ads-feed, vælg produkter/kollektioner, og udfyld fragt- og leveringsoplysninger.
3. Gem, kontrollér XML-visningen, og kopiér feedlinket. Kontrollér især produktpris, lagerstatus, produktlink og fragt.
4. Partner-Ads beder i sin officielle guide annoncøren sende feedlinket til support@partner-ads.com. Aftal tilknytningen til dit annoncørprogram med dem. Denne guide sender ingen mail for dig.
5. Feedlinket giver adgang til de udvalgte produktdata uden portal-login. Del det kun med den tilsigtede modtager. Roterer du linket i WebshopToolbox, skal Partner-Ads have det nye link.

- [Partner-Ads: produktfeeds for annoncører](https://www.partner-ads.com/dk/feed_advinfo.htm)

## Implementerings- og verifikationsstatus

- Fem guides er implementeret som dialoger i Tier 1-integrationskortene. Shopify-guiden omfatter også Shopify Payments. Cloudflare har allerede en særskilt dialog ved mailafsenderen; Partner-Ads kræver ikke en ny API-nøgle og beskrives ovenfor.
- Teksterne er egne danske formuleringer med officielle kildelinks. Hvor leverandøren ikke har en verificeret selvbetjeningsvejledning (Flatpay/ViaBill), henvises til udstedelse/bekræftelse hos leverandøren, uden opdigtede menupunkter.
- Emballage Indberetnings offentlige HTML-guide indlæser /docs/public-api.json. Dens info.description er hentet og læst 28. september 2026; ejerrolle, Settings → Developer, nøgleformat, engangsvisning, test/live og rotation er bekræftet der.
- Guideindhold ændrer ingen credentials, forbindelser, bogføring eller indberetninger. Der er ikke foretaget leverandørlogin, oprettet nøgler eller afsendt testmail.
- Dinero er en udestående produktbegrænsning: den nuværende personlige credentialmodel er ikke den kommercielle OAuth2-model, leverandøren foreskriver. Kundevejledningen viser dette før trinene. Kommerciel Visma Connect-tilslutning er ikke implementeret af denne ændring.
- Tier 1-typecheck bestået. Bygning og samlet CI/udgivelse koordineres med runtime-opgaven; endnu ikke sat i drift ved oprettelsen af dette dokument.

Lokal visningskontrol: guideknapper og dialoger til Shopify/Dinero er afprøvet uden kundedata. Automatisk fokus er rettet til dialogens overskrift, så lange guides åbner ved trin 1; Escape lukker og returnerer fokus. Typecheck bestået efter rettelsen; klientbuild bestået før fokusrettelsen. Samlet CI afventer.
