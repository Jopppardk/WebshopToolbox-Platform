# Mailafsender og testmail

Implementeret 14. september 2026 på den separate platform.

## Kundens forløb
Under Tier 1 → Indstillinger → Mailafsender kan virksomhedsadministratoren gemme afsendernavn og svaradresse. Standardafsenderen er faktura@webshoptoolbox.dk, konfigureret på serveren. Ingen egen domæneopsætning er nødvendig for standardafsenderen.

Egen afsender er valgfri. Kunden aktiverer sit domæne i Cloudflare DNS / Email Service / Email Sending og gemmer afsenderadresse, Account ID og et API-token med Email Sending: Edit til sin konto. Portalen ændrer ikke kundens DNS, MX eller DMARC. Opsætningen forklares i en fold-ud-vejledning. Ingen tredjeparts-mailkonto er indført.

Cloudflare-adgangsoplysninger lagres med den eksisterende AES-GCM-nøgle, bundet til miljø, virksomhed, afsenderadresse og Account ID. Ingen tokenværdi returneres eller skrives i auditlog. Ændret adresse, konto eller token kræver ny kontrol. Ved fjernelse af egen adresse slettes dens lagrede credentials.

Indtil en rigtig testmail fra egen adresse accepteres af Cloudflare, bruges standardafsenderen. Et positivt send-resultat kontrollerer, at Cloudflare tillader netop denne afsender med de gemte konto-oplysninger; det er ikke en garanti for levering til indbakken eller en selvstændig DNS-overvågning. En senere afsendelsesfejl kræver håndtering af afsenderstatus i den kommende fakturaadapter; ingen automatisk genafsendelse må ske.

## Sikkerhed og afgrænsning
- Virksomhedsadgang kontrolleres på serveren; kun virksomhedens administrator eller Tier 0 kan ændre og teste. Impersonering kan ikke ændre mailopsætning eller sende testmail.
- Testmail kan kun sendes til den autentificerede brugers egen, på forhånd tilladte loginadresse. Dev tillader rj@itm8.com og rene.jeppesen@live.dk; ingen vilkårlig modtager, emne, tekst eller vedhæftning fra klienten.
- Særskilt PLATFORM_MAIL_TEST-binding til standardafsenderen, med samme modtagerbegrænsning som serveren. Invitationsbindingen bevares separat.
- Egen Cloudflare-konto bruger et fast HTTPS REST-endpoint med valideret Account ID, timeout og uden redirects. Samme testmodtagerbegrænsning håndhæves før dette kald.
- Afsendelsesforsøg har en holdbar company_id/request_id-nøgle og et atomisk cooldown på 60 sekunder pr. virksomhed. Genafspilning af samme request sender aldrig igen. Usikkert resultat bevarer låsen og vises som uafklaret. Ny test kræver en bevidst ny handling.
- Lokal test viser kun mailen, sender aldrig og kan ikke godkende egen afsender.
- PLATFORM_CUSTOMER_EMAIL og bogføring er fortsat blocked. Testmailen indeholder ingen faktura. Dette er ikke en aktivering af almindelige kundemails.

## Validering og drift
Migration 0008_company_mail.sql er anvendt lokalt og på test-D1 efter backup i den ignorerede .wrangler/before-company-mail.sql. Ingen produktionsressourcer eller main er ændret. 298 tests, build, typecheck og begge Worker-dry-runs er bestået. Efter præcisering af Cloudflare REST-formatet (address/reply_to kontra Workers email/replyTo) er 37 platformtests og typecheck bestået igen.

Første dev-udgivelse a2136a63-c4f2-4c3b-8fe3-18f1f7c47808. Den efterfølgende REST-formatrettelse er deployet som 76046e48-6b82-4571-8d84-8dad6b1ed2cb. Browserens Access-session er udløbet; brugeren er bedt logge ind igen for livekontrol/testmail. Egen kundekonto er kontrakttestet med syntetiske responses, ikke afprøvet med et rigtigt kundetoken.

## Kilder
- https://developers.cloudflare.com/email-service/get-started/send-emails/
- https://developers.cloudflare.com/email-service/api/send-emails/workers-api/
- https://developers.cloudflare.com/api/resources/email_sending/methods/send/
- https://developers.cloudflare.com/email-service/examples/email-sending/recipients/

## Fakturafane – 14. september 2026
Mailafsenderen ligger nu under Indstillinger → Fakturaer. Afsendertesten sender fortsat uden bilag. Fra Fakturaer-oversigten kan man sende en test med den gemte PDF og virksomhedens mailskabelon, begrænset til samme godkendte loginadresser og leveringsclaims. Se INVOICE-MIGRATION.md.


## Ny Tier 1, 22. september 2026

Afsenderopsætningen er tilsluttet Faktura-afsendelse i den nye React-klient med en kort dialogguide. Der er afsendernavn, svaradresse, valg af egen adresse, Cloudflare Account ID og API-token. Ingen DNS ændres. Status skelner mellem standard, afventende og accepteret afsendertest; standard bruges indtil egen afsender er godkendt. Afsendertest er uden bilag; den særskilte fakturatest bruger den godkendte egen afsender med gemt PDF, ellers standard. Guide kontrolleret mod https://developers.cloudflare.com/email-service/get-started/send-emails/ den 22. september 2026.

## Justering af fakturatest og layout

> 22. september 2026 – Layoutjustering udgivet på dev som `768e3e1a-f583-4691-afb3-fa8acd5d1999`: Klassisk er nedtonet uden farvefelter/indramninger; Moderne overtager det tidligere klassiske udtryk. Tier 1-fakturatesten sender samme deterministiske demo-PDF som Se gemt eksempel med gemt design/logo og mailskabelon, uden opslag på rigtige ordrer eller krav om en gemt faktura. Egen loginadresse, allowlist og idempotente leveringsclaims gælder fortsat. Eget Cloudflare DNS-domæne er nu fremhævet med rød tekst øverst i afsendersektionen. 342/342 tests, begge typechecks, builds og dry-runs bestået; begge PDF-layouts renderet og visuelt kontrolleret. Ingen migration eller reel testmail afsendt under arbejdet. Sablen uændret, prod offline, bogføring/kundemail fortsat blokeret.


> 22. september 2026 – Afsendernavn rettet og udgivet kun på dev som `cbffce16-7a6c-496c-9d5d-25eca87ca7ca`. Fejlårsag: fallback læste navnet på D1-metoden first i stedet for at kalde den. Fælles navneresolver bruger nu gemt afsendernavn, ellers fakturaens firmanavn, ellers virksomhedens navn; GET-opsætning og afsendelse er konsistente. Regression kontrollerer faktisk mail-payload uden eget afsendernavn. 342/342 tests, begge typechecks og platformbuild/dry-run bestået. Ingen testmail sendt eller kundedata ændret under fejlsøgning; kun navnene læst i dev. Sablen/prod uberørt.
