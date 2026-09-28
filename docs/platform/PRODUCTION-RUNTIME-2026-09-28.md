# Produktionsaktivering, 28. september 2026

## Status: implementeret og lokalt testet; udgivelse afventer CI

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
