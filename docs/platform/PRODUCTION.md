# Produktionsportal – publiceret 20. september 2026

> 27. september 2026 – Efter brugerens bestilling er den samlede dev-løsning udgivet på WebshopToolbox Prod som `019381d6-d94d-48a2-a125-8d4829a54629`. Tier 1-klient/API og produktfeeds er åbnet for production-miljøet; produktionsscript bygger nu klienten. Migration 0010–0024 anvendt efter backup `.wrangler/prod-before-release-20260927.sql` og kopiprøve med eksisterende rækker bevaret i 19 tabeller. Remote FK-kontrol OK; 1 bruger/administrator og 0 virksomheder, ingen dev-data kopieret. Separat krypteringsnøgle genetableret og separat login-secret oprettet i ignoreret secret-backup. 349/349 tests, begge typechecks, produktionsbuild/dry-run bestået. DNS og certifikat verificeret; alle portalstier giver endnu 302 til den gamle, domænedækkende Access-app. **Kundelogin er derfor ikke færdigverificeret:** Cloudflare-dashboard kræver brugerlogin; Wrangler OAuth kan ikke ændre Access. Brugeren er bedt logge ind i den åbne fane. Næste skridt: begræns eksisterende produktions-Access-app til Tier 0, behold administratorpolitik/audience og kontrollér kunde-login/feed samt adminbeskyttelse. Admin-domænet er fortsat ikke tilknyttet. Bogføring/kundemail/cron er fortsat blokeret. Dev, Sablen og hjemmeside uændret; ingen merge/push. Remote main er nu fc6c8cbcf6be1d771971844180fa05d8ed82e1ee; disse urelaterede ændringer er ikke hentet eller overført.

> 21. september 2026 – **Toolbox-produktionen er taget ned efter brugerens bestilling.** Worker `webshop-toolbox-platform-production` er slettet via Wrangler med eksplicit produktionskonfiguration. Dens custom domain `portal.webshoptoolbox.dk` er fjernet automatisk; efterkontrol viser ingen produktions-Worker og ingen tilknytning for domænet i Cloudflare. Portal-domænet gav ENOTFOUND, den tidligere workers.dev-adresse gav 404. Dev healthz giver fortsat 200 med bogføring/kundemail blokeret; dev- og Sablen-Workers findes fortsat. D1, R2 og Access-app er ikke slettet eller ændret; dette var fjernelse af udgivelsen, ikke en ny datanulstilling. Ingen kildekodeændring, push eller merge. Næste produktionsudgivelse skal bygge på den færdige, godkendte dev-version. Worker, bindings, secrets og domæne skal genetableres og migrationsbehov kontrolleres før udgivelse; secrets følger ikke med automatisk efter Worker-sletning. Eksisterende lokal secret-backup er omtalt i PRODUCTION.md og må ikke offentliggøres. Historiske beskrivelser af aktiv produktion nedenfor gælder ikke længere.


Brugerens bestilling: publicér løsningen på portal.webshoptoolbox.dk. Sablen, dev og hoveddomænets hjemmeside skal bevares uændrede. Ingen merge til main.

## Afgrænsning
Første udgivelse er begrænset drift med virksomhed/webshop-/brugeradministration og den hidtidige fakturafunktion. Bogføring, almindelig kundemail og automatiske jobs er fortsat blokeret. Kunders selvbetjente prøveoprettelse, finansmodulernes fulde migrering og end-to-end-verifikation med rigtige Shopify-data er ikke løst ved publiceringen.

## Nye ressourcer oprettet
- Worker-navn: webshop-toolbox-platform-production.
- Egen D1: webshop-toolbox-platform-production, ID c3775354-8cc9-4f68-9343-1bde30776245.
- Egen privat R2: webshop-toolbox-platform-production-documents.
- Hostname: portal.webshoptoolbox.dk; workers.dev og preview-URL'er deaktiveres.
- Ingen testdata, kundekonti, credentials eller dokumenter overføres. Kun den eksisterende René-administrator klargøres fra aktiv verificeret registrering. Bootstrap-SQL ligger ignoreret i .wrangler/production-admin.sql.

## Klargjort i kode
wrangler.platform-production.json, scripts/platform-production-config.mjs og scripts/platform-production.mjs giver særskilte validerede check/build/migrate/deploy-kommandoer. Konfigurationen afviser dev-/Sablenressourcer, forkert domæne, offentligt workers.dev, cron, lokal JWT og aktivering af kundemail/bogføring. Runtime kræver særskilt production Access-audience, Secure supportcookie og produktionsdomæne i invitationslinks. HTML viser Portal · begrænset drift.

## Aktiveret login
Brugeren bekræftede konkret loginaktivering 20. september 2026, efter auto-review havde krævet en ekstra bekræftelse. Den klargjorte formular blev derefter indsendt normalt i Cloudflare-dashboardet.

Access-app WebshopToolbox Portal: `ffaf131f-cd7e-48a1-aad8-94dc4c709aa3`. Audience: `8029826e98be59c035aba9af67ee49560bea48baae6567048d989d16d465b72f`. Egen politik `c3b21df3-4275-415c-9d16-607420e7550c`: kun rene.jeppesen@live.dk, onetimepin, seks timers session. Ingen bypass, service-token eller dev-audience. Dev og Sablenpolitik er uændrede. Nye kundeidentiteter kræver separat Access-adgang; publiceringen åbner ikke automatisk for alle kunder.

## Kontroller
Alle 304 tests bestået, heraf 43 platform-/produktionstests. Build, efterfølgende typecheck, legacy dry-run og fælles platform dry-run bestået. Produktionskonfigurationens egen validering og dry-run er også bestået med den faktiske Access-audience. GitHub main verificeret til 73e45ac80568c6c6de3057fd41dcbe3c8dd2e6e9, platformbranch remote stadig b9acb153d922f706a64f2faaf08f08dae4e346ea. Ingen merge/fetch af urelaterede ændringer.

## Sat i drift
- Migrationer 0001–0009 anvendt på ny produktions-D1. Første migrationsforsøg blev afvist med Cloudflare 7403; konto og databasen blev verificeret med whoami/list, og næste migrationsforsøg bestod.
- Eksisterende verificeret administratoridentitet overført med auditpost production.admin.created. Kontrol efter deployment: 1 bruger, 1 platformadministrator, 0 virksomheder, 0 webshopforbindelser.
- Ny særskilt PLATFORM_CREDENTIALS_KEY genereret og gemt som Worker-secret. Ingen dev-nøgle genbrugt. Lokal secret-backup ligger kun i ignoreret .wrangler/platform-production-secrets.json; må aldrig vises eller committes.
- Deployet version `ef0c31fe-deed-42a3-aa6c-a0fe00e36165` på https://portal.webshoptoolbox.dk.
- Verificeret med normal DNS/certifikatkontrol: HTTPS giver 302 til den korrekte Access-app/audience; HTTP giver 301 til HTTPS. Produktions-Workerens workers.dev-adresse giver 404.
- Browser viser Log in to WebshopToolbox Portal med mailkode. Bruger er bedt logge ind til afsluttende kontrol af administrationsvisningen; denne kontrol afventer endnu. Fælles Access-header kan fortsat vise Sablen Toolbox, da global branding ikke ændres på tværs af apps.
- Ingen produktionsmail sendt, ingen økonomiske posteringer, ingen testvirksomheder overført. Ingen push/main-merge eller opdatering af dev, Sablen eller hjemmeside-Worker.

## Opfølgning
Kontrollér første administratorlogin. Bevar tydelig status om begrænset drift. Kundeinvitationer er fortsat begrænset til den tidligere godkendte modtagerliste; nye kunder kræver færdiggjort onboarding-/Access-politik og særskilt aktivering. Fuld finansintegration, almindelig kundemail og automatisk import er ikke aktiveret ved denne publicering.

## 27. september 2026 – produktionslogin opdelt og aktiveret

Efter brugerens bestilling er destinationen på eksisterende Access-app `ffaf131f-cd7e-48a1-aad8-94dc4c709aa3` ændret fra hele portal.webshoptoolbox.dk til `portal.webshoptoolbox.dk/admin`. App, audience, administratorpolitik `c3b21df3-4275-415c-9d16-607420e7550c`, mailkode og seks timers session er bevaret. Sablen og dev er ikke ændret. Der oprettes ikke separat admin-domæne; Tier 0 tilgås på /admin i hvert miljø.

Kontrolleret online efter lagring: prod / giver 303 til /login, /login giver 200 og viser WebshopToolbox-formularen med mailkode uden Cloudflare-login. /admin, /admin/ og /admin/api/platform/me giver 302 til Access. /api/platform/me, /api/platform/companies og ordre-API giver 401 anonymt. /local-login giver 401. Offentlige Worker-svar har noindex, nofollow, noarchive. /healthz giver 200 med environment=production og bogføring/kundemail blocked. Devs samme login-/API-/Access-kontroller bestod også.

Ingen kode-deployment, databaseændring eller mailafsendelse i denne aktivering. Reel modtagelse af kundens mailkode og fuldt kunde-/administratorlogin er ikke afprøvet her. Seneste kode-CI og begge GitHub-deployments er bestået. Tidligere noter om domænedækkende produktions-Access er nu historiske.
