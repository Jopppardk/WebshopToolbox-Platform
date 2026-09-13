# Platformens opgavetavle

Lokal opgavetavle, 12. september 2026. Dette er klargjorte udviklingsopgaver, ikke oprettede GitHub Issues/Projects. Flyt dem senere til en fælles GitHub-tavle med samme ID'er. Status må kun ændres med henvisning til leverance og validering.

| ID | Leverance | Afhænger af | Status |
| --- | --- | --- | --- |
| P00 | Klon, revision og bevarelse | – | Lokalt udført; se STAGE-0.md |
| P01 | Beslut datamodel, roller og miljøvalg | P00 | Standardvalg besluttet, ADR-001; integrationstabeller ikke implementeret |
| P02 | Fuld kortlægning af dataadgang og Sablen-afhængigheder | P00 | 43 ruter/53 runtimefiler registreret; semantisk gennemgang af dynamiske nøgler udestår ved integrationsoverførsel |
| P03 | Separat testkonfiguration og central blokering af writes/mail | P01, P02 | Implementeret og testet for selvstændig admin-Worker; ingen live adapters medtaget |
| P04 | Opret testressourcer og isoleret CI | P03 | Ressourcer og aflåst Worker i drift; Access og begrænset deploy-adgang udestår |
| P05 | Skema, syntetiske fixtures og servervalideret adgang | P01, P04 | Adminskema og lokale adgangstests implementeret; rigtigt fjernlogin udestår |
| P06 | Scoped repositories, credentials, dokumenter og historik | P02, P05 | Planlagt |
| P07 | Administration og integrationsindstillinger | P05, P06 | Virksomheder/webshops/brugeradgang implementeret lokalt; integrationsindstillinger udestår |
| P08 | Scheduler, leases, cursors og bogføringskvitteringer | P06 | Planlagt |
| P09 | Pilot med overlap, fælles regnskab og fejlgenopretning | P07, P08 | Planlagt |
| P10 | Sablen-migrationsplan og separat overgangsbeslutning | P09 | Senere; ingen produktionsflytning autoriseret |
| P11 | GitHub-opgaver og fælles tavle | P00 | Klargjort lokalt; ikke oprettet på GitHub |

## Afgrænsning og acceptkrav

**P01 – Arkitekturbeslutning.** Gennemgå DATA-MODEL.md; fastlæg roller, login, selskabs-/webshopejerskab, delte regnskaber og betalingsaftaler, databasevalg og miljøkonto. Lever ADR med godkendte valg, åbne spørgsmål og eksempelrelationer A1/B1/A2. Accepteres når alle ressourcer har entydig ejer og dubletscope, også ved delt aftale. Ingen produktionsmigration.

**P02 – Isolationsregister.** Gennemgå alle `app/api`-ruter, DB-adgange, settings-nøgler, credentials, cache, R2, emails, logs, scheduler, eksterne referencer og hardcodet branding/kontoplan. Lever tabel med fil, operation, nuværende scope, mål-scope og test. Accepteres når hver adgang er knyttet til en planlagt ændring; tekstsøgning alene er ikke nok.

**P03 – Sikker testruntime.** Implementér separat konfiguration, obligatorisk miljøidentitet, mock-adaptere og standardafvisning af eksterne writes/mail. Accepteres når både manuelle API-kald og jobs afvises uden eksplicit testadapter, og produktionsbindings samt implicit fallback afvises før deploy. Ingen ændring af produktionskonfiguration.

**P04 – Miljø og CI.** Følg TEST-ENVIRONMENT.md. Lever ressourceinventar uden hemmeligheder, dedikeret testworkflow, seed-, deploy- og rollbackprocedure. Accepteres når miljøidentitet, adgangsbegrænsning, mailopsamling og restore er afprøvet; ingen Sablen-ressource ændret. Afgør platformens udgivelsesstrategi inden merge til main.

**P05 – Identitet og skema.** Implementér kontrollerede migrationer i test, medlemskaber og serveroprettet adgangskontekst. Accepteres når direkte kald med forfalsket webshop/company-ID, ugyldig JWT, deaktiveret bruger eller manglende rolle afvises, og FK'er afviser relationer mellem virksomheder. Fixtures inkluderer overlappende eksterne ID'er.

**P06 – Dataadskillelse.** Konvertér kode systematisk efter P02; normaliser credentials fra begge nuværende lagre og bevar kryptering. Accepteres når A/B-test dækker listning, eksport, dokumentdownload, settings, logs, cache, emails og oprydning, og bogføringskvitteringer overlever retention. Delt regnskab giver ikke webshopbrugere adgang til andre webshops.

**P07 – Administration.** Opret/deaktivér virksomhed og webshop, tildel roller og egne integrationer/kontoplaner/startdatoer/mailvalg. Accepteres når handlinger auditeres, egen virksomhed håndhæves, frakobling ikke påvirker andre brugere af en delt forbindelse, og deaktivering stopper nye jobs.

**P08 – Kørsler og bogføring.** Implementér ejerspecifikke leases/cursors, fair jobplanlægning, idempotens og varige kvitteringer. Accepteres ved samtidige forsøg, fejl hos webshop A med fortsat drift for B, fælles aftale med én bogføring, timeout efter write, procesnedbrud og lease-udløb uden dobbeltoprettelse. Usikkert write afstemmes før genforsøg.

**P09 – Pilot.** Kør salg, refunds, udbetalinger, rapporter, emails og alarmer med to virksomheder plus delt regnskab/aftale inden for én virksomhed. Accepteres med testrapport for negative adgangstests, overlap, dokumentisolation, dubletter og restore. Alle finansielle eksterne writes er mock eller særskilt dokumenteret testkonto.

**P10 – Fremtidig overgang.** Lever senere backup-/mappingsplan med alle eksisterende bilags-ID'er og dokumenter, stop/start af gamle/nye jobs og afstemning efter rollback. Produktion flyttes først ved særskilt beslutning efter bestået pilot.

**P11 – Fælles tavle.** Opret senere issues fra disse afgrænsede beskrivelser og link dem i en GitHub Projects-tavle. Accepteres når ID'er, afhængigheder, ansvar og status stemmer med repositorydokumentationen. Lokal klargøring er ikke det samme som publiceret tavle.

For hver kodeleverance: separat branch, relevante fixtures og repositoryets obligatoriske Linux-CI-kontroller. Angiv særskilt implementeret, lokalt testet, CI-testet og sat i testdrift. Produktionsdrift er aldrig implicit i en afsluttet udviklingsopgave.
