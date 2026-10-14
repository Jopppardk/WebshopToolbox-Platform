# Overlevering

Aktuel status på én side. Læs den før hver opgave. Historikken står i [CHANGELOG.md](CHANGELOG.md), planen i [ROADMAP.md](ROADMAP.md) og arbejdsreglerne i [AGENTS.md](../../AGENTS.md). Opdatér denne side, når status eller åbne punkter ændrer sig. Skriv selve ændringen som en note øverst i CHANGELOG.md.

_Senest opdateret 14. oktober 2026._

## Miljøer

| | Prod | Dev |
|---|---|---|
| Adresse | https://portal.webshoptoolbox.dk (Tier 1). Tier 0 under `/admin/` bag Cloudflare Access | https://dev.webshoptoolbox.dk |
| Bogføring i Dinero og kundemail | Aktiveret | Blokeret |
| Automatiske kørsler (cron) | Hvert 5. minut | Ingen |
| Selvbetjent tilmelding | Slået til (genåbnet 11. oktober 2026) | Slået til, kun for godkendte modtagere |
| Database | D1 `webshop-toolbox-platform-production` | D1 `webshop-toolbox-platform-test` |

Lokalt: `npm run platform:init`, `npm run platform:seed` og `npm run platform:dev` (port 8790, syntetiske data).

## Fra ændring til drift

1. Branch fra en frisk main, og opret en lille PR.
2. CI skal være grøn: tests, begge typechecks, `npm run lint` (lint og formatering må kun blive bedre), Tier 1-build og portalens browsertest.
3. Squash-merge.
4. Er der en migration, køres den først med workflowet *Vedligehold: D1-migrering* (dev, derefter prod). Seneste migration er `0050_shop_sync.sql` (kørt på dev og prod 12. oktober 2026).
5. Udgiv: `node scripts/platform-release.mjs dev --sha <sha>`, derefter `prod`. Udgivelsen genbruger den grønne testkørsel for samme commit.
6. Skriv en note i CHANGELOG.md.

## Kode

- `platform/worker.ts`: indgangen (HTTP og cron).
- `platform/production-jobs.ts`: den automatiske kørsel pr. webshop.
- `platform/ops-monitor.ts`: driftsalarmer og driftsoverblik.
- `platform/tier1-*.ts`: kundeportalens API.
- `platform/tier1/src`: kundeportalen (React).
- `platform/public/admin.js`: Tier 0.
- `platform/migrations`: databaseskemaet.
- Tests: `lib/platform-*.test.mjs`, der deler `lib/platform-harness.mjs`. Browsertest af kundeportalen og Tier 0 i `tests/portal` (`npm run test:portal`).

## Drift

- Straks-mail til de aktive platformadministratorer, når en webshop er over 30 minutter forsinket, en import eller kø fejler 3 gange i træk, eller cron har fejlet i 30 minutter. Der kommer også en mail, når problemet er løst.
- Daglig driftsmail kl. 7.
- Tier 0 → Indsigt → Driftsoverblik.
- `GET /healthz/scheduler` svarer 200 eller 503.
- Uventede fejl vises med et fejl-ID ("Fejl-ID: 7f3a1c2e") og logges i Workers Logs: Cloudflare → Workers → platform-Worker → Observability, søg på ID'et.
- Backup og gendannelse: [BACKUP.md](BACKUP.md).

## Åbne punkter

**Ikke verificeret i drift**
- **Ekstern overvågning af den automatiske kørsel:** workflowet *Overvågning: automatisk kørsel i prod* (`.github/workflows/platform-scheduler-watch.yml`, `scripts/scheduler-watch.mjs`) kalder `/healthz/scheduler` hvert 15. minut og fejler, når cron ikke har gennemført en kørsel i 30 minutter, så GitHub mailer den, der senest har ændret workflowets tidsplan. GitHub kan forsinke planlagte kørsler, så alarmen kommer typisk efter 30-45 minutter. Første kørsel og mailen er ikke set.
- **Driftsoverblikkets "venter på nyt forsøg" (udgivet 14. oktober 2026, dev og prod, run 38523869306, main `e4d9081`):** afviste poster, senere bogførte poster og annullerede, fuldt refunderede ordrer, der ikke nåede Dinero, tælles ikke længere med i morgenmailen og Tier 0 → Driftsoverblik.
- **Kø til den automatiske kørsel (udgivet 14. oktober 2026, dev og prod, run 38525600682, main `912e1d9`):** cron sender forfaldne webshops som én besked hver til Cloudflare Queues `webshop-toolbox-platform-production-jobs` (`PLATFORM_JOBS`, `queueDueShops`/`runQueuedShop` i `production-jobs.ts`, `queue` i `worker.ts`; consumer `max_batch_size: 1`, `max_retries: 0`, `max_concurrency: 10`, `limits.cpu_ms: 300000`). Første kørsel via køen er ikke set; følg forsinkelsen i Driftsoverblikket.
- **Dansk dato og 100.000 rækker (udgivet 14. oktober 2026, dev og prod, run 38519352806, main `3b87b07`):** "i dag" er dansk dato overalt (bl.a. lagerreguleringens bilagsdato), lister og Emballage-perioder rummer 100.000 rækker, og den daglige Emballage-hentning læser kun ændrede ordrer. Ikke set med rigtige data over 10.000 rækker.
- **Shipmondo-labels fra Salg:** ikke afprøvet mod en rigtig konto. Den første rigtige ordre er testen (aftalt).
- **Daglig driftsmail:** modtagelsen er ikke bekræftet.
- **Webshopnavn på udbetalingsrapporter og Dinero-linjer (udgivet 11. oktober 2026, dev og prod, run 38143685177, main `c70bc7b`):** "Webshop: {navn}" på rapporten og " · {webshop}" sidst på hver bilagslinje. Ikke afprøvet mod rigtig Dinero.
- **Økonomi pr. webshop og forsendelser på dashboardet (udgivet 11. oktober 2026, dev og prod, run 38149276433, main `42c7229`):** omsætning MTD/YTD mod sidste år fra Shopify Analytics (kræver read_reports) og lagerværdi fra Shopify pr. webshop, samlet kort fra Dinero med overskud, og forsendelseslinje i webshopkortene. Kun afprøvet med testdata.
- **Lager uden read_locations (udgivet 11. oktober 2026, dev og prod, run 38149276433, main `42c7229`):** lokationer vises med Shopifys id uden read_locations, og en anden webshops fejl nævner webshoppen. Ikke afprøvet mod rigtig Shopify.
- **Overblik med flere webshops (udgivet 11. oktober 2026, dev og prod, run 38133154668, main `3f2a9bd`):** webshopvælger, kort pr. webshop på dashboard og Emballage, fælles Emballage-indberetning i oversigten, tydelig fælles/egen faktura og webshopnavn i overskrifter. Kun afprøvet med testdata.
- **Flere webshops (udgivet 10. oktober 2026, dev og prod, run 38064862126, main `15bf3cd`):** faktura og afsender pr. webshop, genbrug af Shipmondo/Emballage med samlet Emballage-indberetning og mellemregningskonti pr. webshop. Kun afprøvet med testdata; ikke mod rigtig afsendelse fra eget domæne, Shipmondo, Emballage Indberetning eller Dinero.

- **Performance: salg pr. dag (udgivet 12. oktober 2026, dev og prod, run 38295423966, main `e2220ba`):** graf med alle dage i måneden mod samme dage sidste år (Shopify `total_sales − taxes`, kræver read_reports), og siden viser webshoppens tal øverst og virksomhedens nederst. Kun afprøvet med testdata.
- **Custom apps pr. virksomhed (udgivet 12. oktober):** menuen "Custom apps" og registrering af en app til præcis én virksomhed i Tier 0. Testappen "Eksempel" findes kun på dev.

- **Webshop-synkronisering (custom app til LA Trading, udgivet 12. oktober):** opretter og synkroniserer valgte produkter og kollektioner fra én webshop til en anden, lager begge veje, udeladt af modtagerens lagerværdi. Mangler: en platformadministrator slår appen til for LA Trading i Tier 0, og modtagerens Shopify-app skal have write_products, write_inventory og read_locations (kilden read_locations). Første rigtige kørsel er ikke set.

**Mangler**
- **Svenske produktnavne på fakturaer:** kræver read_translations i kundens Shopify-app; ellers danske navne.
- **Backup:** gendannelsen er ikke øvet, og R2-dokumenterne har ingen backup.

- **Fakturanumre ved flere webshops:** fakturanummeret er Shopify-ordrenavnet (`#1001` → `1001`, kreditnota `1001-K1`). Besluttet 10. oktober 2026: hver webshop får sit eget ordre-præfiks i Shopify (Indstillinger → Generelt → ordre-ID-format), før den tilsluttes som webshop nr. 2 eller senere. Platformen kontrollerer det ikke.

**Kendt teknisk gæld**
- **Kodekvalitet:** 275 lint-fund (mest `any` og React-compiler), låst af `npm run lint`. Al kode er formateret, og nye ændringer skal være det.

**Mangler efter genåbning** (tilmeldingen blev genåbnet 11. oktober 2026 på brugerens bestilling, før disse var færdige)
- Sletning og eksport af en kundes data (GDPR)
- "Kom godt i gang"-tjekliste
- Abonnement og betaling
