# Statusvisning for salg og udbetalinger

Implementeret 28. september 2026; udgivelse afventer GitHub CI/deployment.

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
