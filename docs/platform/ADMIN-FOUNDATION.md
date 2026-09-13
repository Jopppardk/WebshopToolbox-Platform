# Administration – implementering, drift og næste handling

## Brugerplacering – beslutning 13. september 2026

Brugeren har fravalgt adgang til flere virksomheder for samme virksomhedsbruger. Virksomhedsbrugere oprettes og administreres i den enkelte virksomhed. Portalindstillinger indeholder alene administratorer af Toolbox, som har adgang på tværs af virksomheder i kraft af deres portalrolle.

Implementeret: users.company_id fastholder virksomhedsejerskab; migration 0002 bevarer eksisterende tilknytninger, afviser tvetydige medlemskaber og forhindrer ændring af ejerskab. Virksomhedsbrugere kan ikke gøres til portaladministratorer. De gamle globale /users-ruter er fjernet; /settings/admins er kun for portaladministratorer. Virksomhedsadministratorer kan oprette medlemmer og ændre deres status inden for egen virksomhed; kun portaladministratorer tildeler virksomhedsadministratorrollen. Egen deaktivering er blokeret.

Testet: 281 tests bestået, inklusive 20 platformtests med migration, isolation, portalroller og deaktivering. Testdatabasens eksisterende medlemskaber er kontrolleret uden konflikter. Build, typecheck og begge dry-runs er bestået. Migration 0002 og Worker-version `fae60d2b-7e18-4206-b10e-c393639ce711` er udrullet til testmiljøet. Browserkontrol bekræfter Portalindstillinger med kun portaladministratorer og Brugere inde under virksomheden. Backup før migration ligger lokalt i ignoreret `.wrangler/before-company-users.sql`. Brugeren har godkendt push til platform/admin-foundation. De lokale kontroller er bestået; status for denne revisions Linux-CI skal kontrolleres på GitHub efter push. Ingen ændring af Sablen eller merge til main.

> Loginstatus 13. september 2026: Separat Cloudflare Access-app er oprettet og test-Worker deployet med issuer og egen AUD (version `6a9263ed-d19d-40c4-a2e8-9236b6788072`). Brugerens identitet er verificeret i Cloudflare-dashboardet via aktiv OTP-session for testappen og registreret som platformadministrator i test-D1 med auditspor. Online virksomhedsoversigt er verificeret med rollen Platformadministrator. Sablen er uændret, main er ikke merged, og bogføring/kundemail er fortsat blokeret. Tidligere beskrivelser af manglende Access-login nedenfor er historiske. Remote rolleisolationsprøver med flere rigtige brugere udestår; eksisterende lokale adgangstests er fortsat grundlaget.

Status 13. september 2026. Arbejdsbranch: `platform/admin-foundation`. Sablen er ikke ændret eller flyttet, og der må ikke merges til main i denne leverance.

## Implementeret og lokalt afprøvet

- Virksomhedsoversigt og opret/redigér/deaktivér virksomhed.
- Opret/redigér/deaktivér webshop med uforanderligt ID og virksomhedsejerskab.
- Opret en bruger fra kendt `(issuer, subject)`; aktivér/deaktivér almindelige brugere. Platformadministratorer og egen bruger kan ikke deaktiveres via denne første UI.
- Tildel/fjern virksomhedsmedlemskab og webshoproller med serverkontrol. Ændring af virksomhedsrolle sker ved at tilknytte den samme bruger med den nye rolle.
- Scoped lister, fixturedata og audithistorik. Mutation og audit er atomiske; tilbagekaldt adgang gælder næste request.
- Signaturvalideret Cloudflare Access-adapter samt lokalt testlogin. Ingen email-header-bypass, produktionsfallback eller live providerklienter i bundle.
- UI er visuelt kontrolleret lokalt. Oprettelse af `Browserkontrol` under virksomhed A og den tilhørende audithændelse blev bekræftet i browseren. Denne ekstra webshop findes kun i lokal teststate.

## Ressourceinventar

| Ressource | Faktisk værdi | Status |
| --- | --- | --- |
| Konto | `cab062dd85faea98c9b8c4969175c39f` | Eksisterende konto, valgt af brugeren |
| Worker | `webshop-toolbox-platform-test` | Deployet særskilt |
| URL | https://webshop-toolbox-platform-test.rene-jeppesen.workers.dev | Health virker; administration afvist indtil loginopsætning |
| Worker-version ved første deploy | `fabb4b43-32e1-482b-a5b8-603f63e3948a` | 13. september 2026 |
| Seneste testversion | `ef89fc82-108a-4d8d-bf5e-4bb742eeca2a` | Endelig pakke efter frisk npm ci, 13. september 2026 |
| D1 | `webshop-toolbox-platform-test` / `438fde65-c538-4719-aa2e-9502ae37c7e6` | Skema og syntetisk seed anvendt |
| R2 | `webshop-toolbox-platform-test-documents` | Oprettet; 0 objekter / 0 B ved kontrol |
| Secrets på test-Worker | Tom liste | Ingen produktions-/providersecrets overført |
| Cron / email-binding | Ingen | Kontrolleret i testkonfiguration og deployoutput |
| Access-app | Ikke oprettet | Cloudflare svarede `403 auth.forbidden` |
| Automatisk testdeploy | Ikke konfigureret | Kræver separat begrænset adgang; CI indeholder intet deployjob |

`PLATFORM_EXTERNAL_WRITES=blocked` og `PLATFORM_CUSTOMER_EMAIL=blocked` er obligatoriske. Desuden indeholder testentrypoint ingen legacy-providerklienter og accepterer ikke gamle DB-/mailbindings eller providercredentials. Alle 43 nuværende legacy-API-ruter afvises i tests.

## Lokal brug

Kør fra klonen `C:/Users/rj/Documents/Codex/2026-09-07/je/work/WebshopToolbox/work/platform`:

```powershell
npm ci
npm run platform:init
npm run platform:seed
npm run platform:session
npm run platform:dev
```

`platform:init` opretter kun en lokal nøgle, hvis `.dev.vars` ikke allerede findes, og anvender migrationer lokalt. `platform:seed` køres **kun én gang i en tom testdatabase**; det overskriver ikke eksisterende fixtures. Den allerede etablerede lokale database skal ikke seedes igen.

Åbn `http://127.0.0.1:8790/local-login`, og brug `token` fra den ignorerede `.wrangler/platform-local-session.json`. Token gælder én time. `npm run platform:session -- local-a` / `local-b` / `local-reader` giver fixturebrugere med begrænset adgang. Sessionen bliver til en HttpOnly/SameSite-cookie; lokalt login er ikke tilgængeligt i fjernmiljøet.

Teststate ligger i `.wrangler/platform-state`; den gamle snapshots `.wrangler`, data og credentials bruges ikke. Frisk `npm ci` er gennemført i klonen. De afsluttende kontroller bruger klonens egne låste dependencies og Node 26.5.1. Linux-CI med Node 22.23.2 er også bestået den 13. september 2026.

## Verifikation

- Efter frisk `npm ci`: 279 tests bestået, 0 fejl, 0 sprunget over, inklusive 18 platformtests og eksisterende Workerd-test.
- Repositoryets build og typekontrol samt både legacy- og platform-Worker dry-run bestod lokalt med klonens egne dependencies. Fjernkonfigurationens dry-run bestod også før testdeploy.
- Brugeren godkendte push 13. september 2026. `platform/admin-foundation` er pushet til `Jopppardk/WebshopToolbox`. Linux-CI bestod på kodecommit `46c1fb292cd9dc15eb39411c7570aedf8359bfe4`: npm ci, konfigurationskontrol, tests, build, typecheck og begge Worker-dry-runs. [CI-kørsel](https://github.com/Jopppardk/WebshopToolbox/actions/runs/34748367038). Ingen merge til main eller deployment fra CI.
- Negativ adgang: forfalsket signatur, forkert issuer/audience, udløbet token, email-header, deaktiveret bruger, krydsvirksomheds-ID, manglende webshoprolle, CSRF, ugyldig FK, dublet og tilbagekaldelse.
- To virksomheder har hver en kildepost med eksternt ID `123`; scoped læsning viser kun egen post. Det er ikke en pilot af delte regnskaber eller idempotent bogføring.
- Live testsmoke: `/healthz` returnerer 200 med testmiljø og begge blokeringer. `/`, `/api/platform/companies`, `/admin.js`, `/local-login` og `/api/invoices/email` returnerer 503, fordi Access endnu ikke er konfigureret, også med forfalsket Sablen-email-header. Ingen administrationsdata eksponeres.
- Produktionsruter, db-kode, middleware, worker-entry, produktions-Wrangler og begge oprindelige workflows er uændrede mod `9a76239`. De tilbageholdte emballage-/ViaBill-ændringer er ikke medtaget.

## Backup og gendannelse

Remote test-D1 er eksporteret til ignoreret `.wrangler/platform-backups/initial-test.sql` og gendannet i **separat lokal state** `.wrangler/platform-restore-check`. Kontrol: 2 virksomheder, 3 webshops, 4 fixturebrugere, 2 kildeposter og ingen fejl fra `PRAGMA foreign_key_check`. Backup-SHA256: `BCBBE3ADB78B66FCA3E8149F2BB0A83608C0776079AA3D0E43B74763FAA28BBA`.

R2 er tom; ingen dokumentgendannelse er afprøvet. Når dokumentflows tilføjes, skal manifest, indholdshashes og scoped restore testes. Der er ingen bogføringskvitteringer i dette adminskema, så testen dokumenterer ikke finansiel gendannelse.

Ved senere opdatering: eksportér test-D1 før migration, registrér Worker-version og R2-manifest, kør fixtures/dry-run og anvend kun testkonfigurationen. Ved fejl: hold cron/writes blokeret, rul kun test-Worker tilbage til registreret version, og afklar skemakompatibilitet. Gendan i en ny testressource ved øvelse; overskriv ikke produktion eller en testdatabase med uafstemte eksterne writes. Brug ikke `wrangler.direct.jsonc` til testdeploy.

## Nødvendigt før online administration

1. Opret en særskilt Cloudflare Access-applikation for den nye testadresse og en konkret tilladt brugerpolitik. Det nuværende CLI-login fik 403 ved oprettelse. Et forsøg på at åbne dashboardet blev efterfølgende stoppet af automatisk godkendelseskontrol; dette kræver brugerens godkendelse eller brugerens egen opsætning.
2. Sæt den nye app-audience og korrekte issuer i `wrangler.platform-test.json`. Genbrug ikke Sablens audience. Kontrollér både accepteret signeret login og afvisning af tokens til andre applikationer.
3. Registrér den første bruger med verificeret issuer/subject og tilknyt platformadministrator **kun i test-D1**. Fixtureidentiteterne kan ikke logge ind remote; deres lokale issuer accepteres ikke der. Der sendes ingen invitation.
4. Kør `node scripts/platform.mjs build-remote` og derefter `deploy`, og test brugere/roller i fjernmiljøet. Første brugeroprettelse og Access-politik skal være konkrete og gennemgåede før aktivering.
5. Etablér begrænset test-CI-adgang, hvis automatisk deployment ønskes. Det eksisterende production-token må ikke bruges i et nyt testworkflow.

Forberedte CLI-handlinger er `check`, `init-local`, `seed-local`, `local-session`, `dev`, `build`, `build-remote`, `migrate-remote`, `seed-remote`, `deploy`. Fjernhandlinger kræver en `platform/`-branch og det registrerede testdatabase-ID. Kontrolscriptet afviser legacy-entrypoint, produktionsbindings, services, cron, emailbinding og statiske assets uden Worker-kontrol.
