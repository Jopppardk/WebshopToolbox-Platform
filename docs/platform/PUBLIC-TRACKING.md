# Fælles tracking via Shipmondos offentlige sider

Implementeret 4. oktober 2026 via PR #90 og #91. Godkendt release-SHA: `e2227078ef3771b586e7e9b36e5d2273bcffe167`.

## Releasebeviser

- GitHub CI: 451/451 tests, typechecks, builds og dry-runs bestået i kørsel 37201734964.
- [Dev → prod-kørsel 37202026243](https://github.com/Jopppardk/WebshopToolbox-Platform/actions/runs/37202026243) er den autoritative driftsstatus. `success` betyder, at begge deployments og HTTP-gates er bestået. Den tidligere kørsel 37201609496 blev annulleret under tests, før nogen deployment.
- Migration 0040 er anvendt på dev og prod; begge FK-kontroller uden fejl. Lokal kopiprøve bevarede alle 59 eksisterende tabeller.
- D1-gendannelsesbogmærker før migration: dev `00000084-00000002-000050fa-e220a135752aa523b6730dfe02f3cee9`, prod `0000069c-00000000-000050fa-aa7fbddeb8cd1cec22524a94d4ba9de1`.
- Den endelige parser er afprøvet i workerd mod brugerens DAO-link: HTTP 200, EN_ROUTE og tre hændelser. Ingen afsender/modtager gemt som fixture.

Forsendelser bruger nu én fælles kilde: `window.tracking`-JSON i den offentlige HTML på `https://track.shipmondo.com`. Der udføres aldrig JavaScript fra siden. Ingen Shipmondo-konto, API-nøgle eller webhook kræves. Den valgfri API-forbindelse bevares til senere forsendelsesoprettelse; eksisterende webhooks kan stadig modtages, men beriger ikke denne visning.

- **Bring (24. oktober 2026):** Shipmondo har ingen trackingside for Bring; track.shipmondo.com/bring/… omdirigerer til tracking.bring.com. Bring-pakker hentes derfor fra Mybring tracking-API'et med webshoppens egen Mybring-nøgle (Integrationer → Bring, `platform/bring.ts`, `platform/bring-tracking.ts`, migration 0051). Uden forbindelse vises Bring-pakker som utilgængelige, og der slås intet op.
- Eksisterende Shipmondo-links valideres mod pakkenummer og transportør. DAO, GLS Danmark, PostNord Danmark (`pdk`) og Bring kan også få genereret link fra Shopify-oplysninger. Andre transportører kræver et gyldigt eksisterende Shipmondo-link. Manglende/ugyldige identiteter vises som utilgængelige med Shopify-data som fallback.
- Flere pakkenumre på en afsendelse vises separat (op til 100 trackingInfo pr. fulfillment). Shopify-listens eksisterende periode- og ordrebegrænsninger gælder fortsat.
- Registrering sker, når Forsendelser hentes. Første sidekald forsøger op til otte pakker, højst fire samtidigt. Siden genhenter, mens den er synlig, hvert minut. Hvert pakkenummer kontrolleres højst hver sjette time; Listens Opdatér omgår ikke grænsen. Hent ny status på en enkelt pakke udfører et manuelt opslag med atomisk ét-minutsgrænse på tværs af brugere/faner. Leverede pakker springes fortsat over. Serveren slår kun op for en forsendelse, som findes i den adgangskontrollerede Shopify-liste; klienten kan ikke angive URL.
- Prod-cron opdaterer også registrerede pakker uden en åben browser, op til 40 pr. kørsel, ældst forfaldne først. Dev har fortsat ingen cron og opdaterer ved sidekald. Dette er ikke en selvstændig import af Shopify-ordrer; nye pakker registreres ved indlæsning af Forsendelser.
- Migration 0040 opretter en separat cache/arbejdskø. Nøgler afgrænses til virksomhed, webshop, afsendelse, tidspunkt og trackinglink. Udskiftede Shopify-credentials invaliderer gamle snapshots. Demo, inaktive kunder/webshops og udløbne prøvekunder behandles ikke i cron. Ingen ændring i bogføring eller kundemail.
- Atomiske leases beskytter samtidige faner/cron. Et fejlet opslag bevarer sidste gode snapshot, viser fejlen og venter seks timer før nyt forsøg. DELIVERED stopper polling. Ukendte statusser vises som kildetekst og antages ikke leveret/returneret. Ikke-afsluttet cache udløber 90 dage efter afsendelse og ryddes af cron. Leveringsbekræftelser bevares indtil webshop-/kundedata slettes og overlever credentialudskiftning for samme pakke. Shopify-bekræftet levering afslutter også polling uden et opslag hos Shipmondo.
- Kun fast HTTPS-origin, ingen redirects, cookies eller API-nøgler. 8 sekunders timeout, maks. 512 KB HTML og 300 hændelser. Kun status, hændelsestekst, tidspunkt og forsendelses-ID gemmes; afsender/modtager fra siden gemmes ikke.
- Sidens danske tidsstempler (yyyy/MM-dd, dd/MM/yyyy, dd.MM.yyyy og yyyy-MM-dd) fortolkes som Europe/Copenhagen med sommertid; ISO 8601 med tidszone bruges, som det er. Hændelser med samme tidspunkt accepteres, når pakkens status er én af dem. Ved efterårets dobbelte klokkeslæt vælges den sene forekomst. Ingen opfundne trintidspunkter. Afhentningsfrister er fortsat skøn.

## Verifikation

DAO-link stillet til rådighed af brugeren blev læst uden login og indeholdt gyldig `window.tracking` med EN_ROUTE og INFORMED. Der gemmes ingen rigtig trackingfixture i Git. GLS/PostNord/Bring er dækket med syntetiske fixtures i samme format; rigtige pakker fra disse transportører er ikke verificeret. Layout/JSON er udokumenteret og kan ændre sig; fejl vises med fallback. Fuld CI er bestået. Se releasekørslen ovenfor for begge miljøers HTTP-gates.
