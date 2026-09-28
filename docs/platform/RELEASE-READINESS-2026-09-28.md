# Frigivelsesvurdering – 28. september 2026

## Beslutning

**NO-GO til almindelig ekstern kundedrift som automatiseret webshop-/regnskabsløsning.**

**Betinget GO til en inviteret, overvåget læse-/demopilot**, efter at kundens login, adgang, integrationer og datavisning er prøvet samlet på separate testkonti. En sådan pilot må ikke love bogføring, automatisk fakturamail, lagerregulering eller automatisk indberetning. Ingen fuld pilotgodkendelse gives ved denne rapport.

Projektet har et brugbart fundament og en fungerende udgivelsesproces. Det skal ikke startes forfra. Men en fungerende portal på et produktionsdomæne er endnu ikke en færdig produktionsintegration. Der mangler implementering og driftsverifikation, ikke kun aktivering af konfigurationsflag.

## Omfang og bevis

Vurderet lokal HEAD `d5ada30068b89bb55249a546ff5715b469c34956`, ren main før rapporten. Produktionskode `76e12bd148b9d028d357f3b98c25ec47e6618111`; forskellen er kun tre dokumentationsfiler. GitHub-status, offentlige HTTP-svar, afhængighedsaudit og lint er kontrolleret på ny. Koden for sikkerhedsgrænser, Tier 1-dataadapter, importer, fakturaafsendelse, login og lageroptælling er læst målrettet.

Dette er en produkt- og teknisk frigivelsesvurdering, ikke en fuld penetrationstest, juridisk vurdering eller verificeret afstemning af et kunderegnskab. Der er ikke oprettet kunder, sendt mails, udført posteringer, ændret opsætning eller deployet under vurderingen. Sablen er ikke berørt. Seneste 359-test-resultat genbruges fra den konkrete udgivelses CI; identisk kode er ikke testkørt igen uden grund.

## Aktuel status

| Område | Vurdering | Bevis og begrænsning |
|---|---|---|
| Repository og deployment | Godt fundament | Privat separat repository, PR #2, grøn CI og manuelle GitHub Actions-deployments til begge miljøer. Ingen åbne PR'er ved kontrollen. |
| Build og regression | Bestået | 359/359 tests i seneste dev/prod-deploy, begge typechecks og builds bestået. Suiten omfatter også legacy-kode; antal tests er ikke bevis for en komplet platformintegration. |
| Adskillelse og adgang | Positivt testgrundlag | Serverkontrol, scoped credentials/dokumenter, rolle-/supporttests og overlappende eksterne ID'er. Ingen komplet autentificeret online fler-kunde-pilot attesteret. |
| Login/onboarding | Implementeret, samlet accept mangler | Mailkode, invitation, profil, roller og Tier 0-adskillelse findes. Et helt nyt kundeforløb skal dokumenteres fra invitation til import og deaktivering på releaseversionen. Google/Microsoft-login er tidligere udskudt og er ikke et krav, hvis mailkode er det aftalte produkt. |
| Shopify/Dinero og betalingsdata | Delvis leverance | Læseforbindelser, import, kontoplan, dashboard, datoer og manuel Dinero-afstemning findes. Rigtige leverandørforløb er ikke dokumenteret samlet bestået. |
| Bogføring | Frigivelsesblokering | Tier 1 afviser salg/refund/udbetaling/manual transfer; normale økonomiske overførsler er ikke gjort produktionsklare. Startdato og et beregnet kladdeforslag udfører ingen bogføring. |
| Fakturaer og mail | Delvis leverance | PDF, design/logo, forhåndsvisning og demo-testmail findes. Normal kundeafsendelse er blokeret. Tidligere konkret demo til live.dk stod Delivered i Cloudflare; det beviser ikke almindelig mailautomatik eller indbakkeplacering. |
| Automatisk drift | Frigivelsesblokering | Cron er tom, scheduled() svarer disabled og synkroniseringsstatus automatic:false. Alarmmailindstillinger understøttes heller ikke af den aktuelle dataadapter. |
| Lager | Afgrænset funktion | Læsning, forslag og simulering; commit afvises. Skal færdiggøres eller udelades tydeligt af første udgivelse. |
| Emballage og feeds | Kræver afgrænset accept | Import/opsætning og PartnerAds-feed findes. Automatisk indberetning og faktisk PartnerAds-modtagelse er ikke samlet driftsgodkendt. |
| Afhængigheder | Bestået kendt-sårbarhedskontrol | Både npm audit og npm audit --omit=dev returnerer nul kendte advisories. Det er ikke en garanti mod applikationsfejl. |
| Lint/tilgængelighed | Ikke bestået | 837 fejlmarkerede linjer i oxlint-output, heraf 175 i platform/tier1. Omfatter testkode, stil/typekrav og formular-/tilgængelighedsfund. Ikke 837 konstaterede produktionsfejl. Lint indgår ikke i obligatorisk CI. |
| Backup og recovery | Utilstrækkeligt releasebevis | Tidligere D1-kopiprøve og migrationsbackups findes; samlet, aktuel D1+R2-restore med dokumenthashes, credentials og kvitteringer er ikke dokumenteret. |
| Belastning/drift | Ikke dokumenteret godkendt | Ingen fremlagt test af større kataloger/ordremængder, leverandørbegrænsninger, omkostningsgrænser eller vedvarende fler-kundedrift. |

## Hvorfor det ikke kan aktiveres ved blot at skifte et flag

`platform/safety.ts` kræver bogføring og normal kundemail sat til blocked, også ved PLATFORM_ENV=production. Et andet flag med den nuværende kode giver 503. Samme fil har en deaktiveret scheduler.

`platform/tier1-data.ts` afviser normal bogføring og /invoices/email uden en miljøundtagelse. `platform/operations.ts` importerer data og beregner forslag, men dette er ikke en overførsel til Dinero. `platform/stocktake.ts` afviser commit og understøtter simulate/cancel.

Produktionsadaptere, holdbare tilstande/kvitteringer, kontrollerede retries og jobafvikling skal implementeres og testes før aktivering. Fjernelse af de nuværende spærrer alene er ikke en løsning.

## Prioriteret vej til ekstern frigivelse

### 1. Fastlæg første produktversion

Anbefalet første leverance: Shopify + Dinero, salg/refundering/udbetaling, faktura-PDF/mail samt support. Flatpay, ViaBill, lagercommit og automatisk emballageindberetning kan følge særskilt, medmindre de er krav for de første kunder. Funktioner uden for scope skal skjules eller tydeligt markeres, så grænsefladen ikke lover en handling, backend afviser. Prod-tekster, der fortsat siger dev, skal ryddes op.

Accept: én aktuel funktionsmatrix med understøttede lande/valutaer/momsscenarier, datakilder og udbydere, og en klar liste over undtagelser. Der gives ikke en generel økonomisk godkendelse af understøttelsen i denne rapport.

### 2. Færdiggør produktionsforløbene

Implementér tenantafgrænsede økonomiske writes, bogførings-/kladdevalg, stabile kvitteringer og stop ved ukendt udfald. Manuel onboarding-afstemning skal respekteres før oprettelse. Afprøv timeout efter ekstern accept, samtidige klik/jobs, ændret ordre, delvis gennemførelse, genstart og ændret regnskabsforbindelse uden dubletter.

Implementér almindelig fakturaafsendelse med varig afsendelsesstatus og kontrolleret recovery, ikke ved at genbruge demo-test som kundeautomatik. Kobl scheduler, låse, fortsættelser og driftsalarmer til de rigtige platformmoduler. Aktivering skal ske kontrolleret pr. kunde med en mulighed for at stoppe behandling.

Accept: testkontoforløb fra Shopify-ordre til kontrolleret Dinero-bilag og mail, inkl. refund/udbetaling og verificeret afstemning. Ingen testposteringer på Sablen eller andre rigtige regnskaber.

### 3. Gennemfør en dokumenteret kundepilot

Mindst to isolerede testvirksomheder og flere webshops med overlappende ID'er. Test administrator og almindelig bruger, invitation/mailkode, profil, forbindelser, datoer, import, rettigheder, PDF/logo, standard-/egen afsender, fejl, support, logout og deaktivering. Kontroller direkte API-krydsadgang og delte regnskabs-/aftalescenarier, hvis de indgår i scope. Verificér leverandørresultater, ikke kun appens succesbesked.

Accept: scenarieoversigt med forventet/faktisk resultat, commit, testkonto og kendte begrænsninger. Kritiske fejl skal være lukket før første kunde med rigtige økonomiske handlinger.

### 4. Gør drift og gendannelse klar

Dokumentér og gennemfør isoleret restore af D1 og R2 med PDF'er, nøgler, hashes og bogførings-/mailkvitteringer. Fastlæg tilladt datatab, forventet gendannelsestid, alarmmodtager, hændelseshåndtering, tokenrotation og kundens offboarding/dataeksport. En Worker-rollback må ikke føre til gentagne økonomiske writes eller tab af nye kvitteringer.

GitHub miljøerne dev/prod har ingen protection_rules og ingen deployment_branch_policy. Workflowet begrænser til main og manuel start, men der er ingen særskilt miljøgodkender. Branch protection/rulesets-API gav 403 med besked om planbegrænsning; håndhævet branchbeskyttelse kan derfor ikke attesteres. Fastlæg en udgivelsesgodkendelse og håndhæv den, hvor abonnementet understøtter det. Gør ikke repositoryet offentligt for at omgå begrænsningen.

### 5. Afslut kvalitet og kundevilkår

Triagér lint; ret relevante kunde-/tilgængelighedsfejl og definér en eksplicit baseline for øvrig gæld. Automatisk CI skal blokere nye relevante fejl. Kør belastningsprøver for realistiske datamængder og afbrudte importer.

Afklar desuden pris/prøveperiode, supportansvar, kundeaftale, databehandling og opbevaring med de ansvarlige. Disse forhold er ikke dokumenteret som godkendte i de gennemgåede kilder; det er en afklaringsliste, ikke en juridisk konklusion. Selvbetjent tilmelding/betaling behøver ikke være et krav til en manuelt onboardet pilot.

## Verifikation denne gang

- GitHub HEAD: d5ada30068b89bb55249a546ff5715b469c34956, check-run 36380250282 success.
- Dev-deploy 36379750291: success, kode 76e12bd, Worker 769786c9-1be8-4e00-81d7-10d05e7fe6c4.
- Prod-deploy 36379989591: success, kode 76e12bd, Worker 4f63f886-3e93-4e0d-adeb-df149200c10b.
- Begge miljøer: health/login 200, admin 302 til Access, anonym ordre-API 401. Health viser fortsat blocked for bogføring/kundemail; dette er sammenholdt med kildekoden, ikke alene accepteret som funktionsbevis.
- npm audit og npm audit --omit=dev: 0 kendte sårbarheder. Rå resultater gemt lokalt i ignoreret .wrangler/release-audit*.json.
- npm run lint: fejl; rå log i ignoreret .wrangler/release-lint.log. Fundtællingen er linjer med ': error ', ikke en sikkerhedsscore.
- GitHub environments: ingen protection_rules; branchbeskyttelse/rulesets ikke tilgængeligt på aktuel plan ifølge API. Ingen indstillinger ændret.

Den gamle vurderings netværks-/GitHub-/auditblokeringer gælder dermed ikke længere. Dokumentationen indeholder flere historiske statusnoter, der modsiger nyere noter; denne vurdering og seneste HANDOVER skal bruges som aktuel status, og en samlet funktionsmatrix bør erstatte spredte statusafsnit.

## Anbefaling

Brug næste udviklingsforløb på en afgrænset frigivelseskandidat og dens test-/driftsbevis frem for flere skærmbilleder eller nye integrationer. Hold fuld kundelancering lukket, indtil punkterne 1–5 er accepteret. Der er ikke grundlag for et troværdigt procenttal eller en leveringsdato, før første versions scope og resterende skriveadaptere er opgjort.
