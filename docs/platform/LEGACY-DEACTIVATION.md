# Deaktivering af den gamle Sablen-integration

Udført 28. september 2026 ca. 18:15 UTC efter brugerens udtrykkelige bestilling.

- Worker: sablen-integrationshub. Alle automation.sales/payments/refunds/payouts/
  invoiceEmails/inventory er false i app_settings for sablen.dk/admin_settings.
  Øvrige indstillinger og regnskabsdata er bevaret.
- Cloudflare Cron Triggers er tomme (før: * * * * *).
- Custom domain integration.sablen.dk er fjernet. Ingen legacy Worker Routes
  fandtes på sablen.dk-zonen. workers.dev og preview-adresser er deaktiverede.
- Worker-kode, secrets, D1-databasen sablen-integrationshub og R2-bilag er bevaret.
  Ingen Worker eller databaser er slettet; ingen bilag, kvitteringer eller
  tidligere bogføringer er slettet eller genforsøgt.
- Cloudflare API efterkontrol bekræftede tomme schedules/domains og lukkede
  workers.dev/previews. Access-login kan stadig vises via eksisterende DNS/cache;
  dette er ikke den gamle applikation. Access-appen er bevaret.
- Separat DNS-læsning var ikke tilladt af det tilgængelige API-token (403).
  Der blev ikke ændret øvrige DNS-poster. Domænets Worker-tilknytning er bekræftet fjernet.
- Cron-/routingændringer kan skulle udbredes hos Cloudflare; alle automatiske
  modulvalg blev derfor deaktiveret før fjernelsen af triggeren.
- WebshopToolbox PROD/DEV health/login svarer 200, Tier0 kræver Access og anonym
  ordre-API giver 401. PROD enabled og DEV blocked er uændret. feed.sablen.dk er uberørt.

## Genaktivering

Kræver en ny udtrykkelig brugerbeslutning, da den nye platform nu bogfører.
Genetablér kun integration.sablen.dk-domain, den gamle minutplan og relevante
modulvalg efter afklaring af periode/dubletbeskyttelse. En gammel deployment kan
ellers genetablere trigger/domæne. Brug ikke platformrepositoryets historiske
wrangler.direct.jsonc til en legacy-deployment.
