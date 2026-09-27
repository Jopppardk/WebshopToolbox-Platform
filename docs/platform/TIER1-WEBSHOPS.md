# Tier 1 – webshopopsætning

> Beslutning 21. september 2026: Webshopoprettelse, metadata og forbindelsesopsætning hører udelukkende til virksomhedens administrator i Tier 1. Tier 0 viser webshops uden opret-/opsætnings-/redigeringsknapper. Begrænsningen håndhæves i API’et, også ved impersonering. Virksomheder og brugerinvitationer kan fortsat administreres i Tier 0.

Beslutning 13. september 2026: Tier 0 betyder ejerens administrationsportal. Tier 1 betyder kundens portal. Virksomhedsbrugeren tilhører fortsat kun én virksomhed.

## Implementeret
Tier 1 / Integrationer viser Webshop med Tilføj webshop. Dropdown starter med Vælg webshopplatform; Shopify viser navn, offentlig webadresse, myshopify.com-domæne, Client ID og Client secret. Flere webshops kan oprettes. Den separate provider-kolonne og opsætning pr. webshop gør det muligt senere at tilføje andre platforme; kun Shopify accepteres i denne version. Tidligere webshops bevares uden automatisk tildeling af platform og kan få Opsætning udfyldt.

Nederste sektioner er Indløsere og betalingsgateways (Flatpay/ViaBill) og Øvrige Integrationer (Emballage Indberetning). Ét regnskabsprogram pr. virksomhed bevares.

Migration 0007: webshop_connections med composite FK til virksomhed/webshop, provider, shop_domain og krypteret credential-payload. UI/API læser kun provider, shop_domain og credentials_saved. Secrets sendes aldrig tilbage eller til audit. AES-256-GCM bruger tilfældig IV og binder payload til miljø, virksomhed, webshop, provider og Shopify-domæne. PLATFORM_CREDENTIALS_KEY er en separat Worker-secret til test; lokal test har egen nøgle. Nøglerne er ikke i Git. Remote nøgle-backup findes i ignoreret .wrangler/platform-credentials-key.json; den må ikke overskrives/roteres uden migrering af krypterede data. Driftssikker ekstern key-backup/rotation skal etableres før produktion.

Oprettelse af webshop, credentials og audit er atomisk. Ændring af credentials kræver virksomhedsadministrator eller Tier 0 og er blokeret under impersonering. Gemte credentials kan kun erstattes med et nyt komplet sæt. Formularens felter ryddes ved lukning. Intet kald til Shopify udføres; status er Opsætning gemt – afventer tilslutning. Provideradapter, OAuth, tokenfornyelse og import er planlagt, ikke implementeret her.

Shopifys client-credentials-flow kræver app og butik i samme Shopify-organisation. En fælles app på tværs af uafhængige kunder kræver det relevante OAuth-installationsflow; disse felter må ikke opfattes som en færdig generel Shopify-autorisation.
Kilde: https://shopify.dev/docs/apps/build/authentication-authorization/client-credentials-grant

## Test og drift
292 tests (31 platformtests), build, typecheck, begge Wrangler-dry-runs og JS-syntakskontrol bestået. Nye tests dækker kryptering, afvisning ved ændret miljø/virksomhed/webshop/domæne, ingen secrets i svar/audit, rettigheder, udskiftning, ugyldige hosts/providers og rollback ved dubletter/manglende nøgle. Migration anvendt lokalt og remote uden seed. Backup før migration: .wrangler/before-webshop-connections.sql.
Ingen nye remote testkonti eller Shopify-credentials oprettet. Ingen Sablen-produktionsændring eller main-merge. Tidligere lokale platformændringer bevaret; ingen commit/push.

Deployet til test som 4e2f35a5-5f63-413b-9a11-522e67e1934e. Browserkontrol i Tier 1 bekræftede sektionernes navne/rækkefølge og at Tilføj webshop først viser dropdown og derefter Shopify-felterne. Formularen blev annulleret uden dataændringer. Ingen rigtige adgangsoplysninger er indtastet eller testet mod Shopify; gemmeforløbet er verificeret med syntetiske data i de automatiske tests.
