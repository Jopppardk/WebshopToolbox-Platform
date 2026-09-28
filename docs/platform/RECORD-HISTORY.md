# Posthistorik og udbetalinger på dashboardet

Implementeret: separat append-only historik med virksomhed/webshop/udbyder/type/eksternt ID. Triggere gemmer import, ændrede kildedata, dokumentgenerering og bogførings-/mailfaser atomisk sammen med eksisterende rækker. Fejl fra fakturabehandling, bogføring og automatiske postforsøg gemmes med renset tekst. Kvitteringer og dubletbeskyttelse bevares. Der gemmes ikke hele ordredata, mailindhold, credentials eller rå upstream-svar i historikken.

Tier 1 viser sideopdelt historik pr. ordre, udbetaling og tilbagebetaling. Gamle fakturaer kan bruge den eksisterende audit-hændelse som genereringstidspunkt; ældre bogførings- og mailkvitteringer viser deres sidst gemte status. Afstemningstidspunkt er ikke den oprindelige bogføringsdato. Tidligere overskrevne hændelser kan ikke genskabes. Mailaccept betyder ikke nødvendigvis levering til indbakken.

Dashboard: bekræftet via læseforespørgsel, at PROD indeholdt en Flatpay-udbetaling 2026-09-28. Den tidligere tæller læste kun Shopify-snapshots. Ny tæller inkluderer Flatpay payments og ViaBill payout, undlader settlements og bruger dansk dato ved UTC-døgnskifte. Registrerede poster tælles, ikke nye bankbevægelser hentet under visningen.

Migration 0029 er additiv. Lokal migrationsprøve bevarer samtlige eksisterende rækker og FK-integritet og opfinder ingen fortidige hændelser. Cloudflare Time Travel anvendes som serverbaseret gendannelsespunkt; produktionsdata eksporteres ikke lokalt. Bookmarks før ændringen:
- PROD: 00000031-00000975-000050f4-18f44dc1234297e1259a7d5bb04bb708
- DEV: 00000074-00000000-000050f4-4425dcfefd8e723d8072699b517f69e5

Der foretages ingen automatisk databasegendannelse; igangværende produktionsbogføring gør tilbageførsel af hele databasen uegnet som almindelig rollback.

Test: regressionsscenarier for tenant-/webshopisolation med overlappende ID’er, fastholdte kvitteringsfaser, faktura og mail-ID, hemmelighedsfiltrering, pagination, dansk datogrænse, flere betalingsudbydere og migrationsbevarelse. Samlet CI og remote migration/udgivelse afventer.
