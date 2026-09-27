# API-acceptliste for den nye Tier 1

Status 21. september 2026: dev-læsefunktioner og lokale ændringer er tilsluttet. Leverandørtests bruger syntetiske fixtures; rigtige testkonti og fuld visuel paritet er ikke godkendt. Fuld paritet er fortsat falsk.

| Metode | Original rute | Status |
| --- | --- | --- |
| GET | `/api/admin/errors` | Gemte importfejl og kvittering tilsluttet; automatisk mailnotifikation ikke aktiveret |
| POST | `/api/admin/errors` | Gemte importfejl og kvittering tilsluttet; automatisk mailnotifikation ikke aktiveret |
| GET | `/api/admin/feature-requests` | Fravalgt; erstattet af Support |
| POST | `/api/admin/feature-requests` | Fravalgt; erstattet af Support |
| PATCH | `/api/admin/feature-requests` | Fravalgt; erstattet af Support |
| GET | `/api/admin/history` | Implementeret med virksomhed/webshopafgrænsning; udgivet på dev, testet med fixtures |
| POST | `/api/admin/history` | Implementeret med virksomhed/webshopafgrænsning; udgivet på dev, testet med fixtures |
| GET | `/api/admin/insights` | Implementeret med virksomhed/webshopafgrænsning; udgivet på dev, testet med fixtures |
| GET | `/api/admin/settings` | Implementeret med virksomhed/webshopafgrænsning; udgivet på dev, testet med fixtures |
| POST | `/api/admin/settings` | Implementeret med virksomhed/webshopafgrænsning; udgivet på dev, testet med fixtures |
| GET | `/api/admin/sync-status` | Manuelle importkørsler; ingen cron eller automatisk bogføring |
| POST | `/api/bookkeeping/manual` | Blokeret i dev; ingen eksterne writes eller kundemail |
| GET | `/api/dashboard/finance` | Implementeret med virksomhed/webshopafgrænsning; udgivet på dev, testet med fixtures |
| GET | `/api/dashboard/platform` | Implementeret med virksomhed/webshopafgrænsning; udgivet på dev, testet med fixtures |
| GET | `/api/dinero/accounts` | Implementeret med virksomhed/webshopafgrænsning; udgivet på dev, testet med fixtures |
| POST | `/api/dinero/accounts` | Implementeret med virksomhed/webshopafgrænsning; udgivet på dev, testet med fixtures |
| GET | `/api/dinero/suppliers` | Implementeret med virksomhed/webshopafgrænsning; udgivet på dev, testet med fixtures |
| POST | `/api/dinero/suppliers` | Implementeret med virksomhed/webshopafgrænsning; udgivet på dev, testet med fixtures |
| GET | `/api/documents` | Implementeret med virksomhed/webshopafgrænsning; udgivet på dev, testet med fixtures |
| POST | `/api/documents` | Implementeret med virksomhed/webshopafgrænsning; udgivet på dev, testet med fixtures |
| GET | `/api/emballage/connection` | Implementeret med virksomhed/webshopafgrænsning; udgivet på dev, testet med fixtures |
| POST | `/api/emballage/connection` | Implementeret med virksomhed/webshopafgrænsning; udgivet på dev, testet med fixtures |
| GET | `/api/emballage/reporting` | Læseoversigt og Shopify-hentning tilsluttet; ekstern indberetning blokeret |
| POST | `/api/emballage/reporting` | Læseoversigt og Shopify-hentning tilsluttet; ekstern indberetning blokeret |
| GET | `/api/flatpay/connection` | Implementeret med virksomhed/webshopafgrænsning; udgivet på dev, testet med fixtures |
| POST | `/api/flatpay/connection` | Implementeret med virksomhed/webshopafgrænsning; udgivet på dev, testet med fixtures |
| POST | `/api/flatpay/draft` | Blokeret i dev; ingen eksterne writes eller kundemail |
| GET | `/api/flatpay/production` | Blokeret i dev; ingen eksterne writes eller kundemail |
| POST | `/api/flatpay/production` | Blokeret i dev; ingen eksterne writes eller kundemail |
| POST | `/api/flatpay/records` | Implementeret med virksomhed/webshopafgrænsning; udgivet på dev, testet med fixtures |
| POST | `/api/flatpay/refunds` | Implementeret med virksomhed/webshopafgrænsning; udgivet på dev, testet med fixtures |
| POST | `/api/flatpay/sync` | Implementeret med virksomhed/webshopafgrænsning; udgivet på dev, testet med fixtures |
| GET | `/api/integrations` | Implementeret med virksomhed/webshopafgrænsning; udgivet på dev, testet med fixtures |
| POST | `/api/integrations` | Implementeret med virksomhed/webshopafgrænsning; udgivet på dev, testet med fixtures |
| GET | `/api/integrations/selection` | Implementeret med virksomhed/webshopafgrænsning; udgivet på dev, testet med fixtures |
| POST | `/api/integrations/selection` | Implementeret med virksomhed/webshopafgrænsning; udgivet på dev, testet med fixtures |
| GET | `/api/integrations/start-date` | Implementeret med virksomhed/webshopafgrænsning; udgivet på dev, testet med fixtures |
| POST | `/api/integrations/start-date` | Implementeret med virksomhed/webshopafgrænsning; udgivet på dev, testet med fixtures |
| POST | `/api/invoices/email` | Blokeret i dev; ingen eksterne writes eller kundemail |
| POST | `/api/invoices/email-test` | Eksplicit test af seneste PDF til egen allowlistede loginadresse |
| GET | `/api/invoices/pdf` | Implementeret med virksomhed/webshopafgrænsning; udgivet på dev, testet med fixtures |
| GET | `/api/invoices` | Status og PDF-generering tilsluttet; gemte bilag bevares, ingen regenerering |
| POST | `/api/invoices` | Status og PDF-generering tilsluttet; gemte bilag bevares, ingen regenerering |
| GET | `/api/notifications` | Gemte importfejl og kvittering tilsluttet; automatisk mailnotifikation ikke aktiveret |
| POST | `/api/notifications` | Gemte importfejl og kvittering tilsluttet; automatisk mailnotifikation ikke aktiveret |
| GET | `/api/payouts/log` | Implementeret med virksomhed/webshopafgrænsning; udgivet på dev, testet med fixtures |
| GET | `/api/payouts/overview` | Implementeret med virksomhed/webshopafgrænsning; udgivet på dev, testet med fixtures |
| POST | `/api/payouts/transfer` | Blokeret i dev; ingen eksterne writes eller kundemail |
| GET | `/api/refunds/overview` | Implementeret med virksomhed/webshopafgrænsning; udgivet på dev, testet med fixtures |
| POST | `/api/refunds/transfer` | Blokeret i dev; ingen eksterne writes eller kundemail |
| GET | `/api/sales/log` | Implementeret med virksomhed/webshopafgrænsning; udgivet på dev, testet med fixtures |
| POST | `/api/sales/preview` | Implementeret med virksomhed/webshopafgrænsning; udgivet på dev, testet med fixtures |
| POST | `/api/sales/transfer` | Blokeret i dev; ingen eksterne writes eller kundemail |
| GET | `/api/shopify/inventory` | Læseadgang og optællingssimulering tilsluttet; commit blokeret |
| POST | `/api/shopify/inventory` | Læseadgang og optællingssimulering tilsluttet; commit blokeret |
| GET | `/api/shopify/orders` | Implementeret med virksomhed/webshopafgrænsning; udgivet på dev, testet med fixtures |
| POST | `/api/shopify/orders` | Implementeret med virksomhed/webshopafgrænsning; udgivet på dev, testet med fixtures |
| GET | `/api/shopify/packaging` | Implementeret med virksomhed/webshopafgrænsning; udgivet på dev, testet med fixtures |
| POST | `/api/shopify/packaging` | Implementeret med virksomhed/webshopafgrænsning; udgivet på dev, testet med fixtures |
| GET | `/api/shopify/payments` | Implementeret med virksomhed/webshopafgrænsning; udgivet på dev, testet med fixtures |
| POST | `/api/shopify/payments` | Implementeret med virksomhed/webshopafgrænsning; udgivet på dev, testet med fixtures |
| GET | `/api/shopify/payouts` | Implementeret med virksomhed/webshopafgrænsning; udgivet på dev, testet med fixtures |
| POST | `/api/shopify/payouts` | Implementeret med virksomhed/webshopafgrænsning; udgivet på dev, testet med fixtures |
| GET | `/api/shopify/refunds` | Implementeret med virksomhed/webshopafgrænsning; udgivet på dev, testet med fixtures |
| POST | `/api/shopify/refunds` | Implementeret med virksomhed/webshopafgrænsning; udgivet på dev, testet med fixtures |
| GET | `/api/viabill/connection` | Implementeret med virksomhed/webshopafgrænsning; udgivet på dev, testet med fixtures |
| POST | `/api/viabill/connection` | Implementeret med virksomhed/webshopafgrænsning; udgivet på dev, testet med fixtures |
| GET | `/api/viabill/records` | Implementeret med virksomhed/webshopafgrænsning; udgivet på dev, testet med fixtures |
| POST | `/api/viabill/records` | Implementeret med virksomhed/webshopafgrænsning; udgivet på dev, testet med fixtures |

Desuden GET/PUT `/api/invoices/settings` til virksomhedsoplysninger på PDF. Originale API-adresser omskrives af klienten til den servervaliderede Tier 1-indgang.

22. september: Fakturadesigner og afsenderdialog udgivet som c5eac4cb-de7d-4d6f-8312-97cedd6e1d03. GET/PUT invoices/settings, GET/PUT/DELETE invoices/logo, GET invoices/preview, GET/PUT invoices/sender og POST invoices/sender/test. Alle ruter bruger samme virksomhed/webshopadgang; PDF-eksempel er syntetisk og gemmes ikke.

## Produktfeeds, 23. september 2026
/api/platform/tier1/shops/:shop/feeds: GET liste og POST oprettelse. /catalog: GET søgning, kind/q/after. /:id: PUT/DELETE med revision. /:id/refresh og /:id/rotate: POST med revision. /:id/preview: autentificeret XML. Alle administrationsruter kræver virksomhedsadmin, serverafledt virksomhed og webshopadgang. Offentlig GET/HEAD /feeds/:token.xml har egen afgrænset læseadgang; aktivt feed, aktiv virksomhed/webshop og eksisterende Shopify-forbindelse kræves. Prod afvises.
