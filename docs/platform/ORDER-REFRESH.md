# Opdaterede Shopify-ordrer – 27. september 2026

## Implementeret

Platformens ordreindlæsning henter hele ordren på ny ved valideringsfejl eller ændret Shopify-revision under sideindlæsning. Der er højst tre komplette forsøg pr. handling; delvist hentede data genbruges ikke. Dette anvendes af Salg/Kontrollér (bogføringsforslag) og fakturagenerering/kontrol. Transportfejl og eksterne writes genforsøges ikke i dette lag.

En redigeret, endnu ikke faktureret ordre afvises ikke længere alene på Shopifys `edited`-markering. Platformens separate validator bruger `currentQuantity`, `priceAfterAllDiscountsBeforeTaxesSet`, `originalUnitPriceSet` og de aktuelle ordretotaler. Fjernede vare-/fragtlinjer udelades. Historisk linjemoms fordeles efter det aktuelle antal; resultatet skal afstemmes præcist mod aktuelle moms-, subtotal- og totalbeløb. Uafstemmelige beløb, refusioner, gavekort og manglende afsendelse/adresse blokeres fortsat med forklaring. Den oprindelige Sablen-validator ændres ikke.

Genhentning sker før PDF-claim og lagring. Allerede genererede fakturaer overskrives ikke; ændret fakturaindhold kræver særskilt korrektion. Usikker dokumentlagring og mailafsendelse genforsøges ikke blindt. Virksomheds-/webshopafgrænsning bevares.

## Afgrænsning

Dev har fortsat blokeret bogføring og kundemail. Den nye håndtering er tilsluttet forberedelsen af regnskabsdata, ikke en aktiv overførsel til Dinero. Der er ingen automatisk baggrundskø i denne ændring; genforsøg sker inden for den igangsatte kontrol/generering. Efter tre fejlede forsøg kan handlingen startes igen, når ordren er rettet i Shopify.

## Kontrol og udgivelse

349/349 automatiske tests bestået inklusive ændrede antal/beløb, genhentning ved validering og pagination, begrænsede genforsøg og eksisterende dublet-/tenantkontroller. Begge typechecks, platform/legacy-build, dry-runs og konfigurationskontrol bestået. Udgivet på dev som `4a92a846-fd0b-46c0-b13d-2115f34a53fe`; health/login 200 og anonym API 401. Ingen rigtig ordre afprøvet; ingen økonomiske testposteringer. Ingen migration. Ingen ændringer til Sablen eller prod, ingen main-merge.

Kilde til Shopify-felternes betydning: https://shopify.dev/docs/api/admin-graphql/latest/objects/LineItem
