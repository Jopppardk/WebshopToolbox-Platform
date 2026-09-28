# Produktionsaktivering, 28. september 2026

## Status: under implementering, ikke udgivet

Brugeren har godkendt produktionsaktivering og oplyst, at den tidligere
integration.sablen.dk-løsning er stoppet. Der skal ikke indhentes en ny generel
godkendelse af produktionsdrift. Sablen-installationen må fortsat ikke ændres.
DEV skal bevare blokeringerne. Der er ikke udført økonomiske testposteringer.

PROD er endnu ikke aktiveret. Konfiguration, cron, remote database og deployment
er uændrede. Dette er et delarbejde på platform/production-runtime.

## Kontrolleret remote, kun læsning

- Den gemte bogføringsstart er 2026-09-28 for Shopify, Dinero, Flatpay og ViaBill.
- En webshop har gemte modulvalg; alle automatiske moduler er false.
- 48 ordre-snapshots, 4 Shopify-udbetalinger, 15 Flatpay-betalingsposter,
  1 platformfaktura og 0 afstemningskvitteringer.
- Cloudflare gav først 7403. Efter verificering af OAuth-konto og D1-scope
  lykkedes samme læsekontrol. Ingen tokens eller credentials er udskrevet.

## Implementeret lokalt

- Migration 0026 tilføjer varige kvitteringer pr. virksomhed, webshop, provider,
  modul, eksternt ID og destination. Optimistisk låsning beskytter samtidige forsøg.
- Databasetriggers forhindrer, at en afstemning og en ny oprettelse vinder
  samtidig for samme post.
- Ny separat Dinero-klient uden gamle globale bindings. Writes genforsøges ikke.
- Salgsadapter validerer aktive rettigheder, gemte startdatoer, friske Shopify-data,
  kontoplan, fakturaens fingerprint, revisionsnumre og det returnerede Dinero-bilag.
  Den gemmer GUID før yderligere behandling og genopretter aldrig et usikkert bilag.
- En kendt GUID kan læses og verificeres som bogført efter et tabt svar.
  Usikker kladde uden bekræftet bogføring kræver fortsat en afklaringsfunktion.
- Almindelig fakturamail har et separat spor fra demo-mail, anvender den
  serverhentede kundeadresse og den gemte PDF, og gemmer afsendelsesclaim før send.
  Accepterede eller usikre mails bliver ikke automatisk genafsendt.

## Verifikation

364/364 isolerede repository-tests bestået. De nye tests dækker samtidighed,
webshop- og virksomhedsadskillelse, startdato, ændret ordre, mistet create/book-svar,
kvitteringsgenbrug, mail-timeout og afstemningsrace. Tests benytter syntetisk API,
in-memory SQLite og syntetisk dokumentlager. Ingen rigtig mail eller postering.
TypeScript-kontroller er kørt; obligatoriske builds og CI skal fortsat følges
før udgivelse. Migrationen er endnu ikke afprøvet på en frisk PROD-backup eller
anvendt remote.

## Krævet før aktivering

1. Tilslut serverruter, miljøspecifikke capabilities og klienthandlinger til de nye
   adapters; DEV skal fortsat afvise writes. Vis reelle kvitteringer i status/logs.
2. Implementer scheduler med holdbare cursors, låse, fair behandling af fejlede
   poster og kontrollerede modulvalg. Fakturamail skal respektere cutover-datoen.
3. Flyt de relevante refund-, payout-, Flatpay-/ViaBill-, lager- og
   emballageproduktionsforløb med samme tenantafgrænsning og dubletbeskyttelse.
   De gamle globale Sablen-adapters må ikke importeres direkte.
4. Kontroller om eksisterende indstillinger fortsat skal være fravalgt pr. kunde;
   global aktivering må ikke stiltiende tilsidesætte kundernes gemte modulvalg.
5. Udvid tests for de tilsluttede ruter/jobs, kør obligatorisk CI, afprøv migration
   på backup, og udgiv derefter via det separate platformrepositorys workflow.
6. Fjern kun testblokeringer for færdige funktioner. Adgangskontrol, datogrænser,
   afstemning og beskyttelse mod usikre gentagne writes skal bevares.

Dette dokument erstatter ikke den tidligere releasevurdering med en go-beslutning.
Brugerens accept af egne tests er registreret; det resterende arbejde er reel
manglende implementering og teknisk udgivelseskontrol, ikke yderligere tilladelse.
