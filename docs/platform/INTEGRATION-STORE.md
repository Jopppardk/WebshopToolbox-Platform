# Fælles integrationskatalog og virksomhedens valg

Besluttet 13. september 2026: Toolbox-administrationens Integrationer er et kodevedligeholdt katalog, ikke valg for en bestemt virksomhed. Kundeportalens Integrationer er virksomhedens egne valg og forbindelser.

Implementeret: platform/catalog.ts beskriver Shopify, Dinero, Flatpay, ViaBill og Emballage Indberetning efter det eksisterende lib/integration-catalog.ts. Kataloget ændres gennem projektet, ikke gennem admin-UI. E-conomic var tidligere tilbudt som et planlagt regnskabsvalg, men findes ikke i det implementerede integrationskatalog; det tilbydes derfor ikke til nye valg i kundeformularen. Eventuelle tidligere valg bevares.

Admin-kataloget har ingen tilslutningsknapper, kundekonti eller credentials. Status viser grøn ved udbyderrapporteret API operational, rød ved kendt forstyrrelse og grå ved ukendt/fejlet kontrol. Shopify kontrolleres via den dokumenterede offentlige components-endpoint og kun API/API & Mobile-komponenten. Andre integrationer har ingen verificeret offentlig statusadapter endnu og vises derfor Ukendt. Status er ikke en autentificeret API-prøve eller bevis for kundens forbindelse. Tidspunkt og kilde vises; indikatorerne udløber efter fem minutter i den åbne side. Kontrol udføres ved åbning og manuel genkontrol; ingen ny cron eller baggrundsovervågning.

Kilde: https://www.shopifystatus.com/api

Kun serverens faste GET-endpoint kan kaldes af statusadapteren; ingen klientvalgt URL, ingen credentials, ingen redirects, fem sekunders timeout. Fejlede HTTP-svar, ugyldigt JSON, ukendte komponenter/statusværdier og timeout giver Ukendt. Ingen produktionsintegrationer importeres eller testes.

Kundeportalen viser virksomhedens regnskab og webshops samt en integrationsbutik med de øvrige integrationer. Migration 0005 gemmer Flatpay/ViaBill/Emballage-valg pr. virksomhed med unik nøgle. Tilvalg/fravalg kræver virksomhedsadministrator eller portaladministrator og logges atomisk. Medlemmer kan kun læse. Regnskab følger fortsat den ene company_accounting-række; webshops beholder egne scoped relationer. Valg betyder Afventer tilslutning, ikke aktiv integration. Import, providerautorisation og bogføring er stadig kommende leverancer.

Validering: 27 platformtests bestået, inklusive virksomhedsscope, medlemsafvisning, idempotent valg, afvisning af ekstra regnskabsvalg og statusadapterens fejltilfælde. Fuld kontrol og driftsstatus opdateres efter udrulning. Tidligere invitation-/kundeportalændringer er bevaret. Intet merge til main, ingen Sablen-ændringer.

Drift 13. september 2026: Migration 0005 anvendt på test-D1 efter eksport til .wrangler/before-integration-store.sql. Test-Worker deployet som 43a344a8-bbc9-46cd-a545-5a19742e649d. 288 tests, build, typecheck og begge dry-runs bestået. Online admin-katalog viser fem integrationer uden tilslutningsknapper. Shopify-kontrollen fra Worker gav Ukendt; samme offentlige endpoint returnerede HTTP 200 og API & Mobile operational fra udviklingsmaskinen. Årsagen til forskellen er ikke verificeret; portalen må ikke bruge maskinens resultat som Worker-verifikation. Øvrige statusadaptere udestår. Ingen commit/push eller ny Linux-CI.

Online kundeprøve bestået: Testvirksomhed A viser egne webshops og regnskab, og Flatpay blev valgt gennem integrationsbutikken. Efter genindlæsning af visningen står Valgt · afventer tilslutning og Fjern valg. Ingen providerkald eller bogføring fra tilvalget.
