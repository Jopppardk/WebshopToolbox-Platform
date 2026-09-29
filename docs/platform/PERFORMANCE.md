# Performance

Status 29. september 2026: implementeret og lokalt testet på
`platform/performance-dashboard`. Ikke sat i drift på dev eller prod.

## Funktion

Tier 1-menuen har en ny **Tools**-sektion med Performance, Emballage og
Produktfeeds, også på mobil. Performance viser januar–december som søjler med en
stiplet linje for året før. Årsvælgeren omfatter indeværende år og ni tidligere år.
Hver graf har en læsbar tabel med de samme månedstal.

- Omsætning: virksomhedens bogførte omsætning fra Dinero, ekskl. moms.
- Omkostninger: virksomhedens bogførte omkostninger før skat, uden
  fradragsberettiget moms. Alle leverandører, én leverandør eller Uden leverandør
  kan vælges. Filteret ændrer både årets og sammenligningsårets omkostninger.
- Besøg: sessioner fra den valgte Shopify-butiks analyser.
- Antal ordrer: ordrer fra den valgte Shopify-butiks salgsrapport.

Dinero dækker hele virksomheden; webshopmålinger dækker den valgte butik.
Indeværende måned er til dato, mens sammenligningsåret viser hele måneder.
Fremtidige måneder, manglende rapporttal og måneder før den gemte historikstart
vises som ukendte (—). En måned, hvor historikstart ligger midt i måneden, skjules
helt for at undgå en misvisende delsum. Nul vises kun, når kilden underbygger det.
Summen over hver graf er summen af de viste måneder, ikke en beregnet helårsprognose.

## Kilder og adgang

`GET /api/platform/tier1/shops/:shop/performance/finance?year=YYYY` og
`GET /api/platform/tier1/shops/:shop/performance/shop?year=YYYY` validerer session,
virksomhed, webshop, status og medlemskab på serveren. Regnskabstal kræver
virksomhedsadministrator ligesom den eksisterende regnskabsoversigt. Klientens
tenant-/virksomhedsparametre kan ikke vælge et andet regnskab.

Dinero-adapteren genbruger den gemte krypterede forbindelse. Den læser regnskabsår,
kontokategorier, posteringer og kontaktlisten (v2, inklusive slettede kontakter).
Omsætning er minus summen af kategorien Turnover; omkostninger summerer
udgiftskategorierne defineret i `platform/performance-calculations.ts`.
Balancekonti, moms, skat, renteindtægter, primo og ultimo indgår ikke.
Kreditposteringer reducerer omkostningerne. Ukendte kontokategorier på bogførte
posteringer giver en fejl frem for en ufuldstændig sum. Beløb behandles i hele øre.

Leverandører knyttes via posteringens ContactGuid eller en entydig kontakt på samme
VoucherGuid, eksempelvis kreditorlinjen. Manglende eller flertydig tilknytning går
i Uden leverandør. Manglende kontaktnavne bevarer ID'et og markeres som ukendte.
Leverandør-ID'er, gentagne posteringer, beløb, datointervaller og sideinddeling
valideres. Adapteren henter højst 20.000 kontakter; en større eller ufuldstændig
liste giver fejl.

Shopify-adapteren bruger ShopifyQL: `FROM sessions SHOW sessions` og
`FROM sales SHOW orders`, begge med `TIMESERIES month`. Det kræver `read_reports`
og Shopifys Level 2-adgang til beskyttede kundedata. Integrationsguiden er opdateret.
Butikkens tidszone bruges til datogrænsen. Fejl vises pr. måling, så en afvist
besøgsrapport ikke skjuler en tilgængelig ordrerapport. Parserfejl, manglende
kolonner og ugyldige månedstal accepteres ikke som nul.

Officielle referencer:

- [Dinero OpenAPI](https://api.dinero.dk/openapi/index.html)
- [Dinero analyseintegrationer](https://developer.dinero.dk/news/how-to-create-an-analysis-integration/)
- [Shopify shopifyqlQuery og adgangskrav](https://shopify.dev/docs/api/admin-graphql/2026-07/queries/shopifyqlQuery)
- [ShopifyQL datoafgrænsning](https://shopify.dev/docs/api/shopifyql/latest/syntax/since-until-during)

## Cache og afgrænsning

En separat `performance:v1:`-cache ligger i den eksisterende `finance_state`.
Virksomhed, miljø, kilde, regnskabsorganisation/webshop og år afgrænser cachen.
En hash af credentials, historikstart og dato invaliderer gamle resultater uden
at oprette en ny række dagligt. Tal genbruges i op til 15 minutter; fejl og delvise
Shopify-svar i højst 30 sekunder. Opdatér-knappen genlæser denne cache og omgår ikke
kildens begrænsning. En atomisk lås forhindrer samtidige hentninger af samme rapport.
Adgangskontrol udføres også før udlevering af allerede gemte tal.

Ingen migration. Kun læseforespørgsler hos kilderne ud over tokenudstedelse;
ingen bogføring, ordreændring, kundemail eller nye produktionskvitteringer.
Eksisterende importer, bogføringsjournal og beskyttelse mod dubletter er uændrede.

## Verifikation og rester

Lokalt bestået: alle 413 tests, begge typechecks, Tier 1-build, eksisterende
applikationsbuild, konfigurationskontrol samt obligatoriske dry-runs for legacy,
platform dev og platform prod. CI-definitionen er uændret.

Nye tests dækker fortegn, krediteringer, moms-/balanceafgrænsning, leverandørkobling,
forskudte regnskabsår, historikgrænser, årsskifte, ugyldige kildedata, delvise
Shopify-fejl og to virksomheders/to butikkers overlappende eksterne ID'er.
API-testen verificerer afviste adgange, isolerede caches og uændrede journaler.

Lokal browserkontrol med syntetiske data: fire grafer og stiplet sammenligning,
leverandørfilter, årsskift, webshopskift, isoleret rapportfejl, månedstabel og
Tools-menu på desktop/mobil uden vandret overflow. Ingen browserfejl observeret.

Rigtige Dinero-/Shopify-forbindelser er ikke afprøvet med denne funktion.
Ved udgivelse skal butikkens rapportadgang og den ønskede historikstart kontrolleres.
Live-tal skal sammenholdes med kildernes tilsvarende rapporter; dette er ikke
erstattet af de syntetiske tests. Merge og deployment er separate efterfølgende trin.
