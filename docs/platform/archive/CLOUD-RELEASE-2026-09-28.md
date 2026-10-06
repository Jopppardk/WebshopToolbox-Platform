## 28. september 2026 – Cloud-leverancer udgivet samlet

De fem Cloud-opgaver med ændringer er gennemgået, eksporteret via Codex UI og samlet i PR #1: https://github.com/Jopppardk/WebshopToolbox-Platform/pull/1. Samlet kodecommit på main: 8fd86ce7522c65bb257f07caab86f626cfab59d1.

- Fakturatest: task_e_6ab982cafa5c832aaba703f8bcff6a3d, valgfri gyldig modtager til servergenereret demo-PDF; afsendertest og almindelig kundemail beholder deres begrænsninger.
- Integrationsvejledning: task_e_6ab9837f62a0832aacd617ad717416a3, dataafhængige sider viser opsætningsgenvej før tilslutning.
- Emballage API-fejl: task_e_6ab983017eb0832a823f09795d2206f3, skelner mellem nøgle-/adgangsfejl og driftsfejl.
- Emballagehistorik: task_e_6ab988630eb8832aa13b50f0f029d102, importerer Shopify-emballagehistorik ved første opsætning. Dette er ikke ny automatisk indberetning.
- Frigivelsesvurdering: task_e_6ab982a70268832abfa49d001397d627, dokumentationen er bevaret. Den samlede udgivelse er ikke en godkendelse til generel økonomisk drift.

Lokalt: 358/358 tests, begge typechecks, begge klient/applikationsbuilds og miljøkonfigurationskontroller bestået. PR-CI 36376932151 og branch-CI 36376929268 bestået inklusive obligatoriske dry-runs. PR merged efter grøn CI.

Sat i drift via GitHub Actions, begge med 358/358 tests:
- Dev run 36377192057, Worker 65c9f0c6-3836-4774-97a5-b183407d42cf.
- Prod run 36377462253, Worker e0c0a1bc-2467-4e9f-b633-881a5a6d744c.

Efterkontrol af begge miljøer: health/login HTTP 200, /admin/ 302 til miljøets Access-login, anonym ordre-API 401. Bogføring og normal kundemail er fortsat blocked. Ingen migrationer, kundedataændringer, finansielle kald, testmail eller ændring af Sablen. Ingen live leverandør-/autentificeret Tier 1-browserprøve udført; mailmodtagelse og første emballageimport med rigtige testkonti er ikke efterprøvet her. Tidligere Cloud-noter om ikke udgivet er historiske; ovenstående fem leverancer er nu udgivet. Øvrige punkter i frigivelsesvurderingen består.
