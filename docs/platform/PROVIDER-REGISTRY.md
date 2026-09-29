# Integrationsregister

Status 29. september 2026: implementeret og testet lokalt. Migration 0030 er **ikke** anvendt på dev eller prod.

## Formål

Hvilke integrationer der findes, og hvad de understøtter, står ét sted: `platform/catalog.ts`. Databasen har ikke længere faste udbyderlister, så en ny integration kræver ingen migration.

Hver post i `catalog` angiver:

- `kind`: `payment` routes til `handlePayments` og gemmes i `payment_connections`/`payment_records`.
- `optional`: virksomheden tilvælger selv integrationen (Shopify og Dinero er altid tilgængelige).
- `history`: integrationen har egen historikstart.
- `booking`: integrationen har bogføringsstart og kan afstemmes mod Dinero.

Serveren udleder `optionalIntegrations`, `paymentProviders`, `historyProviders`, `bookingSources` og `paymentProviderPattern` af registeret. Ukendte udbydere afvises fortsat af API'et.

## Ny integration

1. Tilføj posten i `platform/catalog.ts` (id: kun små bogstaver).
2. Byg adapteren. For betalingsudbydere tilføjes id'et også til `adapters` i `platform/payments.ts`; indtil da svarer ruten 501.
3. Tilføj Tier 1-visningen (forbindelse, guide, data).
4. Kun hvis integrationen gemmer en helt ny slags data, kræves en ny tabel og dermed en migration.

## Migration 0030 – `0030_open_provider_lists.sql`

Genopbygger `payment_connections`, `payment_records`, `company_integrations`, `integration_history` og `booking_start_dates` uden udbyderlister. Kolonner, nøgler, fremmednøgler, indeks, triggere og data er uændrede. Navne skal fortsat være små bogstaver (`GLOB '[a-z]*'`, højst 40 tegn).

`payment_records` genopbygges sammen med `payment_connections`, fordi D1 ellers afviser migrationen: udskudte fremmednøglebrud fra den droppede forældretabel ryddes ikke af en omdøbning. En fejlet migration rulles helt tilbage af D1.

Lokal prøve på kopi med data i alle tabeller: rækketal uændrede, 0 fremmednøglebrud, triggere og indeks genskabt, ny udbyder kan gemmes, ugyldigt navn og post uden forbindelse afvises.

### Kørsel på dev og prod (kræver brugerens godkendelse)

1. Udgiv først koden fra PR'en; den virker både før og efter migrationen.
2. Notér et gendannelsespunkt: `npx wrangler d1 time-travel info <database>` (Cloudflare Time Travel).
3. Kør `npx wrangler d1 migrations apply PLATFORM_DB --remote --config <wrangler-konfiguration>` med en nøgle, der har D1-adgang.
4. Kontrollér rækketal før/efter og `PRAGMA foreign_key_check`.
5. Ved fejl: `npx wrangler d1 time-travel restore <database> --timestamp=<gendannelsespunkt>`.
