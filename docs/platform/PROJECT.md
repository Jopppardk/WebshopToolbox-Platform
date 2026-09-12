# WebshopToolbox – fælles platform

Projektgrundlag samlet 12. september 2026 fra samtalen “Udviklingschat - integrationsløsning v2”.

## Formål
Udvide den eksisterende integrationsløsning fra Sablen.dk til en fælles platform. Platformadministrator skal kunne oprette flere webshops, tilknytte brugere, vælge integrationer og overvåge driften. Hver webshop skal have egne indstillinger, adgangsoplysninger, data og kørsler.

## Arbejdsretning
Genbrug repository Jopppardk/WebshopToolbox og integrationslogikken. Byg i isoleret udviklings-/testmiljø med egne databaser, dokumentlagre og nøgler. Sablen fortsætter i drift indtil en kontrolleret overgang. Denne retning er anbefalet i samtalen; den konkrete datamodel og miljøopsætning skal stadig besluttes og implementeres.

Skeln mellem virksomhed, webshop og regnskabsforbindelse. Flere webshops kan tilhøre samme virksomhed og eventuelt samme regnskab. Antag ikke én webshop pr. Dinero-organisation.

## Status
- Produktion: https://integration.sablen.dk
- Eksisterende løsninger: salg/fakturaer, tilbagebetalinger, udbetalinger, rapporter, lager, emballage, indsigt, dashboard og integrationer.
- Databasen har tenant-felter, men login, forespørgsler, credentials og scheduler indeholder Sablen-specifikke værdier. Reel isolation mellem webshops er ikke implementeret.
- Senest verificerede produktionscommit i denne samtale: 9a76239477ae03e7e5504f537e52a24277198ab4 (PR 55). Kontrollér GitHub igen før nye ændringer.
- Platformsprojektet er endnu ikke bygget. Der er endnu ikke oprettet et testmiljø eller en GitHub Projects-tavle.

## Organisering
Brug et lokalt Codex-projekt med denne mappe som hovedmappe. Brug en separat opgave pr. afgrænset leverance. Gem beslutninger og acceptkrav i repository. GitHub Issues/Projects anbefales til opgavestatus, og pull requests til kodegennemgang.

Den rigtige klon er etableret 12. september 2026 i `work/platform` under det oprindelige snapshot, på branchen `platform/stage-0`. Dokumentation er overført og lokale afvigelser gennemgået; snapshot og sikkerhedskopi er bevaret. Brug klonen som hovedmappe til platformarbejde. Se STAGE-0.md for præcis placering og revision. Der er ikke pushet eller deployet.

## Læs videre
- ROADMAP.md: etaper og acceptkrav.
- HANDOVER.md: produktionshensyn, kendte udeståender og arbejdsmetode.
- STAGE-0.md: klon, bevarelse og lokal revision.
- BACKLOG.md: klargjort lokal opgavetavle med acceptkrav og afhængigheder.
- DATA-MODEL.md og TEST-ENVIRONMENT.md: forslag, endnu ikke implementeret eller sat i drift.

## Åbne beslutninger
- Kun administratoroprettede webshops eller senere selvbetjent oprettelse?
- Roller og virksomheders adgang til flere webshops.
- Fælles database med strikt webshopafgrænsning eller separat database pr. virksomhed.
- Loginudbyder, platformdomæne og identifikation af valgt webshop på serveren.
- Delte regnskaber og ejerskab til betalingsaftaler: hvordan undgås dobbeltimport på tværs af webshops?
- Backup, gendannelse, opbevaring og sletning pr. virksomhed.
