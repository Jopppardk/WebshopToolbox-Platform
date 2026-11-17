# Trustpilot-invitationer (Tools → Anmeldelser)

Implementeret 17. november 2026 (Claude). Ikke udgivet.

Webshoppens egne mails, der beder kunden anmelde butikken på Trustpilot, i stedet for Trustpilots automatiske invitationer (AFS). Danske kunder får den danske mail, svenske kunder den svenske.

## Brugerfladen
- Ny menu **Tools → Anmeldelser** (kræver Shopify). Én fane pr. sprog (Dansk, Svensk), hver med egen tænd/sluk, ventetid efter afsendelse (standard 5 dage for dansk, 7 for svensk), emne, forhåndstekst og Trustpilot-link (standard `https://dk|se.trustpilot.com/evaluate/{webshoppens domæne}`).
- Visuel editor: mailen vises, som kunden ser den; tekst skrives direkte i mailen (fed, kursiv, understreget, link og felterne `{{fornavn}}`, `{{ordrenummer}}`, `{{butik}}`). Elementer: overskrift, tekst, billede (upload eller adresse, bredde, link), Trustpilot-stjerner (hver stjerne åbner Trustpilot med det antal stjerner valgt), knap, streg og luft. Flyt, kopiér og slet; baggrund, indholdsfelt og skrifttype.
- Testmail: den gemte mail med eksempeldata (Anna, ordre #1001) til en valgfri adresse; ændringer gemmes først. Lokalt dannes mailen kun.
- Status: antal sendte, uafklarede og de seneste 50 invitationer med grund for dem, der ikke blev sendt.

## Afsendelse
- Den automatiske kørsel (`auto.reviews` i `production-jobs.ts`) sender kun i prod med kundemail slået til, når invitationerne er slået til for webshoppen.
- Kun ordrer afsendt (seneste fulfilment) efter tidspunktet, hvor invitationerne blev slået til. Slås de fra og til igen, starter de forfra fra det nye tidspunkt. Ingen ordrer fra historikken.
- Sprog: ordrens marked (`webshop_markets.locale`), ellers Sverige → svensk og Danmark → dansk. Andre lande og slåede-fra sprog springes over (vises i listen). Ordrer, hvis marked endnu ikke er kendt, venter.
- Ordren hentes frisk fra Shopify (mail, fornavn, annullering). Annullerede, fuldt refunderede (status REFUNDED), testordrer og ordrer uden mail springes over.
- Afsender: som standard samme som fakturaerne for markedet (Indstillinger → Faktura-afsendelse). Pr. sprog kan man vælge en anden afsenderadresse (fx kontakt@sablen.dk og kontakt@sabeln.se) og et afsendernavn. Adressen skal ligge på et domæne, der er godkendt under Integrationer → Cloudflare E-mail (eller på domænet for sprogets ældre, godkendte afsender); det kontrolleres ved gem, testmail og afsendelse. Mister domænet godkendelsen, venter invitationerne, og kørslen melder hvorfor.
- Højst 10 mails pr. webshop pr. kørsel. Hver ordre gemmes i `review_invitations`, før den sendes: en ordre mailes højst én gang, og en ubekræftet afsendelse står som uafklaret og sendes aldrig igen automatisk.

## Billeder
Uploadede billeder (PNG, JPG, GIF, WebP, højst 2 MB, indholdet kontrolleres) gemmes i R2 under virksomhed og webshop og vises offentligt på `/mail-images/{tilfældigt id}` med lang cache, så mailprogrammer kan hente dem uden login. Portalen tillader nu billeder fra https-adresser i editoren (`img-src 'self' https:` i Tier 1).

## Data
Migration `0053_review_invitations.sql`: `review_invitation_settings`, `review_invitations`, `review_mail_images`. Alle ryddes ved demo-nulstillingen.

## Ikke verificeret / åbne punkter
- Links fra en almindelig Trustpilot-side giver ikke "verificerede" anmeldelser. Det kræver Trustpilots Business API (invitationslinks pr. kunde), som ikke er indbygget.
- Trustpilots automatiske invitationer skal slås fra i Trustpilot Business, ellers får kunderne to mails.
- Ikke afprøvet mod rigtig Shopify eller rigtig mailafsendelse; HTML-visning kun kontrolleret i Chromium.
