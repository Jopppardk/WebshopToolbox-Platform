# Separat Tier 0-domæne

Bestilling: fjern link til Tier 0 fra kundelogin, brug admin.webshoptoolbox.dk til administrationen og undgå indeksering.

Implementeret lokalt:
- Tier 0-link fjernet fra kundelogin.
- X-Robots-Tag: noindex, nofollow, noarchive på alle platformens svar, også fejl/redirects. Samme robots-meta i login-, onboarding- og administrations-HTML.
- robots.txt tillader crawl, så søgemaskiner kan læse noindex. Private data kræver fortsat autentifikation; robots.txt bruges ikke som adgangskontrol.
- Valgfri PLATFORM_ADMIN_HOST=admin.webshoptoolbox.dk giver egen admin-indgang: root viderestiller til /admin/, kundelogin/auth-endpoints på admin-host afvises. Gamle GET/HEAD-adminadresser viderestilles til canonical admin-host; writes på gammel host afvises. Hostnavn og protokol bestemmes af konfiguration, ikke klientinput.
- Portaladministratorinvitationer bruger admin-host, når aktiveret. Ingen kundecookies eller supportcookies deles på tværs af hostnavne.
- Testkonfiguration accepterer kun det præcise admin-host og den tilhørende custom-domain-route. Variablen/routen er endnu IKKE aktiveret.

Afklaring afventer: admin.webshoptoolbox.dk skal knyttes til enten nuværende dev/test eller produktionsmiljøet. Brugeren er spurgt, fordi databaser og brugere er adskilte. Ingen DNS-/Access-/domæneændring udføres før svaret. Dette arbejde må ikke implicit publicere den endnu ikke aktiverede produktionsversion af kundelogin.

Ved aktivering: beskyt hele admin.webshoptoolbox.dk med det valgte miljøs eksisterende Access-app/politik før domænet tilknyttes Workeren. Bevar miljøets audience og valideret platformadministratorrolle. Afprøv adminredirect, API-afvisninger, login og noindex. Sablen, hoveddomænets hjemmeside og main er uberørt.

Kilde til indekseringsmekanismen: https://developers.google.com/search/docs/crawling-indexing/robots-meta-tag . Loginbeskyttelse beskytter data; noindex er et søgemaskinedirektiv, ikke garanti mod alle crawlers.

## Publiceret på dev
315 tests, build, typecheck, dev dry-run og legacy dry-run bestået. Dev-version `6dab3cd8-66d5-4786-bded-4900281bf4c8` publiceret. Ekstern kontrol af /login: 200, X-Robots-Tag noindex/nofollow/noarchive, robots-meta noindex og intet link til /admin/. Administrationsdomænet er endnu ikke tilknyttet, da dev/produktion-valget afventer. Ingen produktion-, Sablen- eller DNS/Access-ændringer i denne opgave.
