# Udviklingsplan


> 4. oktober 2026 – Shipmondo-tracking er udgivet til dev og prod via PR #86, SHA 1a509aad, grøn releasekørsel 37185020870. Migration 0039 er anvendt på begge efter gendannelsesbogmærker og kopiprøve. 445 tests og begge HTTP-gates bestået. Krypteret webshopforbindelse, signeret Shipment Monitor-webhook og berigelse af Forsendelser. Rigtig API-/webhook- og browserkontrol udestår; kunden skal forbinde konto og oprette webhook. Se [SHIPMONDO.md](SHIPMONDO.md).

> 3. oktober 2026 – Forsendelser/track & trace: implementeret og lokalt testet, ikke sat i drift. Næste skridt er CI og gennemgang, udgivelse og kontrol mod en rigtig butik med fragtapp samt bekræftede opbevaringstider. Se [SHIPMENTS.md](SHIPMENTS.md).

> 29. september 2026 – Performance-dashboard og Tools-menu: implementeret, testet og sat i drift på Dev og Prod via PR #53 og run `36628986416`. Fire månedsgrafer med sammenligningsår samt leverandørfilter er afsluttet; 413 tests og begge HTTP-gates bestået. Tilbage er kontrol af rigtige rapporttal og butikkens Shopify-rapportadgang ved ibrugtagning. Se [PERFORMANCE.md](PERFORMANCE.md).

> Cloud-deployprocedure 28. september: implementering, PR #14, obligatorisk CI, gemt GH_TOKEN samt Cloud-læse-/Actions-write-kontrol er afsluttet. Run `36471598436` bekræfter Cloud-bestilling og tilsigtet versionsafvisning før deployment; rigtige dev→prod-udgivelser med HTTP-gates er bestået i runs `36468362953` og `36471085328` fra andet arbejde. Brug det opdaterede miljø til nye Cloud-opgaver. Se CODEX-CLOUD-DEPLOY.md for præcis testafgrænsning og fremgangsmåde.


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

> 21. september 2026 – fortsat klargøring til Sablen-flytning: Flatpay/ViaBill-læseforbindelser, Shopify-emballagehistorik, lageroptællingssimulering og regnskabsdashboard er implementeret, testet (327/327) og udgivet til dev som `d4514abf-3141-45c4-b58d-f5674e1ec6a4`. **Ikke migrationsklar endnu.** Aktuel acceptliste, præcise rester og deployment står i [MIGRATION-READINESS-2026-09-21.md](MIGRATION-READINESS-2026-09-21.md). Brugeren tilknytter separate testkonti på dev. Sablen-flytning er ikke autoriseret.

> 21. september 2026: Første paritetsimplementering med support i Tier 1/Tier 0, fakturamail/PDF og isolerede dataimporter. **Fortsat delvis paritet.** Se [PARITY-IMPLEMENTATION-2026-09-21.md](PARITY-IMPLEMENTATION-2026-09-21.md) for test, udrulning og præcise mangler.

> 14. september 2026: Fakturaopsætning er flyttet til **Indstillinger → Fakturaer**. Tier 1 har nu Shopify-fakturaimport, kontrol, isoleret PDF-generering/download og begrænset PDF-testmail implementeret og testet. Deployet til dev som `8f3000fd-eda9-4597-964d-2d7278e079ed`; migration 0009 anvendt. 302 tests og de obligatoriske buildkontroller bestået. Rigtig PDF-testmail og Shopify-flow i den autentificerede portal mangler endnu end-to-end-kontrol. Se [INVOICE-MIGRATION.md](INVOICE-MIGRATION.md) for aktuel status; tidligere beskrivelser af tom fakturaoversigt er historiske.

> Tier 0 = ejerens administration; Tier 1 = kundeportalen. Shopify-opsætning med krypteret credential-lagring og nye integrationssektioner er implementeret. Tilslutning/import er fortsat planlagt. Se [TIER1-WEBSHOPS.md](TIER1-WEBSHOPS.md).

> Supportopfølgning 13. september 2026: impersonering er implementeret og deployet til separat testmiljø. Google/Microsoft udskudt efter brugerens valg. Fælles Cloudflare-branding afventer afklaring, da også Sablens loginside påvirkes. Se [SUPPORT-ACCESS.md](SUPPORT-ACCESS.md).

> Integrationskatalog: Toolbox-administration viser fælles katalog og udbyderrapporteret API-status. Virksomhedens egne valg ligger i kundeportalens integrationsbutik. Se [INTEGRATION-STORE.md](INTEGRATION-STORE.md) for afgrænsning og faktisk driftsstatus.
> Kundeportal 13. september 2026: Brugeren har besluttet direkte adgang til én virksomhed, flere webshops under Integrationer og ét fælles regnskab. Første kundeportal er implementeret og testet; faktisk tilslutning/import er fortsat planlagt. Se [CUSTOMER-PORTAL.md](CUSTOMER-PORTAL.md).
> Seneste arbejde: invitation via mail og førstegangsprofil er deployet til testmiljøet som a310b9db-6ff5-40aa-b305-034bf74e4310. Maildomænet er aktiveret efter brugerens konkrete DNS-godkendelse. Afsender er no-reply@webshoptoolbox.dk; eneste tilladte invitationsmodtager er rj@itm8.com. Førstegangsprofil er gemt, og testinvitationen er sendt med automatisk virksomhedsadministratorrolle. Modtagelse/accept og Google/Microsoft-login udestår. Ændringerne er endnu ikke committed/pushet. Se [INVITATIONS.md](INVITATIONS.md) for faktisk status og næste handling.

## Brugerplacering – beslutning 13. september 2026

Brugeren har fravalgt adgang til flere virksomheder for samme virksomhedsbruger. Virksomhedsbrugere oprettes og administreres i den enkelte virksomhed. Portalindstillinger indeholder alene administratorer af Toolbox, som har adgang på tværs af virksomheder i kraft af deres portalrolle.

Implementeret: users.company_id fastholder virksomhedsejerskab; migration 0002 bevarer eksisterende tilknytninger, afviser tvetydige medlemskaber og forhindrer ændring af ejerskab. Virksomhedsbrugere kan ikke gøres til portaladministratorer. De gamle globale /users-ruter er fjernet; /settings/admins er kun for portaladministratorer. Virksomhedsadministratorer kan oprette medlemmer og ændre deres status inden for egen virksomhed; kun portaladministratorer tildeler virksomhedsadministratorrollen. Egen deaktivering er blokeret.

Testet: 281 tests bestået, inklusive 20 platformtests med migration, isolation, portalroller og deaktivering. Testdatabasens eksisterende medlemskaber er kontrolleret uden konflikter. Build, typecheck og begge dry-runs er bestået. Migration 0002 og Worker-version `fae60d2b-7e18-4206-b10e-c393639ce711` er udrullet til testmiljøet. Browserkontrol bekræfter Portalindstillinger med kun portaladministratorer og Brugere inde under virksomheden. Backup før migration ligger lokalt i ignoreret `.wrangler/before-company-users.sql`. Brugeren har godkendt push til platform/admin-foundation. De lokale kontroller er bestået; status for denne revisions Linux-CI skal kontrolleres på GitHub efter push. Ingen ændring af Sablen eller merge til main.

> Loginstatus 13. september 2026: Separat Cloudflare Access-app er oprettet og test-Worker deployet med issuer og egen AUD (version `6a9263ed-d19d-40c4-a2e8-9236b6788072`). Brugerens identitet er verificeret i Cloudflare-dashboardet via aktiv OTP-session for testappen og registreret som platformadministrator i test-D1 med auditspor. Online virksomhedsoversigt er verificeret med rollen Platformadministrator. Sablen er uændret, main er ikke merged, og bogføring/kundemail er fortsat blokeret. Tidligere beskrivelser af manglende Access-login nedenfor er historiske. Remote rolleisolationsprøver med flere rigtige brugere udestår; eksisterende lokale adgangstests er fortsat grundlaget.

Opdatering 13. september 2026: Se ADR-001.md, ADMIN-FOUNDATION.md og BACKLOG.md for den aktuelle delvise gennemførelse af etape 1–3/5. Selvstændig test-Worker og adminskema er etableret, men Access-login er endnu ikke konfigureret. Ingen integrationer er flyttet og ingen produktionsetape er startet. Beskrivelsen nedenfor bevarer den oprindelige samlede plan.

Etape 0 er lokalt gennemført for klon, revision, instruktioner og opgavegrundlag den 12. september 2026. En fælles GitHub-tavle er endnu ikke oprettet, så etape 0's fulde oprindelige acceptkrav er ikke afsluttet. Etape 1–10 er fortsat planlagt; forslag til etape 1–2 ligger i DATA-MODEL.md og TEST-ENVIRONMENT.md. Konkrete udviklingsopgaver står i BACKLOG.md.

| Etape | Leverance | Acceptkrav |
| --- | --- | --- |
| 0 | Git-checkout og projektorganisering | Rigtig lokal klon, gennemgåede lokale afvigelser, projektinstruktioner og fælles opgavetavle. |
| 1 | Arkitektur og dataejerskab | Beslutningsnotat for virksomhed, webshop, bruger, regnskab og betalingsaftale; kortlægning af alle hardcodede Sablen-værdier. |
| 2 | Separat testmiljø | Egne ressourcer og secrets; ingen produktionsbogføring eller kundemails fra test. Dokumenteret udrulning og tilbageførsel. |
| 3 | Identitet og adgang | Platformadministrator og webshopbrugere; servervalideret adgang ved alle læsninger og skrivninger. |
| 4 | Dataadskillelse | Forespørgsler, credentials, dokumentnøgler, cache, logs, notifikationer og dubletkontrol er afgrænset korrekt. Tests med to webshops afviser adgang på tværs. |
| 5 | Administration | Opret/deaktivér virksomhed og webshop; tilknyt brugere; se integrationer og driftsstatus; administrative handlinger logges. |
| 6 | Integrationer pr. webshop | Egne nøgler, kontoplaner, startdatoer og mailvalg. Tilslutning og frakobling påvirker kun den relevante webshop. |
| 7 | Kørsler pr. webshop | Intervaller, kørselslåse, genforsøg og fremdrift adskilles. Fejl hos én webshop blokerer ikke andre. |
| 8 | Pilot med to testwebshops | Test salg, refunderinger, udbetalinger, rapporter og advarsler med overlappende eksterne ID'er. Kontroller også fælles Dinero-regnskab. |
| 9 | Flyt Sablen | Backup og prøveflytning; alle bogføringsreferencer og dokumenter bevares; gamle kørsler stoppes før nye startes. Ingen dobbeltbogføring. |
| 10 | Åbn for næste webshop | Dokumenteret oprettelse, driftsovervågning, support og gendannelse. |

## Leveranceprocedure
Én afgrænset opgave med acceptkrav → ændring i separat branch → relevante tests og typekontrol → pull request → testmiljø → kontrolleret produktion.

## Flytning af Sablen
Flytteplanen skal omfatte konfiguration, krypterede nøgler, ordrer, fakturaer, udbetalinger, refunderinger, dokumenter, jobhistorik, låse, sidekurser og bogføringskvitteringer. Bevar tilknytning til Dinero-organisation og eksisterende bilags-ID'er. En tilbageførsel skal også tage højde for posteringer oprettet efter skiftet; database-restore alene må ikke give genbogføring.


## 27. september 2026 – Generel kundestyret bogføringsopstart (klargjort)

Separate historik-/bogføringsdatoer og assisteret manuel Dinero-afstemning implementeret. Ingen kundedatoer, import eller afstemning startet. Migration 0025 er additiv. 355/355 tests samt efterfølgende 5 målrettede tests med kladdeafvisning bestået. Begge typechecks og miljøkonfigurationskontroller bestået; GitHub CI og udgivelse afventer. Bogføring/kundemail fortsat blokeret. Se [BOOKING-ONBOARDING.md](BOOKING-ONBOARDING.md) for funktion, begrænsninger og verifikation.


## 27. september 2026 – Bogføringsopstart udgivet på dev og portal

Kodecommit `47e1815bebfca0040fa040f20af2790a193506d4` er udgivet fra det separate GitHub-repository:
- Dev: run `36346884449`, Worker `1f93b5da-eb81-4689-bba8-e712054a57e3`.
- Prod: run `36347101084`, Worker `eedf78d0-2750-456a-b5c1-935ed082b9eb`.
- CI `36346770841` samt begge deployjobs bestået, hver med 355/355 tests og obligatoriske builds/typechecks.

Migration 0025 anvendt i begge D1-databaser efter Time Travel-bookmarks. FK-kontrol OK, begge nye tabeller tomme efter migration. Prod gav først Cloudflare 7403; read-only whoami bekræftede rigtig konto og D1-write-rettighed, d1 info bekræftede rigtig database. Nyt forsøg med samme autoriserede login lykkedes. Ingen rettigheder eller credentials ændret.

Begge miljøers health/login giver 200, admin giver 302 til egen Access-destination, anonym ordre-API giver 401. Bogføring og normal kundemail fortsat blocked. Ingen historik hentet, datoer sat eller bilag afstemt for kunder. Sablen uændret. Live Dinero-afstemning og visuel browserkontrol er ikke udført; funktionens API og klient er testet/bygget med syntetiske data og CI. Afstemningen er manuel pr. bilag, ikke automatisk masseafstemning. Se BOOKING-ONBOARDING.md.


## Cloud-opgaver samlet 28. september 2026

> 27. september 2026 – Fakturasidens eksempelfaktura er klargjort til en valgfri gyldig mailadresse i både dev og produktion. Serveren genererer fortsat emne, tekst og demo-PDF, kræver virksomhedsadgang, afviser supportimpersonering og bevarer idempotens/cooldown. Den separate afsendertest er fortsat begrænset til brugerens allowlistede loginadresse. Testet lokalt, men endnu ikke udgivet.

> 27. september 2026 – Lokal rettelse til Emballage Indberetning-diagnostik er implementeret: kun 401/403 klassificeres som nøgleafvisning, øvrige API-/netværksfejl beskrives korrekt, og tidligere credentials bevares. Regressionstest er tilføjet. Udgivelse og kontrol med en separat testnøgle er fortsat planlagt; ingen ekstern indberetning er udført.

> 27. september 2026 – Automatisk emballagehistorik ved første opsætning er implementeret og lokalt testet: Shopify-data hentes fra valgt kvartalsstart til dags dato i den servervaliderede virksomheds-/webshopkontekst. En ufuldstændig import afviser opsætningen, senere ændringer gentager den ikke, og regressionen kontrollerer isolation mellem to webshops. 356/356 tests og Tier 1-typecheck bestået. Ikke sat i drift eller afprøvet med rigtige leverandørkonti.

> 27. september 2026 – Implementeret lokalt: dataafhængige Tier 1-sider viser en fælles illustreret integrationsvejledning i stedet for tomme tabeller og starter først sidekomponenternes datahentning, når Shopify eller en relevant betalingsudbyder er forbundet. Regressionstest og Tier 1-typecheck er bestået; browserkontrol, CI og udrulning er fortsat planlagt.

> 27. september 2026 – Release gate: **no-go til almindelig ekstern frigivelse**. Næste milepæl er en lukket pilot med to isolerede testwebshops og virkelige testkonti efter kriterierne i [RELEASE-READINESS-2026-09-27.md](RELEASE-READINESS-2026-09-27.md). Bogføring, normal kundemail og cron forbliver blokeret, indtil pilot, driftsbeslutning og særskilt go/no-go er bestået.


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
