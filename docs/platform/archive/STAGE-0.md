# Etape 0 – etablering og lokal revision

Kontrolleret 12. september 2026. Status: lokal klon og opgavegrundlag etableret; platform, testmiljø og GitHub Projects er ikke oprettet i drift.

## Arbejdsmappe

Den rigtige klon ligger i `work/platform` under det oprindelige snapshot:
`C:/Users/rj/Documents/Codex/2026-09-07/je/work/WebshopToolbox/work/platform`.
Brug denne mappe som arbejdsmappe for efterfølgende platformopgaver. Mappen to niveauer ovenfor er fortsat snapshot og skal ikke bruges til platformbuild eller branches.

- Oprettet med `git clone https://github.com/Jopppardk/WebshopToolbox.git`.
- Branch: `platform/stage-0`, baseret på `9a76239477ae03e7e5504f537e52a24277198ab4`.
- `git ls-remote` bekræftede samme HEAD/main som ved PR 55. Dette er GitHub-status, ikke en ny verifikation af live deployment.
- Åben PR ved kontrol: [#31 – Emballage: forbind entydige kg-felter automatisk](https://github.com/Jopppardk/WebshopToolbox/pull/31). Den indgår ikke i platformarbejdet.
- Ingen push, merge, workflow-dispatch, deploy eller ændring af produktionsressourcer er udført.
- Branchens ændringer er udelukkende AGENTS.md og platformdokumentation. Runtime, workflows og produktionskonfiguration er uændrede.

## Bevarelse og sammenligning

Snapshot er bevaret. Før dokumentationsopdateringer er de oprindelige instruktioner og platformdokumenter desuden kopieret til `work/stage-0-preservation` i snapshot-mappen. Her ligger også `tracked-file-comparison.json` med SHA-256 for snapshot og klon samt `snapshot-extra-files.txt`. Sikkerhedskopier og testlogs er lokale og skal ikke committes.

Alle 293 sporede filer i GitHub-klonen er sammenholdt med snapshot:

| Klassifikation | Antal | Håndtering |
| --- | ---: | --- |
| Byte-identiske | 14 | GitHub-version anvendes |
| Kun CRLF/LF | 141 | GitHub-version anvendes |
| Kun linjeslutninger/afsluttende whitespace | 132 | GitHub-version anvendes |
| Indholdsforskelle | 3 | Bevaret separat; ikke overført |
| Mangler i snapshot | 3 | Findes i klonen fra GitHub |

Indholdsforskellene er gennemgået:

- `lib/emballage-reporting.ts`: automatisk feltmapping og ændret fejltekst fra stoppet arbejde.
- `lib/emballage-reporting.test.mjs`: ekstra test af automatisk feltmapping.
- `lib/viabill.test.mjs`: tre ekstra tests af tomme udbetalingssvar, pagination/idempotens og ugyldige svar/blandede valutaer. Kan vurderes i en særskilt ViaBill-opgave.

De tre filer er bevaret både i snapshot og under `work/stage-0-preservation/local-files/lib`. Sikkerhedskopien omfatter også de øvrige byteafvigende tekstfiler før klassifikation. De manglende filer er `public/favicon.png`, `public/og.png` og `public/sablen-logo.webp`.

Lokale ekstra filer omfatter platformdokumentation, AGENTS.md, testlogs, TypeScript-genererede filer og PDF/PNG-eksempler i `tmp/pdfs`. Dependencies, buildoutput og lokale Wrangler-data bliver i snapshot. Kun AGENTS.md og de tre oprindelige platformdokumenter er kopieret til klonen før udarbejdelse af de nye dokumenter.

## Opgavegrundlag og næste skridt

- [BACKLOG.md](BACKLOG.md) er den lokale opgavetavle med afhængigheder og acceptkrav; GitHub Issues/Projects er endnu ikke oprettet.
- [DATA-MODEL.md](../DATA-MODEL.md) er et forslag, ikke en implementeret migration.
- [TEST-ENVIRONMENT.md](TEST-ENVIRONMENT.md) beskriver et foreslået isoleret miljø og betingelserne for at aktivere det.
- Næste udviklingsleverance er P01/P02: beslut model og kortlæg isolation. Miljø og skriveblokering skal være på plads før eksterne integrationstests.

## Validering

`git fsck --full` er bestået. Klonen var ren før dokumentoverførsel. Afsluttende hashkontrol bekræfter alle oprindelige sporede snapshotfiler uændret samt intakte kopier af de tre kodeafvigelser. 261 tests, build, typecheck og lokal Worker dry-run er bestået. Kontrollerne brugte Node 26.5.1 og snapshotets eksisterende dependencies; frisk installation og Linux-CI udestår. Se HANDOVER.md for detaljer og begrænsninger.

Autoriteten for CI er `.github/workflows/check.yml` og `deploy.yml`: `npm ci`, `npm test`, `npm run build`, derefter `npm run typecheck`; PR-workflow inkluderer også `npx wrangler deploy --config wrangler.direct.jsonc --dry-run`. Linux-CI anvender Node 22.23.2. Ingen fjern-CI er startet i denne opgave. Main-push og manuel kørsel af deploy-workflow kan deploye Sablen, også når ændringen kun er dokumentation; denne branch må derfor ikke merges som led i etape 0.
