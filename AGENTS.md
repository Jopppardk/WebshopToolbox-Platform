# WebshopToolbox Platform

Læs docs/platform/PROJECT.md og docs/platform/HANDOVER.md ved nye platformopgaver. Planen står i docs/platform/ROADMAP.md. Hold dokumentationen opdateret, og skeln mellem planlagt, implementeret, testet og sat i drift.

- Arbejd på dansk i dialogen med brugeren.
- Produktionsløsningen til Sablen indeholder rigtige bogføringsdata. Platformsarbejde skal bruge separat testmiljø.
- Serveren skal validere brugerens adgang til virksomhed/webshop. Stol ikke på et tenant-ID alene fra klienten.
- Afgræns data, credentials, dokumenter, låse, logs og dubletkontrol. Test to webshops med overlappende eksterne ID'er.
- Bevar bogføringskvitteringer og beskyttelse mod gentagen oprettelse. Usikre eksterne writes må ikke genforsøges blindt.
- Inden nye ændringer: kontrollér aktuel GitHub-status og lokale afvigelser. Dette er den selvstændige klon af Jopppardk/WebshopToolbox-Platform. Brug denne mappe til nyt platformsarbejde; gamle henvisninger til work/platform i historiske dokumenter gælder det tidligere repository.
- Brug relevante tests samt repositoryets obligatoriske CI-kontroller. Foretag ikke økonomiske testposteringer i produktion.
- Medtag ikke lokale ændringer fra stoppede eller urelaterede opgaver i en udgivelse.

- Origin skal være Jopppardk/WebshopToolbox-Platform. Push aldrig platformændringer til Jopppardk/WebshopToolbox.
- Brug kun scripts/platform.mjs eller scripts/platform-production.mjs til deployment. wrangler.direct.jsonc og gamle Sablen-deployvejledninger er kun historisk reference; de må ikke deployes fra dette repository.
- Push deployer ikke. GitHub-udgivelse kræver manuel workflow_dispatch til valgt miljø.
