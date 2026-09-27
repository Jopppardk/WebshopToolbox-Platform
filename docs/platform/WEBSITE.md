# Offentlig hjemmeside – 20. september 2026

Implementeret og udgivet separat fra platformen: https://webshoptoolbox.dk. Kode og driftsvejledning: `../../../website/README.md` (work/website). Brugerens eksisterende Cloudflare-konto er udtrykkeligt valgt. Worker webshoptoolbox-website, egen D1 webshoptoolbox-website; ingen platform-/Sablenressourcer eller kode er deployet.

Indhold: fire moduler med små udbyderlogoer, målgruppe og afgrænsninger, 99 kr./md. ekskl. moms, tre måneders gratis prøveperiode og tydelig afventende produktlancering. Emballageteksten er bekræftet som automatisk indberetning. Der er ingen selvbetjent abonnements- eller virksomhedsoprettelse.

Tilmeldingsformularen gemmer navn, mail og samtykke i separat D1. Live test verificerede lagring og dubletbeskyttelse. Testdata er fjernet. Seks lokale adfærdsprøver, syntakskontrol og Worker-pakkekontrol består. Hoveddomænet er DNS/HTTPS-verificeret; lokal negativ DNS-cache kan midlertidigt forsinke adgang.

Afventer: Brugeren opretter info@webshoptoolbox.dk dagen efter. MAIL_ENABLED=false; alle kontakter køes uden mail. Når adressen er klar, kræves leveringsprøve, aktivering og afgrænset afsendelse af køen. Automatisk kø-dræn og rigtig maillevering er endnu ikke implementeret/testet. Ingen automatisk udsendelse af lanceringsmail til abonnenter.

Udgivet Worker-version: 3533bf00-79c6-48ba-83f8-6de9fc9ad62f. Fallback: https://webshoptoolbox-website.rene-jeppesen.workers.dev.

## Handelsbetingelser og politikker – 20. september 2026
Tre egne sider og footerlinks udgivet: /handelsbetingelser, /privatlivspolitik og /cookiepolitik. Udbyder bekræftet af brugeren: LA Trading ApS, CVR 45036871, Egetoften 13, 7500 Holstebro. Månedsbetaling forud, opsigelse til periodens udløb og ingen automatisk betalingsstart efter prøveperioden er godkendt. Version 6ef9b1f0-5fb8-4edb-8afe-abbf051e933e. Se work/website/LEGAL-NOTES.md for kildegrundlag, test og opfølgning før abonnementsstart. Mail er fortsat deaktiveret.

Login-link til https://portal.webshoptoolbox.dk er tilføjet øverst på alle hjemmesidens sider efter brugerens anmodning. Portalens drift/adgang er ikke ændret som del af linkopgaven.

HTTPS-opfølgning: hoveddomænet havde gyldigt Cloudflare-certifikat, men manglede HTTP-redirect. Rettet i separat hjemmeside-Worker, version cb05ba91-5365-46aa-b037-f7718dc88daf. 7 tests bestået; almindeligt HTTP-opslag følger 308 til HTTPS og 200 uden IP-override. Ingen ændring af portal/dev/Sablen.

## SEO – 20. september 2026
Implementeret og udgivet på hoveddomænet i version b6a326b2-153f-475f-ae17-ac1b36a64cb4: søgerelevant titel, canonical, Open Graph, tydelige moduloverskrifter, seks synlige FAQ-svar, Schema.org WebSite/Organization microdata, robots.txt og sitemap med fire kanoniske URL'er. Fallback-host får X-Robots-Tag: noindex; hoveddomænet får ingen noindex. Ingen ny analytics eller cookies. Lancering omtales stadig som kommende.
Kontrol: 8 Worker-tests bestået, CSS og fire siders interne links/assets valideret. Live HTTPS 200 for alle sider, robots og sitemap; ikke-eksisterende URL giver 404. Forespørgsler fra vores forbindelse med Googlebot, bingbot og OAI-SearchBot user-agent får indholdet uden noindex. Dette beviser ikke adgang fra crawlernes egne IP-adresser eller faktisk indeksering. Normal certifikatkontrol benyttet.
Afventer: ejerskabsbekræftelse og sitemap-indsendelse i Google Search Console og Bing Webmaster Tools samt kontrol af faktisk crawling/indeksering. Ikke udført i denne opgave. Næste indholdsarbejde bør bygge på dokumenterede funktioner og konkrete søgebehov: Shopify/Dinero-bogføring, lagerværdi, emballage og produkt-feeds. Ingen garanti for trafik eller AI-citationer.
Kilde: https://developers.google.com/search/docs/appearance/ai-features og https://developers.openai.com/api/docs/bots. Særlige AI-tekstfiler er ikke påkrævet af Google. Mail fortsat deaktiveret; platform og Sablen ikke udgivet.

## Offentlige crawler-filer – 21. september 2026
Tilføjet public/llms.txt med produktbeskrivelse, lanceringsstatus, fire moduler, pris ekskl. moms, prøvevilkår, målgruppe, virksomhedsoplysninger og links til officielle sider. Udgivet version c443c71a-df05-46e8-9c30-3ff562988205. robots.txt, sitemap.xml og llms.txt verificeret på https://webshoptoolbox.dk/: alle HTTP 200, korrekt MIME-type og indhold identisk med lokale filer. Sitemap XML kan parses. Hold llms.txt opdateret ved ændringer i pris, produkt og lancering. Ingen ændringer i platform, mailaktivering eller eksisterende Worker-logik.

## Mail aktiveret – 22. september 2026

MAIL_ENABLED=true udgivet på den separate hjemmeside i version 323f4a14-532a-4d91-860d-1b76d7984ff5. Nye tilmeldinger sender til info@webshoptoolbox.dk fra no-reply@webshoptoolbox.dk. Brugeren har bekræftet aktiv indbakke; MX peger på Microsoft. Privatlivsteksten opdateret med Cloudflare-afsendelse/Microsoft-modtagelse. 8/8 tests, syntakskontrol og dry-run bestået. Reel indbakkelevering er endnu ikke verificeret. Én eksisterende queued tilmelding blev fundet. Videresendelse blev afvist før udførelse af automatisk godkendelseskontrol, fordi aktivering ikke tydeligt autoriserer videresendelse af tidligere gemte persondata. Kræver konkret brugertilladelse; ingen køpost sendt eller slettet. Ingen automatisk lanceringsemail til tilmeldte. Platform/Sablen uberørt.
