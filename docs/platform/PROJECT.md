# WebshopToolbox – fælles platform

## Brugerplacering – beslutning 13. september 2026

Brugeren har fravalgt adgang til flere virksomheder for samme virksomhedsbruger. Virksomhedsbrugere oprettes og administreres i den enkelte virksomhed. Portalindstillinger indeholder alene administratorer af Toolbox, som har adgang på tværs af virksomheder i kraft af deres portalrolle.

Implementeret: users.company_id fastholder virksomhedsejerskab; migration 0002 bevarer eksisterende tilknytninger, afviser tvetydige medlemskaber og forhindrer ændring af ejerskab. Virksomhedsbrugere kan ikke gøres til portaladministratorer. De gamle globale /users-ruter er fjernet; /settings/admins er kun for portaladministratorer. Virksomhedsadministratorer kan oprette medlemmer og ændre deres status inden for egen virksomhed; kun portaladministratorer tildeler virksomhedsadministratorrollen. Egen deaktivering er blokeret.

Testet: 281 tests bestået, inklusive 20 platformtests med migration, isolation, portalroller og deaktivering. Testdatabasens eksisterende medlemskaber er kontrolleret uden konflikter. Build, typecheck og begge dry-runs er bestået. Migration 0002 og Worker-version `fae60d2b-7e18-4206-b10e-c393639ce711` er udrullet til testmiljøet. Browserkontrol bekræfter Portalindstillinger med kun portaladministratorer og Brugere inde under virksomheden. Backup før migration ligger lokalt i ignoreret `.wrangler/before-company-users.sql`. Brugeren har godkendt push til platform/admin-foundation. De lokale kontroller er bestået; status for denne revisions Linux-CI skal kontrolleres på GitHub efter push. Ingen ændring af Sablen eller merge til main.

> Loginstatus 13. september 2026: Separat Cloudflare Access-app er oprettet og test-Worker deployet med issuer og egen AUD (version `6a9263ed-d19d-40c4-a2e8-9236b6788072`). Brugerens identitet er verificeret i Cloudflare-dashboardet via aktiv OTP-session for testappen og registreret som platformadministrator i test-D1 med auditspor. Online virksomhedsoversigt er verificeret med rollen Platformadministrator. Sablen er uændret, main er ikke merged, og bogføring/kundemail er fortsat blokeret. Tidligere beskrivelser af manglende Access-login nedenfor er historiske. Remote rolleisolationsprøver med flere rigtige brugere udestår; eksisterende lokale adgangstests er fortsat grundlaget.

Projektgrundlag samlet 12. september 2026 fra samtalen “Udviklingschat - integrationsløsning v2”.

## Formål
Udvide den eksisterende integrationsløsning fra Sablen.dk til en fælles platform. Platformadministrator skal kunne oprette flere webshops, tilknytte brugere, vælge integrationer og overvåge driften. Hver webshop skal have egne indstillinger, adgangsoplysninger, data og kørsler.

## Arbejdsretning
Genbrug repository Jopppardk/WebshopToolbox og integrationslogikken. Byg i isoleret udviklings-/testmiljø med egne databaser, dokumentlagre og nøgler. Sablen fortsætter i drift indtil en kontrolleret overgang. Administrationsgrundlaget er besluttet i ADR-001.md og delvist implementeret; den samlede integrationsplatform er fortsat under udvikling.

Skeln mellem virksomhed, webshop og regnskabsforbindelse. Flere webshops kan tilhøre samme virksomhed og eventuelt samme regnskab. Antag ikke én webshop pr. Dinero-organisation.

## Status
- Opdatering 13. september 2026: første administrationsudsnit er implementeret og lokalt testet. Egne testressourcer er oprettet på den eksisterende Cloudflare-konto efter brugerens valg; test-Worker er deployet, men afviser administration, fordi Access-login mangler. Se ADMIN-FOUNDATION.md og ADR-001.md.
- Produktion: https://integration.sablen.dk
- Eksisterende løsninger: salg/fakturaer, tilbagebetalinger, udbetalinger, rapporter, lager, emballage, indsigt, dashboard og integrationer.
- Legacy-databasen har tenant-felter, men login, forespørgsler, credentials og scheduler indeholder Sablen-specifikke værdier. Reel isolation er ikke implementeret i legacy-integrationerne. Den separate administrationsdel har egne scoped relationer og adgangstests.
- Senest verificerede produktionscommit i denne samtale: 9a76239477ae03e7e5504f537e52a24277198ab4 (PR 55). Kontrollér GitHub igen før nye ændringer.
- Integrationsplatformen som helhed er ikke bygget. GitHub Projects er ikke oprettet; administrationens testmiljø er etableret med den ovennævnte loginbegrænsning.

## Organisering
Brug et lokalt Codex-projekt med denne mappe som hovedmappe. Brug en separat opgave pr. afgrænset leverance. Gem beslutninger og acceptkrav i repository. GitHub Issues/Projects anbefales til opgavestatus, og pull requests til kodegennemgang.

Den rigtige klon er etableret 12. september 2026 i `work/platform` under det oprindelige snapshot. Aktuel branch er `platform/admin-foundation`, videreført fra `platform/stage-0`. Dokumentation er overført og lokale afvigelser gennemgået; snapshot og sikkerhedskopi er bevaret. Brug klonen som hovedmappe til platformarbejde. Se STAGE-0.md for præcis placering og revision. Test-Worker er deployet. Brugeren godkendte push 13. september 2026; platformbranchen er pushet, og Linux-CI er bestået. Cloudflare Access-login udestår fortsat. Produktion er ikke deployet som led i denne opgave.

## Læs videre
- ROADMAP.md: etaper og acceptkrav.
- HANDOVER.md: produktionshensyn, kendte udeståender og arbejdsmetode.
- STAGE-0.md: klon, bevarelse og lokal revision.
- BACKLOG.md: klargjort lokal opgavetavle med acceptkrav og afhængigheder.
- DATA-MODEL.md og TEST-ENVIRONMENT.md: målbillede og oprindelige forslag; første administrationsudsnit er implementeret, og fjernmiljø er etableret med loginbegrænsning.
- ADR-001.md: valgte standarder og afgrænsning; ADMIN-FOUNDATION.md: faktisk implementering/drift; ISOLATION-INVENTORY.md: reproducerbar fortegnelse over legacy-ruter og ressourceadgang.

## Åbne beslutninger
- Kun administratoroprettede webshops eller senere selvbetjent oprettelse?
- Roller og virksomheders adgang til flere webshops.
- Fælles database med strikt webshopafgrænsning eller separat database pr. virksomhed.
- Loginudbyder, platformdomæne og identifikation af valgt webshop på serveren.
- Delte regnskaber og ejerskab til betalingsaftaler: hvordan undgås dobbeltimport på tværs af webshops?
- Backup, gendannelse, opbevaring og sletning pr. virksomhed.
