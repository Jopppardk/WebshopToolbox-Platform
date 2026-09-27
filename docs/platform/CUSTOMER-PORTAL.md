# Kundeportal – 13. september 2026

## Besluttet

En virksomhedsbruger har ét fast arbejdsområde og lander direkte på Dashboard. Ingen virksomhedsvælger. Virksomheden har én regnskabskonfiguration, som alle dens webshops deler. Flere webshops oprettes under Integrationer. Profil og virksomhedens brugere administreres under Indstillinger. Toolbox-administratoren beholder sin separate virksomhedsoversigt og kan åbne kundeportalen for en valgt virksomhed uden at skifte identitet.

## Implementeret

- Servervalgt `/api/platform/workspace` udleder virksomheden fra den signerede brugers eksisterende ejerskab og medlemskab. Inaktiv virksomhed afvises. Klientens companyId vælger ikke arbejdsområdet.
- Kundevisning med Dashboard, Integrationer og Indstillinger, inspireret af Sablens dashboard og varme farver. Medlemmer ser kun egne tildelte webshops; kun virksomhedens administrator kan konfigurere regnskab, webshops og brugere.
- Migration 0004 indfører company_accounting med company_id som primærnøgle. Der kan kun eksistere én konfiguration pr. virksomhed. Webshops bruger virksomhedens fælles valg uden egen regnskabsreference. Ændring logges atomisk i virksomhedens audit.
- Regnskabsprogram og regnskabsnavn kan gemmes. Dinero/e-conomic er valg til senere forbindelsesopsætning, ikke fungerende tilslutninger. Status er altid Afventer tilslutning. Der indsamles ingen providercredentials i denne leverance.
- Eksisterende invitation, rollebeskyttelse og webshopadgang genbruges under Indstillinger. Portaladministrator kan åbne kundevisningen via Åbn kundeportal og vende tilbage til Toolbox-administration.

## Afgrænsning

Dette er kundeportalens første udsnit. Sablens salg, refunderinger, udbetalinger, rapporter og øvrige integrationsmotor er ikke flyttet. Dashboardet viser ærlige tomtilstande, ingen opdigtede økonomital eller tilsluttede integrationer. Regnskabsautorisation, import og bogføring er kommende leverancer i separat testmiljø. Login er fortsat Cloudflare Access/OTP; fuldt branded login og Google/Microsoft er ikke implementeret her.

## Validering og drift

286 tests bestået, inklusive 25 platformtests. Build, typecheck og begge dry-runs bestået. Ny test dækker servervalgt virksomhed, krydsvirksomhedsafvisning, medlem uden skriveadgang, inaktiv virksomhed, ét regnskab, validering og audit. Eksisterende tests med overlappende eksterne ID'er består.

Lokal browser bekræftede direkte dashboard for virksomhedsmedlem uden virksomhedsvælger. Senere lokal browsernavigation blev blokeret af browserklienten, så administratorens visuelle kontrol fortsætter på testportalen. Migration 0004 er anvendt lokalt og i test-D1 uden seed. Remote eksport er gemt i ignoreret `.wrangler/before-customer-portal.sql`.

Sablen-produktion og main er uændrede. Invitationernes tidligere lokale ændringer er bevaret og indgår i test-Worker-grundlaget. Ingen commit/push eller ny Linux-CI i denne opfølgning.

Test-Worker er deployet som 9639b268-0e98-43d5-9ec2-810d3e557e4d. Online portaladministrator har åbnet kundeportalens dashboard for Testvirksomhed A; kun de to tilhørende testwebshops vises. Bogføring og kundemail er fortsat blokeret.

Online browserprøve bestået: fælles Dinero-valg gemt for syntetisk Testvirksomhed A; status Afventer tilslutning; begge webshops under Integrationer; profil, invitationer og roller under Indstillinger. Ingen nye invitationsmails sendt i denne prøve.

Seneste testversion: 58229a30-1ab3-4a0c-9ca6-7b7af5dc5a10 (dansk audittekst, JavaScript-syntaks kontrolleret).

## Kundeportalens udseende – 13. september 2026

Brugeren ønsker samme slutbrugerflade som den eksisterende integrationsløsning, uden Sablen-referencer og uden udviklingsside. platform/public/customer.js indeholder kundepræsentationen: mørk #232323 sidemenu, gylden #c09960 aktiv navigation, virksomhedens navn og bruger i topbjælken, mobilmenu, grupperne Bogføring/Dokumenter/System og siderne Dashboard, Salg, Tilbagebetalinger, Udbetalinger, Lager, Emballage, Fakturaer, Udbetalingsrapporter, Indsigt, Integrationer og Indstillinger. Udvikling og brandbilleder fra produktionen medtages ikke. Dashboardets struktur følger dagens aktivitet, drift og status samt omsætning MTD/YTD, overskud og lagerværdi. Tal uden datagrundlag vises som —.

Det er en tilpasning af brugerfladen, ikke en flytning af integrationsmotoren. Nye bogførings-/dokumentvisninger er tomtilstande med kolonner og filtre, indtil den virksomhedsspecifikke import er implementeret. Ingen produktionskald, dokumenter eller økonomital genbruges. Eksisterende fungerende virksomhedsopsætning, integrationsvalg, brugere, profil og log ud bevares. Kundepræsentationens JavaScript kræver autentificering ligesom admin.js. Administrationens katalog og virksomhedsoversigt beholder deres separate brugerflade.

Designvalidering: 289 tests, build, typecheck og begge dry-runs bestået. Online browserkontrol af mobil-dashboard, menugrupper og Salg med tabel/tomme data bestået. Mobilmenu lukker efter valg og flytter fokus tilbage til menuknappen. Ingen Sablen-/Udvikling-referencer findes i platform/public. Der er ikke foretaget pixel-for-pixel-kontrol af alle oprindelige skærme; integrationsmotoren og de importafhængige funktioner er fortsat ikke flyttet. Ingen commit/push eller merge til main.
