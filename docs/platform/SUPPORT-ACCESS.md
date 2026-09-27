# Supportadgang og login – 13. september 2026

## Implementeret og sat i testdrift
Portaladministrator kan vælge Virksomheder → virksomhed → Brugere → Log ind som bruger. En kort årsag kræves. Sessionen varer højst 30 minutter og åbner kundeportalen med den aktive kundebrugers aktuelle virksomhed/rolle/webshopadgang. Portaladministratorrettigheder følger ikke med. Der er en tydelig supportmarkering og Afslut supportadgang, også når sessionen er udløbet eller brugeren er deaktiveret.

En tilfældig 256-bit cookie er HttpOnly, SameSite=Strict og Secure remote. Kun SHA-256 gemmes i D1. Cookie er bundet til den oprindelige signerede administratoridentitet; både administratorrolle, aktiv målbruger, virksomhed og medlemskab valideres pr. API-kald. Cookie bevares længere end supportadgangen, så udløb afvises frem for at vende tilbage til administratorrettigheder uden besked. Én ny session tilbagekalder administratorens tidligere sessioner. Faner deler cookie; API-kald med en gammel bruger-/sessionskontekst afvises.

Start/afslutning auditeres med administratoren som aktør. Ændringer under support har original administrator som actor_id samt supportSession og impersonatedUser i details_json. Invitationer, onboarding og personlig profilændring er blokeret under support; invitationer kan administreres fra den normale Toolbox-administration. Der sendes ingen testmail ved kontrol af supportfunktionen.

Migration 0006 er anvendt i den separate test-D1. Backup: ignoreret .wrangler/before-support-sessions.sql. Worker-version: 9fd449d6-04a3-4704-8bcd-d27cd64000e8. Sablen-ressourcer er uændrede, bogføring/kundemail blokeret. Ingen commit, push eller merge til main i denne opfølgning.

## Validering
291 tests bestået; heraf 30 platformtests. De nye tests dækker CSRF, forkerte målvirksomheder, kundens begrænsede rettigheder, cookie under anden identitet, gamle faner, audit af writes, profil/invitationsblokering, sessionudløb, deaktivering og fjernet portalrolle. Build, typecheck samt legacy- og platform-dry-run bestået. Efter tilføjelse af visning af auditaktør er de 30 platformtests genkørt og bestået. Browserkontrol dokumenteres nedenfor, når gennemført.

## Loginbeslutning
Google og Microsoft udskydes efter brugerens svar; der er ingen adgang til Google Cloud/Entra til appregistrering. Cloudflare mail/engangskode bevares.

Brugeren ønsker let branding. Konkret forslag: organisationsnavn WebshopToolbox, baggrund #232323, overskrift “Velkommen til WebshopToolbox”, hjælpetekst “Log ind med din mailadresse for at åbne din virksomheds portal”. Ingen nyt logo er valgt/uploadet.

Cloudflares loginbranding gælder ALLE Access-apps i samme organisation og vil derfor også ændre Sablens loginside. Forslaget er ikke gemt i Cloudflare, fordi brugeren tidligere har krævet Sablen uændret. Der kræves en konkret undtagelse for den fælles loginsides udseende, før dette kan aktiveres. Alternativt skal login isoleres i en separat organisation, hvilket er en større arkitekturændring og ikke udført.
Kilde: https://developers.cloudflare.com/cloudflare-one/reusable-components/custom-pages/access-login-page/

## Online browserkontrol
Gennemført på testversionen: Virksomheder → Testvirksomhed A → reader@example.test → Log ind som bruger. Banner med målbruger og udløbstid samt kunde-dashboard er visuelt verificeret ved mobilbredde. Afslut supportadgang returnerede til René Jeppesens portaladministration. Remote audit viser support.started og support.stopped med platform-admin-rene som aktør og local-reader som mål; ingen aktive supportsessioner efter testen, og ingen FK-fejl.
Den gamle syntetiske reader@example.test-fixture manglede full_name og blev først korrekt afvist. Kun denne fixture fik navnet Syntetisk testlæser, afgrænset med id/mail/company/issuer og NULL-navn. Rigtige kunders profiler er ikke ændret. Brugere skal have accepteret invitationen og udfyldt profilen før supportlogin.
Lokale migrationer 0005/0006 er også anvendt uden genindsættelse af fixtures. Google/Microsoft og fælles branding er fortsat ikke aktiveret.
