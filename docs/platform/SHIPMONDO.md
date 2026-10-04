# Shipmondo – tracking

4. oktober 2026. Udgivet til dev og prod fra PR #86, SHA `1a509aad68f8bc2a96e3cb554820c6d1e0a53ac5`.

## Leverance

Shipmondo tilføjes fra integrationsbiblioteket. Virksomhedsadministratoren forbinder
hver webshop med API-bruger/API-nøgle og vælger live eller sandbox. Testen udfører
kun `GET /api/public/v3/shipments?per_page=1&page=1`. Ingen labels eller forsendelser
oprettes, og intet sendes til modtagere. Credentials krypteres med eksisterende
AES-GCM og miljø-/virksomheds-/webshopafgrænsning.

Forsendelsers eksisterende Shopify-data suppleres med Shipmondos Shipment Monitor.
Tilslutningsformularen viser webhook-URL og en særskilt nøgle samt trinvis vejledning:
opret webhook i Shipmondo, vælg Shipment Monitor og handling `latest`, indsæt URL og
nøgle og aktivér. API-kontrol og første modtagne trackinghændelse vises separat.
Webhook-oprettelsen sker manuelt i Shipmondo; portalen ændrer ingen abonnementer der.

Shipmondos dokumentation beskriver Shipment Monitor som dagligt opdateret. Almindelige
GET shipments-svar indeholder ikke scanhistorik. Derfor loves ingen realtid eller
bagudrettet import af tracking. Shopify-data bevares, når der ikke er et entydigt match.

## Sikkerhed og data

- Migration 0039 opretter `shipping_connections` og `shipping_events`; ingen eksisterende
  økonomiske tabeller ændres. Skal anvendes før udgivelse, også fordi kataloget læser forbindelser.
- Webhook er offentlig POST, men kræver HS256-signatur med den pågældende webshops
  krypterede nøgle og korrekt destination i det signerede payload. Den accepterer også
  Shipmondos JSON-streng i JWT-payload. Ingen tillid til usignerede SMD-headere.
- Aktiv virksomhed/webshop kræves; demokonto afvises. Payload er højst 16 KB.
- Kun tracking-ID, Shipmondo-ID, fragtfirma, status, statustekst og tidspunkt gemmes;
  ikke modtageradresse, credentials eller hele providerpayloadet.
- Gentagne hændelser deduplikeres efter normaliseret indhold. Hændelser sorteres efter
  providerens tidspunkt, så forsinket levering ikke erstatter nyere status.
- Visning matcher både trackingnummer og fragtfirma samt tidspunkt efter Shopify-afsendelse.
  Ordrenumre bruges aldrig som kobling. Flere Shipmondo-forsendelses-ID'er på samme
  nummer er tvetydige og beriger ikke rækken. Kendte carrieraliases: post_nord/pdk → postnord.
- Første udgave beriger de eksisterende trackingnumre, Shopify-siden viser, for GLS,
  DAO, PostNord og Bring. Andre fragtfirmaer beholder Shopify-visningen.
- Kun den dokumenterede slutstatus DELIVERED afslutter tidslinjen. Øvrige statusser
  vises med Shipmondos tekst, rå status og tidspunkt uden gættet statusoversættelse.
  Afhentningsfristen er fortsat et estimat fra Shopify-tidspunkt og fragtfirma.
- API-oplysninger returneres aldrig. Webhook-nøglen kan kun læses af virksomhedens
  administrator; supportimpersonering og Tier 0 får ikke adgang til den.
- Udskiftning af credentials roterer webhook-URL/nøgle og rydder gammel lokal tracking
  atomisk. Opdatér webhooken i Shipmondo bagefter. Afbrydelse tilbagekalder endpointet.
- Forsendelser beriges efter Shopify-cachen, så nye webhooks vises uden ny Shopify-import.
  Maksimalt 5.000 hændelser i visningsperioden; en begrænsning vises i brugerfladen.

## Verifikation og udgivelse

Syntetiske tests dækker kryptering, roller, tenant-/webshopisolation med overlappende
trackingnumre, fejlede API-oplysninger, revisionskontrol, JWT-signatur/algoritme/destination,
ugyldige datoer, dubletter, tvetydige trackingnumre, ukendt status og tilbagekaldt webhook.
Verificeret lokalt: 445/445 tests, begge typechecks, Tier 1- og hovedbuild,
konfigurationskontroller samt de tre obligatoriske deployment-dry-runs er bestået.
GitHub CI og releasekørsel [37185020870](https://github.com/Jopppardk/WebshopToolbox-Platform/actions/runs/37185020870) er bestået, inklusive begge HTTP-gates. Ingen rigtige Shipmondo-nøgler eller forsendelser er brugt.

Migration 0039 er anvendt på begge D1-databaser efter syntetisk kopiprøve med alle 57 eksisterende tabeller bevaret og ingen FK-fejl. Remote FK-kontrol var også uden fejl. Gendannelsesbogmærker før migration:

- Dev: `00000083-00000002-000050fa-f54e35656fa03b3bf1769c385ad367a7`
- Prod: `0000066d-0000003a-000050fa-f1778b4ac2f4edee0800836b96735f01`

Worker-versioner:

- Dev: `b4758d8a-c29e-4aa9-a5b7-e9adddf3c1a7`
- Prod: `b50ff209-c4a1-45b6-a6d5-ee2dc2a58857`

Efterkontrol: healthz og login 200, ordre-API 401 anonymt og admin viderestillet til Access. Dev har fortsat blokeret bogføring/kundemail; prod bevarer eksisterende aktivering. Ingen økonomiske testwrites.

Før godkendelse af faktisk tracking: tilslut en separat testkonto på dev og opret webhook. Kontrollér Shipmondos faktiske webhook-format,
testlevering og svartid under tre sekunder. Kontoens trackingabonnement og transportørens
dækning skal kontrolleres med en faktisk pakke. End-to-end live og visuel kontrol udestår.

## Senere forsendelsesoprettelse

Tilføj separat write-adapter med godkendt pris, carrier/product/service-valg, labels,
holdbar idempotens og afklaring af usikre resultater. Trackingmodulet har bevidst ingen
POST shipments-kode. Eksisterende krypterede konto og adskilte provider-modul kan genbruges.

## Kilder

- https://shipmondo.dev/api-reference/ – OpenAPI fra https://app.shipmondo.com/api/public/v3/elements.json
- https://shipmondo.dev/docs/api/auth/
- https://shipmondo.dev/docs/api/rate-limit/
- https://shipmondo.dev/docs/webhooks/requirements-and-structure/
- https://shipmondo.dev/docs/webhooks/resources-and-actions/
- https://shipmondo.dev/docs/sandbox/
