# Fakturaer i Tier 1

Opdateret 14. september 2026. Reference: Sablens fakturafunktion på main 3dbe5ebd23c115fbb52486fc49a0693a8923ee93. Legacy-filerne er uændrede; ingen data eller credentials er kopieret fra Sablen.

## Implementeret
- Selvstændig fane **Indstillinger → Fakturaer**: juridisk navn, adresse, CVR, kontakt, PNG-logo, historik (1–120 måneder), emne, mailtekst og standard/egen Cloudflare-afsender. Profil og brugere ligger på Generelt.
- **Fakturaer** i hovedmenuen: hent Shopify-ordrer i sider på 25, vis 100 pr. side, søg/statusfilter, kontrollér friske komplette linjer, generér én eller op til fem PDF'er og hent gemt PDF. Import aktiveres kun ved et udtrykkeligt klik.
- Samme rene moms-, valuta-, afsendelses-, fuldstændigheds- og fingerprintkontrol som Sablen. Faste virksomhedsoplysninger er erstattet med den aktuelle virksomheds opsætning. Layoutet understøtter flere sider og danske tegn.
- Migration 0009: invoice_settings, invoice_orders og platform_invoices. Credentials, ordrer, claims og R2-nøgler er afgrænset til virksomhed/webshop. Ordreoversigten henter kun metadata; generering og kontrol henter friske komplette ordredata.
- En udstedt PDF bevares ved ændrede ordredata eller ny fakturaopsætning. En atomisk generating-claim forhindrer dubletter. Ved fejl efter claim bliver den stående og kræver manuel undersøgelse; den nulstilles ikke automatisk.
- Testmail fra fakturaoversigten vedhæfter den gemte PDF og anvender kundens mailskabelon. Den sendes kun til den aktuelle, godkendte loginadresse, med [TEST] og tydelig testtekst. Mailindstillingernes separate afsendertest har ingen PDF vedhæftet.
- Vedvarende leveringsclaim/kvittering og et minuts pause mellem testmails. Usikker levering genafsendes ikke med samme request-ID. PDF begrænset til 3,5 MB af hensyn til den samlede mailstørrelse.
- Almindelig kundemail, automatisk fakturaafsendelse, planlagt import og bogføring er fortsat blokeret i dev. Supportimpersonering giver ikke adgang til import, generering, testmail eller ændret fakturaopsætning.

## Testet
302 automatiske tests bestået, heraf 41 platformtests. De nye tests dækker overlappende ordre-ID'er på to webshops, afvist dokumentadgang, ændrede ordredata, samtidige genereringer, lagringsfejl, afsendelseskrav, korrekt testmodtager/PDF/skabelon, usikker levering og Shopify-pagination/revisionsskift. Alle kald til Shopify og mailudbyderen i disse tests er syntetiske.

PDF'er med én og fire sider er renderet og visuelt kontrolleret, inklusive danske tegn, totaler og sidefod. Syntetiske QA-filer ligger i ignoreret `.wrangler/invoice-qa/`.

## Driftsstatus
Build, efterfølgende typecheck, legacy dry-run og platform dry-run er bestået. Migration 0009 er anvendt lokalt og i separat test-D1. Dev er deployet som version `8f3000fd-eda9-4597-964d-2d7278e079ed` på dev.webshoptoolbox.dk. Backup før migration: ignoreret `.wrangler/before-invoices.sql`. Ingen push eller merge til main. Rigtig Shopify-import og testmail med PDF er endnu ikke end-to-end-afprøvet i den autentificerede dev-portal.

## Forudsætninger og afgrænsning
Shopify-forbindelsen kræver kundens egen Shopify-app med Client ID/secret, installeret i samme Shopify-organisation som butikken, og read_orders. Shopify giver normalt kun nyere ordrer uden yderligere historikadgang; en større historik i Toolbox giver ikke ekstra Shopify-rettigheder. Hemmeligheder sendes kun til valideret myshopify.com-domæne, uden redirects; GraphQL-adapteren har ingen mutationer.

Der er ingen fri genoprettelse/sletning af tidligere fakturaer. Kreditnotaer, ændrede/refunderede ordrer og genopretning efter uafklarede lagringsfejl skal håndteres særskilt. Fakturaoversigten erstatter ikke importen til de øvrige finansmoduler; disse forbliver under separat migrering.

Cloudflare-attachmentformat kontrolleret mod [Workers API](https://developers.cloudflare.com/email-service/api/send-emails/workers-api/) og [REST API](https://developers.cloudflare.com/api/resources/email_sending/methods/send/). Workers bruger binær PDF; REST bruger base64. Lokal mailvisning foretager ingen reel afsendelse.


## Fakturadesigner, 22. september 2026

> 22. september 2026 – Fakturadesigner udgivet på dev som `c5eac4cb-de7d-4d6f-8312-97cedd6e1d03`. Tier 1 → Indstillinger → Faktura-afsendelse har firmaoplysninger, PNG-logo (300 KB / 2048 × 2048), fjern logo, farve, klassisk/moderne layout og bundtekst. Uden logo viser nye PDF'er både virksomhedsnavn og den servervalgte webshops navn. Et link åbner en autentificeret eksempel-PDF med fiktive data og tydelig EKSEMPEL-markering; ingen ordre, faktura, mail eller bogføring oprettes. Virksomhedens design gemmes i migration 0023 med revisionskontrol; gemte PDF'er ændres ikke. Logoer er scoped til virksomheden og valideres som PNG, ikke kun ved filendelse. Afsenderformular og dialogguide bruger den eksisterende krypterede Cloudflare-opsætning; standardafsender bruges indtil godkendt afsendertest. Eget domæne kræver Cloudflare DNS/Email Sending; ingen DNS ændres af portalen, og ingen automatisk DNS-onboarding er implementeret. Testmails er fortsat begrænset til egen allowlistede adresse; fakturatest bruger godkendt egen afsender, ellers standard. 341/341 tests samt begge builds/typechecks/dry-runs bestået; 78/78 afsluttende platformtests efter første-upload-forbedringen bestået. Remote: login/health 200, fakturaindstillinger/logo/eksempel/afsender kræver login (401 uden session), bogføring og kundemail blocked. Migration 0023 bekræftet på dev og lokalt, ingen remote FK-fejl. To PDF'er er renderet og visuelt kontrolleret med/uden logo. Browser-UI kan ikke kontrolleres lokalt: ERR_BLOCKED_BY_CLIENT; remote brugerfane står på login. Dev-backup `.wrangler/before-invoice-design-0023.sql`; migration prøvet på kopi med alle gamle felter uændrede og ingen FK-fejl, derefter anvendt på dev. Sablen uændret, prod offline, ingen push/main-merge.


## Justering af fakturatest og layout

> 22. september 2026 – Layoutjustering udgivet på dev som `768e3e1a-f583-4691-afb3-fa8acd5d1999`: Klassisk er nedtonet uden farvefelter/indramninger; Moderne overtager det tidligere klassiske udtryk. Tier 1-fakturatesten sender samme deterministiske demo-PDF som Se gemt eksempel med gemt design/logo og mailskabelon, uden opslag på rigtige ordrer eller krav om en gemt faktura. Egen loginadresse, allowlist og idempotente leveringsclaims gælder fortsat. Eget Cloudflare DNS-domæne er nu fremhævet med rød tekst øverst i afsendersektionen. 342/342 tests, begge typechecks, builds og dry-runs bestået; begge PDF-layouts renderet og visuelt kontrolleret. Ingen migration eller reel testmail afsendt under arbejdet. Sablen uændret, prod offline, bogføring/kundemail fortsat blokeret.
