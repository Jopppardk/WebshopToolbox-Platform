# Funktionsgennemgang: Sablen → WebshopToolbox

Dato: 21. september 2026. Type: læsende kode-/konfigurationsanalyse, ikke en udgivelse.

## Konklusion

**Nej: funktionerne er ikke flyttet 1:1.** Platformen har et reelt administrationsgrundlag, brugere/virksomheder, adgangskontrol, forbindelsesopsætning og en delvis fakturafunktion. En stor del af Sablens driftsfunktioner er endnu kun repræsenteret af menupunkter og tomme tabeller. Fakturamailen og PDF-layoutet har desuden konkrete afvigelser, også fra ændringer merged efter platformens fakturamigrering.

Det er derfor ikke korrekt at beskrive leverancen som den samme integrationsløsning med nyt navn. At vi tidligere har omtalt fakturafunktionen som flyttet uden en tydelig liste over afvigelser, har givet et for positivt billede af færdiggørelsen.

**To forhold skal holdes adskilt:** Bogføring/kundemail skal fortsat være blokeret i dev efter den aftalte sikkerhedsmodel. Men flere nødvendige adaptere, kørsler og brugerfunktioner er slet ikke implementeret i platformens aktive kode. En ændring af en indstilling kan ikke gøre disse moduler færdige.

## Grundlag og sikkerhed i konklusionerne

- GitHub main er hentet uden checkout eller merge: `73e45ac80568c6c6de3057fd41dcbe3c8dd2e6e9`, seneste merge PR #68 den 16. september. Platformbranch er fortsat `platform/admin-foundation`, HEAD `b9acb15`, med omfattende eksisterende lokale platformændringer. Det er den faktiske lokale platformkode, ikke bare branchens HEAD, som er sammenlignet.
- Sablen-reference: alle **44 API-routefiler**, side/navigation, indstillinger, faktura-/mail-/PDF-kode, integrations- og driftsmoduler samt seneste ændringshistorik. Rute-for-rute-bilag: [CSV](C:/Users/rj/Documents/Codex/2026-09-07/je/work/WebshopToolbox/work/platform/docs/platform/PARITY-ROUTES-2026-09-21.csv).
- Dev: senest dokumenteret deployet version `6dab3cd8-66d5-4786-bded-4900281bf4c8`. Kundelogin/noindex-arbejdet er med. Produktionsportalen er en ældre, separat udgivelse `ef0c31fe-deed-42a3-aa6c-a0fe00e36165` med eget datagrundlag. Dev og produktionsportalen må ikke behandles som samme version.
- Sablen-Cloudflare er kontrolleret læsende: seneste listede deployment er 16. september kl. 09:17 UTC, Worker-version `5c57ed45-7d7a-4343-849e-5abd45966801`, 100 % trafik. Versionsmetadata indeholder ikke Git-SHA, så byte-for-byte-sammenhæng mellem denne version og main er **ikke bevist**. Seneste main er det reproducerbare sammenligningsgrundlag.
- Åbne PR'er er kontrolleret: #31 om automatisk genkendelse af emballagens kg-felter står stadig åben. Den er ikke regnet som merged produktionsbaseline.
- Ingen produktionsdata eksporteret, ingen kundemails eller økonomiske handlinger udført, ingen ændring af Worker/DNS/Access, intet merge/push. Der er kun oprettet analysebilag og hentet kildekode/versionsmetadata.
- Dette er ikke en afsluttet side-for-side-test af to autentificerede liveportaler. Konkrete kildekodeforskelle nedenfor er verificeret; faktisk brugeroplevelse og rigtige integrationers end-to-end-adfærd skal efterprøves som accepttest. Upublicerede ændringer i andre lokale arbejdsmapper er ikke automatisk medtaget.

## 1. Faktura-mail: konkrete forskelle

| Funktion | Seneste Sablen-kode | Platformens Tier 1 | Vurdering |
|---|---|---|---|
| Placering | Indstillinger → Faktura-afsendelse | Indstillinger → Fakturaer → Redigér fakturaopsætning | Andet og mindre direkte forløb |
| Rediger emne | Synligt felt, maks. 200 tegn | Findes i dialog, maks. 200 tegn | Findes, men ikke samme brugeroplevelse |
| Rediger mailtekst | Synligt tekstfelt, maks. 4.000 tegn | Dialog, maks. 2.500 tegn | Reel indskrænkning |
| Flettefelter | kundenavn, fakturanummer, ordrenummer | Samme tre + virksomhedsnavn | Kerne dækket; platformen har ekstra felt |
| Gem | Selvstændig skabelon/indstillingshandling | Gemmes sammen med juridisk navn, adresse, CVR, kontakt og historik | Mailændring koblet til anden opsætning |
| Testmodtager | Indtast en gyldig mailadresse; serveren validerer modtageren | Kun egen godkendte loginadresse; dev tillader to adresser | Mangler tilsvarende testforløb; dev-begrænsning er bevidst |
| Test med PDF fra indstillinger | “Send seneste faktura som test”; backend finder en egnet nylig faktura | Afsendertest på indstillingerne har ingen PDF | Ikke flyttet |
| Test med valgt PDF | Seneste egnede faktura vælges til indstillingstesten | Muligt fra den enkelte genererede faktura i oversigten | Andet forløb, ikke en erstatning for indstillingstesten |
| Manuel afsendelse til kunden | Faktura sendes til Shopify-kundens adresse | Ingen normal kundeafsendelse | Mangler og er samtidig blokeret |
| Automatisk afsendelse | Kontakt, afsendt ordre, dannet PDF og aktiveringstidspunkt; kørsler i scheduler | Ingen kontakt/aktiveringsdato eller faktura-mailjob | Ikke flyttet |
| Status/historik | Kundeleveringsrækker og sent/status koblet til faktura | PDF-status + særskilte testmailclaims; ingen fuld kundeleveringsstatus | Delvis teknisk sikring, manglende driftsfunktion |
| Skabelonforhåndsvisning | Tekstbaseret redigering | Fold-ud viser den rå skabelon | Ingen dokumenteret HTML-/designeditor i nogen af de to kodeversioner |
| Afsender/branding | Sablen-specifik afsender/identitet | Egen virksomhedsafsender eller fælles standard, krypterede konto-oplysninger | Bevidst forbedring til flerfirmaplatform |

**Vigtigt for din observation:** Emne og mailtekst er ikke helt væk. De er skjult bag en anden redigeringsdialog. Men valgfri testadresse, testen med seneste faktura direkte fra indstillinger, længere tekst og automatisk kundeafsendelse er ikke gengivet 1:1.

Jeg har ikke fundet en HTML-editor, valg af skrifttype eller fri mailfarvetilpasning i seneste main. Disse funktioner skal derfor ikke opføres som tidligere leveret uden en anden konkret reference.

Kilder: [Sablens mailindstillinger](https://github.com/Jopppardk/WebshopToolbox/blob/73e45ac80568c6c6de3057fd41dcbe3c8dd2e6e9/app/page.tsx#L941), [validering og tekstgrænser](https://github.com/Jopppardk/WebshopToolbox/blob/73e45ac80568c6c6de3057fd41dcbe3c8dd2e6e9/lib/admin-settings.ts#L38), [Sablens testmail](https://github.com/Jopppardk/WebshopToolbox/blob/73e45ac80568c6c6de3057fd41dcbe3c8dd2e6e9/app/api/invoices/email-test/route.ts#L17), [normal afsendelse](https://github.com/Jopppardk/WebshopToolbox/blob/73e45ac80568c6c6de3057fd41dcbe3c8dd2e6e9/app/api/invoices/email/route.ts), [platformens redigeringsdialog](C:/Users/rj/Documents/Codex/2026-09-07/je/work/WebshopToolbox/work/platform/platform/public/admin.js:661), [platformens fakturaadapter](C:/Users/rj/Documents/Codex/2026-09-07/je/work/WebshopToolbox/work/platform/platform/invoices.ts), [platformens mailadapter](C:/Users/rj/Documents/Codex/2026-09-07/je/work/WebshopToolbox/work/platform/platform/mail.ts).

## 2. PDF-fakturaer: manglende nyere ændringer

| Område | Sablen main | Platform |
|---|---|---|
| Linjebeløb og stykpris | Inklusive moms: `line.gross` | Eksklusive moms: `line.net` |
| Forklarende tekst | “Priser er inkl. moms og efter rabatter” | “Priser er ekskl. moms og efter rabatter” |
| Momsoversigt | “Heraf moms” og samlet total inkl. moms | Ældre opdeling med netto/moms |
| Gravering/produktgrupper | Fysisk produkt før tilknyttede graveringer, sorteret inden for gruppen | Følger den ældre linjerækkefølge |
| Indrykning | Graveringsbeskrivelse indrykket | Ingen tilsvarende gruppespecifik indrykning |
| Striber på linjer | Fjernet | Hver anden række har stadig baggrund |
| PDF-links/version | Versionsværdi fra generatedAt bruges til opdaterede links | Downloadlink uden tilsvarende versionsparameter; serveren bruger no-store |
| Firmanavn/logo | Sablen/LA Trading-hardcoding | Virksomhedsoplysninger og PNG-logo | Bevidst og nødvendig ændring |
| Bevarelse af udstedt PDF | Kontrol af ændrede ordredata og tidligere PDF | Fingerprintkontrol, claim og bevaret PDF | Kerneprincip dækket, ikke fuld layoutparitet |

Eksempel: En linje med 100 kr. ekskl. moms / 125 kr. inkl. moms vises med 125 kr. i det nye Sablen-layout og 100 kr. i platformens ældre layout. Dette er en **visningsforskel**, ikke i sig selv bevis på forkert totalberegning.

`lib/invoice-check.ts` og `lib/invoice-totals.ts`, som platformen genbruger, er kontrolleret og identiske med seneste main. Det er godt, men det opdaterer ikke den separate `platform/invoice-pdf.ts`. Den nye `lib/invoice-line-order.ts` er ikke koblet på platformens PDF-renderer.

Kilder: [nyt PDF-layout](https://github.com/Jopppardk/WebshopToolbox/blob/73e45ac80568c6c6de3057fd41dcbe3c8dd2e6e9/lib/invoice-pdf.ts#L35), [gruppering](https://github.com/Jopppardk/WebshopToolbox/blob/73e45ac80568c6c6de3057fd41dcbe3c8dd2e6e9/lib/invoice-line-order.ts), [versionsoplysninger](https://github.com/Jopppardk/WebshopToolbox/blob/73e45ac80568c6c6de3057fd41dcbe3c8dd2e6e9/app/api/invoices/route.ts), [platformens PDF-renderer](C:/Users/rj/Documents/Codex/2026-09-07/je/work/WebshopToolbox/work/platform/platform/invoice-pdf.ts:35).

## 3. Samlet funktionsmatrix

“Delvis” betyder, at noget findes og virker i kode, men ikke at hele Sablen-forløbet er flyttet. “Tom visning” betyder, at menu/tabel findes uden den tilhørende driftsfunktion.

| Område | Sablen-funktioner | Platformens faktiske status |
|---|---|---|
| Dashboard | Dagens aktivitet, jobstatus, omsætning/overskud MTD/YTD, lagerkonto | Tomme nøgletal og opsætningskort; ingen tilsvarende økonomidata |
| Salg | Import, søgning/pagination, betalingsudbyder, afsendelse, realisering, bogføring | Tom visning. Fakturaimport er ikke fuld salgsimport |
| Salgsbilag | Kontrolleret forhåndsvisning, kontofordeling, kladde/bogfør, kvittering | Ikke flyttet |
| Salgslog | Hændelser og bogføringshistorik | Ikke flyttet; platformens admin-audit er en anden log |
| Betalinger | Shopify/ViaBill-data og udbyderafstemning | Ikke flyttet |
| Tilbagebetalinger | Shopify Payments/Flatpay, fælles liste og Dinero-behandling | Tom visning |
| Udbetalinger | Shopify/Flatpay samlet, kommende udbetalinger, pagination, status | Tom visning |
| Udbetalingsbilag | Afstemning, rapport, upload og Dinero-kladde/bogføring | Ikke flyttet |
| Flere Flatpay-afregninger | Flere settlements i ét udbetalingsbilag | Nyeste rettelse ikke flyttet |
| Manuel bogføringsgenopretning | Bekræftet kvittering, statusreparation, historik | Ikke flyttet |
| Udbetalingsrapporter | Dan, vis/hent og vedhæft Shopify-/Flatpay-rapporter | Tom visning; faktura-PDF er en anden dokumenttype |
| Fakturaoversigt | Generering, liste, status, kundeafsendelse | Delvis: import, kontrol, PDF, download og begrænset test |
| Faktura-mail | Skabelon, testmodtager, seneste PDF-test, manuel/automatisk kundeafsendelse | Delvis, jf. tabel ovenfor |
| Lager | Fysiske antal, kostpris, kontrolleret optælling, version/bekræftelse, Shopify/Dinero-opdatering | Tom visning |
| Automatisk lagernedskrivning | Behandling ved afsendte salg og lagerkonti | Ikke flyttet |
| Emballage | Perioder, materialer, husholdning/erhverv, priser og manuelle poster | Tom visning |
| Emballageindberetning | Udbyderforbindelse, formularfelter, kontrol, indberetning og periodeovervågning | Katalogvalg findes; driftsfunktioner mangler |
| Dinero-leverandører | Nyt opslag til manuel emballageregistrering | Ikke flyttet |
| Shopify-forbindelse | Forbindelseskontrol og integration til flere moduler | Credentials kan gemmes krypteret; manuel ordreimport findes kun i fakturamodulet |
| Dinero-forbindelse | Credentials, organisation, kontoplan og finansdata | Kun valg af udbyder/navn med pending-status |
| Kontoplan/momskoder | Konti for salg, fragt, ydelser, refundering, gebyrer, mellemregning, bank og lager | Ikke flyttet |
| Flatpay | Forbindelse, import, settlements, rapporter, refundering, automation | Kun katalog/valg, ingen driftsadapter |
| ViaBill | Forbindelse, valideret konto, records | Kun katalog/valg, ingen driftsadapter |
| API-status | Integrationsfunktioner og konkrete forbindelser | Katalogets Shopify-lys er offentlig driftsstatus; det beviser ikke kundens forbindelse. Andre statuskilder er unknown |
| Historik/startdato | Pr. integration, datovinduer, lagrings-/importgrænser | Kun fakturaers månedshistorik; ikke den samlede politik |
| Automatik | Importjob, modulvalg, intervaller og kladde kontra bogfør | Ikke flyttet; scheduler returnerer disabled, cron er tom |
| Indsigt/kørsler | Resultater, varighed, joblog, fejlede kørsler | Tom visning |
| Fejl/alarmer | Handlingskrævende fejl, advarsler, løste hændelser, sammenhæng til kvitteringer | Ikke flyttet |
| Notifikationer/driftsmail | Varsler og nyere forsinkelse/klassifikation | Ikke flyttet |
| Firma/brugeradgang | Sablen-specifik adgang | Ny, reel platformsfunktion: virksomheder, webshops, roller, invitationer og support |
| Udviklingsside | Udviklingsønsker | Bevidst fravalgt af brugeren; skal ikke genindføres som paritetskrav |

Konkret bevis på tomme moduler: `customerModule()` bygger kolonner og filterknapper, men fylder altid én tom række og teksten om manglende dataimport. Fakturaer har en særskilt funktion før denne fallback. Dashboardet indsætter faste “—”-værdier. Se [kundemoduler](C:/Users/rj/Documents/Codex/2026-09-07/je/work/WebshopToolbox/work/platform/platform/public/customer.js), [rutevalg](C:/Users/rj/Documents/Codex/2026-09-07/je/work/WebshopToolbox/work/platform/platform/public/admin.js:462) og [platformens serverruter](C:/Users/rj/Documents/Codex/2026-09-07/je/work/WebshopToolbox/work/platform/platform/admin.ts:79).

Sablens tilsvarende kode ligger bl.a. i [worker/scheduler](https://github.com/Jopppardk/WebshopToolbox/blob/73e45ac80568c6c6de3057fd41dcbe3c8dd2e6e9/worker-entry.ts), [konti og moduler](https://github.com/Jopppardk/WebshopToolbox/blob/73e45ac80568c6c6de3057fd41dcbe3c8dd2e6e9/lib/admin-settings.ts), [lager](https://github.com/Jopppardk/WebshopToolbox/blob/73e45ac80568c6c6de3057fd41dcbe3c8dd2e6e9/app/api/shopify/inventory/route.ts), [emballage](https://github.com/Jopppardk/WebshopToolbox/blob/73e45ac80568c6c6de3057fd41dcbe3c8dd2e6e9/app/api/shopify/packaging/route.ts) og [rapporter](https://github.com/Jopppardk/WebshopToolbox/blob/73e45ac80568c6c6de3057fd41dcbe3c8dd2e6e9/app/api/documents/route.ts).

## 4. Seneste Sablen-ændringer, som skal med i migreringsgrundlaget

Disse er merged på main efter platformens oprindelige basis. Status angiver platformintegration, ikke om vi har genudført den konkrete funktion i produktion.

| Dato | Commit | Ændring | Platformstatus |
|---|---|---|---|
| 13/9 | 7598348 | Hurtigere læsning af udbetalinger uden svækket kvitteringskontrol | Udbetalingsmodulet mangler |
| 15/9 | 5f0198a | Saml varer og graveringer på PDF | Mangler |
| 15/9 | 08afa8a | Linjepriser inkl. moms og heraf-moms | Mangler |
| 15/9 | 1ea7721 | Genkend Maserin-varer i rækkefølge | Mellemtrin i senere generel gruppering; brug den endelige løsning |
| 15/9 | dde9b8a | Fjern striber og indryk gravering | Mangler |
| 15/9 | 9a356c3 | Generel produkt-/graveringsgruppering og versionsmærkede PDF-links | Mangler |
| 15/9 | 880ea09 | Driftsmail først efter tre timers sammenhængende jobfejl | Driftsmail/jobmodul mangler |
| 15/9 | f9276ed | Straksalarm ved blokeret Dinero-postering; advarsler sender ikke mail | Mangler |
| 15/9 | ed38377 | Browseropdatering på salg uden ekstra import | Salgsmodulet mangler |
| 15/9 | f109ae7 | Ens udbetalingsstatus og aktuel Shopify-bogføringskvittering | Mangler |
| 15/9 | 0c6fb2a | Dinero-leverandører til manuelle emballageposter | Mangler |
| 16/9 | 647504c | Klassifikation/genopretning af midlertidige Shopify-importfejl | Import-/hændelsesmodul mangler |
| 16/9 | 874e694 | Flere Flatpay-settlements i samme udbetalingsbilag | Mangler |

Commits kan åbnes på `https://github.com/Jopppardk/WebshopToolbox/commit/<commit>`. LF-normalisering 8a04951 er ikke en brugerfunktion og er derfor ikke et funktionsgab.

Åben [PR #31](https://github.com/Jopppardk/WebshopToolbox/pull/31) skal vurderes særskilt; den må ikke automatisk blandes ind som en allerede godkendt del af baseline.

## 5. Hvorfor forskellene er opstået

1. Platformen bruger en ny Worker-indgang og en separat HTML/JavaScript-klient. De eksisterende React-komponenter/API-ruter i repositoryet bliver ikke automatisk en del af den nye portal.
2. Sikker isolering af virksomheder og oprettelse af administrationen blev leveret før migration af driftsmodulerne. Men menusiderne kom tidligt til at ligne en færdig løsning.
3. PDF-renderer og mailflow blev delvist genimplementeret. Senere Sablen-rettelser i den oprindelige kode følger derfor ikke automatisk med.
4. Dokumentationen rummer både historiske tomtilstandsbeskrivelser og senere delvise leverancer. Formuleringen “flyttet” har ikke været bundet til en fuld funktionsliste og en accepteret sammenligning.
5. Det samlede testtal er ikke et mål for migreringsgrad: den seneste testkørsel havde 315 tests, men kun 52 ligger i platform-admin-filen og 2 i produktionskonfigurationstesten. Resten tester primært eksisterende legacy-logik. Beståede tests dokumenterer ikke, at alle 44 gamle API-forløb findes i den nye portal.

Jeg anbefaler ikke et procenttal for “færdig migration”: én simpel indstilling og et komplet bogføringsflow er ikke lige store leverancer.

## 6. Foreslået rækkefølge og acceptkrav

### A. Fakturaer og mail først

- Genskab et synligt forløb under fakturaindstillinger med emne, 4.000 tegns mailtekst og tydelige flettefelter.
- Genskab “send seneste faktura som test” fra indstillingerne. I dev: eksplicit godkendte testmodtagere/sikker mailtest, ikke almindelig kundemail. Udform modtagerfeltet, så det ikke skjuler begrænsningen.
- Flyt det endelige PDF-layout fra seneste main: inkl.-moms-priser, generel gruppering, indrykning, ingen striber og versionshåndtering. Bevar kundespecifikke afsenderoplysninger.
- Byg separat manuel og automatisk kundeafsendelse med afsendelseskvitteringer, aktiveringstidspunkt og uafklaret leveringsstatus. Hold eksterne afsendelser blokeret i dev.
- Accept: samme syntetiske ordre giver samme linjerækkefølge, priser, moms og tekst i begge løsninger efter tilladt brandingudskiftning; korrekt PDF i mailen, ingen dubletter ved gentagne kald; ændret ordre ændrer ikke allerede udstedt PDF.

### B. Forbindelser og konfiguration

- Reel Dinero-forbindelse, kontoplan/momskoder, test af Shopify-forbindelse og modulvis startdato/historik.
- Accept: to webshops med overlappende eksterne ID'er holdes adskilt; de deler kun deres egen virksomheds ene regnskab. Credentials returneres aldrig til klienten.

### C. Salg og refundering

- Lister, previews, logs, manuelle handlinger, kladde/bogfør-valg og bekræftede kvitteringer.
- Accept: tilsvarende beregninger/valideringer som Sablen og ingen blind retry af usikre eksterne writes. Test først med syntetiske adaptere og testregnskab.

### D. Udbetalinger, rapporter og udbydere

- Shopify/Flatpay/ViaBill, kommende afregninger, flere settlements, rapporter, bogføringskvitteringer og manuel genopretning.
- Accept: de nye rettelser fra PR #56, #65 og #68 er udtrykkeligt dækket i platformtests og kundevisningen.

### E. Lager, emballage og drift

- Optælling/lagernedskrivning, emballageposter/leverandører/indberetning, jobs, fejl/alarmer, driftsmail og dashboard.
- Accept: 3-timers-reglen, straksalarmer ved blokeret bogføring, advarsler uden mail og korrekt opløsning af midlertidige fejl testes pr. virksomhed.

For hvert punkt kræves fem adskilte statusser: **implementeret, lokalt testet, deployet på dev, brugerafprøvet, aktiveret i produktion**. En funktion er ikke 1:1-flyttet, før dens accepttest er godkendt eller afvigelsen er udtrykkeligt accepteret.

## 7. Hvad denne gennemgang ikke ændrer

De ønskede platformforskelle skal bevares: ingen Sablen-branding, ingen udviklingsside, én virksomhed pr. kundebruger, flere webshops pr. virksomhed, ét regnskab, adskilt Tier 0 og supportadgang. En rå kopi af legacy-kode med faste tenant-/bruger-/domæneværdier ville være en sikkerhedsregression.

Udgangspunktet for næste udviklingsleverance bør derfor være **funktionsparitet med bevidste platformtilpasninger**, ikke kopi af hele Sablen-Workerens runtime. Denne rapport bestiller ikke automatisk implementering eller produktionsaktivering.
