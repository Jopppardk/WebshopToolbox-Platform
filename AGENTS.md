# WebshopToolbox

Læs docs/platform/PROJECT.md og docs/platform/HANDOVER.md ved nye platformopgaver. Planen står i docs/platform/ROADMAP.md. Hold dokumentationen opdateret, og skeln mellem planlagt, implementeret, testet og sat i drift.

- Arbejd på dansk i dialogen med brugeren.
- Produktionsløsningen til Sablen indeholder rigtige bogføringsdata. Platformsarbejde skal bruge separat testmiljø.
- Serveren skal validere brugerens adgang til virksomhed/webshop. Stol ikke på et tenant-ID alene fra klienten.
- Afgræns data, credentials, dokumenter, låse, logs og dubletkontrol. Test to webshops med overlappende eksterne ID'er.
- Bevar bogføringskvitteringer og beskyttelse mod gentagen oprettelse. Usikre eksterne writes må ikke genforsøges blindt.
- Inden nye ændringer: kontrollér aktuel GitHub-status og lokale afvigelser. Denne mappe er en rigtig klon; det oprindelige snapshot ligger to niveauer ovenfor. Se docs/platform/STAGE-0.md. Overfør ikke snapshot-filer ukritisk.
- Brug relevante tests samt repositoryets obligatoriske CI-kontroller. Foretag ikke økonomiske testposteringer i produktion.
- Medtag ikke lokale ændringer fra stoppede eller urelaterede opgaver i en udgivelse.
