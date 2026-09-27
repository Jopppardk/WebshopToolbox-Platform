# Tier 1-paritet og support – 21. september 2026

> Opfølgning samme dag: læseforbindelser til Flatpay/ViaBill, emballageimport, lageroptællingssimulering og Dinero-dashboard er nu tilføjet. Den historiske mangelliste nedenfor er afløst af [MIGRATION-READINESS-2026-09-21.md](MIGRATION-READINESS-2026-09-21.md). Overførsler, driftsautomatik og faktisk flytteparathed er fortsat uafsluttede.

## Afgrænsning
Brugeren har godkendt implementering og deployment på dev.webshoptoolbox.dk. integration.sablen.dk må hverken flyttes eller ændres. Ingen deployment til portal.webshoptoolbox.dk og ingen merge til main. Baseline er origin/main 73e45ac80568c6c6de3057fd41dcbe3c8dd2e6e9, kontrolleret mod GitHub før ændringerne. Senere åbne PR-er er ikke en del af baseline.

**Dette er en delvis migration, ikke 100 % funktionsparitet.** Tabellen skelner mellem implementerede funktioner og resterende arbejde. Ingen statisk tabel må tælle som migreret funktion. Bogføring, lagerændringer hos udbyder, almindelige kundemails og cron forbliver blokeret i dev.

## Implementeret
| Område | Faktisk funktion |
|---|---|
| Support, Tier 1 | Opret supportsag med emne og besked, fælles virksomhedsoversigt, statusfilter, sideinddeling, svartråd, luk/genåbn. Ingen udviklingsside. |
| Support, Tier 0 | Indbakke på tværs af virksomheder, svar som Toolbox-support, ændring af status og prioritet. Impersonering må ikke bruges til at skrive som kunden. |
| Faktura-mail | Synlige emne- og tekstfelter under Indstillinger → Fakturaer, 200/4000 tegn, fire skabelonfelter, forhåndsvisning med eksempeldata, seneste genererede faktura som test. Testmodtager er fortsat den godkendte loginadresse. |
| Faktura-PDF | Priser inkl. moms efter rabat, Heraf moms, produkt/indgraveringsgruppering fra seneste main, indrykning, ingen skiftevis rækkeudfyldning. Virksomhedens egen identitet bevares. Udstedte PDF-er overskrives ikke. |
| Shopify-forbindelse | Særskilt læsetest af butikkens navn. Verifikation slettes ved udskiftning af credentials. |
| Salg | Sidevis import, søgning og gemte data pr. webshop, betalingsudbyder, status, beløb og detaljer. Frisk, kontrolleret bogføringsforhåndsvisning med Dinero-kontotilknytninger. |
| Tilbagebetalinger | Sidevis læseimport af Shopify Payments-refunderinger med beløb, gebyr og netto. |
| Udbetalinger | Sidevis Shopify Payments-import, status og beløb. Ingen bogføringsstatus påstås overført. |
| Udbetalingsrapporter | Kontrolleret Shopify-afregning med komplette REST-transaktioner, afstemning og PDF-specifikation. Isoleret R2-lagring, varigt genereringskrav før upload, ingen blind gentagelse efter uafklaret lagring. |
| Lager | Shopify-lager pr. lokation, antal, kostpris og beregnet værdi. Ufuldstændige lokationssvar afvises. Visningen er gemte snapshots med hentetid, ikke en afsluttet lageroptælling. |
| Emballage | Manuelle registreringer pr. webshop, periodefilter, husholdning/erhverv, leverandørfelter, indberetningspligt og pris pr. kg. Beregninger genbrugt fra main. |
| Dinero | Krypterede credentials pr. virksomhed; forbindelse kontrolleres ved GET af kontoplan. Én organisation; ændring til en anden organisation afvises. Kontotilknytninger valideres mod aktiv kontoplan. Ingen bilag skrives. |
| Dashboard og Indsigt | Faktiske importerede antal og seneste hentetid for tilladte webshops; historik for manuelle importer med succes/fejl. Regnskabets økonomital er stadig ikke tilkoblet. |

## Fortsat manglende paritet
- Flatpay: connection/credentials, salg/refunderinger, samlede afregninger inkl. flere settlements pr. bilag, kommende udbetalinger, rapporter og genopretning.
- ViaBill: providerforbindelse og records efter den funktionalitet, der faktisk findes i Sablen-baseline.
- Lageroptælling: prepare/commit, versionskontrol mod friske lagerantal og test af reguleringsforslag.
- Emballage: automatisk Shopify-produkt/fulfillment-import, materialefelter, leverandøropslag i Dinero, EIS-forbindelse/indberetning og monitor.
- Samlet salg/realisering og loghistorik, fuldt udbydermix, tilbagebetalings- og udbetalingsforslag med kvitteringer, kladde/bogført-afstemning og manuel recovery. Der findes ingen økonomisk skriveadapter i denne leverance.
- Regnskabsbaseret omsætning, overskud og bogført lager på dashboard.
- Scheduler, jobvalg/intervaller, scope/startdato pr. integration, incident/recovery og mailalarmer fra seneste Sablen. Manuelle Shopify-importer bruger indtil videre virksomhedens fakturahistorik i måneder.
- Automatisk fakturamail med aktiveringstidspunkt og normal kundemail. Blokeringen er bevidst i dev; selve køen/automatikken er ikke flyttet.
- Fri testmodtager er ikke åbnet: dev holder fast i godkendt loginadresse og testbindingens allowlist.
- Support: svar læses i portalen; mailnotifikationer og vedhæftninger er ikke implementeret.
- UI har samme hovedstruktur, men ikke alle Sablens faner, periodevalg, diagrammer og handlingsdialoger er flyttet.

## Adgang og data
Alle API-ruter kontrollerer company/webshop mod serverens brugerrelationer. Snapshots, kørsler, dokumenter, manuelle poster og nøgler har company/webshop-scope. Tickets tilhører en virksomhed og deles med dens medlemmer. Ingen credentials returneres. Kun faste Shopify/Dinero-endpoints; redirects med credentials afvises. Ticket- og emballagesvar bruger versionskontrol. Supportbeskeder rendres som tekst, ikke HTML.

Nye migrationer 0011–0016 er additive. Dev-backup: ignoreret `.wrangler/before-parity-2026-09-21.sql`. Prøve på backuppen kontrollerer identiske eksisterende rækker og ingen foreign_key_check-fejl. Lokal database er migreret; remote-status registreres nedenfor.

## Validering
- Hele pakken bestod med 321 tests. Efter sidste dashboard/auditjustering og en ekstra test af fakturalinjegruppering bestod 59/59 platformtests. Ingen tests sprunget over.
- Obligatorisk build, TypeScript og begge Worker-dry-runs bestået. Ingen legacy-runtimefiler ændret; kun platformtests under lib er ændret.
- Browser: lokal kunde-login, supportoprettelse, mailskabelon, nye modulvisninger og forbindelsesopsætning kontrolleret med syntetiske data.
- PDF: faktura og tosidet udbetalingsrapport genereret med syntetiske data og begge rapportens sider visuelt kontrolleret.
- Tests dækker overlappende eksterne ID-er, kundeadgang, read-only roller, CSRF, ufuldstændige sider, ugyldige datoer, kryptering, forældede revisioner, afstemningsfejl og bevarelse af dokumenter efter usikker upload.
- Rigtige kundecredentials/providerflows og rigtig mailmodtagelse er ikke end-to-end-testet i denne leverance. Der er ikke foretaget bogføring eller sendt kundemails.

## Deployment
Udgivet alene til webshop-toolbox-platform-test / dev.webshoptoolbox.dk som **00bfed86-f337-45a0-8718-423dc730ada5**. Migration 0011–0016 anvendt i dev-D1 438fde65-c538-4719-aa2e-9502ae37c7e6. HTTPS-kontrol: /login 200, anonym /api/platform/me og /api/platform/tickets 401, /admin/ 302 til Access. noindex verificeret på Worker-svar.

Remote autentificeret kundegennemgang, rigtige providerimporter og Tier 0 i browser er ikke genvalideret online; lokal browser og isolationstest er grundlaget. Ingen rigtig testmail sendt i denne opgave. Ingen push, main-merge eller deployment til Sablen/produktionsplatform.

Tilbageførsel: Worker kan rulles tilbage til tidligere dev-version 6dab3cd8-66d5-4786-bded-4900281bf4c8; de additive tabeller kan bevares. Databasebackup må ikke gendannes ukritisk efter nye kunderegistreringer, fordi nyere dev-data ellers mistes.
