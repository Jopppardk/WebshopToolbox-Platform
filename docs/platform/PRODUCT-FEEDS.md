# Produktfeeds – 23. september 2026

> 23. september 2026 – Produktfeeds udgivet kun på dev som `afcddbc2-6332-43db-bdf1-4b0c95a97167`. Nyt Tier 1-menupunkt med flere PartnerAds-feeds, kollektioner/enkeltprodukter, fragtpris/fri-fragt-grænse/leveringstid, pause, XML-visning og linkrotation. Genbruger formatter fra feed.sablen.dk; kilden og Sablen er uændret. Shopify read_products kræves. Offentlig XML via langt unikt link, opdatering ved hentning efter 15 minutter, ingen cron. Migration 0024 efter backup og kopiprøve med 42 tabeller uændrede; remote FK-kontrol OK. 344/344 samlet suite og efterfølgende 3/3 feedtests, begge typechecks/builds/dry-runs og lokal browserkontrol bestået. Dev health/login 200, anonym administrations-API 401, ukendt feedlink 404. Ingen remote feeds oprettet; rigtig PartnerAds-import ikke afprøvet. Bogføring/kundemail fortsat blocked, prod offline, ingen push/main-merge. Se PRODUCT-FEEDS.md.


## Leverance
Tier 1 har menupunktet Produktfeeds på desktop og mobil. Virksomhedsadministratorer kan oprette flere feeds pr. webshop, redigere, slette, sætte på pause, skifte det offentlige link og se XML. PartnerAds er eneste tilladte tjeneste; formatteren ligger separat, så andre formater kan tilføjes senere.

Udvalg er alle aktive produkter eller unionen af valgte Shopify-kollektioner og enkeltprodukter. Søgning og katalogpagination henter fra den valgte webshops Shopify-forbindelse. Identiteter og adgang kontrolleres på serveren. Shopify-appen skal have read_products. Fragtpris inkl. moms, valgfri fri-fragt-grænse og leveringstid angives pr. feed. Fri fragt beregnes ud fra variantprisen; dette ændrer ikke Shopify-checkout. DKK er eneste understøttede valuta i denne version. Kategorinavn kan overskrives; ellers bruges første valgte kollektion og produkttype for enkeltprodukter.

## Kilde og format
Implementeringen tager udgangspunkt i den eksisterende kilde fra Codex-opgaven Implementer eksternt XLM-feed: C:/Users/rj/Documents/Codex/2026-09-01/jeg-skal-have-lavet-et-eksternt/src/index.ts. Kilden er kun læst. Formatet er også kontrolleret mod https://feed.sablen.dk/feed.xml. Ingen ændring af den eksisterende Worker, dens credentials eller Sablen.

PartnerAds: produkter/produkt med kategorinavn, brand, variantid, ean, produktnavn, produktbeskrivelse, pris, gammelpris, billedurl, vareurl, fragtomk, lagerstatus, leveringstid, size, color, gender. Aktive produkter og availableForSale-varianter; førpris lig pris når compareAtPrice ikke er højere. HTML fjernes fra beskrivelser, XML escapes, ugyldige XML-kontroltegn fjernes. Variantens billede vælges før produktets. Pris formateres med to decimaler. Collections/produkt- og variantpagination kontrolleres, ufuldstændige svar afvises frem for tavs afkortning.

## Drift og sikkerhed
- Migration 0024_product_feeds.sql er additiv. D1-konfiguration og R2-XML afgrænses med miljø, virksomhed, webshop og feed-ID.
- Nye feeds er pauset som standard. Et aktivt feed kan læses uden login via /feeds/<64 hex>.xml. Linket giver kun adgang til produkt-XML; ingen Shopify-nøgler indgår. GET/HEAD er eneste offentlige metoder. Noindex og no-store. PartnerAds skal behandle URL som adgang til produktdata.
- Offentlig hentning genbruger snapshots op til 15 minutter; derefter genereres nyt XML. Der er ingen cron. Manuel Opdatér kan bruges til kontrol af et pauset feed. Generering er serialiseret med D1-claim, fem minutters låsefrist og 30 sekunders minimum mellem forsøg. Fejl afviser opdateringen; tidligere XML bevares til autentificeret kontrol, men forældet offentlig XML serveres ikke som en succes efter en opdateringsfejl.
- Ændrede indstillinger invaliderer tidligere snapshot. Revision og låse-ID forhindrer en gammel generering i at udgive over nyere ændringer. Linkrotation, pause, deaktiveret virksomhed/webshop og fjernet Shopify-forbindelse stopper offentlig adgang. Links og produktdata føres ikke i auditdetaljer.
- Grænser: 25 feeds pr. webshop, 100 valgte kollektioner og 100 enkeltprodukter, højst 2.500 produkter, 10.000 varianter, 15 MB XML og 180 Shopify-kald pr. generering. Store udvalg kan ramme kaldgrænsen før produktgrænsen; intet afkortet feed udgives.
- Gamle R2-snapshots beholdes ved redigering/sletning. Automatisk oprydning/livscyklus er endnu ikke implementeret.
- Produktion er afvist i denne version. Ingen bogføring, kundemail, Shopify-mutationer eller ændringer af Sablen.

## Kontrol
344/344 tests i samlet suite bestået; efterfølgende 3/3 fokuserede feedtests bestået, herunder den tilføjede variantpagination/samtidighedstest. Kontrol omfatter overlap mellem webshops, forkert tenant/rolle, CSRF, førpris, fragt, deduplikering, escaping, pause/linkrotation, deaktivering, fejl og bevarelse af seneste snapshot. Begge typechecks, platformbuild/dry-run samt legacybuild/dry-run bestået. Lokal browserkontrol af menu, formular, tomt udvalg og oprettelse af pauset syntetisk feed. Ingen feedkonfiguration oprettet på remote og ingen brugerprodukter eksponeret af testene. PartnerAds-import med en rigtig konto er ikke afprøvet.

Dev-backup: .wrangler/before-feeds-0024.sql (ignoreret). Migration anvendt på backup i hukommelsen: alle 42 eksisterende tabeller identiske før/efter, ingen FK-fejl. Derefter anvendt lokalt og på dev.
