# Invitationer og førstegangsprofil

Status 13. september 2026: Implementeret, afprøvet lokalt og deployet til test som `a310b9db-6ff5-40aa-b305-034bf74e4310`. Endnu ikke committed eller pushet. Portaladministratorens profil er gemt af brugeren, og rigtig testinvitation er sendt. Modtagelse og accept afventer brugeren. Sablen og main er uændrede.

## Seneste driftsopfølgning

- Cloudflare Email Sending viser nu webshoptoolbox.dk som Enabled / Configured. MX/SPF på cf-bounce, DKIM og DMARC p=reject er aktiveret efter brugerens udtrykkelige godkendelse. Den automatiske godkendelseskontrol havde først afvist DNS-ændringen; godkendelsen løste blokeringen. Sablen-mail er ikke ændret.
- Brugeren godkendte rj@itm8.com som testmodtager. Kun denne adresse er tilladt i invitationskonfigurationen og mailbindingen; afsender er no-reply@webshoptoolbox.dk. Testappens egen Access-politik tillader nu denne adresse og den eksisterende portaladministrator. Politikken er kun tilknyttet én app.
- Remote dubletmailkontrol fandt ingen konflikter. Backup er gemt i ignoreret .wrangler/before-invitations.sql. Migration 0003 er anvendt uden ny seed, og remote dry-run med den begrænsede mailbinding bestod før deployment.
- Brugeren har gemt portaladministratorens profil. Den separate Testvirksomhed – invitation er oprettet gennem testportalen. Invitation til rj@itm8.com blev sendt 13. september 2026 kl. 12.55 dansk tid; UI bekræfter sendt, status Inviteret og automatisk rolle Virksomhedsadministrator. Den eksisterende portaladministrator og LA Trading ApS er bevaret. Modtagelse, OTP-retur og profilaccept afventer brugeren; afsendelsesstatus er ikke bevis for modtagelse i indbakken.
- Microsoft/Google er fortsat ikke konfigureret. OTP er den nuværende loginmetode. Bogføring og kundemail er fortsat blokeret.

## Besluttet forløb

- Brugeren inviteres med mailadresse fra sin virksomhed. Første invitation får automatisk virksomhedsadministratorrollen; de efterfølgende roller vælges af virksomhedens administrator.
- Virksomhedsadministratorer administrerer egne invitationer, roller og webshopadgang. Portaladministratorer inviteres særskilt under Portalindstillinger.
- Login sker med engangskode eller senere Microsoft/Google. Ingen lokale adgangskoder. Navn er obligatorisk ved første login; telefonnummer er valgfrit.
- Afsender valgt af brugeren: `no-reply@webshoptoolbox.dk`.

## Implementeret

Migration `0003_invitations.sql` tilføjer normaliseret unik mailadresse, profilfelter, invitationsstatus, udløb og tokenhash. Nye inviterede brugere er inaktive med en utilgængelig placeholderidentitet indtil accept. En eksisterende virksomheds-/portalidentitet flyttes eller sammenkobles ikke automatisk.

Invitationer udløber efter 48 timer. Accept kræver både linkets tilfældige 256-bit token og den matchende mailadresse i en verificeret Cloudflare-JWT med korrekt signatur, issuer, audience og udløb. Identitet, profil, aktivering og audit gemmes atomisk. Tokenet gemmes kun som SHA-256 i databasen. Linket bruger queryparameter, så det kan overleve Cloudflares login-returforløb; siden fjerner parameteren straks efter login og bruger `Referrer-Policy: no-referrer`. Undlad URL/querylogging på onboarding-ruten. Linket alene giver aldrig adgang.

En ny invitation til samme bruger ugyldiggør det gamle link; invitationen kan tilbagekaldes. Usikker mailafsendelse genforsøges ikke automatisk. Administratoren ser leveringsstatus og kan bevidst vælge at sende et nyt link.

Database-triggere beskytter den sidste aktive virksomhedsadministrator mod deaktivering, rolletab eller fjernelse. En afventende administratorinvitation tæller ikke som en aktiv administrator. Profilkravet håndhæves på serveren, også hvis klienten springer formularen over.

Lokal invitationstilstand `preview` viser et link til administratoren uden at sende mail. Denne tilstand afvises i fjernmiljøet. Fjernmiljøets separate binding `PLATFORM_INVITATIONS` må kun sende fra den valgte afsender til udtrykkeligt godkendte testmodtagere. Begge de eksisterende blokeringer for bogføring og kundemail bevares. Bindingen er tilføjet og deployet med kun rj@itm8.com som modtager.

## Afprøvet

- 285 tests bestået i hele repositoryet, heraf 24 platformtests. Build, typecheck og begge dry-runs bestået. Efter den sidste justering af lokal testlogin og invitationslinkets queryparameter er de 24 platformtests kørt igen og bestået.
- Lokalt Workerd-miljø migreret uden ny seed. Browserkontrol: eksisterende bruger skal udfylde navn; invitation med mail/rolle viser status Inviteret; separat syntetisk login accepterer invitationen, udfylder profil og åbner sin virksomhed.
- Tests dækker forkert mail, manglende mailclaim, brugt/udløbet/tilbagekaldt invitation, fornyelse, dubletmail på tværs af virksomheder, profilkrav, første administrator, sidste administrator, testmodtagerliste og usikker afsendelse uden automatisk retry.
- Rigtig invitationsmail, retur fra Cloudflare-login med invitationslink, Google og Microsoft er endnu ikke end-to-end-testet. Ny Linux-CI er ikke kørt.

## Historik: eksterne afhængigheder før mailaktivering

Punkt 1–3 og migrationsdelen af punkt 5 er nu udført som beskrevet ovenfor. Loginudbydere og invitationens samlede mail-/loginprøve udestår fortsat.

1. Cloudflare Email Sending afviser `webshoptoolbox.dk` som inaktiv zone. Dashboardet viser afventende navneservere `beau.ns.cloudflare.com` og `lady.ns.cloudflare.com`; tidligere navneservere er hos Simply. Brugeren arbejder på dette og skriver, når det virker. Ingen navneservere, DNS-poster eller Sablen-mailindstillinger er ændret i denne opgave.
2. Når zonen er aktiv, onboard kun `webshoptoolbox.dk` i Email Sending. Gennemgå DNS-tilføjelser, bevar eksisterende mailopsætning, og konfigurér særskilt binding med afsender og godkendt testmodtagerliste. En ekstra testmodtager er efterspurgt og afventer svar; den nuværende portaladministrator skal ikke konverteres til virksomhedsbruger.
3. Tilføj den godkendte testmodtager til testappens egen Cloudflare Access-politik (`fac8c207-ae43-4178-8452-22dd23f44943`). Sablen-app/politikker må ikke ændres. I en senere løsning med vilkårlige invitationer skal Access-politikken og kapaciteten tilpasses bevidst; invitationskontrollen på serveren skal altid bestå.
4. Google/Microsoft kræver egne OAuth-appregistreringer og klientoplysninger. Brugeren er spurgt om adgang til disse konti; svar afventes. Callback for dette team er `https://flat-sun-0738.cloudflareaccess.com/cdn-cgi/access/callback`. Aktivér udbyderne kun på testappen, bevar OTP, og slå instant redirect fra ved flere udbydere. Microsofts kontotyper og mailclaim skal verificeres; brug ikke et vilkårligt eller uverificeret brugernavn som bevis på ejerskab af invitationsmailen.
5. Før fjernmigration: eksportér test-D1, kontrollér dubletmails, kør migration 0003 og deploy kun test-Worker. Eksisterende brugere skal herefter udfylde deres navn. Afprøv rigtig invitation og alle valgte loginmetoder med den godkendte testmodtager før leverancen kaldes sat i drift.

## Kilder til opsætning

- [Cloudflare Email Sending](https://developers.cloudflare.com/email-service/get-started/send-emails/)
- [Begrænsede mailbindings](https://developers.cloudflare.com/email-service/configuration/send-bindings/)
- [Google-login](https://developers.cloudflare.com/cloudflare-one/integrations/identity-providers/google/)
- [Microsoft Entra ID](https://developers.cloudflare.com/cloudflare-one/integrations/identity-providers/entra-id/)
