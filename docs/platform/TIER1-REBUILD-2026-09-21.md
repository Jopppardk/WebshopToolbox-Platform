# Genopbygning af Tier 1 fra Sablen

> 21. september 2026 – **Dev-datafunktioner udgivet som `51c1d4ea-a908-4294-a0b0-dd88f84d9508` på https://dev.webshoptoolbox.dk.** Migration 0022 anvendt på dev efter frisk backup `.wrangler/before-dev-data-0022.sql` og kopitest med identisk indhold i alle eksisterende tabeller samt FK-kontrol. Ingen nulstilling. Fælles historik og individuelle startdatoer for Shopify/Dinero/Flatpay/ViaBill, manuel ordre-/betalings-/udbetalingsimport, periodevisninger, kontoplan/leverandører, regnskabsdashboard, lagerlæsning/optællingssimulering, emballageforbrug/manuelle poster/priser, krypteret Emballage Indberetning-læseforbindelse, fakturaoplysninger/PDF/testmail, rapporter og importlogs er tilsluttet den nye klient. Flatpay-bankhistorik hentes i 31-dagesportioner; ViaBill fortsætter via validerede cursors. Shopify-testordrer vises markeret, men fakturakontrollen afviser dem fortsat. Eksisterende PDF'er bevares; regenerering er deaktiveret. Fælles historik afgrænser læsning/import, sletter ingen eksisterende data. Ingen cron, automatisk eller manuel bogføring, kundemail, eksterne lagerændringer eller emballageindberetning er aktiveret. Eksplicit fakturatest er fortsat begrænset til egen godkendte loginadresse. Fuld 1:1-paritet er **ikke** godkendt (bl.a. automatiske flows, fuld hændelseshistorik og Flatpay-PDF er ikke flyttet). Den samlede suite bestod 339 tests; efter de sidste rettelser bestod 76/76 platformtests. Begge builds/typechecks og dry-runs bestået. Remote efterkontrol: login/healthz 200, historie-/ordreruter 401 uden session, bookkeeping/customerEmail blocked. Migration 0022 registreret; ingen FK-fejl. Lokal browserkontrol er blokeret med ERR_BLOCKED_BY_CLIENT; ingen rigtige leverandørkonti afprøvet. Sablen uændret, prod fortsat nedtaget, ingen push/main-merge.


> 21. september 2026 – Tier 1-integrationstilslutninger udgivet kun på dev som `7553d17c-bd95-4024-85d3-cb976a675895`. Shopify og Dinero kan testes/gemmes fra React-klienten. Første Shopify-tilslutning opretter webshoppen atomisk efter læsekontrol; efter reload vælges den nye webshop. Webshopvælgeren tilbyder Tilføj webshop. Eksisterende Shopify-identitet kan ikke ændres, og konkurrerende credential-opdateringer afvises. Dinero anvender virksomhedens fælles regnskab og beskytter mod organisationsskift. Credentials krypteres scoped til miljø/virksomhed/webshop; mislykket kontrol bevarer tidligere nøgler. Integrationsbibliotekets valg er koblet til company_integrations. Flatpay/ViaBill konto-/aftalehentning, kontrol og lagring bruger de eksisterende read-only adapters med versionskontrol. Flatpay-startdato ændres ved genvalidering med nøgler; ViaBill har startdato i forbindelsesformularen. Emballage Indberetning kan **endnu ikke tilsluttes** og tilbydes ikke som nyt valg. Historik/startdato for Shopify/Dinero, manuel kontoplansynkronisering og øvrige manglende moduler er ikke implementeret ved denne ændring; fuld paritet er fortsat falsk. Ingen automatisk ordreimport startes ved Shopify-tilslutning. 335/335 tests, begge builds/typechecks/dry-runs bestået. Lokal browserkontrol: integrationskatalog, tilføj Flatpay og validering af tom Shopify-formular. Rigtige leverandørkonti er ikke prøvet; brugeren tilknytter egne separate testkonti. Remote login/healthz 200, integrationsrute 401 uden login, bogføring/kundemail fortsat blokeret. Ingen remote testdata oprettet, ingen migration nødvendig. PROD forbliver nedtaget, Sablen uændret, ingen push/main-merge.


> 21. september 2026 – dev nulstillet og onboarding-dashboard udgivet som `deb420e4-abff-46eb-b276-76acb8ee3dd2`. Efter brugerens præcisering gælder nulstillingen **kun dev**: virksomheder, kundebrugere og øvrige Tier 1-data er slettet; `platform-admin-rene` og migrationshistorikken er bevaret. Frisk ignoreret backup `.wrangler/before-tier1-reset-test-2026-09-21-onboarding.sql`; sletningen prøvet på backup før udførelse. Alle 39 tabeller efterkontrolleret, ingen FK-fejl. Dev-R2 var tomt. Ingen nye remote testdata oprettet. Dashboard erstattes af to store genveje til Dinero/Shopify, indtil begge er verificeret forbundet; allerede forbundet vises grønt. Genvejene åbner den relevante formular under Integrationer. Statusfejl vises særskilt med genforsøg. 332/332 tests, begge builds/typechecks/dry-runs bestået; lokal browserkontrol af begge genveje og udseendet. Remote: rod 303, login 200/noindex, me 401 uden session, admin 302 og healthz 200 med bogføring/kundemail blokeret. Remote kundevisning er ikke testet efter nulstillingen, da kundebrugerne nu er slettet. **Eksisterende mangel består: POST /api/integrations (Test og forbind) er endnu ikke tilsluttet i den nye React-klient.** Dette arbejde implementerer genvejene, ikke den manglende integrationsadapter. Sablen og Toolbox Prod er uændrede; ingen push eller main-merge.


## Beslutning

Brugeren har godkendt at starte Tier 1 forfra med målet om samme funktioner og brugerflade som integration.sablen.dk. Den originale React-kode er nu udgangspunktet. Den hidtidige vanilla-JS-kundeportal er bevaret som eksisterende løsning, ikke som designreference.

Aftalte undtagelser: WebshopToolbox-branding og kundens identitet, ingen Udviklingsside, Support med Tier 0-backend, eget login og servervalideret virksomheds-/webshopadgang. Én virksomhed pr. kunde, flere webshops, ét regnskab. Tier 0 må fortsat kun vise webshops. Ingen Sablen-ændring, main-merge eller ny nulstilling.

## Faktisk status

**Genopbygningen er ikke færdig, men brugeren har efterfølgende udtrykkeligt godkendt at erstatte dev med denne udgave. Udgivet til dev som `9d29d977-cf7c-41ec-81c8-2b2c3cfcffa9`. Der må ikke erklæres 100 % paritet.**

- `platform/tier1/src`: 64 kildefiler fra main `73e45ac80568c6c6de3057fd41dcbe3c8dd2e6e9`; GitHub main og platformbranch er kontrolleret inden ændringer. Originale komponenter, formularer, faner, hjælpefunktioner, CSS og selvhostede Geist-skrifter genbruges. `source-manifest.json` dokumenterer originalernes SHA-256 og tilpasningerne.
- Separat React/Vite-build og TypeScript-konfiguration. Den eksisterende Sablen-app under `app/`, `components/`, `db/` og dens runtime-entrypoint er ikke ændret. Frontend-build/typecheck er føjet til platformens CI. Skriftlicens medfølger.
- `platform/tier1-api.ts`: API-indgang for lokal og dev. Virksomheden udledes fra den autentificerede bruger; serveren kontrollerer virksomhed og valgt webshop. Tier 0, anden virksomheds webshop og læser uden adgang afvises. Ikke-tilsluttede kontrakter svarer 501, aldrig falske succeser eller opdigtede tomme driftsdata.
- `platform/tier1-settings.ts`: original settings-validator og fakturamailformular. Kontoplan og mailskabelon bruger de eksisterende virksomhedsdata. Modulvalg/interval er afgrænset til webshoppen i migration 0021. Versionskontrol omfatter fælles kontoplan og mailskabelon, også ændringer fra den gamle portal/andre webshops. Betingelserne kontrolleres igen atomisk under skrivningen. Automatik, bogføring og almindelig kundemail forbliver blokeret.
- Support genbruger virksomhedens rigtige, eksisterende supportsager og Tier 0-backend. Opret, læs, svar og sideinddeling findes i den nye React-side. Ingen parallel supportdatabase eller simulerede supportdata er indført.
- Gemt regnskabsdashboard, kontoplan samt Dinero-/Shopify-forbindelsesstatus kan læses. Det er ikke komplette flytninger af de tilhørende flows.

## Lokal drift

```sh
npm run platform:tier1:typecheck
npm run platform:tier1:build
node scripts/platform.mjs init-local
node scripts/platform.mjs dev
```

Åbn `http://127.0.0.1:8790/login` med en lokal virksomhedsbruger, derefter `/tier1-next/`. Den gamle lokale kundeportal og Tier 0 er bevaret. Den nye klient vises også på dev-rodsiden efter kundelogin. Den nye indgang er fortsat utilgængelig i production. Migration 0021 er anvendt lokalt og på dev. Tier 0 beholder sin eksisterende brugerflade. Buildscriptet bygger altid React-klienten før lokal start, dry-run og dev-deployment.

## Kontrol mod den aktuelle Sablen-side

Brugeren loggede ind til læseadgang. Dashboard, navigation, Generelt og Faktura-afsendelse er læst i den aktuelle portal. Ingen Gem, import, synkronisering, testmail eller økonomisk handling blev udført på Sablen.

Faktura-afsendelse har samme felter og handlinger: automatisk afsendelse, emne, mailtekst, pladsholdere, testmodtager, seneste faktura som test og Gem indstillinger. Det beviser formularstrukturen, **ikke** at alle bagvedliggende handlinger er færdige.

Lokalt er kunde-login, React-rendering, skabelonlagring og læsning af eksisterende supportsag kontrolleret i browseren. Kun en syntetisk lokal mailskabelon er ændret. Ingen Sablen-branding eller Udviklingsside findes i den nye klient. Dashboardets ikke-tilsluttede driftsstatus viser en udtrykkelig fejl.

Test efter dev-aktivering: 331/331 tests bestået. Nye tests dækker kunde-/webshopadgang, lokal begrænsning, fælles mailskabelon, webshopafgrænsede modulvalg og samtidige ændringer fra flere webshops/andre indstillingsskærme. Build af gammel og ny brugerflade, begge TypeScript-kontroller, konfigurationskontrol og begge Worker-dry-runs er udført. Ingen remote CI-kørsel eller push.

## Restarbejde efter den godkendte dev-udgivelse

[Kontraktlisten](TIER1-CONTRACTS-2026-09-21.md) omfatter 44 oprindelige ruter og 69 metodekontrakter, inklusive den fravalgte Udviklingsfunktion. Maskinlæsbart grundlag: `platform/tier1/contracts.json`. En kopieret komponent er ikke ensbetydende med en flyttet funktion.

1. Forbind import, salg, tilbagebetalinger, udbetalinger, dokumenter, versionsstyrede PDF'er og afgrænset fakturatest med originale response-/fejl-/filterkontrakter.
2. Forbind integrationstilslutning, katalog, startdatoer, historik, Flatpay/ViaBill og fælles Dinero-opsætning.
3. Portér bogføringsmotor med kvitteringskontrol, usikre writes, dubletbeskyttelse og manuel afklaring. Ingen testposteringer på rigtige regnskaber.
4. Portér lageroptælling, emballage, leverandører, EIS-indberetning, driftsjobs, alarmer og notifikationer.
5. Gør brugeradministration, virksomheds-/afsenderoplysninger og tidligere godkendte Toolbox-funktioner tilgængelige fra den nye kundeportal.
6. Sammenlign alle sider og flows mod Sablen; test to webshops med overlappende ID'er og brugerens separate testkonti. Dev er nu erstattet efter særskilt brugerbestilling, selv om disse acceptkrav ikke er afsluttet. Produktion og selve Sablen-flytningen er ikke omfattet.

Den tidligere delvise backend er bevaret og kan genbruges, hvor kontrakter og isolation stemmer. Det er ikke tilladt at skjule manglende implementering med tomme lister, grøn status eller konstante succesbeskeder.
