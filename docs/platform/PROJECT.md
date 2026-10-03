# WebshopToolbox – fælles platform

> 3. oktober 2026 – Tools har fået Forsendelser: track & trace pr. afsendelse fra Shopify med status, datoer, fragtfirmaikon og varsel om pakker, der snart returneres fra pakkeshop. Implementeret og lokalt testet. Ikke udgivet. Se [SHIPMENTS.md](SHIPMENTS.md).

> 29. september 2026 – Performance er udgivet på Dev og Prod efter brugerens bestilling. PR #53, SHA `120581fbfe81ad7cc2bde539a6e003ae8104e41a`, run `36628986416`: 413 tests, obligatoriske checks og begge HTTP-gates bestået. Tools samler Performance, Emballage og Produktfeeds. Månedsgrafer med sammenligningsår og leverandørfilter er browserkontrolleret med testdata; rigtige rapporttal og Shopify-rapportadgang afventer kontrol. Se [PERFORMANCE.md](PERFORMANCE.md).

> Cloud-deployprocedure 28. september: PR #14 (`1a26ae6`) er merged med bestået CI. Et afgrænset GH_TOKEN er gemt. En frisk Cloud-terminal har verificeret læseadgang og Actions-write i run `36471598436`, som bevidst blev afvist af versionsgaten før deployment. Den rigtige dev→prod-kæde og HTTP-gates er bestået i runs `36468362953` og `36471085328` fra andet arbejde. Nye Cloud-opgaver skal bruge det opdaterede miljø; se CODEX-CLOUD-DEPLOY.md.


## Drift 28. september 2026 – aktiveret på PROD

PR #3 og #5 er udgivet fra `739b1860af09c0b082af0acc7e4127572802f9b1` via
GitHub. DEV run `36456558314`, PROD run `36456562615`; begge 375 tests samt
build/typechecks bestået. PROD tillader bogføring og kundemail med femminutters-cron;
DEV beholder blokeringerne. Kundens gemte modulvalg og startdatoer gælder fortsat.
Shopify-konto 55100 er tilknyttet efter udtrykkelig godkendelse og auditført.

Dette aktiverer den eksisterende drift. Kommerciel Dinero-onboarding til eksterne
kunder kræver fortsat OAuth2 i stedet for den nuværende personlige API-nøgle.
ViaBill er import/oversigt; emballageindberetning kræver kundens godkendelse.
Se PRODUCTION-RUNTIME-2026-09-28.md for funktioner, verifikation og begrænsninger.


> 28. september 2026 – Produktionsaktivering er godkendt; brugeren har stoppet den gamle Sablen-integration. Ny kode til varige produktionskvitteringer, salgsbogføring og fakturamail er lokalt implementeret og testet (364 tests), men ikke tilkoblet eller udgivet. PROD/DEV er fortsat uændrede. Se [arbejdsstatus og rester](PRODUCTION-RUNTIME-2026-09-28.md).

> 27. september 2026 – Produktionslogin er nu opdelt: eget kundelogin på portal.webshoptoolbox.dk og Access-beskyttet Tier 0 på /admin. Anonyme API-kald afvises; bogføring/kundemail forbliver blokeret. Se PRODUCTION.md. Reel mailkode/login er endnu ikke afprøvet.

> 27. september 2026 – Dev og prod er nu begge deployet succesfuldt fra GitHub Actions på commit `354c194`. 352 tests og builds bestået. Dev bruger kun dev.webshoptoolbox.dk; workers.dev-alias er lukket. Prod-login afventer fortsat Access-tilpasningen. Se REPOSITORY-SPLIT.md for kørsler og versioner.

> 27. september 2026 – Separat privat repository klargjort: Jopppardk/WebshopToolbox-Platform. Fremtidig arbejdsmappe work/WebshopToolbox-Platform. Se [REPOSITORY-SPLIT.md](REPOSITORY-SPLIT.md).

> 27. september 2026 – Efter brugerens bestilling er den samlede dev-løsning udgivet på WebshopToolbox Prod som `019381d6-d94d-48a2-a125-8d4829a54629`. Tier 1-klient/API og produktfeeds er åbnet for production-miljøet; produktionsscript bygger nu klienten. Migration 0010–0024 anvendt efter backup `.wrangler/prod-before-release-20260927.sql` og kopiprøve med eksisterende rækker bevaret i 19 tabeller. Remote FK-kontrol OK; 1 bruger/administrator og 0 virksomheder, ingen dev-data kopieret. Separat krypteringsnøgle genetableret og separat login-secret oprettet i ignoreret secret-backup. 349/349 tests, begge typechecks, produktionsbuild/dry-run bestået. DNS og certifikat verificeret; alle portalstier giver endnu 302 til den gamle, domænedækkende Access-app. **Kundelogin er derfor ikke færdigverificeret:** Cloudflare-dashboard kræver brugerlogin; Wrangler OAuth kan ikke ændre Access. Brugeren er bedt logge ind i den åbne fane. Næste skridt: begræns eksisterende produktions-Access-app til Tier 0, behold administratorpolitik/audience og kontrollér kunde-login/feed samt adminbeskyttelse. Admin-domænet er fortsat ikke tilknyttet. Bogføring/kundemail/cron er fortsat blokeret. Dev, Sablen og hjemmeside uændret; ingen merge/push. Remote main er nu fc6c8cbcf6be1d771971844180fa05d8ed82e1ee; disse urelaterede ændringer er ikke hentet eller overført.

> 27. september 2026 – Genhentning af ændrede Shopify-ordrer udgivet kun på dev som `4a92a846-fd0b-46c0-b13d-2115f34a53fe`. Op til tre komplette læseforsøg ved revisions-/valideringsfejl før faktura-claim. Redigerede ordrer valideres mod aktuelle mængder og beløb i separat platformadapter. Eksisterende PDF og usikre claims bevares. 349/349 tests, begge typechecks, builds, dry-runs og konfigurationskontrol bestået. Health/login 200, anonym API 401. Regnskabsforberedelse er tilsluttet; faktisk bogføring/kundemail fortsat blokeret. Ingen live ordre eller økonomisk postering afprøvet. Sablen/prod uændret, ingen migration eller main-merge. Se [ORDER-REFRESH.md](ORDER-REFRESH.md).

> 23. september 2026 – Produktfeeds udgivet kun på dev som `afcddbc2-6332-43db-bdf1-4b0c95a97167`. Nyt Tier 1-menupunkt med flere PartnerAds-feeds, kollektioner/enkeltprodukter, fragtpris/fri-fragt-grænse/leveringstid, pause, XML-visning og linkrotation. Genbruger formatter fra feed.sablen.dk; kilden og Sablen er uændret. Shopify read_products kræves. Offentlig XML via langt unikt link, opdatering ved hentning efter 15 minutter, ingen cron. Migration 0024 efter backup og kopiprøve med 42 tabeller uændrede; remote FK-kontrol OK. 344/344 samlet suite og efterfølgende 3/3 feedtests, begge typechecks/builds/dry-runs og lokal browserkontrol bestået. Dev health/login 200, anonym administrations-API 401, ukendt feedlink 404. Ingen remote feeds oprettet; rigtig PartnerAds-import ikke afprøvet. Bogføring/kundemail fortsat blocked, prod offline, ingen push/main-merge. Se PRODUCT-FEEDS.md.


> 22. september 2026 – Afsendernavn rettet og udgivet kun på dev som `cbffce16-7a6c-496c-9d5d-25eca87ca7ca`. Fejlårsag: fallback læste navnet på D1-metoden first i stedet for at kalde den. Fælles navneresolver bruger nu gemt afsendernavn, ellers fakturaens firmanavn, ellers virksomhedens navn; GET-opsætning og afsendelse er konsistente. Regression kontrollerer faktisk mail-payload uden eget afsendernavn. 342/342 tests, begge typechecks og platformbuild/dry-run bestået. Ingen testmail sendt eller kundedata ændret under fejlsøgning; kun navnene læst i dev. Sablen/prod uberørt.


> 22. september 2026 – Layoutjustering udgivet på dev som `768e3e1a-f583-4691-afb3-fa8acd5d1999`: Klassisk er nedtonet uden farvefelter/indramninger; Moderne overtager det tidligere klassiske udtryk. Tier 1-fakturatesten sender samme deterministiske demo-PDF som Se gemt eksempel med gemt design/logo og mailskabelon, uden opslag på rigtige ordrer eller krav om en gemt faktura. Egen loginadresse, allowlist og idempotente leveringsclaims gælder fortsat. Eget Cloudflare DNS-domæne er nu fremhævet med rød tekst øverst i afsendersektionen. 342/342 tests, begge typechecks, builds og dry-runs bestået; begge PDF-layouts renderet og visuelt kontrolleret. Ingen migration eller reel testmail afsendt under arbejdet. Sablen uændret, prod offline, bogføring/kundemail fortsat blokeret.


> 22. september 2026 – Fakturadesigner udgivet på dev som `c5eac4cb-de7d-4d6f-8312-97cedd6e1d03`. Tier 1 → Indstillinger → Faktura-afsendelse har firmaoplysninger, PNG-logo (300 KB / 2048 × 2048), fjern logo, farve, klassisk/moderne layout og bundtekst. Uden logo viser nye PDF'er både virksomhedsnavn og den servervalgte webshops navn. Et link åbner en autentificeret eksempel-PDF med fiktive data og tydelig EKSEMPEL-markering; ingen ordre, faktura, mail eller bogføring oprettes. Virksomhedens design gemmes i migration 0023 med revisionskontrol; gemte PDF'er ændres ikke. Logoer er scoped til virksomheden og valideres som PNG, ikke kun ved filendelse. Afsenderformular og dialogguide bruger den eksisterende krypterede Cloudflare-opsætning; standardafsender bruges indtil godkendt afsendertest. Eget domæne kræver Cloudflare DNS/Email Sending; ingen DNS ændres af portalen, og ingen automatisk DNS-onboarding er implementeret. Testmails er fortsat begrænset til egen allowlistede adresse; fakturatest bruger godkendt egen afsender, ellers standard. 341/341 tests samt begge builds/typechecks/dry-runs bestået; 78/78 afsluttende platformtests efter første-upload-forbedringen bestået. Remote: login/health 200, fakturaindstillinger/logo/eksempel/afsender kræver login (401 uden session), bogføring og kundemail blocked. Migration 0023 bekræftet på dev og lokalt, ingen remote FK-fejl. To PDF'er er renderet og visuelt kontrolleret med/uden logo. Browser-UI kan ikke kontrolleres lokalt: ERR_BLOCKED_BY_CLIENT; remote brugerfane står på login. Dev-backup `.wrangler/before-invoice-design-0023.sql`; migration prøvet på kopi med alle gamle felter uændrede og ingen FK-fejl, derefter anvendt på dev. Sablen uændret, prod offline, ingen push/main-merge.


> 21. september 2026 – **Dev-datafunktioner udgivet som `51c1d4ea-a908-4294-a0b0-dd88f84d9508` på https://dev.webshoptoolbox.dk.** Migration 0022 anvendt på dev efter frisk backup `.wrangler/before-dev-data-0022.sql` og kopitest med identisk indhold i alle eksisterende tabeller samt FK-kontrol. Ingen nulstilling. Fælles historik og individuelle startdatoer for Shopify/Dinero/Flatpay/ViaBill, manuel ordre-/betalings-/udbetalingsimport, periodevisninger, kontoplan/leverandører, regnskabsdashboard, lagerlæsning/optællingssimulering, emballageforbrug/manuelle poster/priser, krypteret Emballage Indberetning-læseforbindelse, fakturaoplysninger/PDF/testmail, rapporter og importlogs er tilsluttet den nye klient. Flatpay-bankhistorik hentes i 31-dagesportioner; ViaBill fortsætter via validerede cursors. Shopify-testordrer vises markeret, men fakturakontrollen afviser dem fortsat. Eksisterende PDF'er bevares; regenerering er deaktiveret. Fælles historik afgrænser læsning/import, sletter ingen eksisterende data. Ingen cron, automatisk eller manuel bogføring, kundemail, eksterne lagerændringer eller emballageindberetning er aktiveret. Eksplicit fakturatest er fortsat begrænset til egen godkendte loginadresse. Fuld 1:1-paritet er **ikke** godkendt (bl.a. automatiske flows, fuld hændelseshistorik og Flatpay-PDF er ikke flyttet). Den samlede suite bestod 339 tests; efter de sidste rettelser bestod 76/76 platformtests. Begge builds/typechecks og dry-runs bestået. Remote efterkontrol: login/healthz 200, historie-/ordreruter 401 uden session, bookkeeping/customerEmail blocked. Migration 0022 registreret; ingen FK-fejl. Lokal browserkontrol er blokeret med ERR_BLOCKED_BY_CLIENT; ingen rigtige leverandørkonti afprøvet. Sablen uændret, prod fortsat nedtaget, ingen push/main-merge.


> 21. september 2026 – Tier 1-integrationstilslutninger udgivet kun på dev som `7553d17c-bd95-4024-85d3-cb976a675895`. Shopify og Dinero kan testes/gemmes fra React-klienten. Første Shopify-tilslutning opretter webshoppen atomisk efter læsekontrol; efter reload vælges den nye webshop. Webshopvælgeren tilbyder Tilføj webshop. Eksisterende Shopify-identitet kan ikke ændres, og konkurrerende credential-opdateringer afvises. Dinero anvender virksomhedens fælles regnskab og beskytter mod organisationsskift. Credentials krypteres scoped til miljø/virksomhed/webshop; mislykket kontrol bevarer tidligere nøgler. Integrationsbibliotekets valg er koblet til company_integrations. Flatpay/ViaBill konto-/aftalehentning, kontrol og lagring bruger de eksisterende read-only adapters med versionskontrol. Flatpay-startdato ændres ved genvalidering med nøgler; ViaBill har startdato i forbindelsesformularen. Emballage Indberetning kan **endnu ikke tilsluttes** og tilbydes ikke som nyt valg. Historik/startdato for Shopify/Dinero, manuel kontoplansynkronisering og øvrige manglende moduler er ikke implementeret ved denne ændring; fuld paritet er fortsat falsk. Ingen automatisk ordreimport startes ved Shopify-tilslutning. 335/335 tests, begge builds/typechecks/dry-runs bestået. Lokal browserkontrol: integrationskatalog, tilføj Flatpay og validering af tom Shopify-formular. Rigtige leverandørkonti er ikke prøvet; brugeren tilknytter egne separate testkonti. Remote login/healthz 200, integrationsrute 401 uden login, bogføring/kundemail fortsat blokeret. Ingen remote testdata oprettet, ingen migration nødvendig. PROD forbliver nedtaget, Sablen uændret, ingen push/main-merge.


> 21. september 2026 – **Toolbox-produktionen er taget ned efter brugerens bestilling.** Worker `webshop-toolbox-platform-production` er slettet via Wrangler med eksplicit produktionskonfiguration. Dens custom domain `portal.webshoptoolbox.dk` er fjernet automatisk; efterkontrol viser ingen produktions-Worker og ingen tilknytning for domænet i Cloudflare. Portal-domænet gav ENOTFOUND, den tidligere workers.dev-adresse gav 404. Dev healthz giver fortsat 200 med bogføring/kundemail blokeret; dev- og Sablen-Workers findes fortsat. D1, R2 og Access-app er ikke slettet eller ændret; dette var fjernelse af udgivelsen, ikke en ny datanulstilling. Ingen kildekodeændring, push eller merge. Næste produktionsudgivelse skal bygge på den færdige, godkendte dev-version. Worker, bindings, secrets og domæne skal genetableres og migrationsbehov kontrolleres før udgivelse; secrets følger ikke med automatisk efter Worker-sletning. Eksisterende lokal secret-backup er omtalt i PRODUCTION.md og må ikke offentliggøres. Historiske beskrivelser af aktiv produktion nedenfor gælder ikke længere.


> 21. september 2026 – dev nulstillet og onboarding-dashboard udgivet som `deb420e4-abff-46eb-b276-76acb8ee3dd2`. Efter brugerens præcisering gælder nulstillingen **kun dev**: virksomheder, kundebrugere og øvrige Tier 1-data er slettet; `platform-admin-rene` og migrationshistorikken er bevaret. Frisk ignoreret backup `.wrangler/before-tier1-reset-test-2026-09-21-onboarding.sql`; sletningen prøvet på backup før udførelse. Alle 39 tabeller efterkontrolleret, ingen FK-fejl. Dev-R2 var tomt. Ingen nye remote testdata oprettet. Dashboard erstattes af to store genveje til Dinero/Shopify, indtil begge er verificeret forbundet; allerede forbundet vises grønt. Genvejene åbner den relevante formular under Integrationer. Statusfejl vises særskilt med genforsøg. 332/332 tests, begge builds/typechecks/dry-runs bestået; lokal browserkontrol af begge genveje og udseendet. Remote: rod 303, login 200/noindex, me 401 uden session, admin 302 og healthz 200 med bogføring/kundemail blokeret. Remote kundevisning er ikke testet efter nulstillingen, da kundebrugerne nu er slettet. **Eksisterende mangel består: POST /api/integrations (Test og forbind) er endnu ikke tilsluttet i den nye React-klient.** Dette arbejde implementerer genvejene, ikke den manglende integrationsadapter. Sablen og Toolbox Prod er uændrede; ingen push eller main-merge.


> 21. september 2026 – **ny Tier 1 udgivet til dev efter udtrykkelig brugerbestilling**, selv om fuld paritet endnu mangler. Version `9d29d977-cf7c-41ec-81c8-2b2c3cfcffa9` på `https://dev.webshoptoolbox.dk/`. Kundens rodside viser nu React-klienten efter login; Tier 0 beholder sin eksisterende brugerflade. Førstegangsprofil kan udfyldes i den nye klient. Migration 0021 er anvendt på dev (kun ny tabel, ingen datasletning). 331/331 tests, begge builds, begge TypeScript-kontroller og begge dry-runs bestået. Online: rodside → login, login 200, me 401 uden session, Tier 0 → Access og health 200 med blokeret bogføring/kundemail. Autentificeret remote kundevisning er ikke kontrolleret i browseren i denne udgivelse; routingen er integrationstestet med kundesession. Sablen og Toolbox-produktion er ikke deployet/ændret, ingen main-merge eller push. Tidligere udgave til eventuel rollback: `1ab1461c-8edb-40c0-9f66-a91fec42278f`. Restarbejdet i [TIER1-REBUILD-2026-09-21.md](TIER1-REBUILD-2026-09-21.md) og kontraktlisten gælder fortsat.

> 21. september 2026 – genstart af Tier 1 godkendt: Den nye kundeportal er påbegyndt direkte fra Sablens originale React-kode på main `73e45ac`. 64 kildefiler, oprindelige styles/faner og fakturamailformular er kopieret til `platform/tier1`; Support bruger den eksisterende Tier 0-backend. Mailskabelon/kontoplan og webshopafgrænsede modulvalg har atomisk versionskontrol. **Ikke færdig, ikke 100 % paritet og ikke udgivet til dev.** Lokal preview findes på `/tier1-next/`; remote adgang er blokeret. Kun lokal migration 0021 er anvendt. Se [TIER1-REBUILD-2026-09-21.md](TIER1-REBUILD-2026-09-21.md) og dens kontraktliste for præcis status og næste arbejde. Sablen, remote data og den eksisterende dev-udgave er bevaret.

> 21. september 2026 – Tier 0-webshops: Tier 0 opretter virksomheder og inviterer brugere; webshops vises kun til orientering. Opret/redigér webshop og Shopify-credentials kræver en virksomhedsadministrator i Tier 1. Tier 0 og impersonering afvises også server-side på POST webshops, PATCH webshop og PUT connection. Eksisterende visning og brugeradministration er bevaret. Test: 328/328, build, TypeScript, JS-syntaks og begge dry-runs bestået. Kodeændringen er udgivet kun på dev som `1ab1461c-8edb-40c0-9f66-a91fec42278f`; produktionskoden er ikke opgraderet. Online login/adgangskontrol er verificeret (200/401/302).
>
> Samtidig er Dev og WebshopToolbox Prod igen nulstillet efter brugerens præcisering: også virksomheder og kundebrugere skulle slettes. Kun den aktive Tier 0-administrator `platform-admin-rene` og migrationshistorikken er bevaret; samtlige 38/19 tabeller efterkontrolleret og ingen FK-fejl. Friske, ignorerede backups: `.wrangler/before-tier1-reset-test-2026-09-21.sql` og `.wrangler/before-tier1-reset-production-2026-09-21.sql`. Databaseskema, R2, Access, secrets og Sablen er uændret. Ingen main-merge eller push.

> 21. september 2026 – nulstilling efter udtrykkelig brugerbestilling: WebshopToolbox Dev-D1 `438fde65-c538-4719-aa2e-9502ae37c7e6` og Prod-D1 `c3775354-8cc9-4f68-9343-1bde30776245` er tømt for applikationsdata. Brugeren valgte at bevare sin Tier 0-konto: `platform-admin-rene` / `rene.jeppesen@live.dk`, aktiv i begge miljøer. Alle andre datatabeller er verificeret tomme (38 tabeller kontrolleret i Dev, 19 i Prod); schema og migrationshistorik (20/9) bevaret, ingen FK-fejl. Backup før nulstilling findes lokalt og ignoreret i `.wrangler/before-reset-test-2026-09-21.sql` og `.wrangler/before-reset-production-2026-09-21.sql`; de indeholder private data og må ikke committes. Sletning er først prøvet på begge backups og derefter udført/efterkontrolleret remote. Gamle virksomheders kundelogin er dermed fjernet. Ingen ændring af R2, Workers, Access, secrets, Sablen eller main. Den tidligere beskrevne LA Trading-testvirksomhed findes ikke længere.

> 21. september 2026 – fortsat klargøring til Sablen-flytning: Flatpay/ViaBill-læseforbindelser, Shopify-emballagehistorik, lageroptællingssimulering og regnskabsdashboard er implementeret, testet (327/327) og udgivet til dev som `d4514abf-3141-45c4-b58d-f5674e1ec6a4`. **Ikke migrationsklar endnu.** Aktuel acceptliste, præcise rester og deployment står i [MIGRATION-READINESS-2026-09-21.md](MIGRATION-READINESS-2026-09-21.md). Brugeren tilknytter separate testkonti på dev. Sablen-flytning er ikke autoriseret.

> 21. september 2026: Første paritetsimplementering med support i Tier 1/Tier 0, fakturamail/PDF og isolerede dataimporter. **Fortsat delvis paritet.** Se [PARITY-IMPLEMENTATION-2026-09-21.md](PARITY-IMPLEMENTATION-2026-09-21.md) for test, udrulning og præcise mangler.

> 21. september 2026 – funktionsaudit: Platformen er **ikke** en 1:1-migrering af Sablen. Flere driftsmoduler er tomme visninger; faktura/mail er delvist flyttet og mangler nyere Sablen-ændringer. Se [PARITY-AUDIT-2026-09-21.md](PARITY-AUDIT-2026-09-21.md) og ruteinventaret. Audit ændrede ingen runtime eller produktion.

> 20. september 2026: Produktionsportal på portal.webshoptoolbox.dk er publiceret med egne ressourcer og særskilt, godkendt Access-login. Version ef0c31fe-deed-42a3-aa6c-a0fe00e36165. Begrænset drift: kun René-administrator, ingen testdata og fortsat blokeret bogføring/kundemail. HTTPS og loginredirect verificeret; første administratorlogin afventer kontrol. Se [PRODUCTION.md](PRODUCTION.md).

> 14. september 2026: Fakturaopsætning er flyttet til **Indstillinger → Fakturaer**. Tier 1 har nu Shopify-fakturaimport, kontrol, isoleret PDF-generering/download og begrænset PDF-testmail implementeret og testet. Deployet til dev som `8f3000fd-eda9-4597-964d-2d7278e079ed`; migration 0009 anvendt. 302 tests og de obligatoriske buildkontroller bestået. Rigtig PDF-testmail og Shopify-flow i den autentificerede portal mangler endnu end-to-end-kontrol. Se [INVOICE-MIGRATION.md](INVOICE-MIGRATION.md) for aktuel status; tidligere beskrivelser af tom fakturaoversigt er historiske.

> 14. september 2026: Mailafsender med standard/egen Cloudflare-afsender og begrænset testmail er implementeret. Se [MAIL-SENDERS.md](MAIL-SENDERS.md). Aktuel fakturastatus står i [INVOICE-MIGRATION.md](INVOICE-MIGRATION.md).

> Domæneplan: dev.webshoptoolbox.dk til test, portal.webshoptoolbox.dk til senere produktion, webshoptoolbox.dk til kommende hjemmeside og prøveoprettelse. Se [DOMAINS.md](DOMAINS.md) for faktisk status.

> Tier 0 = ejerens administration; Tier 1 = kundeportalen. Shopify-opsætning med krypteret credential-lagring og nye integrationssektioner er implementeret. Tilslutning/import er fortsat planlagt. Se [TIER1-WEBSHOPS.md](TIER1-WEBSHOPS.md).

> Supportopfølgning 13. september 2026: impersonering er implementeret og deployet til separat testmiljø. Google/Microsoft udskudt efter brugerens valg. Fælles Cloudflare-branding afventer afklaring, da også Sablens loginside påvirkes. Se [SUPPORT-ACCESS.md](SUPPORT-ACCESS.md).

> Slutbrugerdesign: Kundeportalen tilpasses den eksisterende integrationsløsnings layout og navigation med virksomhedens eget navn, uden Sablen-branding og uden Udvikling. Importafhængige sider viser tomtilstande indtil integrationerne er flyttet. Se [CUSTOMER-PORTAL.md](CUSTOMER-PORTAL.md).
> Integrationskatalog: Toolbox-administration viser fælles katalog og udbyderrapporteret API-status. Virksomhedens egne valg ligger i kundeportalens integrationsbutik. Se [INTEGRATION-STORE.md](INTEGRATION-STORE.md) for afgrænsning og faktisk driftsstatus.
> Kundeportal 13. september 2026: Brugeren har besluttet direkte adgang til én virksomhed, flere webshops under Integrationer og ét fælles regnskab. Første kundeportal er implementeret og testet; faktisk tilslutning/import er fortsat planlagt. Se [CUSTOMER-PORTAL.md](CUSTOMER-PORTAL.md).
> Seneste arbejde: invitation via mail og førstegangsprofil er deployet til testmiljøet som a310b9db-6ff5-40aa-b305-034bf74e4310. Maildomænet er aktiveret efter brugerens konkrete DNS-godkendelse. Afsender er no-reply@webshoptoolbox.dk; eneste tilladte invitationsmodtager er rj@itm8.com. Førstegangsprofil er gemt, og testinvitationen er sendt med automatisk virksomhedsadministratorrolle. Modtagelse/accept og Google/Microsoft-login udestår. Ændringerne er endnu ikke committed/pushet. Se [INVITATIONS.md](INVITATIONS.md) for faktisk status og næste handling.

## Brugerplacering – beslutning 13. september 2026

Brugeren har fravalgt adgang til flere virksomheder for samme virksomhedsbruger. Virksomhedsbrugere oprettes og administreres i den enkelte virksomhed. Portalindstillinger indeholder alene administratorer af Toolbox, som har adgang på tværs af virksomheder i kraft af deres portalrolle.

Implementeret: users.company_id fastholder virksomhedsejerskab; migration 0002 bevarer eksisterende tilknytninger, afviser tvetydige medlemskaber og forhindrer ændring af ejerskab. Virksomhedsbrugere kan ikke gøres til portaladministratorer. De gamle globale /users-ruter er fjernet; /settings/admins er kun for portaladministratorer. Virksomhedsadministratorer kan oprette medlemmer og ændre deres status inden for egen virksomhed; kun portaladministratorer tildeler virksomhedsadministratorrollen. Egen deaktivering er blokeret.

Testet: 281 tests bestået, inklusive 20 platformtests med migration, isolation, portalroller og deaktivering. Testdatabasens eksisterende medlemskaber er kontrolleret uden konflikter. Build, typecheck og begge dry-runs er bestået. Migration 0002 og Worker-version `fae60d2b-7e18-4206-b10e-c393639ce711` er udrullet til testmiljøet. Browserkontrol bekræfter Portalindstillinger med kun portaladministratorer og Brugere inde under virksomheden. Backup før migration ligger lokalt i ignoreret `.wrangler/before-company-users.sql`. Brugeren har godkendt push til platform/admin-foundation. De lokale kontroller er bestået; status for denne revisions Linux-CI skal kontrolleres på GitHub efter push. Ingen ændring af Sablen eller merge til main.

> Loginstatus 13. september 2026: Separat Cloudflare Access-app er oprettet og test-Worker deployet med issuer og egen AUD (version `6a9263ed-d19d-40c4-a2e8-9236b6788072`). Brugerens identitet er verificeret i Cloudflare-dashboardet via aktiv OTP-session for testappen og registreret som platformadministrator i test-D1 med auditspor. Online virksomhedsoversigt er verificeret med rollen Platformadministrator. Sablen er uændret, main er ikke merged, og bogføring/kundemail er fortsat blokeret. Tidligere beskrivelser af manglende Access-login nedenfor er historiske. Remote rolleisolationsprøver med flere rigtige brugere udestår; eksisterende lokale adgangstests er fortsat grundlaget.

Projektgrundlag samlet 12. september 2026 fra samtalen “Udviklingschat - integrationsløsning v2”.

## Formål
Udvide den eksisterende integrationsløsning fra Sablen.dk til en fælles platform. Platformadministrator skal kunne oprette flere webshops, tilknytte brugere, vælge integrationer og overvåge driften. Hver webshop skal have egne indstillinger, adgangsoplysninger, data og kørsler.

## Arbejdsretning
Genbrug repository Jopppardk/WebshopToolbox og integrationslogikken. Byg i isoleret udviklings-/testmiljø med egne databaser, dokumentlagre og nøgler. Sablen fortsætter i drift indtil en kontrolleret overgang. Administrationsgrundlaget er besluttet i ADR-001.md og delvist implementeret; den samlede integrationsplatform er fortsat under udvikling.

Skeln mellem virksomhed, webshop og regnskabsforbindelse. Flere webshops tilhører samme virksomhed og deler dens ene regnskabsforbindelse. Der kan ikke vælges forskellige regnskaber pr. webshop.

## Status
- Opdatering 13. september 2026: første administrationsudsnit er implementeret og lokalt testet. Egne testressourcer er oprettet på den eksisterende Cloudflare-konto efter brugerens valg; test-Worker er deployet, men afviser administration, fordi Access-login mangler. Se ADMIN-FOUNDATION.md og ADR-001.md.
- Produktion: https://integration.sablen.dk
- Eksisterende løsninger: salg/fakturaer, tilbagebetalinger, udbetalinger, rapporter, lager, emballage, indsigt, dashboard og integrationer.
- Legacy-databasen har tenant-felter, men login, forespørgsler, credentials og scheduler indeholder Sablen-specifikke værdier. Reel isolation er ikke implementeret i legacy-integrationerne. Den separate administrationsdel har egne scoped relationer og adgangstests.
- Senest verificerede produktionscommit i denne samtale: 9a76239477ae03e7e5504f537e52a24277198ab4 (PR 55). Kontrollér GitHub igen før nye ændringer.
- Integrationsplatformen som helhed er ikke bygget. GitHub Projects er ikke oprettet; administrationens testmiljø er etableret med den ovennævnte loginbegrænsning.

## Organisering
Brug et lokalt Codex-projekt med denne mappe som hovedmappe. Brug en separat opgave pr. afgrænset leverance. Gem beslutninger og acceptkrav i repository. GitHub Issues/Projects anbefales til opgavestatus, og pull requests til kodegennemgang.

Den rigtige klon er etableret 12. september 2026 i `work/platform` under det oprindelige snapshot. Aktuel branch er `platform/admin-foundation`, videreført fra `platform/stage-0`. Dokumentation er overført og lokale afvigelser gennemgået; snapshot og sikkerhedskopi er bevaret. Brug klonen som hovedmappe til platformarbejde. Se STAGE-0.md for præcis placering og revision. Test-Worker er deployet. Brugeren godkendte push 13. september 2026; platformbranchen er pushet, og Linux-CI er bestået. Cloudflare Access-login udestår fortsat. Produktion er ikke deployet som led i denne opgave.

## Læs videre
- ROADMAP.md: etaper og acceptkrav.
- HANDOVER.md: produktionshensyn, kendte udeståender og arbejdsmetode.
- STAGE-0.md: klon, bevarelse og lokal revision.
- BACKLOG.md: klargjort lokal opgavetavle med acceptkrav og afhængigheder.
- DATA-MODEL.md og TEST-ENVIRONMENT.md: målbillede og oprindelige forslag; første administrationsudsnit er implementeret, og fjernmiljø er etableret med loginbegrænsning.
- ADR-001.md: valgte standarder og afgrænsning; ADMIN-FOUNDATION.md: faktisk implementering/drift; ISOLATION-INVENTORY.md: reproducerbar fortegnelse over legacy-ruter og ressourceadgang.

## Åbne beslutninger
- Kun administratoroprettede webshops eller senere selvbetjent oprettelse?
- Roller og virksomheders adgang til flere webshops.
- Fælles database med strikt webshopafgrænsning eller separat database pr. virksomhed.
- Loginudbyder, platformdomæne og identifikation af valgt webshop på serveren.
- Delte regnskaber og ejerskab til betalingsaftaler: hvordan undgås dobbeltimport på tværs af webshops?
- Backup, gendannelse, opbevaring og sletning pr. virksomhed.

## Hjemmeside – 20. september 2026
Offentlig hjemmeside er udgivet separat på webshoptoolbox.dk. Formularen gemmer tilmeldinger; mailafsendelse afventer brugerens oprettelse af info-adressen. Se [WEBSITE.md](WEBSITE.md) for testet og faktisk driftsstatus.

### 21. september 2026: eget kundelogin
Egen loginform med mailkode, browserbundne engangskoder, serverbaserede kundesessioner og adskilt Tier 0 på /admin er implementeret/testet. Dev er deployet; Access-aktivering og produktionsudrulning afventer. Detaljer: [CUSTOMER-LOGIN.md](CUSTOMER-LOGIN.md).

Dev-status opdateret: Eget kundelogin er aktiveret på https://dev.webshoptoolbox.dk/login efter brugerens godkendelse. /admin er fortsat Access-beskyttet. Loginmail til godkendt testadresse accepteret af mailtjenesten; fuldt login med rigtig mailkode endnu ikke verificeret. Produktionsaktivering er ikke udført.


27. september 2026: Generel kundestyret bogføringsopstart med separate datoer og manuel verificering af eksisterende Dinero-bilag er udgivet på dev og portal. Ingen kundehistorik hentet. Se [BOOKING-ONBOARDING.md](BOOKING-ONBOARDING.md) og seneste HANDOVER for begrænsninger og udgivelsesbevis.


## Cloud-opgaver samlet 28. september 2026

> 27. september 2026 – Fakturasidens eksempelfaktura er klargjort til en valgfri gyldig mailadresse i både dev og produktion. Serveren genererer fortsat emne, tekst og demo-PDF, kræver virksomhedsadgang, afviser supportimpersonering og bevarer idempotens/cooldown. Den separate afsendertest er fortsat begrænset til brugerens allowlistede loginadresse. Testet lokalt, men endnu ikke udgivet.

> 27. september 2026 – Fejlvisningen ved kontrol af Emballage Indberetning-nøgler er rettet lokalt. Kun HTTP 401/403 beskrives nu som en afvist nøgle; netværks-, rate limit- og tjenestefejl vises som kontrolfejl med den sikre request-reference, når leverandøren sender den. Tidligere krypterede oplysninger bevares fortsat ved alle fejl. Nøgleeksemplet i klienten viser formatet uden vildledende mellemrum. Regressionstest er tilføjet. Ændringen er ikke udgivet.

> 27. september 2026 – Første konfiguration af Emballage Indberetning henter nu automatisk den valgte historik fra den adgangskontrollerede Shopify-webshop, før opsætningen gemmes. En ufuldstændig import afviser opsætningen, så en tom historik ikke kan ligne en færdig konfiguration; senere ændringer genstarter ikke førstegangsimporten. Regressionen kontrollerer webshopisolering og kun én automatisk import. 356/356 tests og Tier 1-typecheck er bestået. Implementeret og lokalt testet, men ikke sat i drift.

> 27. september 2026 – Frigivelsesvurdering: **no-go til almindelig frigivelse for andre virksomheder/webshops**. 355/355 lokale tests, typechecks, builds og konfigurationskontroller består, men flerwebshop-pilot med rigtige testkonti, komplet login/onboarding og autentificeret onlinekontrol mangler. Bogføring, normal kundemail og cron er fortsat blokeret; lint er ikke grøn, og aktuel GitHub-/auditstatus kunne ikke verificeres fra miljøet. Se [RELEASE-READINESS-2026-09-27.md](RELEASE-READINESS-2026-09-27.md).


Ovenstående fem Cloud-leverancer er samlet på platform/cloud-release-20260928. Lokale og GitHub-kontroller samt udgivelse af den samlede version afventer. Ingen migrationer, kundedata eller Sablen-ændringer. Bogføring og almindelig kundemail forbliver blokeret.


## 28. september 2026 – Samlet Cloud-udgivelse afsluttet

Alle fem Cloud-leverancer er samlet via PR #1 og udgivet på dev og portal fra 8fd86ce. 358/358 tests, obligatorisk CI og begge deployworkflows bestået. Health/login 200, admin Access 302 og anonym ordre-API 401 på begge miljøer. Bogføring/normal kundemail fortsat blocked; ingen Sablen- eller dataændringer. Se [CLOUD-RELEASE-2026-09-28.md](CLOUD-RELEASE-2026-09-28.md) for kildeopgaver, runs, versioner og resterende live-verifikation.


## 28. september 2026 – Samlet fakturamail-opsætning

Implementeret: tre trin (design, mailtekst, afsender/test), foldbar valgfri Cloudflare-opsætning og grønt flueben efter accepteret test af gemt konfiguration. Én demo-testmail kontrollerer nu også en endnu ikke verificeret egen afsender; fejl falder ikke tilbage til standardafsender. Status genhentes efter testen. Gemte designs bruges fortsat, idempotens og tenantkontrol bevares. Tests og udgivelse afventer. Ingen migration, rigtige testmails eller Sablen-ændringer.

Udgivet via PR #2 fra `76e12bd148b9d028d357f3b98c25ec47e6618111`. Obligatorisk PR-CI bestået (run 36379542557), 359/359 tests; begge deployforløb gentog 359/359 tests samt builds/typechecks. Dev run 36379750291, Worker 769786c9-1be8-4e00-81d7-10d05e7fe6c4. Prod run 36379989591, Worker 4f63f886-3e93-4e0d-adeb-df149200c10b. Begge health/login 200, admin 302 til Access og anonym ordre-API 401. Fold-ud, grønt flueben og ændret-konfiguration-status browserkontrolleret lokalt med syntetiske data; ingen rigtig mail sendt og ingen autentificeret online-UI-test. Ingen migration eller ændring af Sablen. Bogføring/normal kundemail fortsat blokeret.

## 28. september 2026 – Opdateret ekstern frigivelsesvurdering

NO-GO til almindelig kundedrift; betinget læse-/demopilot efter afgrænset accept. Aktuel GitHub/HTTP-status og begge npm-audits er verificeret. 359-test CI er grøn, men økonomiske writes, normal kundemail og scheduler er stadig kodeblokeret. Lint fejler; samlet leverandørpilot og D1+R2-restore mangler som releasebevis. Se [RELEASE-READINESS-2026-09-28.md](RELEASE-READINESS-2026-09-28.md) for prioriteret plan og afgrænsninger. Denne vurdering ændrer ingen runtime, data eller udgivelse.


## Produktionskørsel – 28. september 2026
Implementeret på platform/production-runtime; endnu ikke udgivet. Se PRODUCTION-RUNTIME-2026-09-28.md for adapters, sikkerhedsgrænser, tests og driftsstatus. Samlet udgivelse koordineres med tilmeldingsopgaven.
