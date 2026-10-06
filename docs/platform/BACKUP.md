# Backup, gendannelse og overvågning

Kort driftsvejledning for prod (`webshop-toolbox-platform-production`). Dev følger samme fremgangsmåde med `wrangler.platform-test.json`.

## Hvad der findes

| Data | Sikring | Begrænsning |
|---|---|---|
| D1 (alle tabeller) | Cloudflare D1 Time Travel: gendannelse til et vilkårligt tidspunkt inden for de seneste 30 dage. Migreringsworkflowet logger et gendannelsespunkt (bookmark) før hver migration. | Gendannelse gælder **hele databasen**, altså alle kunder på én gang. |
| R2 (faktura- og kreditnota-PDF'er, logoer, udbetalingsrapporter) | Ingen. R2 har hverken versionering eller snapshots. | En slettet eller overskrevet fil kan ikke hentes tilbage. Platformen sletter ikke dokumenter; kun demo-nulstillingen rydder demoens egne. |
| Secrets | Lokal, ignoreret backup (se PRODUCTION.md). | Må aldrig vises eller committes. |

## Gendan hele databasen

Kun efter aftale, fordi det ruller alle kunder tilbage.

1. Find tidspunktet eller bookmarket: `npx wrangler d1 time-travel info webshop-toolbox-platform-production --timestamp=<ISO-tid> --config wrangler.platform-production.json`.
2. Gem den nuværende tilstand først: `npx wrangler d1 export webshop-toolbox-platform-production --remote --output=.wrangler/prod-before-restore-<dato>.sql --config wrangler.platform-production.json`.
3. Gendan: `npx wrangler d1 time-travel restore webshop-toolbox-platform-production --bookmark=<bookmark> --config wrangler.platform-production.json`. Kommandoen udskriver et nyt bookmark, der kan bruges til at fortryde gendannelsen.
4. Kontrollér portalen, og kør migreringsworkflowet i `status`-tilstand. Det viser rækketal og fremmednøglebrud.

## Gendan én kundes data

D1 kan ikke gendanne én virksomhed direkte. Fremgangsmåde:

1. Eksportér den nuværende database (trin 2 ovenfor).
2. Gendan hele databasen til tidspunktet før fejlen.
3. Eksportér kundens rækker (`WHERE company_id='<id>'`) fra de berørte tabeller.
4. Gendan tilbage til den nuværende tilstand med bookmarket fra trin 2's gendannelse.
5. Indsæt kundens rækker i en transaktion efter kontrol.

Bogføringen i Dinero påvirkes ikke af en gendannelse. Kvitteringer i `production_receipts` er værnet mod dobbelt bogføring, så gendan aldrig til et tidspunkt før bogføringer, der er sket i Dinero, uden at afstemme dem bagefter.

## Overvågning

- Der kommer en straks-mail til de aktive platformadministratorer, når en webshops kørsel er mere end 30 minutter forsinket, når en import eller kø er fejlet 3 gange i træk, eller når de automatiske kørsler har fejlet i 30 minutter. Der kommer også en mail, når problemet er løst.
- Hver morgen kl. 7 kommer en daglig driftsmail. **Udebliver den, kører cron ikke.**
- Tier 0 → Indsigt → Driftsoverblik viser samme status på tværs af kunder.
- `GET https://portal.webshoptoolbox.dk/healthz/scheduler` svarer 200, når den seneste gennemførte kørsel er højst 30 minutter gammel, og ellers 503. Det kan bruges af en ekstern oppetidsovervågning (f.eks. UptimeRobot), som fanger, at cron er gået helt i stå. Endpointet viser ingen kundedata.

## Åbne punkter

- Gennemfør en øvelse i at gendanne én kunde på **dev** én gang i kvartalet, og notér resultatet i HANDOVER.md.
- R2: overvej en natlig kopi af dokumentbucketten til en separat backup-bucket. Det kræver en ny bucket og et nyt workflow og aftales først.
- Opsæt en ekstern overvågning af `/healthz/scheduler`. Det gøres af platformens ejer.
