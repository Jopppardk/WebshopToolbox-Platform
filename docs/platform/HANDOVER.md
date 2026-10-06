# Overlevering

Aktuel status på én side. Læs den før hver opgave. Historikken står i [CHANGELOG.md](CHANGELOG.md), planen i [ROADMAP.md](ROADMAP.md) og arbejdsreglerne i [AGENTS.md](../../AGENTS.md). Opdatér denne side, når status eller åbne punkter ændrer sig. Skriv selve ændringen som en note øverst i CHANGELOG.md.

_Senest opdateret 6. oktober 2026._

## Miljøer

| | Prod | Dev |
|---|---|---|
| Adresse | https://portal.webshoptoolbox.dk (Tier 1). Tier 0 under `/admin/` bag Cloudflare Access | https://dev.webshoptoolbox.dk |
| Bogføring i Dinero og kundemail | Aktiveret | Blokeret |
| Automatiske kørsler (cron) | Hvert 5. minut | Ingen |
| Selvbetjent tilmelding | Slået fra | Slået til, kun for godkendte modtagere |
| Database | D1 `webshop-toolbox-platform-production` | D1 `webshop-toolbox-platform-test` |

Lokalt: `npm run platform:init`, `npm run platform:seed` og `npm run platform:dev` (port 8790, syntetiske data).

## Fra ændring til drift

1. Branch fra en frisk main, og opret en lille PR.
2. CI skal være grøn: tests, begge typechecks, `npm run lint` (lint og formatering må kun blive bedre), Tier 1-build og portalens browsertest.
3. Squash-merge.
4. Er der en migration, køres den først med workflowet *Vedligehold: D1-migrering* (dev, derefter prod). Seneste migration er `0045_ops_monitor.sql`.
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
- Tests: `lib/platform-*.test.mjs`, der deler `lib/platform-harness.mjs`. Browsertest i `tests/portal`.

## Drift

- Straks-mail til de aktive platformadministratorer, når en webshop er over 30 minutter forsinket, en import eller kø fejler 3 gange i træk, eller cron har fejlet i 30 minutter. Der kommer også en mail, når problemet er løst.
- Daglig driftsmail kl. 7.
- Tier 0 → Indsigt → Driftsoverblik.
- `GET /healthz/scheduler` svarer 200 eller 503.
- Backup og gendannelse: [BACKUP.md](BACKUP.md).

## Åbne punkter

**Ikke verificeret i drift**
- **Shipmondo-labels fra Salg:** ikke afprøvet mod en rigtig konto. Den første rigtige ordre er testen (aftalt).
- **Daglig driftsmail:** modtagelsen er ikke bekræftet.

**Mangler**
- **Ekstern overvågning:** `/healthz/scheduler` overvåges ikke eksternt endnu (ejerens opgave).
- **Backup:** gendannelsen er ikke øvet, og R2-dokumenterne har ingen backup.

**Kendt teknisk gæld**
- **Tier 1-JavaScript:** én fil på 1 MB, sendt med `no-store`, så den hentes ved hver indlæsning.
- **Kodekvalitet:** 467 lint-fund og 203 uformaterede filer, låst af `npm run lint`. Store filer formateres én ad gangen i separate PR'er.

**Før lancering** (tilmeldingen er slået fra)
- Sletning og eksport af en kundes data (GDPR)
- "Kom godt i gang"-tjekliste
- Abonnement og betaling
