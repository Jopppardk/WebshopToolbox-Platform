# WebshopToolbox Platform

Læs docs/platform/HANDOVER.md (aktuel status, én side) ved nye platformopgaver. Overblik og dokumentliste står i docs/platform/PROJECT.md, planen i docs/platform/ROADMAP.md og historikken i docs/platform/CHANGELOG.md. Hold dokumentationen opdateret, og skeln mellem planlagt, implementeret, testet og sat i drift.

- Arbejd på dansk i dialogen med brugeren.
- Produktionsløsningen til Sablen indeholder rigtige bogføringsdata. Platformsarbejde skal bruge separat testmiljø.
- Serveren skal validere brugerens adgang til virksomhed/webshop. Stol ikke på et tenant-ID alene fra klienten.
- Afgræns data, credentials, dokumenter, låse, logs og dubletkontrol. Test to webshops med overlappende eksterne ID'er.
- Bevar bogføringskvitteringer og beskyttelse mod gentagen oprettelse. Usikre eksterne writes må ikke genforsøges blindt.
- Inden nye ændringer: kontrollér aktuel GitHub-status og lokale afvigelser. Dette er den selvstændige klon af Jopppardk/WebshopToolbox-Platform. Brug denne mappe til nyt platformsarbejde; gamle henvisninger til work/platform i historiske dokumenter gælder det tidligere repository.
- Brug relevante tests samt repositoryets obligatoriske CI-kontroller. Foretag ikke økonomiske testposteringer i produktion.
- Medtag ikke lokale ændringer fra stoppede eller urelaterede opgaver i en udgivelse.

- Origin skal være Jopppardk/WebshopToolbox-Platform. Push aldrig platformændringer til Jopppardk/WebshopToolbox.
- Brug kun scripts/platform.mjs eller scripts/platform-production.mjs til deployment. Den gamle Sablen-app og wrangler.direct.jsonc er fjernet; genskab dem ikke, og deploy aldrig Sablen fra dette repository.
- Push deployer ikke. GitHub-udgivelse kræver manuel workflow_dispatch til valgt miljø.
- Codex Cloud: læs docs/platform/CODEX-CLOUD-DEPLOY.md. Brug scripts/platform-release.mjs til at starte GitHub-workflowet; Cloud skal ikke have Cloudflare-tokens. En prod-bestilling udgiver og efterkontrollerer først dev fra samme godkendte main-SHA. En bestilt kørsel er ikke bevis for gennemført deployment.

## Samarbejde mellem Codex og Claude

Begge assistenter arbejder i samme repository. For at undgå konflikter og overraskelser:

- **Start altid fra en frisk main**: `git pull` før ny opgave, og læs `docs/platform/HANDOVER.md` og de øverste noter i `docs/platform/CHANGELOG.md`. Her står, hvad den anden senest har lavet.
- **Én opgave = én branch = én lille PR.** Arbejd aldrig direkte på main. Flet kun med squash, og kun når CI er grøn på den seneste commit.
- **Kun én assistent ad gangen i de samme filer.** Rører en opgave store delte filer (`platform/tier1-data.ts`, `platform/production-jobs.ts`, `platform/tier1/src/app/page.tsx`, testfilerne), så afslut og flet, før den anden starter i dem. Opstår der alligevel en konflikt, så behold begge sider og kør hele testsuiten.
- **Migreringer**: tjek nummeret på den seneste fil i `platform/migrations` lige før du opretter en ny, kør migreringen på dev og prod via workflowet *før* koden udgives, og nævn den i PR'en og i `CHANGELOG.md` (og seneste migration i `HANDOVER.md`).
- **Skriv en note øverst i `CHANGELOG.md`** for hver udgivet ændring: dato, hvem (Codex/Claude), hvad, filer/endpoints, migrering og hvad der ikke er verificeret. Opdatér `HANDOVER.md` (højst én side), når status eller åbne punkter ændrer sig. Forældede dokumenter flyttes til `docs/platform/archive/`.
- **Linjeskift er altid LF** (`.gitattributes`). Skriv aldrig CRLF ind i filer.
- **Tests**: kør `npm test` og begge typechecks før PR. Ny adfærd får en test i den fil, der passer til området (se `lib/`). Kør portal-røgtesten (`npm run test:portal`), når brugerfladen er ændret.
- **Lint og formatering må kun blive bedre** (`npm run lint`, også i CI). Nye fund ud over `scripts/lint-baseline.json` afvises. Al kode er formateret med oxfmt; kør `npx oxfmt <fil>` (eller `npx oxfmt`) før commit, ellers afviser CI ændringen. Kør `npm run lint:update` efter at have rettet fund eller formateret filer.
- **Udgivelse**: brug `scripts/platform-release.mjs` (dev, så prod) og meld resultatet tilbage til brugeren. Udgiv ikke andres uflettede eller uafsluttede arbejde.
