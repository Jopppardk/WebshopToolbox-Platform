# Kundestyret bogføringsopstart

Implementeret 27. september 2026. Udgivelsesstatus findes i CHANGELOG.md.

## Kundens valg

Integrationer har separate felter **Hent historik fra** og **Bogfør fra og med**. Historik påvirker kun læseperioden. Bogføringsstart gemmes pr. virksomhed, webshop og datakilde; også Dinero-grænsen gælder den valgte webshop. Begge bogføringsdatoer skal være sat, og den seneste grænse gælder. Tom dato betyder manglende opsætning. Datoer er inklusive i Europe/Copenhagen; refunderinger og udbetalinger følger deres egen hændelsesdato, ikke ordrens dato. At gemme datoer starter hverken import eller bogføring.

Ingen eksisterende historikdato konverteres til bogføringsdato. Migration 0025 opretter kun tomme tabeller. Der hentes ikke historik for Sablen eller andre kunder ved implementering eller deployment.

## Afstemning

Under Dinero kan en virksomhedsadministrator manuelt vælge en datakilde, posttype, eksternt ID og GUID for et eksisterende manuelt Dinero-bilag. Posten skal allerede være hentet til den valgte webshop. Preview læser kun det valgte bilag fra virksomhedens tilknyttede organisation. Kunden kontrollerer dato, reference, beløb og valuta og bekræfter sammenhængen. API'et kan ikke generelt bevise forbindelsen fra et ordrenummer alene: der foretages derfor **ikke automatisk eller massevis matchning**. Dette er en assisteret, manuel afstemning.

Bekræftelsen udløber efter 10 minutter og er kryptografisk bundet til miljø, bruger, virksomhed, webshop, post, organisation, forbindelsesrevision og kilde-/bilagsindhold. Bilaget genlæses ved bekræftelse. Kun Booked accepteres; Draft kan vises, men gemmes ikke som bogført. Ingen writes til Dinero ud over OAuth-tokenudstedelse.

Den gemte kvittering indeholder bilags-GUID/nummer, organisation, kilde, kontrolgrundlag, bruger og tidspunkt. Samme organisationsbilag kan ikke knyttes til en anden post, heller ikke i en anden webshop. Kvitteringer overskrives ikke ved genhentning eller ændring af datoer. En ændret kilde vises som **Afstemt · ændret post** og kræver manuel kontrol. En ny tilknyttet Dinero-organisation arver ikke gamle statuser.

Ordrer, refunderinger og udbetalingsoversigten viser opsætning/historiske poster/afstemningsbehov i stedet for ubetinget pending. Import- og bilagsafstemning kan ses i ordre-/udbetalingsloggen. Modtagne betalinger sidestilles ikke med en bogført ordre.

## Sikkerhedsgrænse og resterende arbejde

Bogføring og normal kundemail er fortsat serverblokeret i begge miljøer. En dato eller gemt kvittering aktiverer ingen overførselsadapter. Fremtidige adaptere skal bruge kvitteringsnøglen før hver ekstern oprettelse og fortsat holde usikre writes til kontrol. OnboardingStatus gør ikke en uafstemt post klar til oprettelse. Bulk-afstemning, automatisk kandidatfindning og rettelse/ophævelse af en manuelt bekræftet sammenhæng er ikke implementeret. Dashboardets generelle importtællere er ikke et afstemt regnskab.

## Test

Syntetiske tests dækker adskilte datoer og webshops, ugyldige datoer, dansk midnat/sommertid, rettighedsafvisning før eksterne kald, kun GET til Dinero efter OAuth, Draft-afvisning, ændret kilde/bilag/forbindelse, krypteret bekræftelse på tværs af webshops, dublet-GUID, kvitteringsbevarelse og overlappende eksterne ID'er. Alle migrationer afvikles mod tom SQLite og syntetiske kunder i testharnessen. Ingen live økonomiske testposteringer eller kundeafstemninger.

Før remote migration er D1 Time Travel-bookmarks registreret: dev `0000006a-00000000-000050f3-7acb3f0184b1f0f691f3d560e540315a`, prod `00000010-0000014e-000050f3-c62cbbf8e3f0329fefe6afcebbadb582`. Ingen kundedata eksporteret.
