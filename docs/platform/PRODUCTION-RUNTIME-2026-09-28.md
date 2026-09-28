# Produktionsaktivering, 28. september 2026

## Status: udgivet og aktiveret på PROD; DEV forbliver blokeret

Brugeren har godkendt produktionsaktivering og oplyst, at den gamle Sablen-
integration er stoppet. Ingen Sablen-installation ændres. Ingen økonomiske
prøveposteringer udføres i produktion. DEV beholder blokeret bogføring/kundemail.

## Implementeret

- Tenantafgrænsede Dinero-adapters for salg, refunderinger, Shopify Payments-
  udbetalinger og simple afstemte Flatpay-afregninger i DKK. Kontoplan, datoer,
  aktuelle kildedata og returnerede bilagsbeløb verificeres før videre behandling.
- Varige kvitteringer (0026) forhindrer gentagen oprettelse og genafsendelse.
  Kvitteringer, credentials, PDF'er og fejllog er afgrænset til virksomhed/webshop.
  Usikre writes genforsøges ikke. Kendt bogført Dinero-GUID kan verificeres ved GET.
- Shopify-lageroptælling med frisk antal-/kostpriskontrol, compare-and-set og
  idempotency key; efterfølgende Dinero-kladde/bogføring. Delvis/usikker gennemførelse
  bevares til manuel afklaring. Lagerkost kan indgå i salgsbilag ved valgt modul.
- Kundevalgt emballageindberetning med kontrolvisning, komplet historik, friske
  formularfelter/organisationskontrol, kundegodkendelse og holdbar kvittering.
  Scheduler opdaterer emballagehistorik dagligt; indberetning kræver kundens klik.
- Fakturamail til serverhentet kundeadresse og gemt PDF. Leverandøraccept er ikke
  det samme som verificeret indbakkelevering. Demo-mail forbliver separat.
- Scheduler hvert femte minut, gemte intervaller/modulvalg, holdbare importcursors,
  webshoplåse, begrænset antal poster pr. kørsel og cooldown ved fejl (0027).
  Ændrede opsætninger og udløbne prøveperioder stopper nye baggrundshandlinger.
- Tilmelding fra den koordinerede hjemmesideopgave (0028). Trial håndhæves både
  for kundesessioner, virksomhedsadgang og scheduler. Nye kunder får ikke automatisk
  aktiveret bogføringsmoduler ved tilmelding.
- PROD-konfiguration tillader eksplicit enabled + præcis femminutters-cron.
  DEV-konfiguration accepterer fortsat kun blocked. Ressourcebindinger er fastholdt.

## Afgrænsninger

ViaBill er import/oversigt, ikke en automatisk Dinero-bogføringsadapter. Komplekse
Flatpay-reguleringer og ukendte bilagsformer stoppes til kontrol. Manglende data,
startdatoer eller kontotilknytning omgås ikke. Et tidligere eksternt bilag kan kun
markeres afstemt via den eksisterende eksplicitte afstemningsfunktion; der gættes
ikke på historiske matches. Brug de gemte cutover-datoer. Et uafklaret eksternt
write kræver afklaring; generel genoprettelse/automatisk retry er ikke implementeret.
Fejl vises i portalen; særskilte alarmmails er ikke aktiveret af denne udgivelse.

## Verifikation

374/374 tests bestået før de sidste status-/prøveperiodejusteringer. Syntetiske
API'er og SQLite dækker overlappende eksterne ID'er, samtidige jobs, tabte svar,
kvitteringsgenbrug, ændrede ordrer, datoer, lagerantal og emballagemængder.
Typechecks og hovedbuild bestået. Endelig CI/dry-runs og migrationsprøve følger.
Ingen rigtig mail eller bogføring er udført som test.

## Drift og tilbageførsel

Kun WebshopToolbox-Platform og de to platformressourcer anvendes. Udgivelse sker
via GitHub-workflow efter grøn CI og separat migrering. Cloudflare Time Travel-
bookmark skal registreres før migrering; kundedata eksporteres ikke til en lokal
fil. Migrationerne er additive og afprøves på en syntetisk kopi af tidligere skema.
Ved driftsproblem blokeres writes/kundemail og cron først. Kvitteringer må aldrig
rulles tilbage eller slettes efter eksterne writes, da det kan medføre dubletter.
Produktionsmoduler følger kundens gemte valg, også når den globale runtime åbnes.

## Udgivelseskontrol

- Migration 0026/0027 anvendt på PROD og DEV efter 0028 fra signup-opgaven.
- Syntetisk opgraderingsprøve bevarer 44 eksisterende tabeller; nul FK-fejl.
- Remote PROD-kontrol: nul FK-fejl, 1 virksomhed og 48 ordresnapshots bevaret.
- Pre-runtime PROD Time Travel: `0000002a-00000004-000050f4-ce4afce59bcbd75407da21902c21c26b`.
- Pre-runtime DEV Time Travel: `00000070-00000000-000050f4-53190f6366efffc4d973e33cbdb991aa`.
- Aktuelle PROD-valg er salg/refunderinger/udbetalinger=true; automatisk kundemail,
  lagerkost og bilagsupload=false. Kundens valg bevares; ingen præferenceændring udført.
- Fuld GitHub-CI for 3d15d73 bestået; sidste status-/tekstjustering afventer endelig CI.

## Sidste driftsafklaring

Den manglende Shopify-mellemregningskonto er efter brugerens udtrykkelige godkendelse
sat til den eksisterende aktive `55100 - Shopify Payments`; auditpost gemt.
Andre kundepræferencer er uændrede. Fravalg af bilagsupload håndhæves for både salg,
Shopify-udbetalinger og Flatpay. Lokal PDF og kvittering bevares også uden upload.

Kommerciel Dinero-tilslutning er en særskilt udestående opgave: nuværende adapter
bruger personlig API-nøgle. Dinero kræver OAuth2 til en markedsført/solgt integration:
https://developer.dinero.dk/news/personal-integration/ (kontrolleret 28. september 2026).
Teknisk produktionsaktivering er ikke dokumentation for kommerciel Dinero-onboarding.

## Sat i drift

- PR #3 og #5 merged; udgivet commit `739b1860af09c0b082af0acc7e4127572802f9b1`.
- DEV workflow `36456558314`, Worker `f085b4d4-69d2-4e4b-8e7c-0cfbca43978d`.
- PROD workflow `36456562615`, Worker `b9eaf4f1-fc3c-478b-ab9c-b1472f4bada6`.
- Begge workflows gentog 375/375 tests og obligatoriske builds/typechecks.
- Begge miljøer: health/login 200, Tier0 302 til Access, anonym ordre-API 401.
- PROD health bekræfter bookkeeping/customerEmail enabled; DEV begge blocked.
- Automatisk kundemail og lagerkost er fortsat fravalgt af kunden; salg,
  refunderinger og udbetalinger er tilvalgt. Ingen historiske bogføringer er importeret.
- Den tidligere PROD-run `36455572877` blev annulleret før deploy for at få
  rettelsen af bilagsfravalget med. Det var ikke en tilbageførsel af levende data.
- Indbakkelevering og økonomiske writes er ikke afprøvet med testtransaktioner i PROD.

## Efterkontrol af automatik – 28. september kl. 19.41 dansk tid

Produktionskode og konfiguration er udgivet, men automatisk drift er endnu ikke
verificeret. Cloudflare API viser scheduled-handler og cron `*/5 * * * *`, oprettet
17:15:57 UTC og senest opdateret 17:21:21 UTC. Efter kontrollen af 17:40-intervallet
var production_jobs fortsat tom, og ingen nye operation_runs eller scheduled-events
var observeret. Én aktiv webshop har en egnet virksomhedsadministrator. Årsagen er
ikke fastslået; det må ikke beskrives som en bestået første kørsel. Der er ikke
udløst økonomiske testposteringer eller genstartet usikre writes.

Næste trin er at afklare Cloudflares manglende planlagte invocation og derefter
kontrollere første normale kørsel. PROD tillader stadig de godkendte operationer;
DEV forbliver blokeret. Guideudgivelsen fra PR #6 ændrede ikke runtime-funktionerne.
