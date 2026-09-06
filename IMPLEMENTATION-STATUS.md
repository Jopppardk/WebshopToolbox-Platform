# Statusgennemgang – 4. september 2026

## Afgrænset kladdetest #2635

- Brugeren valgte #2635 til test. D1-readonly-kontrol fandt Shopify-ID `gid://shopify/Order/11105060421956`, FULFILLED, kontrolleret faktura-PDF og kun prepared overførselsstatus uden Dinero-GUID.
- `DINERO_DRAFT_TEST_ORDER_ID` tillader kun kladdeoprettelse for dette ID. `DINERO_SALES_WRITES_ENABLED` er stadig false. Testen kræver fakturanummer og eksplicit testgodkendelse, men ikke falske erklæringer om stoppet Storebuddy/ingen tidligere bogføring.
- Forbered forslaget igen før oprettelse. Testmode gemmes varigt på overførslen; testkladden må aldrig bogføres gennem hubben, heller ikke hvis almindelige writes senere åbnes. Reference og linjetekster mærkes TESTKLADDE. Alle øvrige indholds-, konto-, PDF- og dubletkontroller bevares.
- Sletning efter testen udføres separat i Dinero og kræver efterfølgende afklaring af lokal status. Ingen automatisk nulstilling/genoprettelse ved mistet/slettet bilag. Fjern test-ID fra deploykonfiguration, når testen er afsluttet.

## Nyeste: manuel salgsoverførsel til Dinero (produktionsskrivning låst)

- Salg → Overfør til Dinero → vælg bogføringsdato → Forbered forslag. Friske Shopify-data og live-kontoplan kontrolleres sammen med den gemte PDF og fælles indstillinger. Kun fuldt afsendte danske fysiske salg i DKK; eksisterende valideringsbegrænsninger gælder stadig.
- To adskilte eksterne skrivetrin: Opret kladde (eventuelt upload af eksisterende PDF efter bilagsindstillingen), derefter Bogfør kladde. Dineros returnerede linjer, moms, beløb, konti, dato, reference, fil-ID og status valideres før bogføring. Salgsmoms sendes med negative nettobeløb efter den aktuelle OpenAPI-kontrakt, ikke med bruttobeløb fra den ældre webshopguide. Ingen ny Dinero-salgsfaktura, kundemail eller betaling oprettes.
- Produktionsflag `DINERO_SALES_WRITES_ENABLED=false` i `wrangler.direct.jsonc` blokerer oprettelse/bogføring på serveren. Før aktivering: stop Storebuddy-salg, afstem eksisterende bogføringer, aftal dato og én konkret endnu ikke bogført ordre, verificér Cloudflare Access. Ingen live-kladdetest eller bogføring udført under implementeringen.
- Browseren kræver bekræftelse af fakturanummer, stoppet Storebuddy-salg og ingen tidligere bogføring. Det er ikke en automatisk detektion af Storebuddy-bilag. CSRF/origin- og ejerkontrol på API. Workers.dev- og preview-adresser deaktiveret i direkte deploykonfiguration.
- D1 compare-and-swap i `app_settings` giver én varig overførselskvittering pr. Shopify-ordre på tværs af Dinero-organisationsskift. En uklar oprettelse uden bilags-ID kan ikke prøves igen automatisk. Kendt bilags-ID afstemmes med GET; mistet bogføringssvar kan genfindes uden ny kladde. Ingen automatiske POST-genforsøg, sletninger eller kreditnotaer.
- Forslag udløber efter ti minutter. Efter historikperioden fjernes detaljer; en minimal spærring med ordre-/organisations-/bilags-ID bevares for overførsler, som kan have skrevet i Dinero. Ubrugte gamle forslag slettes. Der er ingen baggrundsimport eller automatisk bogføring.
- Kilder: https://api.dinero.dk/openapi/v1/swagger.json (ManuelVoucherCreateModel, ManuelVoucherLineCreateModel, ManuelVoucherReadModel, BookModel, FileSavedReadModel) og https://developer.dinero.dk/news/how-to-create-a-webshop-integration/.

## Afsendelse er nu påkrævet før fakturering og salgsforslag

- Kun Shopify-status FULFILLED vises som Afsendt. PARTIAL vises som Delvist afsendt og venter.
- Fælles serverkontrol afviser fakturagenerering/regenerering og salgsforslag, hvis ordren ikke er fuldt afsendt. Import og massefakturering springer ventende ordrer over uden fakturafejl; øvrige valideringer er bevaret.
- Fakturasiden viser Afventer afsendelse og spærrer manuel generering indtil næste import har bekræftet afsendelsen. Eksisterende PDF’er slettes ikke.
- Dette aktiverer hverken baggrundssynkronisering eller Dinero-bogføring. Ændringer fra Shopify opdages fortsat ved manuel import. Senere Dinero-overførsel skal genkontrollere afsendelse før skrivning.

## Kontoplan gemt i D1 – seneste rettelse

- Identiske kontonumre i Dineros entry/deposit-lister samles til én konto. Modstridende navne/momskoder stoppes fortsat. Deposit-status og skjult-status bevares; entry-momskoden går ikke tabt, når deposit-svaret mangler den.
- Kontoplanen gemmes som ét atomisk snapshot i eksisterende `app_settings`, afgrænset efter tenant og Dinero-organisation. Ingen skemaændring. Kun eksplicit POST/synkronisering henter Dinero-data. GET og salgsforhåndsvisning læser databasen og viser seneste synkronisering; kontovalgenes indstillinger ændres ikke.
- Ved fejl/tom respons bevares tidligere snapshot. Ældre samtidige synkroniseringer kan ikke overskrive nyere snapshots. Skift af Dinero-organisation kan ikke genbruge en anden organisations kontoplan.
- Administration indlæser automatisk den gemte liste, filtrerer skjulte konti fra valgmuligheder og har knappen Synkronisér kontoplan. Misvisende standardtekst om forkerte forbindelser er fjernet.
- Tests med syntetiske API-svar og SQLite verificerer dubletter, konflikter, vedvarende lagring, læsning uden netværk og bevarelse ved fejl. Første synkronisering med produktionsnøgler foretages af brugeren. Ingen Dinero-bogføring eller fakturaændringer.

## Nyeste opfølgning: fakturakontrol og skrivebeskyttet salgsforhåndsvisning

- Salg og Fakturaer har nu `Kontrollér`, som henter friske, komplette Shopify-ordredata. Salg viser desuden konto-/momskodeforslag fra de fælles indstillinger mod en live-læst Dinero-kontoplan. Kontrollen skriver hverken dokumenter, bogføringsstatus eller Dinero-bilag; credentiallæsning kører uden oprydning.
- Varelinjernes oprindelige pris minus alle fordelte rabatter anvendes, inklusive ordreniveaurabatter. Fragt, linjemoms, varesum og ordretotal skal afstemmes præcist. Manglende kundenavn/adresse/data og ændrede, annullerede, refunderede eller testordrer stoppes. Ingen generiske erstatningslinjer eller antaget moms. Gavekort er ikke understøttet i dette fakturaforløb.
- Alle vare-/fragtlinjer hentes med sideinddeling, cursor-/dubletkontrol og revisionskontrol ved flere kald. Importen kører fem ordrer ad gangen. En fakturafejl stopper ikke øvrige ordrer; advarsler gemmes i Administration. Manuel fakturagenerering henter også friske data.
- Nye PDF’er bruger samme kontrollerede beregningsgrundlag, nettopriser efter rabat, Sablens logo, betalingsstatus, fulde ombrudte varebeskrivelser og sidetal. En ældre automatisk sletning af fakturaer ved import/læsning er fjernet.
- Eksisterende PDF’er bevares. Nye snapshots får et indholdsfingeraftryk; regenerering afvises ved ændret indhold eller ældre snapshots, der ikke kan valideres. Ældre fakturaer skal gennemgås særskilt, ikke masseoverskrives. Den generelle, tidligere aftalte historikoprydning er ikke ændret.
- Første kontoforslag er begrænset til fysisk dansk salg i DKK med 0/25 % moms. Udenlandsk salg, andre momstyper, uklassificerede ikke-fysiske varer, ugyldige konti og uafklarede PDF’er vises som stopårsager. Forslaget er ikke et færdigt Dinero-API-bilag, og bogføringsdato er endnu ikke aftalt.
- Validering: TypeScript og produktionsbuild bestået. 29 isolerede tests bestået, inklusive skrivebeskyttet preview, rabatter, moms, sideinddeling og PDF-beskyttelse. Én- og tresiders PDF’er med syntetiske data er renderet og visuelt kontrolleret. Ingen produktionsordrer er bogført, ingen produktionsfakturaer er genereret/slettet under arbejdet, og produktionskonti er ikke brugt til en end-to-end-test.
- Næste godkendelsespunkt: brugeren vælger en reel ordre i Salg → Kontrollér. Afklar konti, dato og eventuel ældre PDF, før der bygges/aktiveres en eksplicit godkendt enkeltpostering med dubletværn. Automatisk synkronisering/bogføring, kreditnotaforløb, fuld drifts-/sikkerhedsverifikation samt ViaBill/Flatpay-afklaringer udestår stadig.
- API-grundlag: Shopify Admin GraphQL 2026-07, officielle Order-, LineItem-, ShippingLine- og DiscountAllocation-felter. Tidligere statusafsnit nedenfor er historik; denne opfølgning har forrang ved overlap.

## ViaBill – implementeret, afventer første live-læsetest

- Rettet forbindelsesfejl: Workerd afviser `redirect: 'error'` før netværkskald. Reproduceret i lokal Miniflare med samme compatibility date; `manual` når ViaBills API (nøglefrit kald giver forventet HTTP 400). Klienten bruger nu `manual` og afviser alle 3xx uden at følge Location. Ny test kører den faktiske klient i Workerd med en lokal outbound-stub; 19 samlede tests består. Ingen produktionsnøgler er brugt ved diagnosen.
- Administration har en separat ViaBill-forbindelsesboks: test nøgler, hent konti, vælg Sablens konto, gem krypteret. Shopify-appen ændres ikke. Ingen nøgler vises igen eller gemmes i browserlager.
- Betalinger/Udbetalinger har providerfaner. ViaBill-import er manuel, periodeafgrænset, med stabile konto-/entryUUID-ID'er, genimport uden dubletter og bevaret bogføringsstatus. Tilbagebetalinger/Salg er uændrede.
- Klienten tillader kun Merchant API's kontoliste, JSON-posteringseksport og udbetalingsdetaljer. POST til eksport er en læseoperation; capture/refund/cancel/checkout er ikke implementeret. Fejl og fetch-URL'er med signatur bliver ikke logget af applikationen.
- Betalinger kræver en eksplicit capture-type og integer-beløb i øre/cents; ukendte formater afvises. Gebyrer fordeles ikke skønsmæssigt på betalinger. Udbetalinger bruger detalje-endpointets total, ikke den negative kontobevægelse. Alle afregningsposter gemmes, inklusive gebyrer/refunderinger/invoice-poster, og summeringsdifference vises som advarsel.
- Krypteret ViaBill-envelope ligger i `app_settings` med den eksisterende serverbaserede AES-GCM-hjælper. Ingen migration eller ændring af Shopify/Dinero-nøgler kræves. Statusruten udleverer kun navn/verifikationstidspunkt.
- Kilde: https://viabill.stoplight.io/docs/merchant-api/875734860e7eb-merchant (original OpenAPI-eksport læst 2026-09-04). Den publicerede specifikation mangler response-schema for kontoliste og posteringseksport. Parseren understøtter liste/eksplicit liste-envelope med strikt feltkontrol. Andre formater stoppes med synlig fejl, ikke en tom succes.
- **Før produktionsgodkendelse:** Brugeren skal indtaste sine nøgler i administrationen og gennemføre første import for en kort kendt periode. Kontoliste-/eksportformat og `entryPage.first`-semantik skal verificeres mod MyViaBill, især første/sidste post og sidegrænser. Koden følger eksemplets `first: 1` og bruger 50 posteringer/5 udbetalinger ad gangen. Gentaget/for stor side stoppes; fixtures er ikke dokumentation for en live-test. Ingen ViaBill-produktionskald blev foretaget under implementeringen.
- Seks nye isolerede ViaBill-tests samt elleve eksisterende tests består. Testene omfatter autentificering, kryptering, kontovalg, skrivebeskyttet endpointliste, dubletter, valuta/beløb, afregningssum, historik og fejlhåndtering. Ingen automatisk synkronisering eller Dinero-bogføring er aktiveret.

## Opfølgning: de tre nederste punkter er implementeret

- Kontotilknytninger og modul-/bilagsvalg gemmes nu samlet i D1 via `/api/admin/settings`, med versionskontrol mod overskrivning fra gamle faner. Browserdata læses kun som et migrationsforslag, hvis centrale indstillinger ikke findes. Brugeren skal gemme for at overføre dem. Nye installationer har tomme konti og fravalgte moduler.
- Faste salgstal, opdigtet systemstatus, forkert profilnavn, inaktivt dashboard/filter/ordreåbning/ekstra paginering, demodata og simuleret bogføring er fjernet. Bogføring er tydeligt markeret som ikke aktiveret. Fakturatal er mærket efter den viste side, ikke en fast måned.
- Mobilmenu med alle moduler er tilføjet, inklusive Fakturaer i egen kategori. Den bruger projektets tilgængelige Sheet-komponent med lukning og tastaturhåndtering.
- PDF og forhåndsvisning bruger samme momsberegning: det rapporterede Shopify-beløb, også nul. Manglende/ugyldige momsdata giver fejl i stedet for en antaget momssats. Eksisterende PDF’er er ikke slettet eller ændret; de skal regenereres, hvis rettelsen skal anvendes.
- Administration viser de seneste 20 åbne fejl og kan markere dem håndteret uden at slette historikken. Shopify Payments-importer samt læsefejl på salg/fakturaer logges nu også. Ny generisk logning gemmer ikke rå upstream-svar eller nøgler. Eksisterende Dinero-, forbindelses- og fakturagenereringsfejl indgår i samme oversigt.
- Isolerede tests af moms, settings-API med SQLite, samtidig lagring, fejlafgrænsning og refunderinger er bestået. Browser-/mobiltest og live-import med produktionsoplysninger er ikke udført i denne opfølgning.

**Stadig ikke implementeret:** Dinero-posteringer og automatisk baggrundssynkronisering. Modulvalg er gemt konfiguration til det kommende workflow, ikke en aktiv automatik. De øvrige faktura-/driftsforbehold fra den oprindelige gennemgang nedenfor er stadig relevante, særligt store ordrers linjeindlæsning og dokumentmodellen ved efterfølgende ordreændringer.

## Oprindelig gennemgang før opfølgningen

Konklusion: Løsningen er ikke færdigbygget eller helt fri for prototypeelementer. Dette er en kodegennemgang, ikke en bekræftelse af produktionsdata eller bogføring. Ingen posteringer er sendt til Dinero under gennemgangen.

## Live-data implementeret

| Område | Implementering | Begrænsning |
| --- | --- | --- |
| Salg | Shopify-ordrer gemmes i D1, sideinddeling og genindlæsning | Manuel synkronisering; ikke automatisk bogføring |
| Betalinger | Shopify Payments CHARGE-transaktioner med gebyr/netto | Kun Shopify Payments |
| Tilbagebetalinger | Shopify Payments REFUND-transaktioner med separate transaktions-id'er, dato, ordre, valuta, gebyr/netto og bogføringsstatus | Kun Shopify Payments; ikke butikskredit eller andre gateways; ingen Dinero-bogføring |
| Udbetalinger | Shopify Payments payouts, ikke ordresummer | Ingen Dinero-bogføring |
| Fakturaer | PDF i R2, generering ved ordreimport, download og regenerering | Ikke baggrundsimport; se datakorrekthed nedenfor |
| Forbindelser | Serverbaserede Shopify/Dinero-forbindelser og hentning af Dinero-kontoplan | Live-forbindelser ikke gentestet i denne gennemgang |
| Historik | Startdato og rullende måneder gemmes i D1 og anvendes på modulerne | Oprydning sker ved API-aktivitet, ikke på en tidsplan |

## Prioriterede mangler

1. **Bogføringsworkflow mangler.** Ingen API-rute udfører posteringer i Dinero. Salgsrækkens `Bogfør igen` i `app/page.tsx` ændrer kun React-state til `Bogført` efter en timer; den gemmer eller bogfører ikke. Må ikke bruges som dokumentation for bogføring. Betalinger, tilbagebetalinger og live-udbetalinger angiver korrekt, at bogføring ikke er aktiveret.
2. **Automatik er kun brugerflade.** Modulvalg og bilagsvalg i `app/page.tsx` gemmes i localStorage, men bruges ikke af et server-workflow. Kontotilknytninger gemmes også kun i browseren og har forudfyldte, ikke organisationsvaliderede standardkonti. En ekstra automatisk-bogføring-switch har kun `defaultChecked`. Ingen webhookruter eller cron-triggers fundet i den direkte Cloudflare-konfiguration. Nye ordrer bliver derfor ikke hentet i baggrunden.
3. **Fakturaernes datakorrekthed kræver arbejde.** `lib/invoice-pdf.ts` og forhåndsvisningen i `app/page.tsx` udleder 25 % moms, når rapporteret moms er nul; det giver forkerte tal for reelt momsfrit salg. Ordrekaldet henter højst 50 varelinjer og 10 fragtlinjer uden videre sideinddeling. PDF bruger aktuelle ordretotaler; regenerering efter ordreændringer/refunderinger kræver en aftalt dokumentmodel og kontrol af summer/linjer. Manglende linjer erstattes af en generisk ordrelinje, og manglende kundenavn af `Kunde`.
4. **Synlige prototypeelementer findes stadig.** Fast salgstæller `24`, systemstatus `Alle forbindelser kører`/`Synkroniseret for 2 min. siden` og brugernavnet `Rune Jensen`. Dashboard-link, ordreåbning, filterknap med fast tal og nederste `Næste` på salg er ikke koblet til en handling. Den øverste ordrepaginering er derimod aktiv.
5. **Gammel demokode findes stadig.** `orders`-eksempler i `app/page.tsx` anvendes kun til TypeScript-typeafledning; live-salg starter tomt. Gammel `payouts`-liste og `Payouts`/`PayoutRow` er ikke de komponenter, der vises. Refunderingernes demoposter, demotal og simulerede bogføringsfunktion er fjernet i denne ændring.
6. **Fejloversigt er ikke færdigkoblet.** `app/api/admin/errors/route.ts` kan læse fejltabellen, men brugerfladen henter ikke den oversigt. De gennemgåede importforløb viser fejl lokalt; en komplet central fejllog og genforsøg mangler.
7. **Mobilmenu mangler fortsat.** Sidebaren i `app/page.tsx` er skjult under `lg`, og mobilheaderen har kun logo, ingen alternativ navigation.
8. **Drift/sikkerhed skal afsluttes.** Middleware tillader den konfigurerede e-mail via Cloudflare Access-header. Adgangspolitik, eventuelle alternative Worker-adresser og beskyttelse mod direkte origin-adgang skal verificeres på kontoen; kode alene beviser ikke det. Backup/gendannelse og fuld import under belastning er ikke verificeret. Ingen sikkerhedsomgåelse eller produktionsbogføring udført.

## Kontrol af nyt tilbagebetalingsmodul

- Samme periodepolitik og søgning som betalinger, 50 poster pr. side.
- Kun REFUND, ikke CHARGE, testdata eller transaktioner uden for perioden.
- Signerede beløb og valuta bevares; flere delvise refunderinger på samme ordre bevares hver for sig.
- Upsert på transaktions-id forhindrer nye dubletter ved genindlæsning og overskriver ikke bogføringsstatus.
- Fire isolerede routetests bestået: filtrering/beløb, cursor, GET-afgrænsning og fejl uden databasewrites.
- End-to-end-import med butikkens adgangsoplysninger er ikke udført. Brug Tilbagebetalinger → Hent fra Shopify Payments for at verificere de reelle poster.

API-grundlag: https://shopify.dev/docs/api/admin-graphql/latest/objects/ShopifyPaymentsAccount og https://shopify.dev/docs/api/admin-graphql/latest/enums/ShopifyPaymentsTransactionType
