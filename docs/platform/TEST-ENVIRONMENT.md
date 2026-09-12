# Forslag til separat udviklings- og testmiljø

Status 12. september 2026: design og acceptkrav klargjort. Ingen Cloudflare-ressourcer, secrets, domæner eller testkonti er oprettet. Nedenstående navne er forslag, ikke eksisterende ressourcer.

## Ressourcer

| Område | Foreslået adskillelse |
| --- | --- |
| Cloudflare | Separat testkonto foretrækkes; alternativ kræver dokumenteret adgangsbegrænsning til testressourcer |
| Worker | `webshop-toolbox-platform-test`, egen konfiguration og ingen Sablen-route |
| D1 | `webshop-toolbox-platform-test`, nyt ID, syntetisk seed |
| R2 | `webshop-toolbox-platform-test-documents`, tom bucket og eget nøglescope |
| Identitet | Egen Access-applikation/audience eller besluttet loginudbyder; testbrugere |
| Secrets | Ny krypteringsnøgle, testcredentials, test-CI-token; aldrig kopi af produktionssecrets |
| Eksterne systemer | Mock-adaptere som standard; særskilte testkonti først efter verifikation af testmuligheder |
| Mail | Lokal opsamling/mock, ingen almindelig kundemail-binding; eventuel senere tilladt testmodtagerliste |
| Scheduler | Deaktiveret ved første deploy; senere særskilte testjobs |
| CI | Separat workflow og GitHub environment `platform-test`, uden adgang til produktionssecrets |

Et separat runtimeflag er ikke tilstrækkelig isolation. Test skal både mangle produktionscredentials og have en central afvisning af eksterne writes. Eksisterende Dinero-flags dækker ikke nødvendigvis Flatpay, emballage, mails eller alle manuelle endpoints. Foreslåede nye sikkerhedsflags skal implementeres og testes i P03; de findes ikke allerede som samlet miljøbeskyttelse.

## Implementeringsrækkefølge

1. P03: lav særskilt build/runtime-konfiguration med eksplicit testmiljø, central adapterpolitik og alle writes slået fra. Fjern implicit brug af snapshot-data, produktions-hosting-ID eller standard-produktionskonfiguration i testforløbet. Eksisterende `.openai/hosting.json` og `wrangler.direct.jsonc` er ikke testopsætningen.
2. P04: opret nye ressourcer og gem faktiske test-ID'er i særskilt konfiguration. Definér secrets i testmiljøet og kontrollér effektiv adgang. Ændr ikke Sablen-bindings, routes eller scheduler.
3. Seed kun syntetiske virksomheder A/B og webshops A1/B1 med overlappende ID'er; tilføj A2 med fælles regnskab og aftale. Ingen produktionsdump eller kundedokumenter.
4. Kør fixtures, typecheck, build og dry-run mod testkonfiguration. En maskinelt verificeret kontrol skal afvise produktionsdatabase-ID, bucket, Worker-navn, route og manglende miljømarkering før deployment. Kontrollen må ikke logge secrets.
5. Deploy kun til det særskilte testmiljø, med cron og eksterne writes slukket. Verificér adgangsafvisning, bindingernes identitet, mailopsamling og tomme egne logs/lager før integrationstests.
6. Aktivér eventuelle test-API'er enkeltvis. Hvis leverandøren ikke har et egnet testmiljø, behold mock; brug ikke produktionsbogføring som erstatning.

## CI og udgivelse

Nuværende PR-CI tester, bygger, typechecker og laver Worker dry-run. Nuværende push til main eller workflow_dispatch af deploy-workflow deployer Sablen. Bevar dette forløb uændret i etape 0, og undlad push/merge til main. Platformarbejde bruger egne branches; testworkflow skal have eksplicit testkonfiguration og miljøafgrænsede secrets. Før første platform-merge skal udgivelsesstrategien være besluttet, så platformsændringer ikke automatisk rammer Sablen. Dokumentationsændringer kan også udløse det eksisterende deploy-workflow.

## Accept og tilbageførsel

- To virksomheder kan ikke læse/skrive hinandens data, dokumenter, settings, credentialmetadata eller logs, heller ikke ved direkte HTTP-kald og manipulerede ID'er.
- Overlappende eksterne ID'er behandles uafhængigt; delte aftaler deduplikeres på den fælles kilde.
- Alle finansielle writes, formularindberetninger og kundemails afvises uden eksplicit testadapter. En test verificerer også timeout efter simuleret oprettelse og genstart uden nyt write.
- Test-CI kan ikke deploye Sablen eller hente dens secrets. Produktionskonfigurationens hash er uændret efter etablering.
- Før skemaændringer tages backup af test-D1 og tilhørende R2-manifest. Gendan i en ny testdatabase/bucket og kontrollér counts, hashes, relationer og kvitteringer.
- Ved fejl: stop testcron/køer, deaktivér testwrites, rul Worker tilbage til kendt testversion og brug kun et kompatibelt skema. Testdatabase-restore alene må ikke genåbne eksternt bekræftede operationer; afstem kvitteringer og usikre writes først.
- Testfejl må aldrig føre til fallback til produktionsbindings, credentials eller domæne.

Valg af konto/domæne/login og leverandørtestkonti afsluttes i P01/P04. Miljøet må først beskrives som oprettet efter en ressourceinventarliste og som testet efter ovenstående kontroller.
