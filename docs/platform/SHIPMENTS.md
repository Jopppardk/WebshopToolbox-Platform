# Forsendelser (track & trace)

Status 3. oktober 2026: implementeret og lokalt testet. Ikke udgivet. Ingen migration.
Siden er kun afprøvet med syntetiske data og demodata. Den er ikke afprøvet mod en rigtig
Shopify-butik med fragtapp.

## Funktion

**Tools → Forsendelser** viser webshoppens afsendte ordrer for de seneste 14, 30 eller 60
dage. Der vises én række pr. afsendelse i Shopify. En ordre med delleveringer giver flere
rækker.

| Kolonne | Kilde |
|---|---|
| Ordre | Ordrenummer og afsendelsesdato |
| Modtager / By | Leveringsadressens navn og by. Mangler leveringsadressen, bruges faktureringsadressen |
| Status | Det højeste nåede trin. Et klik folder rækken ud med alle trin og deres datoer |
| Track & trace | Trackingnummer. Et klik åbner en dialog med fragtfirmaets hændelser og knappen "Åbn hos …" |
| Fragtfirma | Ikon for DAO, GLS, PostNord eller Bring. Andre fragtfirmaer vises med navnet fra Shopify |

Trin ved levering til pakkeshop: Udskrevet → Indleveret i pakkeshop → Under transport →
Klar i pakkeshop → Afhentet af kunden. Ved levering til kundens adresse er der ikke noget
pakkeshoptrin, og sidste trin hedder "Leveret hos kunden".

Det ses på følgende, om en forsendelse går til pakkeshop:

- en Shopify-hændelse af typen `READY_FOR_PICKUP`, eller
- fragtmetodens navn, fx "Pakkeshop", "ParcelShop", "Pakkeboks" eller "Service point".

"Afhentning i butik" tæller ikke som pakkeshop.

Dialogen viser fragtfirmaets side i en ny fane. Siderne hos PostNord, GLS, DAO og Bring kan
ikke vises indlejret i WebshopToolbox.

## Datakilde

Siden læser kun fra Shopify Admin GraphQL `orders.fulfillments`:
`displayStatus`, `inTransitAt`, `deliveredAt`, `trackingInfo` og `events`. Den kræver
`read_orders` og ingen ny adgang. Den skriver ikke ordrer, bogføring eller kvitteringer.

Status og datoer findes kun, hvis fragtappen eller fragtfirmaet har sendt hændelser til
Shopify. Et trin uden dato, som er passeret, vises som "Dato ikke oplyst". Udskrevet bruger
`LABEL_PRINTED`/`LABEL_PURCHASED` eller afsendelsens oprettelsestidspunkt. Kun http(s)-links
sendes videre til browseren.

## Returvarsel

Fragtfirmaerne sender ikke afhentningsfristen til Shopify. Fristen er derfor et skøn: den
danske dato for seneste `READY_FOR_PICKUP` plus 7 dages opbevaring for alle fire
fragtfirmaer (`carriers` i `platform/tier1/src/lib/shipments.ts`).

- Med 2 dage eller mindre tilbage markeres rækken med gult ("Returneres om …").
- Når fristen er passeret, markeres rækken med rødt ("Fristen er sandsynligvis overskredet").

Opbevaringstiden er ikke bekræftet fra officielle kilder. DAO opgives andre steder til op
til 10 dage. Den skal bekræftes, før man stoler på varslet.

## Afgrænsning og cache

`GET /api/platform/tier1/shops/{webshop}/shipments?days=14|30|60[&refresh=1]`

- Serveren validerer virksomheds- og webshopadgang.
- Kun webshoppens egen gemte Shopify-forbindelse bruges.
- Resultatet caches i `finance_state` under nøglen `shipments:v1:` i 5 minutter pr.
  virksomhed, webshop og periode, med samme lås som Performance.
- Opdatér henter igen, dog højst én gang i minuttet.
- Der hentes højst 300 ordrer pr. kald, og siden siger til, når grænsen nås.
- Historikstarten under Indstillinger respekteres.

Demokontoen viser fiktive forsendelser og kalder ikke Shopify.

## Test

- `lib/platform-shipments.test.mjs`: genkendelse af fragtfirma og pakkeshop, trin og datoer,
  annullerede afsendelser, usikre links og fristberegning.
- `lib/platform-admin.test.mjs`:
  - adgang mellem to virksomheder og to webshops med samme Shopify-ordre-ID
  - læserbegrænsning, cache og 400/405/409-svar
  - at der ikke skrives ordrer eller kvitteringer
  - demokontoen
- Browserkontrol på desktop og mobil med demodata.

## Næste skridt

1. CI og gennemgang.
2. Udgivelse til dev og kontrol mod en rigtig butik med fragtapp:
   - at hændelser og trackinglinks faktisk kommer igennem
   - at fragtmetodens navn genkendes som pakkeshop
3. Bekræft opbevaringstiderne pr. fragtfirma.
