# Statusvisning for salg og udbetalinger

Implementeret og merged i PR #12 den 28. september 2026. GitHub CI bestod på
7049eb9, inklusive 376 tests og de obligatoriske builds/typechecks.
Udgivelsen bruger main-commit c889caf17e7e8116708b8825a5c4e34d333863a3.
Den verificerbare udgivelsesstatus findes i disse miljøspecifikke workflows:

- [DEV](https://github.com/Jopppardk/WebshopToolbox-Platform/actions/runs/36465584277)
- [PROD](https://github.com/Jopppardk/WebshopToolbox-Platform/actions/runs/36465589921)

Kun et gennemført success-resultat i den pågældende kørsel bekræfter udgivelsen.

- En ikke-afsendt Shopify-ordre uden tidligere kvittering/fejl vises som Afventer,
  også før bogføringsstart er valgt. En eksisterende bogføringskvittering har forrang.
- reconciliation_required beholder sin interne betydning, men vises som Afventer.
  Dette ændrer ingen bogføringsregler eller afstemningskontroller.
- Et registreret fejlet automatisk forsøg uden usikre eksterne writes vises som
  Fejlet - afventer nyt forsøg, når det relevante automatiske modul er tilvalgt.
- Uafklarede kvitteringer og fejl der kræver kontrol vises som
  Fejlet - Kræver manuel handling. Der genoprettes ikke bilag for at ændre en status.
- Forsøg og kvitteringer læses scoped til virksomhed/webshop og betalingsmodul.
- Shopify PAID og ViaBill Afregnet vises som Udbetalt ligesom Flatpay. Øvrige fælles
  betegnelser er Kommende, Under overførsel, Fejlet og Annulleret.
- Ingen migration eller ændring af kundens automatiske modulvalg/startdatoer.
- Regression dækker ventende ordrer, fejl, usikre/booked-kvitteringer og overlappende
  eksterne ID'er hos to virksomheder. Typechecks og obligatorisk CI skal bestå.
