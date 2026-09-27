# Kundelogin – 21. september 2026

## Implementeret
Tier 1: WebshopToolbox-login på `/login` med mailadresse og ottecifret engangskode. Tier 0: `/admin/`, fortsat Cloudflare Access og aktiv platformadministrator. Kundesessioner kan ikke give Tier 0-adgang. Eksisterende identiteter bevares. Google/Microsoft er ikke implementeret.

Kundeinvitationer kræver matchende mailkode og navn. Portaladministratorinvitationer bruger `/admin/onboarding` og verificeret Access-identitet. Produktion bruger `registered` invitationsmode; kun eksisterende serverautoriserede administratorer kan invitere. Dev bevarer sin modtagerbegrænsning.

## Sikkerhed
- Koder: 10 minutter, engangsbrug, browserbundet, fem forsøg. HMAC med separat PLATFORM_LOGIN_SECRET og miljønavn; rå koder gemmes ikke.
- Session: tilfældigt token, SHA-256 i D1, HttpOnly/Secure/SameSite=Lax __Host-cookie uden delt Domain. Seks timers maksimal levetid og 30 minutters inaktivitet. Serverbaseret logout.
- Aktiv bruger, aktiv virksomhed, medlemskab og fravær af platformadministratorrolle kontrolleres ved hvert kundekald. Deaktivering eller mailændring tilbagekalder sessioner. Servervalideret virksomhed/webshopafgrænsning bevares.
- Samme Origin kræves til login og logout. Login kræver JSON/POST. Frekvensgrænser per mail, IP og globalt. Samme offentlige startbesked til ukendte/deaktiverede/adminadresser.
- PLATFORM_AUTH_MAIL er adskilt fra fakturamail, fra no-reply@webshoptoolbox.dk. Dev kan kun sende til rj@itm8.com og rene.jeppesen@live.dk. Produktion sender kun kode til registrerede berettigede/inviterede kunder. Normal kundemail og bogføring forbliver blokeret.
- Usikker mailafsendelse genforsøges ikke automatisk. Lokal test kan vise koden; kun local-test på localhost.

## Testet
312 tests bestod før sidste profilrettelse. Derefter bestod alle 52 relevante platform-/produktionstests inklusive ny regressionstest (313 tests samlet i repositoryet). Build, typecheck, legacy dry-run, dev dry-run, production dry-run og diff-kontrol bestået. Browser: lokal mailkode, profil og korrekt kundedashboard gennemført med syntetisk bruger. Første browserkontrol fandt manglende profil-opstartsfejl; rettet og dækket af test.

## Deployet
Dev sikkerhedskopieret i ignoreret .wrangler/customer-login-dev-backup.sql. Migration 0010 anvendt. Separat loginsecret provisioneret uden at vise værdien. Version `43cc37ee-3c72-4a9a-b4d3-cc1509bdff90` deployet.

## Afventer
Cloudflare beskytter stadig hele dev-domænet. Formular klargjort, IKKE gemt: dev.webshoptoolbox.dk får path `admin`; gammel workers.dev-adresse forbliver fuldt beskyttet. Bruger bedt godkende adgangsgrænsen efter browserreglerne. Produktionskode/config klargjort lokalt; ingen produktionsmigration, secret eller deployment udført.

Automatisk godkendelseskontrol afviste lokal eksport af hele produktions-D1 som privat datakopi. Ingen eksport udført. Undersøg i stedet D1 Time Travel-gendannelsespunkt før produktionsmigration; gentag ikke eksport uden specifik godkendelse.

## Næste trin efter brugerens godkendelse
1. Gem dev Access-appens path admin. Kontrollér offentlig /login, Access på /admin/, 401 for anonyme kunde-API-kald.
2. Test kodeafsendelse til tidligere godkendt modtager rj@itm8.com; reel indbakke/login kræver brugerens verifikation.
3. Registrér produktionsgendannelsespunkt, provisionér NY separat PLATFORM_LOGIN_SECRET, anvend 0010 og deploy med scripts/platform-production.mjs. Gem Access-appens path admin for portal.webshoptoolbox.dk; bevar audience/politik/administratorliste.
4. Kontrollér loginform, Tier 0 Access og anonym API-afvisning. Dokumentér version og faktisk verifikation.

Rollback: beskyt hele domænet igen med tom Access-path først, gendan derefter tidligere Worker-version om nødvendigt. Migration 0010 er additiv. Fjern ikke data/secrets ved rollback. Sablen, hoveddomænet og main ændres ikke.

Gendannelsespunkt til produktion er efterfølgende læst med `wrangler d1 time-travel info PLATFORM_DB --config wrangler.platform-production.json` og gemt som metadata i ignoreret `.wrangler/customer-login-production-restore-point.log`. Ingen produktionsdata eksporteret eller ændret. [Cloudflare Time Travel](https://developers.cloudflare.com/d1/reference/time-travel/). Hent et friskt punkt ved senere udgivelse.

Afsluttende browserkontrol: logout er også gennemført. Formularafsendelse under no-referrer gav 403; logout bruger nu samme-origin JSON-fetch og manuel redirect, mens Origin-kontrollen bevares. Frontend syntakskontrolleret og rettelsen deployet på dev som version `219bed18-f7dd-4c81-bb93-c6976ef3affc` (erstatter ovenstående første version). Access-formularen er stadig ugemt og afventer godkendelse. Lokal loginforhåndsvisning står på http://127.0.0.1:8790/login.

## Dev aktiveret efter konkret godkendelse
Brugeren bad herefter om publicering på dev. Access-app fac8c207-ae43-4178-8452-22dd23f44943 er gemt med `dev.webshoptoolbox.dk/admin`; den gamle workers.dev-destination forbliver fuldt beskyttet. Dashboard bekræftede Application successfully configured. Ingen ændring af produktion/Sablen eller politik/audience.

Verificeret eksternt: `/login` 200 med WebshopToolbox-branding, `/admin/` og `/admin/api/platform/me` 302 til korrekt Access-host/audience, `/api/platform/me` 401 uden session. Browser-loginformularen blev anvendt én gang til rj@itm8.com; D1-optælling viste én aktuel challenge med delivery=accepted. Første read-only statusforespørgsel fik Cloudflare 7403; gentaget læsning lykkedes. Ingen mail genudsendt. Modtagelse i indbakke og fuldt login med rigtig kode afventer brugeren. Koden skal bruges i den browserfane, der anmodede om den, inden for 10 minutter.

Dev er således sat i drift på version 219bed18-f7dd-4c81-bb93-c6976ef3affc. Tidligere noter om ugemt dev-formular er historiske. Produktion er fortsat uændret; seneste bestilling afgrænsede aktiveringen til dev.

## 27. september 2026 – produktionslogin opdelt og aktiveret

Efter brugerens bestilling er destinationen på eksisterende Access-app `ffaf131f-cd7e-48a1-aad8-94dc4c709aa3` ændret fra hele portal.webshoptoolbox.dk til `portal.webshoptoolbox.dk/admin`. App, audience, administratorpolitik `c3b21df3-4275-415c-9d16-607420e7550c`, mailkode og seks timers session er bevaret. Sablen og dev er ikke ændret. Der oprettes ikke separat admin-domæne; Tier 0 tilgås på /admin i hvert miljø.

Kontrolleret online efter lagring: prod / giver 303 til /login, /login giver 200 og viser WebshopToolbox-formularen med mailkode uden Cloudflare-login. /admin, /admin/ og /admin/api/platform/me giver 302 til Access. /api/platform/me, /api/platform/companies og ordre-API giver 401 anonymt. /local-login giver 401. Offentlige Worker-svar har noindex, nofollow, noarchive. /healthz giver 200 med environment=production og bogføring/kundemail blocked. Devs samme login-/API-/Access-kontroller bestod også.

Ingen kode-deployment, databaseændring eller mailafsendelse i denne aktivering. Reel modtagelse af kundens mailkode og fuldt kunde-/administratorlogin er ikke afprøvet her. Seneste kode-CI og begge GitHub-deployments er bestået. Tidligere noter om domænedækkende produktions-Access er nu historiske.
