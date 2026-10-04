# Overlevering

> 4. oktober 2026 – Fælles tracking via offentlige Shipmondo-links: implementeret; udgivelse afventer CI/release. Ingen API-nøgle eller webhook kræves. DAO/GLS/PostNord/Bring og gyldige eksisterende Shipmondo-links bruger samme parser; flere pakkenumre vises separat. Scoped cache med fejltolerant snapshot, timeinterval og baggrundsopdatering af registrerede pakker i prod. Migration 0040. Se [PUBLIC-TRACKING.md](PUBLIC-TRACKING.md).


> 4. oktober 2026 – Shipmondo-forbindelsesrettelse: Cloudflare/workerd afviste `redirect:error` før netværkskaldet. Reproduceret lokalt i workerd. Kaldet bruger nu `manual`; 3xx afvises fortsat uden videresendelse af API-nøgler. Regressionstest kontrollerer bevarelse af eksisterende forbindelse ved redirect. Udgivelsesstatus følger PR/releasekørsel.


> 4. oktober 2026 – Shipmondo-tracking er implementeret lokalt på platform/shipmondo-tracking: krypteret webshopforbindelse, signeret Shipment Monitor-webhook og berigelse af Forsendelser. Migration 0039. Ikke udgivet; rigtig API-/webhook- og browserkontrol udestår. Se [SHIPMONDO.md](SHIPMONDO.md).

> 3. oktober 2026 – Forsendelser (Tools) er implementeret og lokalt testet. Siden viser track & trace fra Shopifys afsendelser med trin, fragtfirma og returvarsel for pakkeshoppakker. Den læser kun og kræver ingen migration. Den er ikke udgivet, og der er ingen kontrol mod en rigtig butik endnu. Se [SHIPMENTS.md](SHIPMENTS.md).

> 3. oktober 2026 – Synkroniseringsinterval: Indstillinger, status (`/admin/sync-status`) og den automatiske kørsel bruger nu samme regel, `normalizeSyncInterval`: 5, 15, 30 eller 60 minutter, alt andet bliver til 15. Siden #50 tillod indstillingerne og den automatiske kørsel 5 minutter, mens status rundede op til mindst 15. Derfor stod "Ændringen er ikke gemt endnu" permanent ved et gemt 5-minutters interval. En kørsel med 5 minutter er uændret; ældre ugyldige værdier (fx 7 eller 10) kører nu med 15. Implementeret og testet i PR #81; driftsstatus fremgår af udgivelseskørslen.

> 3. oktober 2026 – Lagerafstemning, opfølgning 2: Spærringen i prod skyldtes en gammel uafklaret lageroptælling (28. september, −150 kr.), ikke afstemningen. En ny regulering læser Shopify og Dinero live, så en gammel regulering spærrer kun, mens den kan ligge som kladde i Dinero. Lager kan nu afklare både optællinger og afstemninger, der er uafklarede eller ældre end 15 minutter. Med Dinero-bilags-ID slås bilaget op: findes det ikke, frigives reguleringen; er det bogført, sættes kvitteringen til booked; er det en kladde, forbliver spærringen. Uden bilags-ID bekræfter administratoren, at der ikke ligger en kladde i Dinero. Alt logges i record_events og audit.

> 3. oktober 2026 – Lagerafstemning, opfølgning: Første regulering i prod endte som uafklaret, og intet bilag findes i Dinero. Dineros svar blev ikke gemt. Bilagsreferencen var 128 tegn (`toolbox:<virksomhed>:<webshop>:stocktake:<id>`) og er nu `wtb:stocktake:<id>`. At længden var årsagen er ikke bekræftet. Dinero-afvisninger (4xx undtagen 408/429) gemmes nu med Dineros begrundelse. Ved afstemning frigives claimet, og begrundelsen vises, fordi intet blev oprettet. Ved optælling forbliver den uafklaret, fordi Shopify allerede er ændret. Lager viser uafklarede reguleringer. En afstemning uden Dinero-bilags-ID kan frigives af virksomhedsadministratoren efter kontrol i Dinero ("Intet bilag i Dinero – frigiv"). Det logges i record_events (`cleanup.receipt_cleared`) og audit (`stocktake.released`).

> 3. oktober 2026 – Lagerafstemning mod Dinero: merged i PR #77 som `e05ad794` og udgivet til dev og prod i grøn GitHub-kørsel [37106754151](https://github.com/Jopppardk/WebshopToolbox-Platform/actions/runs/37106754151) (437 tests, typechecks, builds, dry-runs og begge anonyme HTTP-efterkontroller bestået). Ikke afprøvet mod en rigtig Dinero-saldo; ingen økonomisk postering foretaget. Lager viste Shopify-værdien i både "Registreret lagerværdi" og "Værdi efter optælling" (den anden er kun forskellig, når der er indtastet optælling). De tre bokse viser nu lagerværdi i webshop (Shopify), bogført saldo på den valgte lagerkonto i Dinero (regnskabsåret til dags dato inkl. primo, uden ultimo, læst live) og difference. "Regulér Dinero" opretter efter godkendelse ét finansbilag mellem reguleringskontoen og lagerkontoen for differencen; Shopify ændres ikke. Forslaget skal matche de viste værdier og kontrolleres igen før bilaget. En tidligere lagerregulering, som er uafklaret eller ligger som kladde i Dinero, spærrer en ny, så differencen ikke reguleres to gange. Kladde/bogført følger den eksisterende indstilling for lagerbogføring. Dinero-lagerkontoen er fælles for virksomheden, så den sammenholdes med summen af alle virksomhedens aktive Shopify-webshops. Regulering afvises, mens en lagerstyret vare mangler antal eller kostpris, eller kostpriser ikke er i DKK. Bilaget reserveres atomisk: claimet afvises, hvis en anden lagerregulering for samme Dinero-organisation er i gang eller afsluttet efter forslaget. Ingen migration.

> 29. september 2026 – Performance/Tools er udgivet til Dev og Prod fra PR #53/SHA `120581fbfe81ad7cc2bde539a6e003ae8104e41a` i grønt run `36628986416`. 413 tests, typechecks, builds, dry-runs og begge HTTP-gates bestået; ingen migration. Desktop/mobil er testet med syntetiske data. Shopify kræver rapportadgang; live-sammenligning med kilderne mangler. Regnskab læses på virksomhedsniveau, webshopmålinger på butiksniveau. Se [PERFORMANCE.md](PERFORMANCE.md) for versioner, beregninger, cache, adgang og afgrænsning.

> Posthistorik og dashboard 28. september: merged i PR #17 som 4528bcf0 med bestået CI. Migration 0029 er anvendt på dev og prod med FK-kontrol uden fejl. Udgivelse følges i [GitHub-kørsel 36471085328](https://github.com/Jopppardk/WebshopToolbox-Platform/actions/runs/36471085328). Migration 0029 tilføjer en separat hændelsestabel og atomiske logtriggere for import, kildeændringer, dokumenter og produktionskvitteringer. Fejl logges med scoped post-id og renset tekst. Ordre-, udbetalings- og tilbagebetalingsdialoger viser historik, bilags-/fil-/mail-id’er og dokumenterede ældre statusser. Ingen opfundne historiske tidspunkter; mailaccept er ikke leveringsbevis. Dashboardets dagens udbetalinger omfatter nu Shopify, Flatpay og ViaBill i dansk kalenderdag, uden dobbelt optælling af afregninger. Se RECORD-HISTORY.md for migration, test og udgivelse.

> Indsigt i Tier 0: lokalt implementeret 28. september. Joboversigt med virksomheds-/webshopvalg, statusfilter og sider flyttes til Tier 0; begge joblog-API’er afviser kunder. Kundens nedtælling og dashboardlink til joblogs er fjernet. (Historisk: dengang var minimum 15 minutter. PR #50 tillod siden 5 minutter; se noten 3. oktober om synkroniseringsinterval.) Cloudflare-cron kan fortsat vække workeren hvert femte minut. Ingen migration eller ændring af bogføringsvalg. 377 tests bestået; efter lukning af den separate jobfejlsvisning er tre målrettede regressionstests og Tier 1-typecheck bestået. Obligatorisk CI bestod også efter main-indfletning på b160d2b; PR [#15](https://github.com/Jopppardk/WebshopToolbox-Platform/pull/15) er merged som 3a455385. Udgivelse til dev og derefter prod er bestilt fra denne SHA; konkret miljøstatus og HTTP-gates fremgår af [GitHub-kørsel 36468362953](https://github.com/Jopppardk/WebshopToolbox-Platform/actions/runs/36468362953). En bestilling alene beviser ikke gennemført deployment.
> Cloud-deployprocedure 28. september: PR #14 er merged som `1a26ae6` med bestået CI. GH_TOKEN er gemt med brugerens godkendelse; læseadgang og Actions-write er verificeret fra frisk Cloud-terminal. Run `36471598436` er en tilsigtet negativ test: ugyldig SHA blev afvist før checkout, dev/prod skipped. Rigtige udgivelser fra andet arbejde har bestået hele kæden i runs `36468362953` og `36471085328`. Ingen ekstra rigtig deployment er startet af opsætningen. Start nye Cloud-opgaver med det opdaterede miljø og brug release-scriptet. Se CODEX-CLOUD-DEPLOY.md for beviser og tokenets udløb.

> Brug `scripts/platform-release.mjs` til Cloud-dispatch af en godkendt main-SHA; `prod` går altid gennem dev og HTTP-gate. Cloudflare-secrets forbliver i GitHub. Cloud-setup-secrets må ikke persisteres for at omgå deres afgrænsning til setupfasen. Nye Cloud-opgaver skal bruge det opdaterede miljø.

> Statusvisning 28. september: Rettelse merged i PR #12 med bestået CI. Miljøspecifikke udgivelseskørsler er linket i STATUS-DISPLAY.md. Ikke-afsendte salg uden kvittering vises som Afventer; registrerede bogføringsfejl skelner mellem automatisk genforsøg og manuel handling. Udbetalinger bruger fælles danske betegnelser. Se STATUS-DISPLAY.md for afgrænsning og udgivelsesstatus.

> 28. september 2026: Brugeren har udtrykkeligt godkendt fuld deaktivering af integration.sablen.dk. Alle seks automatiske moduler er slået fra i legacy-indstillingerne; cron og custom domain er fjernet. Worker, D1, R2 og credentials bevares. Se LEGACY-DEACTIVATION.md. Genaktivér ikke legacy som del af en platformudgivelse.

> 28. september kl. 20.08: Cron er nu bekræftet i drift efter genoprettelse af Cloudflare-triggeren. Første kørsel 18:05:56–18:07:55 UTC gennemførte import/køer uden registrerede fejl; én salgsordre og én Flatpay-post har booked-kvitteringer. Låsen er frigivet og næste kørsel planlagt. Se seneste afsnit i PRODUCTION-RUNTIME-2026-09-28.md.

> Seneste efterkontrol kl. 19.41: PROD er udgivet, men første cron-kørsel er endnu ikke observeret trods registreret tidsplan. Automatisk drift må derfor ikke regnes som verificeret. Se PRODUCTION-RUNTIME-2026-09-28.md.

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

> 21. september 2026 – Tier 0-webshops: Tier 0 opretter virksomheder og inviterer brugere; webshops vises kun til orientering. Opret/redigér webshop og Shopify-credentials kræver en virksomhedsadministrator i Tier 1. Tier 0 og impersonering afvises også server-side på POST webshops, PATCH webshop og PUT connection. Eksisterende visning og brugeradministration er bevaret. Test: 328/328, build, TypeScript, JS-syntaks og begge dry-runs bestået. Kodeændringen er udgivet kun på dev som `1ab1461c-8edb-40c0-9f66-a91fec42278f`; produktionskoden er ikke opgraderet. Online login/adgangskontrol er verificeret (200/401/302).
>
> Samtidig er Dev og WebshopToolbox Prod igen nulstillet efter brugerens præcisering: også virksomheder og kundebrugere skulle slettes. Kun den aktive Tier 0-administrator `platform-admin-rene` og migrationshistorikken er bevaret; samtlige 38/19 tabeller efterkontrolleret og ingen FK-fejl. Friske, ignorerede backups: `.wrangler/before-tier1-reset-test-2026-09-21.sql` og `.wrangler/before-tier1-reset-production-2026-09-21.sql`. Databaseskema, R2, Access, secrets og Sablen er uændret. Ingen main-merge eller push.

> 21. september 2026 – nulstilling efter udtrykkelig brugerbestilling: WebshopToolbox Dev-D1 `438fde65-c538-4719-aa2e-9502ae37c7e6` og Prod-D1 `c3775354-8cc9-4f68-9343-1bde30776245` er tømt for applikationsdata. Brugeren valgte at bevare sin Tier 0-konto: `platform-admin-rene` / `rene.jeppesen@live.dk`, aktiv i begge miljøer. Alle andre datatabeller er verificeret tomme (38 tabeller kontrolleret i Dev, 19 i Prod); schema og migrationshistorik (20/9) bevaret, ingen FK-fejl. Backup før nulstilling findes lokalt og ignoreret i `.wrangler/before-reset-test-2026-09-21.sql` og `.wrangler/before-reset-production-2026-09-21.sql`; de indeholder private data og må ikke committes. Sletning er først prøvet på begge backups og derefter udført/efterkontrolleret remote. Gamle virksomheders kundelogin er dermed fjernet. Ingen ændring af R2, Workers, Access, secrets, Sablen eller main. Den tidligere beskrevne LA Trading-testvirksomhed findes ikke længere.

> 21. september 2026 – fortsat klargøring til Sablen-flytning: Flatpay/ViaBill-læseforbindelser, Shopify-emballagehistorik, lageroptællingssimulering og regnskabsdashboard er implementeret, testet (327/327) og udgivet til dev som `d4514abf-3141-45c4-b58d-f5674e1ec6a4`. **Ikke migrationsklar endnu.** Aktuel acceptliste, præcise rester og deployment står i [MIGRATION-READINESS-2026-09-21.md](MIGRATION-READINESS-2026-09-21.md). Brugeren tilknytter separate testkonti på dev. Sablen-flytning er ikke autoriseret.

> 20. september 2026: Produktionsportal på portal.webshoptoolbox.dk er publiceret med egne ressourcer og særskilt, godkendt Access-login. Version ef0c31fe-deed-42a3-aa6c-a0fe00e36165. Begrænset drift: kun René-administrator, ingen testdata og fortsat blokeret bogføring/kundemail. HTTPS og loginredirect verificeret; første administratorlogin afventer kontrol. Se [PRODUCTION.md](PRODUCTION.md).

> 14. september 2026: Fakturaopsætning er flyttet til **Indstillinger → Fakturaer**. Tier 1 har nu Shopify-fakturaimport, kontrol, isoleret PDF-generering/download og begrænset PDF-testmail implementeret og testet. Deployet til dev som `8f3000fd-eda9-4597-964d-2d7278e079ed`; migration 0009 anvendt. 302 tests og de obligatoriske buildkontroller bestået. Rigtig PDF-testmail og Shopify-flow i den autentificerede portal mangler endnu end-to-end-kontrol. Se [INVOICE-MIGRATION.md](INVOICE-MIGRATION.md) for aktuel status; tidligere beskrivelser af tom fakturaoversigt er historiske.

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

## Loginopfølgning – 13. september 2026

- Brugeren har nu godkendt dashboardopsætningen og logget ind. Den tidligere dashboardblokering er løst.
- Separat Access-app `WebshopToolbox Platform Test` oprettet: `fac8c207-ae43-4178-8452-22dd23f44943`, kun hostname `webshop-toolbox-platform-test.rene-jeppesen.workers.dev`. Egen Allow-politik `Platform Test - Rene` (`1ce89e36-b5f8-4ef1-b103-05f895a22ec1`), kun brugerens mail, eksisterende One-time PIN, 6 timers session. Sablen-app og fælles loginudbydere er ikke ændret.
- Issuer og ny separat AUD er sat i `wrangler.platform-test.json`. Remote dry-run bestået; test-Worker deployet som `6a9263ed-d19d-40c4-a2e8-9236b6788072`. Begge blokeringer for bogføring/kundemail er bevaret. Browseren viser korrekt Access-login til testappen.
- Afventer brugerens indtastning af engangskode i browseren. Første verificerede identitet skal stadig registreres som platformadministrator i test-D1; fuldt administrationslogin er endnu ikke testet. Ingen automatisk adminoprettelse eller auth-bypass er tilføjet.
- GitHub main og platformbranch kontrolleret før konfigurationsændring: fortsat `9a76239477ae03e7e5504f537e52a24277198ab4` og `8e5dd0f91dd83d9f6fe6b59e573613fefe2bead6`. Loginopfølgningens lokale ændringer er endnu ikke committed/pushet. Afsnittet nedenfor beskriver tilstanden før denne opfølgning.

## Aktuel overlevering – 13. september 2026

- Branch `platform/admin-foundation`, bygget videre på etape 0. Ingen merge til main eller ændring af Sablen-produktionsressourcer. Gamle emballage-/ViaBill-afvigelser er fortsat udeladt.
- P01: standardvalg besluttet i ADR-001.md. Brugeren valgte egne testressourcer på den eksisterende Cloudflare-konto.
- P02: ISOLATION-INVENTORY.md registrerer 43 API-ruter og 53 runtimefiler. Komplet statisk fortegnelse og afvisningstests; dynamiske nøgler kræver fortsat semantisk gennemgang ved P06. Genér med `node scripts/platform-inventory.mjs`.
- P03/P05/P07: separat `platform/worker.ts`, migrationsskema, signerede identiteter, scoped medlemskaber, admin-API og UI for virksomheder, webshops og brugere. Ingen legacy-integrationer, mailbinding, providercredentials eller cron i test-Worker.
- P04: test-D1, R2 og Worker er oprettet og deployet. `/healthz` er 200, administration/assets afvises med 503 indtil Access-login. Det er ikke et færdigt online adminlogin. Inventar, URL, version, testresultater og kørevejledning står i ADMIN-FOUNDATION.md.
- Access-app-oprettelse blev afvist med `403 auth.forbidden`. Automatisk godkendelseskontrol afviste efterfølgende åbning af Cloudflare-dashboardet som alternativ vej. Fortsæt ikke den vej uden brugerens godkendelse. Næste nødvendige brugerhandling er at godkende den konkrete testloginopsætning i dashboardet eller selv oprette appen og levere issuer/audience samt første verificerede brugeridentitet.
- Der findes ingen automatisk administratoroprettelse ud fra email og ingen remote mulighed for at bruge lokale fixturetokens. Registrér første rigtige bruger eksplicit i test-D1 efter verifikation.
- Backup af remote syntetisk D1 er gendannet lokalt separat: 2 virksomheder, 3 webshops, 4 brugere, 2 kildeposter, ingen FK-fejl. R2 er tom; dokument-/bogføringsrestore udestår.
- Endelig lokal validering efter frisk `npm ci` i klonen: 279 tests bestået, 0 fejl/udeladelser, inklusive 18 platformtests. Build, typecheck, legacy-dry-run og platform-dry-run bestået. Lokal Node 26.5.1; Linux/Node 22.23.2 er efterfølgende verificeret i CI.
- Brugeren godkendte push 13. september 2026, og `platform/admin-foundation` er nu på GitHub. Linux-CI bestod på `46c1fb292cd9dc15eb39411c7570aedf8359bfe4`: installation, tests, build, typecheck og begge dry-runs. [CI-kørsel](https://github.com/Jopppardk/WebshopToolbox/actions/runs/34748367038). Intet er merged til main. Workflowet har ingen secrets/deployjob. Godkendelsen gjaldt push; den udestående Cloudflare-loginopsætning er ikke udført i denne opfølgning.
- Lokal browserkontrol bekræftede login, webshopoprettelse og audit. `npm run platform:dev` bruger kun loopback og separat lokal state. Se ADMIN-FOUNDATION.md; seed ikke den allerede etablerede database igen.

De følgende afsnit er historisk overlevering fra etape 0 og den oprindelige samtale.

## Opdatering fra etape 0 – 12. september 2026

- Arbejd fremover i den rigtige klon `C:/Users/rj/Documents/Codex/2026-09-07/je/work/WebshopToolbox/work/platform`, branch `platform/stage-0`. Den oprindelige hovedmappe er bevaret som snapshot.
- GitHub HEAD/main er igen verificeret som `9a76239477ae03e7e5504f537e52a24277198ab4`; ingen ny liveverifikation af produktionen. PR #31 om emballagemapping står åben og indgår ikke her.
- Alle 293 sporede filer er sammenlignet. Kun emballagekode, emballagetest og ViaBill-test har indholdsforskelle; de er bevaret separat og ikke overført. Se STAGE-0.md og den lokale hashoversigt i `work/stage-0-preservation` under snapshot.
- Kun AGENTS.md og platformdokumentation er ændret i klonen. Ingen push, merge, deploy, eksterne bogføringer eller produktionsændringer.
- BACKLOG.md klargør P00–P11. DATA-MODEL.md og TEST-ENVIRONMENT.md er forslag; database, adgangsmodel, miljø, migrationer og GitHub-tavle er ikke implementeret/oprettet.
- Næste opgave: P01/P02, derefter P03/P04 før eksterne integrationstests. Platformsændringer må ikke merges til main før en udgivelsesstrategi forhindrer utilsigtet Sablen-deploy.

### Lokal validering

- `git fsck --full`: bestået.
- `node --test lib/*.test.mjs`: 261 bestået, 0 fejlet, 0 sprunget over, inklusive ViaBill Workerd-test. Første forsøg blev blokeret af sandboxens procesbegrænsning; genkørsel uden denne begrænsning bestod.
- Lokal runtime: Node 26.5.1, med eksisterende dependencies fra snapshot-mappens node_modules; ikke en frisk `npm ci` eller Linux-CI-verifikation. Resultater gælder den uændrede GitHub-kode i klonen, ikke de tilbageholdte lokale kodeændringer.
- `npm run build` og `npm run typecheck`: bestået. Build krævede genkørsel uden sandboxens procesblokering og gav tooling-/Node-advarsler, men ingen buildfejl.
- `wrangler deploy --config wrangler.direct.jsonc --dry-run`: bestået efter samme procesbegrænsning blev fjernet. Dette validerede den uændrede eksisterende Worker-pakke lokalt; det var hverken deployment eller afprøvning af et nyt testmiljø. Metrics var slået fra.
- Afsluttende SHA-256-kontrol: 0 ændringer i snapshotets oprindelige GitHub-sporede filer og 0 fejl i sikkerhedskopierne af de tre kodeafvigelser. Kun snapshotets AGENTS.md/platformdokumenter har fået henvisninger til klonen; originalerne er sikkerhedskopieret.
- Fjern-CI er ikke startet; obligatoriske PR-kontroller står i `.github/workflows/check.yml`. Produktion er ikke berørt.

## Oprindelig samtale
Oprindelig Codex-opgave: “Udviklingschat - integrationsløsning v2”, ID 01a07d1b-ca3c-7392-9b33-92080628dd91. Den fulde samtale er ikke kopieret eller flyttet af disse dokumenter. Dokumenterne sammenfatter arbejdet og platformplanen.

## Produktionsstatus fra seneste verificerede arbejde
- PR 54: Flatpay-knappen henter uden manuelt datovalg og bruger automatikkens afgrænsede historik-/nutidsvinduer uden at ændre dens fremdrift. Kommende udbetalinger medtages.
- PR 55: Advarsler/alarmer, separate mailvalg og automatisk lukning af entydigt refererede beskeder efter bekræftet bogføring. Kun udvalgte sikre Flatpay-fejl før ekstern oprettelse klassificeres som advarsler. Øvrige fejl er konservativt alarmer; dette er ikke en fuld klassifikation af alle integrationers genforsøg.
- Flatpay-udbetaling 48132375: første forsøg timeout, derefter afregningsdifference, til sidst bekræftet bogføring 11.09.2026 kl. 10.41.18. Brutto 1.279,00 DKK, gebyr 15,86, netto 1.263,14. Bruger viste godkendt Dinero-bilag 977. Må ikke genoprettes.
- Automatikken blev senest verificeret med fem minutters interval. Liveindstillinger kan siden være ændret.

## Kendte udeståender
- ViaBill er i udviklingsoversigten markeret I produktion, men den senest gennemgåede kode mangler automatisk import, bogføring og udbetalingsrapport. Brugeren har tidligere ønsket disse funktioner. Verificér aktuel kode og færdiggør særskilt; antag ikke at statusfeltet dokumenterer implementering.
- Udviklingsoversigt #5 Salgsanalyse-side var eneste åbne forslag ved seneste læsning. Øvrige ni stod I produktion; deres status er ikke en fuld revision.
- Lokale ændringer i lib/emballage-reporting.ts og tilhørende test kommer fra arbejde, brugeren stoppede. De må ikke utilsigtet udgives.
- lib/viabill.test.mjs har lokale ekstra tests, som ikke nødvendigvis er på GitHub. Gennemgå forskelle før overførsel til rigtig Git-klon.

## Kode og drift
Next/React/TypeScript, Cloudflare Worker, D1 og R2. GitHub Actions tester, bygger og deployer ved push/merge til main. Main er derfor ikke en sikker byggeplads for platformsarbejdet uden først at adskille udgivelsesforløbet.

Relevante steder: middleware.ts (adgang), db/schema.ts, db/credentials.ts, worker-entry.ts (scheduler), db/*-automation.ts, db/*-transfer.ts, db/payout-events.ts, db/errors.ts og db/incident-recovery.ts.

## Validering
Brug package.json og workflows som autoritet for aktuelle kommandoer. npm run typecheck og relevante node-tests køres lokalt. Linux-CI kører fulde tests og build. viabill-worker.test.mjs har tidligere haft Windows-runtimeproblemer; undlad ikke testen i CI. Finansielle tests skal bruge fixtures og må ikke genbogføre produktionsbilag.

## Arbejdsform
Svar på dansk og hold statusopdateringer forståelige. Brugeren foretrækker selvstændig fremdrift, men samtalen om et projekt er ikke en beslutning om at flytte Sablen til den nye platform nu. Hold produktion og test adskilt, og gem beslutninger i dokumenterne. Ingen adgangsnøgler eller passwords i dokumentation.

## Log ud – 13. september 2026
Knappen Log ud er placeret under identiteten i sidepanelet, også på mobil. POST /logout afviser fremmed origin og sletter lokal HttpOnly-session; remote viderestilles til applikationens /cdn-cgi/access/logout. Cloudflare afslutter Access-sessionen på tværs af apps i organisationen (kan også logge brugeren ud af Sablen); knappen klikkes derfor ikke under kontrol af brugerens aktive session. Ingen ændring af Sablen-konfiguration. Kilde: https://developers.cloudflare.com/cloudflare-one/access-controls/access-settings/session-management/ . Lokal routetest dækker cookie, redirect og CSRF.

Log-ud-opfølgning: 289 tests, typecheck og platform-dry-run bestået. Online browser viser mailadresse efterfulgt af Log ud-knappen ved smal skærmbredde. Log-ud-sessionen er ikke udløst på brugerens konto. Ingen ny commit/push.

## Oprydning af testkonti – 13. september 2026
Efter brugerens udtrykkelige ønske er de tre testvirksomheder (A, B og invitation), deres tre testwebshops, fem testbrugere inklusive gammel local-admin og rj@itm8.com samt tilhørende syntetiske data/invitationer/supportsessioner fjernet fra remote test-D1. René Jeppesens portaladministrator og LA Trading ApS med webshoppen er bevaret. rj@itm8.com kan inviteres igen. Access-politik og begrænset invitationsmodtagerliste er uændrede; oprydningen giver ikke nye modtagere adgang til mail eller login.
Backup ligger i ignoreret .wrangler/before-test-account-cleanup.sql; den præcise engangsoprydning ligger i .wrangler/cleanup-test-accounts.sql. Prøvekørsel mod backup verificerede identiske bevarede rækker og ingen FK-fejl. Remote import lykkedes atomisk. Oprydningen har en auditpost test.accounts.cleaned. Fixtures i koden/lokalt er bevaret til automatiske tests og må ikke seedes remote igen. Ingen kodeudgivelse, push, merge eller ændring i Sablen-produktion.

## Branding i platformen – 13. september 2026
Brugerens godkendte logo uden tagline og favicon er kopieret fra design/brand/v1 til platform/public/brand/webshoptoolbox-logo.png og platform/public/favicon.png. Logo i fælles Tier 0/Tier 1-navigation på lys baggrund og på onboarding; kompakt ikon i Tier 1-topbjælken. Favicon og apple-touch-icon er deklareret i begge HTML-indgange. Worker tillader GET/HEAD for præcis de to ikke-fortrolige brandingfiler; øvrig adgangskontrol er bevaret. Cloudflare Access-regler er ikke ændret.
Branding er fælles kode og kan følge med den senere produktionsplatform på portal.webshoptoolbox.dk. Denne produktion er fortsat ikke etableret, og Sablen-produktionen er ikke ændret. Fremtidig produktionsleverance skal bevare disse assets og HTML-referencer. Ingen merge til main eller push. 292 tests, build, typecheck, platform-dry-run og legacy-dry-run bestået.

Sat i drift på den separate test-Worker (inkl. dev.webshoptoolbox.dk), version 3d7e2dfd-8643-4eb8-93eb-298517009efd. Browserkontrol på Workerens eksisterende workers.dev-adresse viser logoet i Tier 0 og favicon-grafikken korrekt indlæst som mobilikon i Tier 1-topbjælken. Dev-domænets tidligere lokale DNS-cacheproblem er ikke genvalideret i denne brandingopgave.

## Tier 1 – opsætningsbeskeder på dashboard, 13. september 2026
Implementeret: synlige kort øverst for manglende regnskabs- og webshopforbindelse med direkte navigation, scroll og tastaturfokus til hver opsætningssektion. Henter eksisterende adgangsafgrænsede API-data. Skelner mellem manglende opsætning og gemte oplysninger, som afventer tilslutning. Brugere uden administrationsrolle henvises til virksomhedens administrator og kan se opsætningen. Alle forbindelser er fortsat ikke tilsluttet i denne testleverance: regnskabsstatus er kun pending, webshopcredentials er alene gemt. Når live-adaptere etableres, skal kortenes synlighed kobles til verificeret forbindelsesstatus; credentials_saved eller webshopstatus active må aldrig bruges som bevis på forbindelse.
Testet: 292 tests, build, typecheck og begge Worker-dry-runs bestået. Deployet til separat dev/test-Worker som 4192a45f-a2b4-4d80-b02c-2bd4ca27222c. Mobilvisning verificeret via workers.dev. Ingen databaseændringer, push, main-merge eller ændring af Sablen-produktionen.

Logo uden hvid baggrund – 13. september 2026: CSS-baggrunden fjernet fra navigation og onboarding. Navigationens transparente PNG vises monokromt hvid via CSS-filter for kontrast på mørk baggrund; originale farver bevares på onboarding. Kun styles.css ændret i denne leverance. 292 tests, build, typecheck og begge dry-runs bestået. Udgivet til separat dev/test; browserkontrol bekræfter transparent, læsbart logo i navigationen. Ingen ændring af Sablen eller main.

Transparent favicon – 13. september 2026: Den sorte baggrund fjernet med imagegen, guldfarvet værktøjskasse bevaret. RGBA og fuldt transparente baggrundspixels verificeret. Ny fil i platform/public/favicon.png og design/brand/v1/webshoptoolbox-favicon-transparent.png. HTML-indgange og Tier 1-topikon bruger ?v=transparent-1 for at opdatere browsercache. JavaScript-syntaks og platform-dry-run bestået; ingen ændring af serverkode eller adgangskontrol. Tidligere 292 tests/build/typecheck gælder den uændrede logik; ikke genkørt for billedudskiftningen. Sablen og main er uændrede.
Sat i drift på separat dev/test-Worker som 2a0f5c85-8d4d-4025-bf76-718b0477868f.


## Mailopsætning og fakturastatus – 14. september 2026
Se [MAIL-SENDERS.md](MAIL-SENDERS.md) for implementering, begrænsninger og faktisk test-/driftsstatus. Standardafsender faktura@webshoptoolbox.dk; egen afsender via kundens Cloudflare Email Sending-konto er valgfri og skal kontrolleres. Kundemail/bogføring fortsat blokeret; kun særskilt testmail til godkendte loginadresser. Backup før migration 0008 i .wrangler/before-company-mail.sql. Ingen main-merge eller push. GitHub main nu 3dbe5eb (PR 56); platformbranchen er uændret på GitHub.
Fakturafunktionen er ikke flyttet ud over menupost/tomtilstand. Se [INVOICE-MIGRATION.md](INVOICE-MIGRATION.md) for gennemgåede legacy-dele og konkrete acceptkrav. Ingen produktionsfakturaer er berørt.

Seneste maildeployment: 76046e48-6b82-4571-8d84-8dad6b1ed2cb. Rigtig testmail og browserkontrol af formularen afventer nyt Access-login; intet leveringsresultat er påstået verificeret. Platformtests 37/37 bestået efter sidste REST-justering, hele testpakken 298/298 inden justeringen.

## Hjemmeside – 20. september 2026
Se [WEBSITE.md](WEBSITE.md). Kode i work/website, egen Worker og D1. Tilmeldinger køes; MAIL_ENABLED=false indtil info@webshoptoolbox.dk er oprettet og testet. Eksisterende platformkode er ikke udgivet.

## 21. september 2026 – eget kundelogin klargjort
Se [CUSTOMER-LOGIN.md](CUSTOMER-LOGIN.md) for implementering, test, dev-version og resterende Access-aktivering. Tier 1 får egen mailkode; Tier 0 flyttes til /admin og beholder Access. Dev-kode og migration deployet; domænet stadig Access-beskyttet, indtil konkret ændring godkendes/gemmes. Produktionsopsætning klargjort lokalt, endnu ikke deployet. Ingen ændring af Sablen eller merge/push til main.

### Dev-login nu aktiveret
Efter brugerens konkrete bestilling er Access-path admin gemt for dev.webshoptoolbox.dk. Eget login er aktivt på /login; Tier 0 ligger på /admin/. Kontroller: offentlig loginform 200, anonyme kunde-API-kald 401, Tier 0 Access-redirect 302. Én loginmail til rj@itm8.com accepteret af mailtjenesten; indbakke/rigtigt login afventer brugeren. Produktion/Sablen uændret. Se CUSTOMER-LOGIN.md for detaljer.

## Tier 0-domæne klargjort
Se [ADMIN-DOMAIN.md](ADMIN-DOMAIN.md). Link fra kundelogin fjernet og noindex deployet/verificeret på dev som 6dab3cd8-66d5-4786-bded-4900281bf4c8. 315 tests og obligatoriske builds bestået. Routing til admin.webshoptoolbox.dk implementeret som inaktiv konfigurationsmulighed. Bruger spurgt om admin-domænet skal høre til dev/test eller produktion; afventer svar før DNS/Access/route-aktivering. Produktion og Sablen uændret.


## Funktionsaudit – 21. september 2026
Brugeren bad om grundig sammenligning med seneste Sablen. Se PARITY-AUDIT-2026-09-21.md og PARITY-ROUTES-2026-09-21.csv (44 ruter). Main hentet til origin/main på 73e45ac uden merge/checkout. Lokal kildeeksport i ignoreret .wrangler/parity-main-73e45ac. Sablen-version læst som 5c57ed45-7d7a-4343-849e-5abd45966801 fra 16/9; metadata indeholder ikke Git-SHA, så præcis kode/deployment-binding er ikke bevist. Åben PR #31 holdt ude af merged baseline. Platformens nyere lokale/dev-kode sammenholdt med main; intet runtime ændret og ingen deployment udført.
Konklusion: ingen 1:1-paritet. Mail har skjult dialog, 2500 mod 4000 tegn, anden testmodtager/test-PDF-proces og ingen normal/automatisk kundeafsendelse. PDF mangler momsvisning/gruppering/indrykning/versionsrettelser. Salg, refundering, udbetalinger, lager, emballage, rapporter og indsigt er overvejende tomme moduler. Foreslået rækkefølge: faktura/mail → forbindelser/kontoplan → salg/refundering → udbetalinger → lager/emballage/drift. Ingen implementering autoriseret af selve auditbestillingen. Admin-domænets miljøafklaring er fortsat uafklaret og blev ikke behandlet i auditten.


## Paritetsimplementering og support – 21. september 2026
Se PARITY-IMPLEMENTATION-2026-09-21.md. Bruger har udtrykkeligt autoriseret kun dev og forbudt flytning/ændring af Sablen. Supporttickets og første driftsudsnit er implementeret; resten af fuld paritet er oplistet som manglende, ikke færdigt. Migrationer 0011–0016 er additive og prøvet på dev-backup uden datatab. Ingen main-merge eller push.

Dev-udrulning gennemført: version 00bfed86-f337-45a0-8718-423dc730ada5. Migration 0011–0016 anvendt, login/API/Access/noindex kontrolleret online. Hele testpakken 321/321, derefter afsluttende platformpakke 59/59. Build, typecheck og begge dry-runs bestået. Se paritetsnotatet for resterende funktioner og utestede rigtige providerflows.

## 27. september 2026 – GitHub-udgivelsesnøgler

Separat dev/prod-token gemt som miljøsecret i Jopppardk/WebshopToolbox-Platform. Begge aktive og afgrænset til egen Worker samt webshoptoolbox.dk-routes; læseadgang til Sablen afvist med 403. Udløb 28. september 2027. Ingen deployment startet; se REPOSITORY-SPLIT.md for præcis verifikation og begrænsninger.

## 27. september 2026 – første GitHub-deployment gennemført

Begge miljøer er udgivet via det nye repositories manuelle workflow fra commit `354c194731f5c27fc46b5c25171b51a17eb9afab`:

- Dev: https://github.com/Jopppardk/WebshopToolbox-Platform/actions/runs/36341400602 – success, Worker-version `ac18c8aa-7834-4baf-8681-31213d4a7139`.
- Prod: https://github.com/Jopppardk/WebshopToolbox-Platform/actions/runs/36341619641 – success, Worker-version `c868b7f3-2e4c-4ad5-b416-a7b59585c257`.

Begge kørsler bestod 352 tests, begge typechecks, build og upload/trigger-deployment. Repository-guard accepterer nu også GitHub Actions' præcise HTTPS-origin uden `.git`; andre repositories afvises fortsat. Dev bruger nu kun custom domain `dev.webshoptoolbox.dk` og har `workers_dev=false`, ligesom prod. Den gamle workers.dev-adresse er dermed lukket. Dette undgår Wranglers kontoovergribende subdomain-opslag; API-tokenrettigheder er ikke udvidet. Produktionsvalidatorens normalisering er tilpasset samme regel.

Tidlige forsøg: første stoppet før upload af origin-kontrollen; andet uploadede dev-kode men fejlede under workers.dev-triggeropsætning; tredje stoppet af den fælles config-validering. Endelige kørsler ovenfor er begge fuldt gennemført.

Efterkontrol: dev healthz/login 200, anonymt ordre-API 401, /admin/ 302 til Access, bookkeeping/customerEmail blocked. Prod-ruter svarer fortsat 302 til den eksisterende domænedækkende Access-app; kundelogin og autentificeret brugerflow er derfor stadig ikke færdigverificeret. Denne deployment ændrede ingen Access-politikker. Ingen migrationer, økonomiske posteringer eller testmails kørt. Sablen-repository og -ressourcer er ikke ændret.

## 27. september 2026 – produktionslogin opdelt og aktiveret

Efter brugerens bestilling er destinationen på eksisterende Access-app `ffaf131f-cd7e-48a1-aad8-94dc4c709aa3` ændret fra hele portal.webshoptoolbox.dk til `portal.webshoptoolbox.dk/admin`. App, audience, administratorpolitik `c3b21df3-4275-415c-9d16-607420e7550c`, mailkode og seks timers session er bevaret. Sablen og dev er ikke ændret. Der oprettes ikke separat admin-domæne; Tier 0 tilgås på /admin i hvert miljø.

Kontrolleret online efter lagring: prod / giver 303 til /login, /login giver 200 og viser WebshopToolbox-formularen med mailkode uden Cloudflare-login. /admin, /admin/ og /admin/api/platform/me giver 302 til Access. /api/platform/me, /api/platform/companies og ordre-API giver 401 anonymt. /local-login giver 401. Offentlige Worker-svar har noindex, nofollow, noarchive. /healthz giver 200 med environment=production og bogføring/kundemail blocked. Devs samme login-/API-/Access-kontroller bestod også.

Ingen kode-deployment, databaseændring eller mailafsendelse i denne aktivering. Reel modtagelse af kundens mailkode og fuldt kunde-/administratorlogin er ikke afprøvet her. Seneste kode-CI og begge GitHub-deployments er bestået. Tidligere noter om domænedækkende produktions-Access er nu historiske.

## 27. september 2026 – info-konto til Tier 0

Efter brugerens ønske er info@webshoptoolbox.dk oprettet som ventende Tier 0-administrator i både dev og prod. Eksisterende administrator bevares som reserve. Der findes ingen særskilt primærrolle i datamodellen; info-adressen er den aftalte fremtidige konto med samme administratorrettigheder.

Oprettet atomisk i hvert miljø: bruger uden virksomhed, platform_admins-række, 48-timers invitation med hashet token og auditpost. Efterkontrol bekræfter tier0=1, status=inactive og invitation=pending indtil mailverificeret onboarding. Personlige aktiveringslinks findes kun i ignoreret .wrangler/info-admin-activation.html og er ikke sendt med mail eller committet. Brugeren skal logge ind med info-adressen via Access og udfylde profil for hvert miljø. Ingen eksisterende konti eller kundedata er ændret.

Info-adressen er tilføjet de to eksisterende Tier 0 Access-politikker; øvrige adresser, session og autentificering bevares. Ingen ændring af Sablen. Ingen deployment nødvendig.

## 27. september 2026 – dev Access-callback rettet

Brugerens første info-login blev sendt til den lukkede workers.dev-adresse via Access' /cdn-cgi/access/authorized. Dev Access-appens gamle primære workers.dev-destination var bevaret efter lukningen af aliaset; dette blev overset ved den første deploymentkontrol, som kun testede anonym redirect.

Fjernet præcis den gamle destination fra eksisterende app fac8c207-ae43-4178-8452-22dd23f44943. Eneste destination er nu dev.webshoptoolbox.dk/admin. Politik, audience og loginmetode bevares. Prod/Sablen uændret, ingen kode eller databaseændring.

Verificeret efter lagring: dev healthz/login 200, admin 302 til Access, anonym ordre-API 401. Det eksisterende aktiveringslink er genåbnet i brugerens fejlfane, og browseren viser nu onboarding på dev med identiteten info@webshoptoolbox.dk. Profilfelter står tomme, og brugeren skal selv udfylde navn og trykke Opret min bruger. Ingen ny kode sendt og invitationen er ikke accepteret af agenten.


## 27. september 2026 – Generel kundestyret bogføringsopstart (klargjort)

Separate historik-/bogføringsdatoer og assisteret manuel Dinero-afstemning implementeret. Ingen kundedatoer, import eller afstemning startet. Migration 0025 er additiv. 355/355 tests samt efterfølgende 5 målrettede tests med kladdeafvisning bestået. Begge typechecks og miljøkonfigurationskontroller bestået; GitHub CI og udgivelse afventer. Bogføring/kundemail fortsat blokeret. Se [BOOKING-ONBOARDING.md](BOOKING-ONBOARDING.md) for funktion, begrænsninger og verifikation.


## 27. september 2026 – Bogføringsopstart udgivet på dev og portal

Kodecommit `47e1815bebfca0040fa040f20af2790a193506d4` er udgivet fra det separate GitHub-repository:
- Dev: run `36346884449`, Worker `1f93b5da-eb81-4689-bba8-e712054a57e3`.
- Prod: run `36347101084`, Worker `eedf78d0-2750-456a-b5c1-935ed082b9eb`.
- CI `36346770841` samt begge deployjobs bestået, hver med 355/355 tests og obligatoriske builds/typechecks.

Migration 0025 anvendt i begge D1-databaser efter Time Travel-bookmarks. FK-kontrol OK, begge nye tabeller tomme efter migration. Prod gav først Cloudflare 7403; read-only whoami bekræftede rigtig konto og D1-write-rettighed, d1 info bekræftede rigtig database. Nyt forsøg med samme autoriserede login lykkedes. Ingen rettigheder eller credentials ændret.

Begge miljøers health/login giver 200, admin giver 302 til egen Access-destination, anonym ordre-API giver 401. Bogføring og normal kundemail fortsat blocked. Ingen historik hentet, datoer sat eller bilag afstemt for kunder. Sablen uændret. Live Dinero-afstemning og visuel browserkontrol er ikke udført; funktionens API og klient er testet/bygget med syntetiske data og CI. Afstemningen er manuel pr. bilag, ikke automatisk masseafstemning. Se BOOKING-ONBOARDING.md.


## 27. september 2026 – Flatpay: én historikdato

Det gamle Startdato-felt ved aftalevalg er fjernet fra Tier 1. Flatpay bruger den gemte effektive historikdato fra IntegrationStartDate, når forbindelsesrequesten ikke indeholder en legacy-startDate. Gem startdatoer før forbindelse. Bogføringsstart er fortsat selvstændig. Efter datolagring genhentes forbindelsesrevisionen, så samme side ikke sender en forældet revision. Eksisterende klienter og API-kontrakter bevares. Ingen migration eller kundedataændring. Målrettet integrationstest verificerer forbindelseslagring uden ekstra dato samt adskilt bogføringsdato; begge typechecks bestået. Udgivelse afventer.


Flatpay-rettelsen er udgivet på kodecommit `0d9ff2e2c4acbfa535d88bacffa282dc47894401`. CI `36347805009`, dev `36347805355` og prod `36347807975` bestået med 355/355 tests og obligatoriske builds/typechecks. Dev Worker `ae861e94-8347-497e-9534-02dd7d5095f1`, prod Worker `4c0f73ac-d116-4d34-a59c-04e6fd4ea20e`. Begge health/login 200, admin 302 til Access, anonym ordre-API 401. Ingen migration, kundedata, økonomiske kald eller Sablen-ændringer. UI er typechecket og bygget, ikke browserkontrolleret.


## 27. september 2026 – Præcis Cloudflare-guide

Guiden under Afsender og eget maildomæne er udvidet med konto-ID-søgning, direkte link til brugerens API Tokens, Create Custom Token, Account → Email Sending → Edit, afgrænsning til Specific account, engangsvisning af tokenværdien samt Gem afsender og afsendertest. Generisk for hver kundes egen konto; intet WebshopToolbox/Sablen-konto-ID indsat. Officielle Cloudflare-kilder linket i dialogen. Kun hjælpetekst/layout ændret; ingen mail, DNS, credentials eller databaseændringer. Udgivelse afventer.

Guide-opdateringen er udgivet på kodecommit `ebec0ad5d5ba3c191484400943e9db72624f5409`. CI `36349426876` og deployruns dev `36349427504` / prod `36349429596` bestået, 355/355 tests. Dev Worker `5c33c581-a2e4-48ff-b3d8-8144c5575a24`; prod Worker `30bb3d87-e0de-450c-b7ea-00d0aa33c054`. Begge health/login 200, admin Access-redirect 302, anonym ordre-API 401. Dialogen er typechecket/bygget; ingen browserkontrol eller testmail udført.


## 27. september 2026 – Skjul domæneadvarsel efter godkendelse

Den røde Cloudflare DNS-advarsel skjules, når serveren returnerer verified for den gemte egne afsender, eget domæne er valgt og formularen ikke er ændret. Ved ændringer/standardafsender/pending vises advarslen igen. Under indlæsning vises den ikke. Kun visning ændret, ingen ny testmail eller ændring af godkendelse, data eller mailregler. Udgivelse afventer.

Advarselsændringen er udgivet på dev og portal fra `2c1ec73fdf7b889a6e29ecac2a7957ae7cc18999`. CI `36349682249`, dev `36349682280` og prod `36349684268` bestået. Begge miljøers health/login 200, admin Access-redirect 302, anonym ordre-API 401. Ingen testmail afsendt eller kundedata ændret.


## Cloud-opgaver samlet 28. september 2026

> 27. september 2026 – Fakturasidens eksempelfaktura er klargjort til en valgfri gyldig mailadresse i både dev og produktion. Serveren genererer fortsat emne, tekst og demo-PDF, kræver virksomhedsadgang, afviser supportimpersonering og bevarer idempotens/cooldown. Den separate afsendertest er fortsat begrænset til brugerens allowlistede loginadresse. Testet lokalt, men endnu ikke udgivet.

> 27. september 2026 – Emballage Indberetning-forbindelsen skelner lokalt mellem en faktisk afvist nøgle (HTTP 401/403) og fejl hos netværk/tjeneste/rate limit. Leverandørens sikre request-reference vises ved API-fejl, eksisterende credentials bevares, og klientens nøgleeksempel har ikke længere mellemrum omkring punktummet. Regressionstest er tilføjet. Ikke udgivet; en rigtig leverandørnøgle er ikke anvendt.

> 27. september 2026 – Emballage Indberetnings første opsætning importerer nu automatisk Shopify-emballagehistorik fra den valgte kvartalsstart til i dag. Importen er afgrænset til virksomhed/webshop og skal lykkes komplet, før konfigurationen gemmes; efterfølgende indstillingsændringer importerer ikke historikken igen. Klienten viser resultatet. 356/356 tests og Tier 1-typecheck er bestået. Ikke deployet; ingen rigtige leverandørkonti eller produktionsdata er brugt.

> 27. september 2026 – Integrationstomme Tier 1-sider er implementeret lokalt. Salg, fakturaer, lager, emballage og produktfeeds kræver Shopify; tilbagebetalinger, udbetalinger og rapporter åbner, når mindst én relevant betalingsintegration er forbundet. Uden forbindelse vises en illustreret tomtilstand med direkte link til Integrationer, og de bagvedliggende sidekomponenter/datahentninger startes ikke. Fejl ved statusopslag vises særskilt med genforsøg. Logikken er dækket af regressionstest og Tier 1-typecheck; browserkontrol, GitHub CI og udgivelse er endnu ikke udført. Ingen migration, eksterne writes eller produktionsdata er berørt.

> 27. september 2026 – Frigivelsesvurdering: Platformen er **ikke klar til almindelig frigivelse** for andre virksomheder/webshops. Den kan gå videre mod en lukket pilot i testmiljøet efter de dokumenterede adgangskriterier. Ingen deployment, mail, remote dataændring eller økonomisk postering blev udført. Se [RELEASE-READINESS-2026-09-27.md](RELEASE-READINESS-2026-09-27.md).


Ovenstående fem Cloud-leverancer er samlet på platform/cloud-release-20260928. Lokale og GitHub-kontroller samt udgivelse af den samlede version afventer. Ingen migrationer, kundedata eller Sablen-ændringer. Bogføring og almindelig kundemail forbliver blokeret.


## 28. september 2026 – Samlet Cloud-udgivelse afsluttet

Alle fem Cloud-leverancer er samlet via PR #1 og udgivet på dev og portal fra 8fd86ce. 358/358 tests, obligatorisk CI og begge deployworkflows bestået. Health/login 200, admin Access 302 og anonym ordre-API 401 på begge miljøer. Bogføring/normal kundemail fortsat blocked; ingen Sablen- eller dataændringer. Se [CLOUD-RELEASE-2026-09-28.md](CLOUD-RELEASE-2026-09-28.md) for kildeopgaver, runs, versioner og resterende live-verifikation.


## 28. september 2026 – Samlet fakturamail-opsætning

Implementeret: tre trin (design, mailtekst, afsender/test), foldbar valgfri Cloudflare-opsætning og grønt flueben efter accepteret test af gemt konfiguration. Én demo-testmail kontrollerer nu også en endnu ikke verificeret egen afsender; fejl falder ikke tilbage til standardafsender. Status genhentes efter testen. Gemte designs bruges fortsat, idempotens og tenantkontrol bevares. Tests og udgivelse afventer. Ingen migration, rigtige testmails eller Sablen-ændringer.

Udgivet via PR #2 fra `76e12bd148b9d028d357f3b98c25ec47e6618111`. Obligatorisk PR-CI bestået (run 36379542557), 359/359 tests; begge deployforløb gentog 359/359 tests samt builds/typechecks. Dev run 36379750291, Worker 769786c9-1be8-4e00-81d7-10d05e7fe6c4. Prod run 36379989591, Worker 4f63f886-3e93-4e0d-adeb-df149200c10b. Begge health/login 200, admin 302 til Access og anonym ordre-API 401. Fold-ud, grønt flueben og ændret-konfiguration-status browserkontrolleret lokalt med syntetiske data; ingen rigtig mail sendt og ingen autentificeret online-UI-test. Ingen migration eller ændring af Sablen. Bogføring/normal kundemail fortsat blokeret.

## 28. september 2026 – Opdateret ekstern frigivelsesvurdering

NO-GO til almindelig kundedrift; betinget læse-/demopilot efter afgrænset accept. Aktuel GitHub/HTTP-status og begge npm-audits er verificeret. 359-test CI er grøn, men økonomiske writes, normal kundemail og scheduler er stadig kodeblokeret. Lint fejler; samlet leverandørpilot og D1+R2-restore mangler som releasebevis. Se [RELEASE-READINESS-2026-09-28.md](RELEASE-READINESS-2026-09-28.md) for prioriteret plan og afgrænsninger. Denne vurdering ændrer ingen runtime, data eller udgivelse.
## 28. september 2026 – Selvbetjent tilmelding
Se PUBLIC-SIGNUP.md. Implementeret og lokalt testet i isoleret platform/public-signup. Produktionens runtime-opgave koordinerer integration/udgivelse. Endnu ikke sat i drift.



## Produktionskørsel – 28. september 2026
Implementeret på platform/production-runtime; endnu ikke udgivet. Se PRODUCTION-RUNTIME-2026-09-28.md for adapters, sikkerhedsgrænser, tests og driftsstatus. Samlet udgivelse koordineres med tilmeldingsopgaven.
