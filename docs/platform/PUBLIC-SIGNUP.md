# Selvbetjent prøveoprettelse – 28. september 2026

Implementeret og lokalt testet på platform/public-signup. Udgivelse koordineres med production-runtime i den anden aktive opgave. Der må ikke deployes fra den gamle work/platform-klon. Hjemmesiden er separat i work/website.

## Forløb

/signup på kundeportalen opretter virksomhed, første inaktive virksomhedsadministrator, medlemskab, invitation, accepteret vilkårsversion og audit atomisk. CVR og normaliseret mail er unikke for selvbetjente tilmeldinger. CVR er selvoplyst; det er ikke validering af tegningsret. Ingen webshop, integration eller økonomiske writes oprettes automatisk.

Samme-origin JSON, validering, honeypot og IP/mail/global begrænsning beskytter formularen. Dubletter giver generisk svar og sender ikke mails igen. Invitationens 256-bit token gemmes kun hashed. Velkomstmail bruger fast origin, afsender og almindelig tekst. Linket kræver efterfølgende mailkode i samme browser og den tilmeldte mailadresse. Ukendt afsendelsesudfald bliver uncertain, uden automatisk retry. Tier0 kan bevidst forny invitationen via virksomhedens brugeroversigt; det bruger også velkomstskabelonen.

Tre kalendermåneder starter én gang via database-trigger ved verificeret aktivering. Kontaktfrist er 14 dage før udløb. customerActor spærrer efter udløb for alle virksomhedens brugere. Ingen automatisk betaling. Produktionens nye baggrundsjobs skal også kontrollere public_signups.trial_ends_at, før de behandler en virksomhed. Fortsættelse/betaling efter prøveperioden er ikke implementeret i denne leverance.

## Tier0

Portalindstillinger har emne/tekst for velkomstmailen med {{name}}, {{company}} og påkrævet {{link}}. Gemning bruger versionskontrol og audit. Oversigten viser virksomhed/CVR, mail, leveringsstatus, udløb, kontaktfrist og Markér kontaktet. Opfølgningen er manuel, ikke en automatisk påmindelsesmail. Kun portaladministrator uden supportimpersonering har adgang.

## Migration og verifikation

0028_public_signup.sql tilføjer to tabeller og en trigger; ændrer/sletter ingen eksisterende rækker. Nummeret undgår production-runtime-opgavens 0026/0027. Alle migrationer køres mod syntetiske testdata i testsuiten. Cloudflare D1 understøtter den anvendte kalendermånedsberegning (read-only forespørgsel verificeret).

363/363 tests bestået, heraf 95 platformtests. Begge typechecks, build, platform- og produktions-dry-run samt legacy-pakkevalideringen fra CI består. Nye tests omfatter aktivering, prøveperiode, ingen Tier0-eskalering/krydsadgang, dubletter, rollback, misbrug/CSRF/samtykke, redigering af skabelon og ingen genafsendelse ved usikkert udfald. Fysisk modtagelse af velkomstmail og fuldt nyt onlinekundelogin er endnu ikke prøvet.

Lokal fuld databaseeksport blev afvist af automatisk sikkerhedskontrol pga. mulige kundedata. Ingen data blev eksporteret. I stedet læst Cloudflare Time Travel bookmarks uden kundedata: prod 00000028-000000f6-000050f4-83818df9b3e0979103a9916f0a685870; dev 0000006d-00000000-000050f4-1dbd0d7bae465087c8eb787ff1811693. Disse er tidsbegrænsede recovery-punkter, ikke varige arkiver. Gendannelse af hele databasen må ikke udføres blindt efter nye writes. Friske bookmarks skal registreres umiddelbart inden migration.

## Hjemmeside

Prøve-CTA linker til https://portal.webshoptoolbox.dk/signup. Hjemmeside, vilkår, privatliv, login-cookies og llms.txt er klargjort til prøveoprettelse i begrænset drift. Publicér først disse ændringer, når den nye portalrute er verificeret. Eksisterende lanceringskontakter bevares; ingen masseudsendelse eller automatisk konvertering af disse kontakter.
