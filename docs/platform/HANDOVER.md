# Overlevering

## Opdatering fra etape 0 – 12. september 2026

- Arbejd fremover i den rigtige klon `C:/Users/rj/Documents/Codex/2026-09-07/je/work/WebshopToolbox/work/platform`, branch `platform/stage-0`. Den oprindelige hovedmappe er bevaret som snapshot.
- GitHub HEAD/main er igen verificeret som `9a76239477ae03e7e5504f537e52a24277198ab4`; ingen ny liveverifikation af produktionen. PR #31 om emballagemapping står åben og indgår ikke her.
- Alle 293 sporede filer er sammenlignet. Kun emballagekode, emballagetest og ViaBill-test har indholdsforskelle; de er bevaret separat og ikke overført. Se STAGE-0.md og den lokale hashoversigt i `work/stage-0-preservation` under snapshot.
- Kun AGENTS.md og platformdokumentation er ændret i klonen. Ingen push, merge, deploy, eksterne bogføringer eller produktionsændringer.
- BACKLOG.md klargør P00–P11. DATA-MODEL.md og TEST-ENVIRONMENT.md er forslag; database, adgangsmodel, miljø, migrationer og GitHub-tavle er ikke implementeret/oprettet.
- Næste opgave: P01/P02, derefter P03/P04 før eksterne integrationstests. Platformsændringer må ikke merges til main før en udgivelsesstrategi forhindrer utilsigtet Sablen-deploy.

### Lokal validering

- `git fsck --full`: bestået.
- `node --test lib/*.test.mjs`: 261 bestået, 0 fejlet, 0 sprunget over, inklusive ViaBill Workerd-test. Første forsøg blev blokeret af sandboxens procesbegrænsning; genkørsel uden denne begrænsning bestod.
- Lokal runtime: Node 26.5.1, med eksisterende dependencies fra snapshot-mappens node_modules; ikke en frisk `npm ci` eller Linux-CI-verifikation. Resultater gælder den uændrede GitHub-kode i klonen, ikke de tilbageholdte lokale kodeændringer.
- `npm run build` og `npm run typecheck`: bestået. Build krævede genkørsel uden sandboxens procesblokering og gav tooling-/Node-advarsler, men ingen buildfejl.
- `wrangler deploy --config wrangler.direct.jsonc --dry-run`: bestået efter samme procesbegrænsning blev fjernet. Dette validerede den uændrede eksisterende Worker-pakke lokalt; det var hverken deployment eller afprøvning af et nyt testmiljø. Metrics var slået fra.
- Afsluttende SHA-256-kontrol: 0 ændringer i snapshotets oprindelige GitHub-sporede filer og 0 fejl i sikkerhedskopierne af de tre kodeafvigelser. Kun snapshotets AGENTS.md/platformdokumenter har fået henvisninger til klonen; originalerne er sikkerhedskopieret.
- Fjern-CI er ikke startet; obligatoriske PR-kontroller står i `.github/workflows/check.yml`. Produktion er ikke berørt.

## Oprindelig samtale
Oprindelig Codex-opgave: “Udviklingschat - integrationsløsning v2”, ID 01a07d1b-ca3c-7392-9b33-92080628dd91. Den fulde samtale er ikke kopieret eller flyttet af disse dokumenter. Dokumenterne sammenfatter arbejdet og platformplanen.

## Produktionsstatus fra seneste verificerede arbejde
- PR 54: Flatpay-knappen henter uden manuelt datovalg og bruger automatikkens afgrænsede historik-/nutidsvinduer uden at ændre dens fremdrift. Kommende udbetalinger medtages.
- PR 55: Advarsler/alarmer, separate mailvalg og automatisk lukning af entydigt refererede beskeder efter bekræftet bogføring. Kun udvalgte sikre Flatpay-fejl før ekstern oprettelse klassificeres som advarsler. Øvrige fejl er konservativt alarmer; dette er ikke en fuld klassifikation af alle integrationers genforsøg.
- Flatpay-udbetaling 48132375: første forsøg timeout, derefter afregningsdifference, til sidst bekræftet bogføring 11.09.2026 kl. 10.41.18. Brutto 1.279,00 DKK, gebyr 15,86, netto 1.263,14. Bruger viste godkendt Dinero-bilag 977. Må ikke genoprettes.
- Automatikken blev senest verificeret med fem minutters interval. Liveindstillinger kan siden være ændret.

## Kendte udeståender
- ViaBill er i udviklingsoversigten markeret I produktion, men den senest gennemgåede kode mangler automatisk import, bogføring og udbetalingsrapport. Brugeren har tidligere ønsket disse funktioner. Verificér aktuel kode og færdiggør særskilt; antag ikke at statusfeltet dokumenterer implementering.
- Udviklingsoversigt #5 Salgsanalyse-side var eneste åbne forslag ved seneste læsning. Øvrige ni stod I produktion; deres status er ikke en fuld revision.
- Lokale ændringer i lib/emballage-reporting.ts og tilhørende test kommer fra arbejde, brugeren stoppede. De må ikke utilsigtet udgives.
- lib/viabill.test.mjs har lokale ekstra tests, som ikke nødvendigvis er på GitHub. Gennemgå forskelle før overførsel til rigtig Git-klon.

## Kode og drift
Next/React/TypeScript, Cloudflare Worker, D1 og R2. GitHub Actions tester, bygger og deployer ved push/merge til main. Main er derfor ikke en sikker byggeplads for platformsarbejdet uden først at adskille udgivelsesforløbet.

Relevante steder: middleware.ts (adgang), db/schema.ts, db/credentials.ts, worker-entry.ts (scheduler), db/*-automation.ts, db/*-transfer.ts, db/payout-events.ts, db/errors.ts og db/incident-recovery.ts.

## Validering
Brug package.json og workflows som autoritet for aktuelle kommandoer. npm run typecheck og relevante node-tests køres lokalt. Linux-CI kører fulde tests og build. viabill-worker.test.mjs har tidligere haft Windows-runtimeproblemer; undlad ikke testen i CI. Finansielle tests skal bruge fixtures og må ikke genbogføre produktionsbilag.

## Arbejdsform
Svar på dansk og hold statusopdateringer forståelige. Brugeren foretrækker selvstændig fremdrift, men samtalen om et projekt er ikke en beslutning om at flytte Sablen til den nye platform nu. Hold produktion og test adskilt, og gem beslutninger i dokumenterne. Ingen adgangsnøgler eller passwords i dokumentation.
