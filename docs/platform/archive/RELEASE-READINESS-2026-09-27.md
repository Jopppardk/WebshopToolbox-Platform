# Frigivelsesvurdering for flere virksomheder/webshops – 27. september 2026

## Konklusion

**No-go til almindelig frigivelse for andre virksomheder/webshops.** Platformen har et stærkt lokalt sikkerheds- og isolationsgrundlag, og den kan efter de nedenstående adgangskriterier bruges til en afgrænset, overvåget pilot i testmiljøet. Den er ikke klar som selvbetjent produktionsløsning eller til økonomisk drift for en ekstern kunde.

Vurderingen gælder checkout `2c1ec73fdf7b889a6e29ecac2a7957ae7cc18999` på den lokale branch `work`. Der blev ikke ændret remote data, sendt mail, oprettet posteringer eller deployet i forbindelse med vurderingen.

## Beslutningsgrundlag

### Det, der er klar

- Den samlede lokale suite består: 355/355 tests. Den dækker blandt andet serverafledt adgang, to virksomheder/webshops med overlappende eksterne ID'er, credentials, dokumenter, feeds, login, roller, låse, dubletbeskyttelse og usikre eksterne writes.
- Begge TypeScript-kontroller, Tier 1-build, applikationsbuild og begge platforms-dry-runs består.
- Test- og produktionskonfigurationerne har særskilte D1/R2-ressourcer, `workers_dev = false`, ingen cron og fortsat blokerede eksterne writes og normal kundemail.
- Migration 0025 er additiv, og den senest dokumenterede CI/deployment af commit `47e1815` bestod. Det er positiv historik, men er ikke i sig selv bevis for den aktuelle checkout.

### Frigivelsesblokerende forhold

1. **Ingen bestået pilot med to virkelige testwebshops.** Roadmappens etape 8/P09 er fortsat ikke dokumenteret gennemført med komplette salg, refunds, udbetalinger, rapporter, advarsler, dokumentrestore og overlappende eksterne ID'er. De gode syntetiske tests erstatter ikke en leverandør-end-to-end-pilot.
2. **Kerneleverancen er fortsat deaktiveret i produktion.** `PLATFORM_EXTERNAL_WRITES` og `PLATFORM_CUSTOMER_EMAIL` er `blocked`, og cronlisten er tom. Platformen kan derfor ikke udføre normal bogføring, automatisk drift eller almindelig fakturamail for en ny kunde.
3. **Kundens rigtige login- og onboardingforløb er ikke afsluttet.** Modtagelse af mailkode, komplet autentificeret kunde-/administratorflow, invitation, profil, forbindelse og første import er ikke dokumenteret end-to-end på den aktuelle produktion.
4. **Rigtige leverandørkonti er ikke afprøvet samlet.** Shopify/Dinero/Flatpay/ViaBill, live Dinero-afstemning og PartnerAds-import er enten ikke afprøvet med separate testkonti eller kun afprøvet delvist/read-only. Ingen finansielle testwrites må ske mod Sablen eller andre produktionskonti.
5. **Aktuel GitHub-status kan ikke attesteres fra denne checkout.** Checkoutet har ingen `origin`, og `gh auth status` viser ingen GitHub-login. Derfor kunne branchbeskyttelse, aktuelle checks, åbne PR'er og om HEAD findes på `Jopppardk/WebshopToolbox-Platform` ikke verificeres. Den dokumenterede CI på `47e1815` er ældre end lokal HEAD.
6. **Lint er ikke grønt.** `npm run lint` fejler på eksisterende fejl, blandt andet utilknyttede formularlabels, ubrugte imports, React-effect-mønstre og `any`. Lint er ikke med i den nuværende obligatoriske GitHub-workflow, men fejlene – især tilgængelighedsfejlene – bør ikke accepteres ved ekstern frigivelse.
7. **Sårbarhedskontrollen er uafklaret.** `npm audit --omit=dev` kunne ikke hente advisories, fordi registry-endpointet svarede 403 i miljøet. Det er en manglende kontrol, ikke et fund af nul sårbarheder.
8. **Aktuel online-status kunne ikke efterprøves herfra.** HTTP-kald til dev-, portal- og admin-domæner blev afvist af miljøets CONNECT-proxy med 403. Senest dokumenterede onlinekontrol er positiv for health/login/anonym adgang, men autentificeret browserkontrol mangler stadig.

### Ikke blokerende, men bør planlægges

- Tier 1-bundlen giver en størrelsesadvarsel over 500 kB efter minificering.
- Buildet varsler fremtidig Vite-inkompatibilitet for JSON-import uden import-attribut og en deprecated middleware-konvention.
- Produktfeedets gamle R2-snapshots har endnu ingen automatisk oprydning/livscyklus.
- Fuld Sablen-paritet eller Sablen-flytning er ikke et krav for at optage en ny, separat pilotkunde, men manglende funktioner skal være tydeligt afgrænset i pilotens scope.

## Minimumskrav før pilot i testmiljø

1. Genskab/tilknyt korrekt `origin` til `Jopppardk/WebshopToolbox-Platform`, verificér GitHub-login, push den konkrete revisionscommit via PR, og få alle obligatoriske CI-checks grønne.
2. Ret eller baseline-godkend lint eksplicit; tilgængelighedsfejl i kundeportalens kerneflow skal rettes, ikke blot ignoreres.
3. Kør en sårbarhedskontrol fra et miljø med adgang til advisories, og triagér alle relevante fund.
4. Opret to syntetiske virksomheder med mindst to testwebshops og overlappende eksterne ID'er i **testmiljøet**. Brug separate Shopify-/Dinero-/betalingsudbyder-testkonti; brug aldrig Sablen-produktion.
5. Gennemfør og dokumentér invitation/mailkode, roller, Shopify/Dinero-forbindelse, historikdato, import, dokumenter, feeds, deaktivering og negativ adgang på tværs af virksomheder.
6. Gennemfør P09-scenarier for salg, refundering, udbetaling, fejl/ukendt write, gentagelse, samtidighed, backup og restore. Eksterne writes skal være mocks eller gå til en udtrykkeligt afgrænset testkonto.
7. Verificér health, login, anonym 401, Tier 0 Access, noindex og autentificeret Tier 1 i browser på den commit, der skal pilottestes.

## Minimumskrav før almindelig produktionsfrigivelse

Ud over en bestået pilot:

1. Fastlæg det understøttede produktomfang og en driftsmæssig beslutning for bogføring, mail og planlagte kørsler. Aktivering må ske pr. virksomhed/webshop med fail-closed standard, overvågning og dokumenteret rollback.
2. Dokumentér backup/restore af D1 **og** R2, incidenthåndtering, credential-rotation, support/impersonering, dataopbevaring og kundens offboarding/sletning.
3. Bevar idempotenskvitteringer ved alle overgange. Ukendte eksterne writes må fortsat ende i manuel kontrol og må ikke genforsøges blindt.
4. Kør en release candidate gennem PR/CI, testmiljø og manuel `workflow_dispatch` til valgt miljø. Push alene er ikke en deployment.
5. Foretag en afsluttende go/no-go med bevis for den konkrete commit, migration/bookmark, Worker-version, smoke-test og rollbackpunkt.

## Kontroller udført ved denne vurdering

| Kontrol | Resultat |
| --- | --- |
| `git status --porcelain=v2 --branch` | Bestået; ren branch `work`, HEAD `2c1ec73` |
| `git remote -v` | Ikke bestået som releasebevis; ingen remotes konfigureret |
| `gh auth status` | Ikke bestået; ingen GitHub-login |
| `node scripts/platform.mjs check` | Bestået |
| `node scripts/platform-production.mjs check` | Bestået |
| `npm test` | Bestået; 355/355 |
| `npm run platform:tier1:typecheck` | Bestået |
| `npm run platform:tier1:build` | Bestået med bundle-advarsel |
| `npm run build` | Bestået med fremtidige kompatibilitetsadvarsler |
| `npm run typecheck` | Bestået |
| `npx wrangler deploy --config wrangler.direct.jsonc --dry-run` | Bestået som repositoryets aktuelle CI-kontrol; intet deploy. Filen må fortsat aldrig bruges til platformdeployment |
| `node scripts/platform.mjs build` | Bestået; dry-run, intet deploy |
| `node scripts/platform-production.mjs build` | Bestået; dry-run, intet deploy |
| `npm run lint` | Fejlet på eksisterende lint-/tilgængelighedsfejl |
| `npm audit --omit=dev` | Uafklaret; registry audit-endpoint svarede 403 |
| HTTP-smoke-test af dev/prod/admin | Uafklaret; miljøets CONNECT-proxy svarede 403 |

## Samlet anbefaling

Fortsæt med en **lukket testpilot**, når pilotkravene ovenfor er dokumenteret opfyldt. Optag ikke endnu en almindelig produktionskunde, og markedsfør ikke platformen som aktiv bogførings-/mailautomatisering, så længe writes, kundemail og cron er blokeret og den virkelige flerwebshop-pilot ikke er bestået.
