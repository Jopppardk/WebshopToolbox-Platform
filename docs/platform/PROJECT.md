# WebshopToolbox – platformen

WebshopToolbox automatiserer bogføring og administration for webshops. Det omfatter:
- import af Shopify-ordrer, tilbagebetalinger og udbetalinger
- bogføring i Dinero
- fakturaer og kreditnotaer pr. marked med mail til kunden
- betalingsudbydere (Shopify Payments, Flatpay, ViaBill og Pensopay)
- forsendelser og labels via Shipmondo
- produktfeeds
- emballageindberetning
- lager og performance

Den oprindelige Sablen-løsning er lukket ned. Platformen er nu den eneste kørende løsning. Den gamle kode findes i git-historikken før 6. oktober 2026.

## Opbygning

- **Cloudflare Workers.** Én Worker pr. miljø (`platform/worker.ts`), der svarer på HTTP og kører cron.
- **Data.** D1 til databasen og R2 til dokumenter (PDF'er, logoer og rapporter).
- **Tier 0.** Platformejerens administration (`/admin/`, bag Cloudflare Access).
- **Tier 1.** Kundeportalen (React i `platform/tier1/src`) med kundens eget login.
- **Afgrænsning.** En virksomhed har én regnskabsforbindelse og kan have flere webshops. Serveren kontrollerer altid brugerens adgang til virksomhed og webshop. Et tenant-ID fra klienten stoles der aldrig på. Data, adgangsoplysninger, dokumenter, låse og logs er afgrænset pr. virksomhed og webshop.
- **Krypterede nøgler.** Adgangsoplysninger til eksterne tjenester gemmes krypteret.
- **Beskyttelse mod dobbelt bogføring.** Varige kvitteringer i `production_receipts`.

## Dokumenter

**Start her**
- [HANDOVER.md](HANDOVER.md): aktuel status, miljøer og åbne punkter.
- [ROADMAP.md](ROADMAP.md): planen.
- [CHANGELOG.md](CHANGELOG.md): historikken, nyeste først.

**Drift og udgivelse**
- [PRODUCTION.md](PRODUCTION.md): produktionsmiljøet.
- [BACKUP.md](BACKUP.md): backup, gendannelse og overvågning.
- [CODEX-CLOUD-DEPLOY.md](CODEX-CLOUD-DEPLOY.md): udgivelse fra Codex Cloud.
- [DOMAINS.md](DOMAINS.md) og [ADMIN-DOMAIN.md](ADMIN-DOMAIN.md): domæner.
- [STATUS-DISPLAY.md](STATUS-DISPLAY.md): statusvisning.

**Adgang og brugere**
- [ADR-001.md](ADR-001.md): grundlæggende beslutninger.
- [ADMIN-FOUNDATION.md](ADMIN-FOUNDATION.md): administration.
- [DATA-MODEL.md](DATA-MODEL.md): datamodel.
- [CUSTOMER-LOGIN.md](CUSTOMER-LOGIN.md): kundelogin.
- [INVITATIONS.md](INVITATIONS.md): invitationer.
- [SUPPORT-ACCESS.md](SUPPORT-ACCESS.md): supportadgang.
- [PUBLIC-SIGNUP.md](PUBLIC-SIGNUP.md): selvbetjent tilmelding.
- [TIER1-WEBSHOPS.md](TIER1-WEBSHOPS.md): webshops i Tier 1.
- [CUSTOMER-PORTAL.md](CUSTOMER-PORTAL.md): kundeportalen.

**Funktioner**
- [BOOKING-ONBOARDING.md](BOOKING-ONBOARDING.md): bogføringsopstart.
- [INVOICE-MIGRATION.md](INVOICE-MIGRATION.md): fakturaer.
- [MAIL-SENDERS.md](MAIL-SENDERS.md): mailafsendere.
- [ORDER-REFRESH.md](ORDER-REFRESH.md): genhentning af ordrer.
- [RECORD-HISTORY.md](RECORD-HISTORY.md): posthistorik.
- [PRODUCT-FEEDS.md](PRODUCT-FEEDS.md): produktfeeds.
- [PERFORMANCE.md](PERFORMANCE.md): performance.
- [SHIPMENTS.md](SHIPMENTS.md): forsendelser.
- [SHIPMONDO.md](SHIPMONDO.md): Shipmondo.
- [PUBLIC-TRACKING.md](PUBLIC-TRACKING.md): offentlig tracking.

**Integrationer**
- [INTEGRATION-STORE.md](INTEGRATION-STORE.md): integrationsbutikken.
- [INTEGRATION-GUIDES.md](INTEGRATION-GUIDES.md): opsætningsguides.
- [PROVIDER-REGISTRY.md](PROVIDER-REGISTRY.md): udbydere.

**Andet**
- [WEBSITE.md](WEBSITE.md): hjemmesiden.

**Historik**
- [archive/](archive/): forældede, daterede dokumenter og tidligere udgaver af PROJECT og ROADMAP. De gælder ikke længere.

## Åbne beslutninger

- Opbevaring og sletning af data pr. virksomhed (GDPR), og hvor længe rå kildedata gemmes.
- Abonnementsmodel og betaling, før tilmeldingen åbnes.
- Backup af R2-dokumenter.
