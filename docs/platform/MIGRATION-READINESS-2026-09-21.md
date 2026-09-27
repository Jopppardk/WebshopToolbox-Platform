# Klargøring til prøveflytning – 21. september 2026

## Målet og grænserne
Brugeren har bedt om, at platformen færdiggøres til efterfølgende flytning af Sablen. Dette er fortsat den aktive opgave; nedenstående udvidelse er ikke en erklæring om migrationsklarhed. Sablen må hverken flyttes eller ændres nu. Kun dev må udgives, og main må ikke merges.

Brugeren kan tilknytte separate Shopify-/Dinero-testkonti i dev. Nøgler indtastes i portalens Integrationer, ikke i chat. Eksterne bogføringswrites, Shopify-lagermutationer og almindelig kundemail forbliver blokeret i dev. En senere kontrolleret skriveprøve kræver særskilt afgrænsning til testkonti og må ikke åbne adgang til Sablen-produktionen.

## Implementeret i denne udvidelse
| Område | Faktisk funktion |
| --- | --- |
| Flatpay | Kontodiscovery, aftaleverifikation, krypteret forbindelse pr. webshop, startdato, transaktioner, afregninger og betalte/kommende udbetalinger. Merchant og aftale valideres server-side. Betalt udbetaling kan ikke overskrives af kommende. Samme aftale kan ikke tilknyttes to webshops. |
| ViaBill | Discovery eller indtastet Merchant Account ID med serververifikation, krypterede nøgler, capture-betalinger og komplette udbetalingsspecifikationer. Fortsættelse bindes til virksomhed, webshop, konto, revision og periode. Gentagne sider afvises. Afstemningsafvigelser vises. |
| Lageroptælling | Aktuel samlet læsning af lageret, optalte antal, kontrolleret reguleringsforslag, udløb, versionskontrol, annullering og eksplicit dev-simulering. Antal og kostpriser kontrolleres igen ved godkendelse. Ingen Shopify- eller Dinero-skrivning. |
| Emballage | Shopify-fulfillment- og produktmetafeltimport, komplet paginering, husholdning/erhverv, historiske vægte bevares, ukendte vægte kan udfyldes ved genimport. Produktsummer og dækningsperiode vises sammen med manuelle poster. Ingen EIS-indberetning endnu. |
| Regnskabsdashboard | Dinero-GET af regnskabsår, kontokategorier og posteringer/ændringer. Omsætning og resultat MTD/YTD samt bogført lager fra valgt konto. Manglende dækning vises som ukendt. Afgrænsning pr. virksomhed og organisation, importlås og kontrolleret opdatering. Adgang til samlede virksomhedstal kræver virksomhedsadministrator. |

Den rene udbyderlogik er portet fra den verificerede main-baseline `73e45ac80568c6c6de3057fd41dcbe3c8dd2e6e9` i det lokale, ignorerede auditarkiv. Legacy-runtime, produktionskonfiguration og Sablen-data er ikke ændret.

## Testet
- 327/327 repositorytests bestået, heraf 64 platformtests. Ingen sprunget over.
- Build, TypeScript, JavaScript-syntaks og begge Worker-dry-runs bestået.
- Tests med overlappende ID’er, separate virksomheder/webshops, læserroller, aftaledubletter, kryptering, kontorevisioner, gentaget paginering, betalt/kommende-status, historiske emballagevægte, lagerantal og kostprisændringer.
- Lokal browser: eget kundelogin, regnskabsdashboard uden forbindelse, Lager, Emballage og betalingsforbindelser under Integrationer.
- Migration 0017–0020 prøvet på frisk dev-backup: alle eksisterende rækker identiske og ingen foreign_key_check-fejl.
- Ikke testet: rigtige Flatpay-/ViaBill-konti, testkonti hos Shopify/Dinero, komplet bogføringsforløb eller faktisk Sablen-prøveflytning. En simulering er ikke en bogføringskvittering.

## Stadig nødvendigt før Sablen kan flyttes
1. **Finansielle overførsler:** salg, refunderinger, Shopify/Flatpay-udbetalinger, flere Flatpay-afregninger i ét bilag, aktuelle kontoplaner, vedhæftede rapporter, gemte bilags-ID’er, draft/booked/uncertain og verificeret manuel recovery. De almindelige økonomiske skriveadaptere er endnu ikke portet.
2. **Lagercommit:** sikker totrinsændring i Shopify/Dinero med idempotency, varigt mellemresultat og recovery efter delvis gennemførsel. Den implementerede simulering må ikke fremstilles som dette.
3. **Emballageindberetning:** EIS-forbindelse/skemaer, konfiguration, leverandøropslag, kvartalsforberedelse, afstemning, kvitteringer og monitor. Shopify-import alene opfylder ikke dette.
4. **Driftsautomatik:** separate jobvalg/intervaller/startdatoer, webshoplåse, fortsættelser, hændelser og genopretning; alarmer efter seneste Sablen-regler. Scheduler er fortsat deaktiveret.
5. **Fakturamail:** normal kundeafsendelse, aktiveringstidspunkt, varige afsendelseskvitteringer og kø med håndtering af usikkert udfald. Begrænset testmail findes allerede; det er ikke normal kundeautomatik.
6. **UI-paritet:** samlede udbyderlister, realiserings- og bogføringsstatus, periodefaner og alle relevante handlingsdialoger. De nye betalingslister åbnes foreløbig fra den enkelte forbindelse.
7. **Selve prøveflytningen:** importværktøj og manifest for alle historiske poster, PDF’er, hashes, organisationer, kvitteringer, mailhistorik, incidents, startdatoer og cursorer. Gentaget import skal være idempotent. Test delvis flytning, gendannelse og overlappende ID’er.
8. **Cutover/rollback:** dokumenteret stop af gamle kørsler før nye, bevaring af alle kvitteringer og afstemning af posteringer efter skiftet. Intet produktionsskift uden særskilt godkendelse.

Ingen af disse uafsluttede punkter er alene blokeret af manglende testkonti; implementeringen skal fortsætte uafhængigt af brugerens opsætning.

## Udrulning
Udgivet alene til dev som Worker-version `d4514abf-3141-45c4-b58d-f5674e1ec6a4`. Migration 0017–0020 er anvendt i dev-D1 `438fde65-c538-4719-aa2e-9502ae37c7e6`. Online kontrol: /login 200, anonym /api/platform/me og /companies/unknown/finance 401; Worker-svarene har noindex. /admin/ sender 302 til den forventede Cloudflare Access-udsteder; dette redirect sker før Worker og har ikke Workerens noindex-header. Autentificeret online providerafprøvning afventer testkontiene. Ingen main-merge, push eller produktionsudgivelse. Backup før ændringen: `.wrangler/before-readiness-2026-09-21.sql` (ignoreret, private dev-data; må ikke committes). Tidligere dev-Worker: `00bfed86-f337-45a0-8718-423dc730ada5`. Additive tabeller kan blive liggende ved Worker-rollback; databasen må ikke gendannes ukritisk efter nye registreringer.
