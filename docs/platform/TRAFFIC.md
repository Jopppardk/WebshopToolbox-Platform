# Trafikkilder

Status 22. november 2026: implementeret, testet og udgivet på dev og prod (Claude, PR #223, main `e2ba3c2`, workflow-run 45066028690). Ingen migration.

## Funktion

Tools → Trafikkilder viser for den valgte webshop, hvor de besøgende kommer fra, og hvor de kunder, der bestiller, kommer fra. Perioden er de seneste 7, 30, 90 eller 365 dage i webshoppens tidszone, afkortet ved den gemte historikstart.

- Nøgletal: besøg, ordrer, konverteringsrate (besøg med gennemført køb ÷ besøg) og salg ekskl. moms.
- Kanaler: hver kanals andel af besøg og af ordrer side om side, med konvertering og salg. Shopifys "direct" og "unknown" for besøg og en ordre uden kilde samles i "Direkte / ukendt".
- Kilder i detaljer (faner): henvisere (Google, Facebook, …), kampagner (UTM-kilde/medie/kampagne), lande (besøgets land og ordrens leveringsland), landingssider og enheder. Kan sorteres efter besøg, ordrer, salg eller konvertering.

## Kilder og adgang

`GET /api/platform/tier1/shops/:shop/traffic?days=7|30|90|365[&refresh=1]` validerer session, virksomhed og webshop på serveren (`platform/traffic-source.ts`). Tallene hentes med ShopifyQL (`shopifyqlQuery`), kun læsning, med samme adgang som Performance: `read_reports` og Level 2-adgang til beskyttede kundedata. Ingen nye scopes.

- Besøg: `FROM sessions SHOW sessions, sessions_that_completed_checkout GROUP BY referrer_source | referrer_source, referrer_name | utm_source, utm_medium, utm_campaign | session_country_code | landing_page_path | session_device_type`.
- Ordrer: `FROM sales SHOW orders, total_sales, taxes GROUP BY order_referrer_source | order_referrer_source, order_referrer_name | order_utm_source, order_utm_medium, order_utm_campaign | shipping_country_code`.
- Plus to totaler uden opdeling. I alt 12 forespørgsler, højst 3 ad gangen.

Ordrer tilskrives den kilde, Shopify har registreret på ordren; besøg tilskrives hvert besøgs egen kilde. Hver opdeling henter de 100 største kilder; resten vises som "Øvrige" ud fra totalerne. En kilde, der kun findes på den ene side, vises som 0, når den side var komplet, ellers som ukendt (—). Fejl vises pr. side og opdeling, så manglende trafikadgang ikke skjuler ordrerne. Parserfejl og ugyldige tal læses aldrig som 0 (`platform/traffic-calculations.ts`).

Cache: `traffic:v1:` i `finance_state` via den fælles `cachedRead` (15 minutter, fejl 30 sekunder, lås mod samtidige hentninger). Demokontoen får fiktive tal (`demoTraffic` i `platform/demo.ts`).

## Verifikation og rester

Forespørgslerne er afprøvet mod en rigtig Shopify-butik med Shopifys analyseværktøj (samme ShopifyQL). Tests i `lib/platform-performance.test.mjs`, demo-API i `lib/platform-access.test.mjs` og siden i portalens browsertest. Selve siden er ikke set mod en rigtig butik via platformens app.
