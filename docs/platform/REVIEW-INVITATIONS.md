# Trustpilot-invitationer (Tools → Anmeldelser)

Implementeret 17. november 2026 (Claude). Ikke udgivet.

Webshoppens egne mails, der beder kunden anmelde butikken på Trustpilot, i stedet for Trustpilots automatiske invitationer (AFS). Danske kunder får den danske mail, svenske kunder den svenske.

## Brugerfladen
- Ny menu **Tools → Anmeldelser** (kræver Shopify). Én fane pr. sprog (Dansk, Svensk), hver med egen tænd/sluk, ventetid efter afsendelse (standard 5 dage for dansk, 7 for svensk), emne, forhåndstekst og Trustpilot-link (standard `https://dk|se.trustpilot.com/evaluate/{webshoppens domæne}`).
- Visuel editor: mailen vises, som kunden ser den; tekst skrives direkte i mailen (fed, kursiv, understreget, link og felterne `{{fornavn}}`, `{{ordrenummer}}`, `{{butik}}`). Elementer: overskrift, tekst, billede (upload eller adresse, bredde, link), Trustpilot-stjerner (hver stjerne åbner Trustpilot med det antal stjerner valgt), knap, streg og luft. Flyt, kopiér og slet; baggrund, indholdsfelt og skrifttype.
- Testmail: den gemte mail med eksempeldata (Anna, ordre #1001) til en valgfri adresse; ændringer gemmes først. Lokalt dannes mailen kun.
- Status: antal sendte, uafklarede og de seneste 50 invitationer med grund for dem, der ikke blev sendt.
- Ordrer i kø: hver afsendt ordre, der venter på en invitation, med sprog, afsendt dato og hvornår den sendes (højst de 1.000 ældste). **Ekskluder** tager en ordre ud af køen for altid (gemmes som sprunget over med grunden "Ekskluderet manuelt fra køen."); under seneste invitationer kan den sættes tilbage med **Fortryd**. En ordre, kørslen allerede har taget, kan ikke ekskluderes.

## Afsendelse
- Den automatiske kørsel (`auto.reviews` i `production-jobs.ts`) sender kun i prod med kundemail slået til, når invitationerne er slået til for webshoppen.
- Kun ordrer afsendt (seneste fulfilment) efter tidspunktet, hvor invitationerne blev slået til. Slås de fra og til igen, starter de forfra fra det nye tidspunkt. Ingen ordrer fra historikken.
- Sprog: ordrens marked (`webshop_markets.locale`), ellers Sverige → svensk og Danmark → dansk. Andre lande og slåede-fra sprog springes over (vises i listen). Ordrer, hvis marked endnu ikke er kendt, venter.
- Ordren hentes frisk fra Shopify (mail, fornavn, annullering). Annullerede, fuldt refunderede (status REFUNDED), testordrer og ordrer uden mail springes over.
- Afsender: som standard samme som fakturaerne for markedet (Indstillinger → Faktura-afsendelse). Pr. sprog kan man vælge en anden afsenderadresse (fx kontakt@sablen.dk og kontakt@sabeln.se) og et afsendernavn. Adressen skal ligge på et domæne, der er godkendt under Integrationer → Cloudflare E-mail (eller på domænet for sprogets ældre, godkendte afsender); det kontrolleres ved gem, testmail og afsendelse. Mister domænet godkendelsen, venter invitationerne, og kørslen melder hvorfor.
- Tidspunkt (pr. sprog, ved siden af ventetiden): invitationen sendes på dagen, hvor ventetiden slutter (danske kalenderdage fra afsendelsesdagen), fra det valgte klokkeslæt i dansk tid og de følgende 3 timer. Er en ordre klar uden for vinduet, venter den til vinduet åbner igen (vises i køen som "Sendes {dato} kl. …"). Standard er kl. 10 (anbefalet, se nedenfor), også for skabeloner gemt før funktionen. "Straks, når ventetiden er gået" giver den tidligere adfærd (præcis ventetiden efter afsendelse, uanset klokkeslæt). Gemmes i `templates_json` som `sendHour` (0-23 eller null); ingen migrering.
- Højst 10 mails pr. webshop pr. kørsel. Hver ordre gemmes i `review_invitations`, før den sendes: en ordre mailes højst én gang, og en ubekræftet afsendelse står som uafklaret og sendes aldrig igen automatisk.

## Hvorfor kl. 10
Der findes ingen uafhængig, offentliggjort undersøgelse af klokkeslæt for anmeldelsesmails; det bedste er leverandørernes egne tal (november 2026):
- Feefo: anmodninger om produktanmeldelser får flest svar omkring kl. 10, serviceanmodninger kl. 11-13 (egne data, uden stikprøvestørrelse). https://business.feefo.com/resources/when-to-ask-for-feedback-data-backed-tips-to-boost-engagement
- Kudobuzz: tirsdag/onsdag kl. 10-12 anbefales (egne data, uden metode). https://kudobuzz.com/blog/the-review-response-rate-study-what-time-day-and-method-actually-work
- Stamped: kl. 10-16 (uden data). https://website.stamped.io/blog/best-ways-to-optimize-your-review-request-emails/
- eTrusted (Trusted Shops): flest anmeldelser skrives kl. 12-13, så mailen bør ligge i indbakken om formiddagen. https://help.etrusted.com/hc/en-gb/articles/23970876356498-How-to-effectively-collect-reviews
Ventetiden betyder mere end klokkeslættet: et randomiseret felteksperiment med over 300.000 kunder (Journal of Marketing, omtalt af AMA) fandt, at det ikke er bedst at spørge så hurtigt som muligt. https://www.ama.org/2023/01/10/asking-for-customer-reviews-at-the-right-time-sooner-is-not-always-better/

## Billeder
Uploadede billeder (PNG, JPG, GIF, WebP, højst 2 MB, indholdet kontrolleres) gemmes i R2 under virksomhed og webshop og vises offentligt på `/mail-images/{tilfældigt id}` med lang cache, så mailprogrammer kan hente dem uden login. Portalen tillader nu billeder fra https-adresser i editoren (`img-src 'self' https:` i Tier 1).

## Data
Migration `0053_review_invitations.sql`: `review_invitation_settings`, `review_invitations`, `review_mail_images`. Alle ryddes ved demo-nulstillingen.

## Ikke verificeret / åbne punkter
- Links fra en almindelig Trustpilot-side giver ikke "verificerede" anmeldelser. Det kræver Trustpilots Business API (invitationslinks pr. kunde), som ikke er indbygget.
- Trustpilots automatiske invitationer skal slås fra i Trustpilot Business, ellers får kunderne to mails.
- Ikke afprøvet mod rigtig Shopify eller rigtig mailafsendelse; HTML-visning kun kontrolleret i Chromium.
