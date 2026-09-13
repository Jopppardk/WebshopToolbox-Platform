# Forslag til datamodel og dataejerskab

Oprindeligt forslag 12. september 2026. Standardvalg er nu besluttet i ADR-001.md. Administrationens tabeller er implementeret i separat test-D1; regnskaber, aftaler, bogføringsoperationer og de øvrige integrationsdele nedenfor er fortsat målbillede. Ingen produktionsdata er ændret. Se ADMIN-FOUNDATION.md for det præcise implementerede udsnit.

## Anbefalet udgangspunkt

Start med administratoroprettede virksomheder/webshops og en fælles database i det separate platformmiljø. Brug interne, uforanderlige ID'er; et domæne er en indstilling, ikke en identitet. Alle adgangsveje skal afgrænses i serverkode og constraints. Separat database pr. virksomhed kan vurderes ved konkrete krav til drift og isolation; det løser ikke alene adgang til dokumenter, credentials eller delte eksterne konti.

## Relationer og nøgler

| Entitet | Nøgle og relationer | Ansvar |
| --- | --- | --- |
| companies | `id`, navn, status | Virksomhed og administrativ ejer |
| webshops | `id`, `company_id`, domæne, status; UNIQUE(company_id,id) | Import, webshopindstillinger og adgang |
| users | `id`, UNIQUE(identity_issuer,identity_subject), status | Valideret identitet; email er visning, ikke autorisationsnøgle |
| company_memberships | PK(company_id,user_id), rolle | Virksomhedsadministrator eller almindeligt medlem |
| webshop_memberships | PK(company_id,webshop_id,user_id), rolle | Eksplicit adgang for medlem til webshop; sammensatte FK til webshop og virksomhedsmedlemskab |
| platform_admins | PK(user_id) | Særskilt privilegium med audit af administrative handlinger |
| accounting_connections | `id`, `company_id`, provider, external_organization_id, miljø, status | Regnskabskonto; UNIQUE(provider,miljø,external_organization_id), så samme regnskab ikke utilsigtet får to virksomhedsejere |
| webshop_accounting_links | company_id, webshop_id, accounting_connection_id, gyldighed | Flere webshops kan pege på samme regnskab inden for samme virksomhed |
| payment_agreements | `id`, company_id, provider, merchant_id, external_agreement_id, miljø | UNIQUE(provider,miljø,merchant_id,external_agreement_id); én ejer af en betalingsaftale |
| webshop_payment_links | company_id, webshop_id, payment_agreement_id | Deling kræver eksplicit kobling og dokumenteret fordeling |
| integration_connections | `id`, company_id, webshop_id, provider, external_account_id, status | Fx en Shopify-kilde; kildekonto må ikke kobles til flere importejere utilsigtet |
| credential_envelopes | `id`, ejerrelation, key_version, ciphertext, iv, verified_at | Præcis én FK til integrationsforbindelse, regnskabsforbindelse eller betalingsaftale; CHECK for ejerens type |
| integration_records | `id`, company_id, webshop_id, source_connection_id, record_type, external_id, payload | UNIQUE(source_connection_id,record_type,external_id); kilde og webshop skal tilhøre samme virksomhed |
| payment_payouts | `id`, company_id, payment_agreement_id, external_id | UNIQUE(payment_agreement_id,external_id); en fælles aftales udbetaling importeres én gang |
| payout_allocations | payout_id, webshop_id, beløb, valuta, grundlag | Fordeling uden at kopiere udbetalingen; ukendt fordeling blokerer bogføring |
| booking_operations | `id`, company_id, accounting_connection_id, kilde, operation_kind, idempotency_key, state | UNIQUE(accounting_connection_id,idempotency_key); atomisk reservation før ekstern oprettelse |
| booking_receipts | operation_id, external_voucher_id, external_reference, tidsstempel, hash | Varig kvittering og afstemningsgrundlag; overskrives/slettes ikke ved almindelig historikoprydning |
| documents | `id`, company_id, webshop_id eller aftale/operation, object_key, hash | Serveropslag før download; R2-nøgle omfatter miljø, virksomhed og ressourceejer |
| job_runs / job_leases / sync_cursors | company_id, ejerscope, job_key, connection_id | Lease med owner, udløb og version/fencing; cursor pr. kilde og filterversion |
| settings / incidents / audit_events / email_deliveries | company_id og ressourceejer | Autoriseret læsning, deduplikeret mail og redigerede logdata |

Alle tværgående relationer skal bruge sammensatte fremmednøgler med `company_id`, ikke blot valide individuelle ID'er. Hvor en entitet kan have flere ejertyper, bruges konkrete nullable FK-kolonner plus CHECK for præcis én ejer; undgå frit tekstfelt som eneste integritetskontrol. Webshopindstillinger er separate fra indstillinger for fælles regnskab eller aftale.

## Serveradgang

Serveren validerer signeret identitet med issuer/audience/udløb og slår aktivt medlemskab og ressourceejerskab op. Et klientvalgt webshop-ID er kun et valg, aldrig bevis på adgang. Databaselag modtager en serveroprettet adgangskontekst. Baggrundskørsler bruger særskilt servicekontekst fra aktive forbindelser. Listning, eksport, dokumentdownload, logs, admin, cache og skrivninger kontrolleres på samme måde.

Foreslåede roller: platformadministrator, virksomhedsadministrator, webshopoperatør og læser. Virksomhedsadministrator kan administrere egen virksomheds webshops; operatør/læser får kun eksplicit webshopadgang. Fælles regnskabsdata og ufordelte aftaleudbetalinger kræver virksomhedsadgang; en webshopbruger må ikke se andre webshops via fælles konti. Ingen HTTP-header med en email alene må give adgang. Produktionsmiddleware accepterer i dag en bestemt email-header og springer kontrol over uden for production; dette er ikke platformens adgangsmodel.

## Dubletter og usikre writes

Kildeidentiteten skal med i dubletnøglen. To Shopify-kilder kan begge have ordre `123`; to forskellige betalingsaftaler kan begge have udbetaling `456`. Ved fælles aftale er udbetalingen derimod samme kilde og må kun importeres og bogføres én gang. Bogføringsnøglen bygger på stabil kilde, operationstype og regnskabsforbindelse; tilfældig retry-ID eller beløb alene er utilstrækkeligt.

Foreslået tilstandsmaskine: `prepared → sending → confirmed`; timeout eller nedbrud efter muligt eksternt write fører til `uncertain`. Genstart med efterladt `sending` behandles også som usikker. Kun dokumenteret afvisning før oprettelse må sættes tilbage til en automatisk genforsøgbar tilstand. `uncertain` kræver afstemning via ekstern reference/kvittering eller manuel behandling. Lease-udløb tillader ikke i sig selv genoprettelse. `confirmed` bevarer bilags-ID og journalspor. Ekstern oprettelse og lokal database kan ikke antages at være én atomisk transaktion.

## Kortlægning fra eksisterende kode

| Eksisterende kode | Nødvendig ændring i senere etape |
| --- | --- |
| `db/schema.ts`, `drizzle/*`, `db/database.ts` | Fjern implicit Sablen-ejer; erstat request-initieret skema/cleanup med kontrollerede migrationer og scoped oprydning |
| `db/credentials.ts`, `db/integration-selection.ts` | Credentials ligger både i credential-tabellen og app_settings; normaliser med bevaret kryptering og ejerskab |
| `middleware.ts`, `app/api/**` | Valider identitet og autoriser virksomhed/webshop på alle ruter |
| `worker-entry.ts`, `db/*-automation.ts`, `db/sync-cycle.ts`, `db/paginated-sync.ts` | Ejerspecifik scheduler, leases og cursors |
| `db/*-transfer.ts`, `db/flatpay-draft.ts`, `db/manual-booking.ts` | Bevar eksisterende bogføringskvitteringer og erstat globale referencepræfikser |
| `db/dashboard-finance.ts`, `db/schema.ts` dashboard_ledger | Regnskabsdata ejes af regnskabsforbindelse; adgang til fælles regnskab må ikke lække data |
| `db/history.ts`, `db/payout-events.ts`, `db/errors.ts`, `db/incident-recovery.ts` | Scoped retention, hændelser, alarmer og afstemning |
| `lib/invoice-pdf.ts`, `lib/payout-report.ts`, `db/flatpay-report.ts`, `lib/flatpay-report.ts` | Branding, R2-nøgler, rapportindhold og dokumentadgang |
| `lib/invoice-email.ts`, `db/errors.ts`, `wrangler.direct.jsonc` | Afsender/modtagerpolitik samt miljøadskillelse |

En indledende søgning efter `sablen|SABLEN|45036871|LA Trading` fandt 76 runtimefiler i app/db/lib samt middleware/worker. Det er ikke en fuld isolationstest: globale nøgler, kontonumre og manglende WHERE-filtre kan være uden Sablen-tekst. P02 skal gennemgå samtlige ruter, tabeller, settings-nøgler, bindings og eksterne writes.

## Krævede tests før modellen accepteres

To virksomheder med hver sin webshop bruger samme eksterne ordre-, refund- og udbetalings-ID. Begge importer bevares; krydsadgang afvises på alle operationer. To webshops i samme virksomhed deler Dinero-regnskab og betalingsaftale: én fælles udbetaling bogføres én gang, med korrekt fordeling og begrænset visning. FK-tests afviser blandede virksomhedsejere. Parallelle forsøg, timeout efter ekstern oprettelse, genstart og lease-udløb giver ingen dobbeltbogføring. Dokumenter, cache, fejl, mails og restore indgår i samme testmatrix.

Åbne beslutninger: godkend roller/databasevalg, loginudbyder, regler for delte aftaler og dataopbevaring. Overgang af Sablen er fortsat etape 9; ingen migration startes ud fra dette forslag.
