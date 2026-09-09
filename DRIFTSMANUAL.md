# Driftsmanual – Sablen Toolbox

## Formål og omfang

Sablen Toolbox drives på `https://integration.sablen.dk` og forbinder Sablen.dk med Shopify, Shopify Payments og Dinero. Løsningen indlæser driftsdata, genererer dokumenter og bogfører aktiverede moduler automatisk. ViaBill er forberedt, men ikke sat i automatisk produktion. Flatpay er ikke implementeret.

## Produktion

- Kildekode: privat GitHub-repository `Jopppardk/WebshopToolbox`
- Produktionsgren: `main`
- Runtime: Cloudflare Worker `sablen-integrationshub`
- Database: Cloudflare D1 `sablen-integrationshub`
- Dokumentlager: Cloudflare R2 `sablen-invoices`
- Adgang: Cloudflare Access
- Domæne: `integration.sablen.dk`
- Tidszone for forretningsdatoer: `Europe/Copenhagen`

Push til `main` starter GitHub Actions. Workflowet installerer afhængigheder, kører typekontrol, test og build og udgiver derefter hele Worker-pakken til Cloudflare. En fejlet typekontrol, test eller build stopper udgivelsen. Pull requests gennemgår samme typekontrol før sammenlægning.

## Automatiske jobs

Cloudflare kalder Workerens scheduler hvert minut. Den gemte jobfrekvens under **Indstillinger → Dashboard** afgør, om det centrale job skal arbejde på det pågældende kald.

Det centrale job udfører i rækkefølge:

1. Shopify-ordrer
2. Emballagedata
3. Salgsbogføring i Dinero
4. Fakturaafsendelse
5. Shopify Payments-tilbagebetalinger
6. Tilbagebetalingsbogføring i Dinero
7. Shopify Payments-udbetalinger
8. Udbetalingsbogføring i Dinero

Status og resultat ses under **System → Indsigt**. Funktionsfejl registreres i fejloversigten på Dashboard og kan udløse fejlmail, hvis dette er aktiveret.

Ordre-, refunderings- og udbetalingsimport henter op til fem sider pr. job. Fortsættelsen gemmes efter hver importeret side. Hvis der er flere sider, viser Indsigt, at næste kørsel fortsætter; modulets automatiske Dinero-overførsel venter, indtil gennemgangen er afsluttet. Derefter begynder næste kørsel forfra, så ændringer på ældre poster også indlæses. Ændrede historikindstillinger starter en ny gennemgang. En tidsbegrænset lås forhindrer overlappende importer; efter et afbrudt job kan der gå op til ti minutter, før det genoptages.

I kladdetilstand optager eksisterende kladder ikke pladserne for nye poster. Når bogføring aktiveres, kan eksisterende refunderings- og udbetalingskladder vælges til bogføring. Igangværende, usikre og allerede bogførte overførsler genoptages ikke automatisk som nye posteringer.

## Bogføringsprincipper

### Salg

Kun afsendte Shopify-ordrer behandles. Afsendelsesdatoen anvendes som faktura- og bogføringsdato. Salg og fragt samles efter den konfigurerede konto og momskode. Fordelingskontoen er modkonto. Faktura-PDF vedhæftes i Dinero, når bilagsupload er aktiveret.

En vare uden positiv kostpris er en bevidst og gyldig situation: salget bogføres, men der dannes ingen lagernedskrivning for den pågældende kostpris.

### Tilbagebetalinger

Gennemførte, ikke-test Shopify Payments-refunderinger bogføres automatisk, når modulet er aktiveret. Beløb, valuta, Shopify-transaktion og vare-/fragtfordeling kontrolleres før skrivning. Produktionsflowet opretter en Dinero-kladde, genlæser og kontrollerer den og bogfører den derefter.

Manuel og automatisk refunderingsbogføring deler en atomisk statusspærring: kun den kørsel, der får gemt overgangen til bogføring, må sende anmodningen til Dinero. En anden kørsel må ikke ændre den igangværende status. Gemte kladder kan kun genoptages med samme Dinero-organisation. Hvis bogføringskvitteringen ikke kan gemmes, forbliver posten spærret til manuel afklaring; en allerede gemt kvittering bevares, hvis opdateringen af oversigten fejler. Tidligere usikre refunderinger nulstilles ikke af denne rettelse.

### Udbetalinger

Kun betalte Shopify Payments-indbetalinger til banken i DKK behandles. Bruttobetalinger, refunderinger, gebyrer og nettoudbetaling skal afstemmes præcist. Udbetalingsrapporten vedhæftes, når bilagsupload er aktiveret. Produktionsflowet opretter, genlæser, kontrollerer og bogfører Dinero-bilaget.

### Usikre svar og genforsøg

Shopify-læsninger forsøges højst tre gange ved netværksfejl, timeout, HTTP 408/429/500/502/503/504 eller GraphQL THROTTLED. Ventetiden er normalt 1 og 2 sekunder; Retry-After og GraphQL-kapacitet kan kræve længere ventetid. Kræves mere end 5 sekunders ventetid, overlades fortsættelsen til en senere kørsel. Den samlede tidsramme er højst 30 sekunder pr. læsning, og en eksisterende kortere tidsgrænse bevares. Adgangsfejl og ugyldige forespørgsler genforsøges ikke. Shopify-mutationer og Dinero-skrivninger omfattes ikke af denne retry-mekanisme.

ViaBill-fejl bevarer den faktiske HTTP-status. HTTP 403 fra kontolisten betyder afvist adgang og vises som fejl; den beviser hverken et forkert nøglepar eller et forkert konto-ID. Et Merchant Account ID, som ViaBill har bekræftet, kan stadig valideres direkte. Nøgler gemmes først efter vellykket validering. Fejloversigt og jobhistorik skjuler URL’er, adgangsdata og mailadresser i diagnostikken.

Systemet må ikke gætte efter en mulig ekstern skrivning. Hvis Dinero-svaret er usikkert, stoppes automatisk genforsøg, og posten fremgår af fejloversigten. Kontrollér først Dinero for en eksisterende kladde eller bogføring. Dette beskytter mod dobbeltbogføring.

## Daglig kontrol

- Kontrollér alarmklokken og fejloversigten.
- Kontrollér **Indsigt** for fejlede eller udeblevne job.
- Afstem nye salg, tilbagebetalinger og udbetalinger mod Dinero ved behov.
- Kontrollér at næste synkroniseringstid i menuen bevæger sig normalt.
- Ved leveringsproblemer med fakturamail: kontrollér først dokumentstatus, kundemail og Cloudflare Email Sending.

## Fejlhåndtering

1. Åbn fejlen på Dashboard og noter modul, tidspunkt og tekst.
2. Find det tilsvarende job under Indsigt.
3. Kontrollér kildesystemet og Dinero, før en skrivning gentages.
4. Ret konfiguration eller kildedata.
5. Brug manuel handling eller afvent næste job, når det er sikkert.
6. Bekræft efterfølgende status i både Sablen Toolbox og Dinero.

Ved fejl efter `creating`, `draft` eller `booking` skal Dinero altid kontrolleres manuelt. Slet aldrig status i D1 alene for at fremtvinge et nyt forsøg.

### Uafklaret fakturamail

Efter en mulig kundeafsendelse bevares afsendelsesspærringen, også hvis mailudbyderens svar eller lagringen af kvitteringen fejler. Rækken forbliver `sending`, og fejloversigten forklarer, at levering kan være sket. Tidligere `failed`-rækker genforsøges heller ikke automatisk, fordi de kan dække over leverede mails. De spærrer ikke for nye fakturaer i mailkøen.

Kontrollér først mailudbyderens leveringslog. Fjern ikke en spærring blot for at prøve igen. En afsendelse, der allerede er leveret, skal afstemmes som leveret. Hvis det er bekræftet, at ingen mail blev afleveret, kræver et nyt forsøg en kontrolleret manuel afklaring af den enkelte afsendelsesstatus. Der tilføjes ikke automatisk nulstilling eller en ubetinget gensend-knap.

## Indstillinger og startdato

Hvis startdatoen ændres, kan tidligere poster komme tilbage i udvælgelsen. Kontrollér derfor altid skæringsdatoen mod tidligere integrationsløsninger før lagring. Automatikknapperne på Dashboard er den forretningsmæssige til-/frakobling af de enkelte moduler. Miljøvariablerne i `wrangler.direct.jsonc` er en ekstra teknisk sikkerhedslås.

## Deployment og rollback

### Normal udgivelse

1. Arbejd på en separat Git-gren.
2. Kør `npm run typecheck`, `npm test` og `npm run build` lokalt.
3. Gennemgå ændringerne og sammenlæg dem i `main`.
4. Kontrollér den grønne GitHub Actions-kørsel.
5. Kontrollér produktionen og siden Indsigt efter første planlagte job.

### Tilbageførsel af kode

Revert den fejlbehæftede commit i GitHub og push revert-committen til `main`. Det skaber en sporbar ny deployment. Brug ikke force-push eller omskrivning af produktionshistorikken.

En rollback af kode ruller ikke D1-data eller eksterne posteringer i Dinero tilbage.

## Backup og gendannelse

GitHub er backup af kildekoden, ikke af produktionsdata.

- D1: brug Cloudflares D1 Time Travel/backupmuligheder. Test mindst kvartalsvist gendannelse til en separat testdatabase.
- R2: dokumentér og test eksport/gendannelse af fakturaer og udbetalingsrapporter. Gendan ikke direkte oven i produktion under en øvelse.
- Dinero: bogførte bilag er selvstændige regnskabsposter og må ikke forventes rullet tilbage ved databasegendannelse.
- Efter D1-gendannelse skal posteringer fra gendannelsestidspunktet til nu afstemmes mod Dinero, før automatik genaktiveres.

## Adgang og hemmeligheder

- Produktionsadgang styres af Cloudflare Access og skal begrænses til godkendte Sablen-brugere.
- Shopify-, Dinero- og leverandørnøgler må aldrig gemmes i GitHub eller dokumentationen.
- GitHub Actions bruger `CLOUDFLARE_API_TOKEN` og `CLOUDFLARE_ACCOUNT_ID` som repository-secrets.
- Cloudflare-tokenet skal have mindst mulige rettigheder og roteres før udløb.
- Ved mistanke om lækage: tilbagekald nøglen hos leverandøren først, opret en ny og opdatér derefter forbindelsen.

## Vedligeholdelse fra en ny computer

1. Installér Git, Node.js 22+ og GitHub CLI.
2. Klon det private repository og installér med `npm ci`.
3. Log ind på GitHub med en bruger, der har adgang til repositoryet.
4. Opret en arbejdsgren; ændr aldrig produktionshemmeligheder i lokale filer.
5. Kør test og build før push.

Cloudflare- og integrationshemmeligheder følger ikke med Git-klonen. Normal deployment kræver dem ikke lokalt, fordi GitHub Actions allerede har sine deployment-secrets.

## Kontroller efter større ændringer

- Login via Cloudflare Access fungerer, og direkte uvedkommende adgang afvises.
- D1-migrationer er gennemført før kode, der kræver dem.
- Én ny ordre kan synkroniseres uden dubletter.
- Én afsendt ordre får korrekt faktura, dato og Dinero-bilag.
- Én tilbagebetaling og én udbetaling afstemmes korrekt.
- Dokumenter kan åbnes og er vedhæftet i Dinero efter konfigurationen.
- En kontrolleret testfejl ses i Indsigt og fejloversigten og sender mail, hvis fejlmail er aktiveret.

## Kendte udeståender

- ViaBill afventer bekræftet live API-adgang, automatisk synkronisering og Dinero-workflow.
- Flatpay afventer officiel API-dokumentation og adgang.
- Praktisk restore-øvelse for D1/R2 og periodisk Access-gennemgang skal planlægges som en driftsaktivitet.

## Synkroniseringsinterval og kørselsstatus

Intervallet skal gemmes i Indstillinger. Det træder i kraft ved næste planlagte minutgrænse; Gem starter ikke en øjeblikkelig synkronisering. Ét minut angiver hyppigheden af planlagte starter, ikke en garanti for, at alle data er hentet og bogført inden for ét minut.

Sidebarens status læser det gemte interval og faktiske start- og sluttidspunkter fra serveren. Den opdateres hvert 15. sekund, mens siden er synlig. Ordrelisten, tilbagebetalinger, udbetalinger og dokumenter genindlæses efter en registreret afslutning. En afsluttet kørsel kan stadig indeholde oversprungne job; se Indsigt for detaljerne. Historiske importer kan kræve flere kørsler.

Hele den planlagte jobkæde har en fælles lås i D1. Samtidige eller gentagne kald for samme planlagte tidspunkt starter ikke en ekstra kæde. Låsen frigives ved normal afslutning, også ved håndterede fejl. Individuelle importlåse og bogføringskvitteringer bevares.

Ved en hårdt afbrudt worker vises kørslen som afbrudt efter 15 minutter. Sikkerhedslåsen udløber efter 20 minutter, hvorefter næste planlagte kørsel kan overtage. Perioden er længere end Cloudflares maksimale levetid på 15 minutter for en Cron-kørsel og forhindrer, at en gammel kørsel fortsat skriver samtidig med en ny. Se [Cloudflare Workers limits](https://developers.cloudflare.com/workers/platform/limits/). Usikre bogføringsforsøg genposteres ikke automatisk som følge af denne genopretning.

## Dashboard og regnskabsgrundlag

Dashboard er standardforsiden og første menupunkt uden kategorioverskrift.

Økonomital kommer fra Dineros bogførte posteringer via de dokumenterede endpoints accountingyears, accounts/entry, entries og entries/changes. MTD er månedens første dato til dags dato, YTD er kalenderårets første dato til dags dato i dansk tidszone. Sammenligningen er samme dato året før; 29. februar sammenlignes med 28. februar. Regnskabsdata har datoopløsning, ikke klokkeslæt. Omsætning kommer fra kontokategorien Turnover; resultat før skat summerer resultatkategorier uden Tax. Primo og Ultimo indgår ikke i omsætning/resultat. Bogført lagerværdi er saldoen på den valgte lagerkonto, inklusive Primo for det aktuelle regnskabsår.

Datagrundlaget er organisationsopdelt i dashboard_ledger og indeholder kun posteringens ID, konto, dato, beløb og type. Der gemmes ikke bilagstekst eller kundedata her. Første hentning indlæser ét relevant regnskabsår ad gangen; derefter bruges ændringsendpointet i vinduer på højst 30 dage. EntryGuid bruges til idempotente opdateringer, herunder korrigerede primoposteringer. En fælles lås beskytter samtidige hentninger. Almindelig opdatering er højst hvert femte minut via scheduler eller dashboardbesøg. Den første indlæsning kan derfor vise manglende sammenligningstal midlertidigt.

Manglende regnskabsår, ukategoriserede konti med posteringer eller API-fejl vises som manglende tal, ikke nul. Procentændring vises kun med et positivt sammenligningsgrundlag. Gamle data mærkes som forsinkede. API-adgang og lokale caches giver ingen skriveadgang til Dineros bilag fra dashboardet.

Platformstatus bygger på den seneste ikke-oversprungne kørsel pr. job, så en oversprunget kørsel ikke skjuler en tidligere fejl. En gemt forbindelse er ikke i sig selv bevis for drift; ViaBill kan eksempelvis være forbundet uden en bekræftet automatisk kørsel. Succesrate er gennemførte / (gennemførte + fejlede) i de seneste 24 timer. Oversprungne og igangværende udelades, og ingen afsluttede kørsler vises som —. Klik på fejlede kørsler åbner Indsigt filtreret på fejl.

API-specifikation kontrolleret 9. september 2026: https://api.dinero.dk/openapi/index.html og https://api.dinero.dk/openapi/v1/swagger.json.
