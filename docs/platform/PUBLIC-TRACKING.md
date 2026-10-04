# Fælles tracking via Shipmondos offentlige sider

Implementeret 4. oktober 2026. Udgivelse er ikke bekræftet endnu.

Forsendelser bruger nu én fælles kilde: `window.tracking`-JSON i den offentlige HTML på `https://track.shipmondo.com`. Der udføres aldrig JavaScript fra siden. Ingen Shipmondo-konto, API-nøgle eller webhook kræves. Den valgfri API-forbindelse bevares til senere forsendelsesoprettelse; eksisterende webhooks kan stadig modtages, men beriger ikke denne visning.

- Eksisterende Shipmondo-links valideres mod pakkenummer og transportør. DAO, GLS Danmark, PostNord Danmark (`pdk`) og Bring kan også få genereret link fra Shopify-oplysninger. Andre transportører kræver et gyldigt eksisterende Shipmondo-link. Manglende/ugyldige identiteter vises som utilgængelige med Shopify-data som fallback.
- Flere pakkenumre på en afsendelse vises separat (op til 100 trackingInfo pr. fulfillment). Shopify-listens eksisterende periode- og ordrebegrænsninger gælder fortsat.
- Registrering sker, når Forsendelser hentes. Første sidekald forsøger op til otte pakker, højst fire samtidigt. Siden genhenter, mens den er synlig, hvert minut. Hvert pakkenummer kontrolleres højst én gang i timen; Opdatér omgår ikke grænsen.
- Prod-cron opdaterer også registrerede pakker uden en åben browser, op til 40 pr. kørsel, ældst forfaldne først. Dev har fortsat ingen cron og opdaterer ved sidekald. Dette er ikke en selvstændig import af Shopify-ordrer; nye pakker registreres ved indlæsning af Forsendelser.
- Migration 0040 opretter en separat cache/arbejdskø. Nøgler afgrænses til virksomhed, webshop, afsendelse, tidspunkt og trackinglink. Udskiftede Shopify-credentials invaliderer gamle snapshots. Demo, inaktive kunder/webshops og udløbne prøvekunder behandles ikke i cron. Ingen ændring i bogføring eller kundemail.
- Atomiske leases beskytter samtidige faner/cron. Et fejlet opslag bevarer sidste gode snapshot, viser fejlen og venter en time før nyt forsøg. DELIVERED stopper polling. Ukendte statusser vises som kildetekst og antages ikke leveret/returneret. Cache udløber 90 dage efter afsendelse og ryddes af cron.
- Kun fast HTTPS-origin, ingen redirects, cookies eller API-nøgler. 8 sekunders timeout, maks. 512 KB HTML og 300 hændelser. Kun status, hændelsestekst, tidspunkt og forsendelses-ID gemmes; afsender/modtager fra siden gemmes ikke.
- Sidens danske tidsstempler fortolkes som Europe/Copenhagen med sommertid. Ved efterårets dobbelte klokkeslæt vælges den sene forekomst. Ingen opfundne trintidspunkter. Afhentningsfrister er fortsat skøn.

## Verifikation

DAO-link stillet til rådighed af brugeren blev læst uden login og indeholdt gyldig `window.tracking` med EN_ROUTE og INFORMED. Der gemmes ingen rigtig trackingfixture i Git. GLS/PostNord/Bring er dækket med syntetiske fixtures i samme format; rigtige pakker fra disse transportører er ikke verificeret. Layout/JSON er udokumenteret og kan ændre sig; fejl vises med fallback. Fuld CI og release følger PR/kørsel. Produktion må først beskrives som udgivet efter grøn HTTP-gate.
