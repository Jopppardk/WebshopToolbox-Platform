# Domæner og positionering

> 21. september 2026 – **Toolbox-produktionen er taget ned efter brugerens bestilling.** Worker `webshop-toolbox-platform-production` er slettet via Wrangler med eksplicit produktionskonfiguration. Dens custom domain `portal.webshoptoolbox.dk` er fjernet automatisk; efterkontrol viser ingen produktions-Worker og ingen tilknytning for domænet i Cloudflare. Portal-domænet gav ENOTFOUND, den tidligere workers.dev-adresse gav 404. Dev healthz giver fortsat 200 med bogføring/kundemail blokeret; dev- og Sablen-Workers findes fortsat. D1, R2 og Access-app er ikke slettet eller ændret; dette var fjernelse af udgivelsen, ikke en ny datanulstilling. Ingen kildekodeændring, push eller merge. Næste produktionsudgivelse skal bygge på den færdige, godkendte dev-version. Worker, bindings, secrets og domæne skal genetableres og migrationsbehov kontrolleres før udgivelse; secrets følger ikke med automatisk efter Worker-sletning. Eksisterende lokal secret-backup er omtalt i PRODUCTION.md og må ikke offentliggøres. Historiske beskrivelser af aktiv produktion nedenfor gælder ikke længere.


> 20. september 2026: Produktionsportal på portal.webshoptoolbox.dk er publiceret med egne ressourcer og særskilt, godkendt Access-login. Version ef0c31fe-deed-42a3-aa6c-a0fe00e36165. Begrænset drift: kun René-administrator, ingen testdata og fortsat blokeret bogføring/kundemail. HTTPS og loginredirect verificeret; første administratorlogin afventer kontrol. Se [PRODUCTION.md](PRODUCTION.md).

Beslutning 13. september 2026:
- dev.webshoptoolbox.dk: nuværende separate testplatform, både Tier 0 og Tier 1 afhængigt af rolle.
- portal.webshoptoolbox.dk: planlagt fremtidig produktion. Ingen produktionsplatform er oprettet/deployet her endnu.
- webshoptoolbox.dk: reserveret til kommende hjemmeside med produktbeskrivelse og mulighed for at oprette prøveperiode. Hjemmeside, selvbetjent oprettelse og prøveperiode er ikke implementeret som del af domæneopgaven.

## Konfiguration
Custom Domain i wrangler.platform-test.json peger kun på dev.webshoptoolbox.dk. Konfigurationsvalidering afviser portal, hoveddomæne, wildcard og Sablen-domæne. Cloudflare Access-testappen fac8c207-ae43-4178-8452-22dd23f44943 har nu både den oprindelige workers.dev-adresse og dev.webshoptoolbox.dk som beskyttede public hostnames. Eksisterende politik, OTP, 6 timers session, issuer og AUD er bevaret. Sablen Access-app er ikke ændret. Global branding afventer stadig tidligere afklaring.

Invitationslinks bruger nu https://dev.webshoptoolbox.dk/onboarding. Eksisterende links på workers.dev kan fortsat bruges, så længe selve invitationen er gyldig. Sessioner/cookies er hostafgrænsede; et nyt login kan være nødvendigt på det nye domæne. Test-D1, R2, krypteringsnøgle, bogføringsblokering og kundemailblokering er de samme. Ingen nye konti/data oprettes eller flyttes.

## Taglineforslag (ikke endeligt valgt)
Anbefalet: Fra webshop til regnskab. Helt enkelt.
Alternativer: Dine webshops. Ét samlet overblik. / Mindre manuelt arbejde. Mere webshop.
Logoet er ikke ændret som del af denne opgave.

## Verifikation
31 platformtests og alle 292 repositorytests bestået, inklusive afvisning af forkerte domæner. Platform-dry-run bestået. Access-dashboard bekræftede Application successfully configured efter tilføjelse af dev-hostname. Endelig deployment/HTTPS-kontrol tilføjes nedenfor.

## Udrullet 13. september 2026
Worker-version 9ae071a5-e783-4977-a77a-6cc51355e688 er deployet med dev.webshoptoolbox.dk som Custom Domain. Build, typecheck og legacy-dry-run bestået. Offentlig DNS (1.1.1.1) returnerer Cloudflare-IP'er. HTTPS med normal certifikatkontrol mod den DNS-verificerede IP returnerer 302 til den eksisterende Access-issuer og testappens korrekte AUD, med dev.webshoptoolbox.dk som logindestination.
Lokal DNS/browser havde stadig negativ cache (ERR_NAME_NOT_RESOLVED), så nyt autentificeret browserlogin på dev-domænet er ikke verificeret i denne omgang. Browserens interne fejlside kunne ikke læses af Browser Use URL-policy; den er ikke omgået. Ingen ændring af lokal DNS/firewall/proxy. Ved næste kontrol åbnes det almindelige HTTPS-domæne efter DNS-cacheudløb. Gammel workers.dev-adresse bevares som tidligere fungerende adgang.
Ingen ændring af portal.webshoptoolbox.dk eller hoveddomænets hjemmeside/DNS som del af udgivelsen. Ingen merge, push eller Sablen-produktionsændring.

## Hoveddomæne – 20. september 2026
webshoptoolbox.dk er nu Custom Domain for den separate webshoptoolbox-website Worker. HTTPS og offentlig DNS verificeret. Præsentation og interessetilmelding er udgivet; selvbetjent prøveoprettelse er fortsat ikke implementeret. Se [WEBSITE.md](WEBSITE.md).
