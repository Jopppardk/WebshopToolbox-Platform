# Isolationsregister – eksisterende ruter og datalag

Genereret med `node scripts/platform-inventory.mjs`. Kilden er den lokale platformbranch; ingen produktionsdata er læst. Registret kortlægger statiske imports, SQL-tabeller og operationer. Dynamiske settings-nøgler og semantisk dataejerskab skal stadig følges ved P06-konvertering; dette er ikke bevis for isolation i legacy-appen.

Alle nedenstående legacy-ruter er **udeladt af test-Workerens importgraf** og afvises i tests. Ingen af dem genbruges som admin-API. P06 ejer dataadskillelsen; finansielle writes og leases ligger desuden i P08.

| Route | Metoder | Tabeller i afhængigheder | Filer i importgraf | Leverance |
| --- | --- | --- | ---: | --- |
| /api/admin/errors | GET, POST | `app_settings`, `feature_requests`, `integration_credentials`, `integration_records`, `job_runs`, `system_errors` | 9 | P06/P08 |
| /api/admin/feature-requests | GET, POST, PATCH | `app_settings`, `feature_request_numbers`, `feature_requests`, `integration_records`, `job_runs` | 6 | P06/P08 |
| /api/admin/history | GET, POST | `app_settings`, `feature_requests`, `integration_records`, `job_runs` | 6 | P06/P08 |
| /api/admin/insights | GET | `app_settings`, `feature_requests`, `integration_records`, `job_runs` | 6 | P06/P08 |
| /api/admin/settings | GET, POST | `app_settings`, `feature_requests`, `integration_records`, `job_runs` | 8 | P06/P08 |
| /api/admin/sync-status | GET | `app_settings`, `feature_requests`, `integration_records`, `job_runs` | 8 | P06/P08 |
| /api/bookkeeping/manual | POST | `an`, `app_settings`, `being`, `feature_requests`, `integration_credentials`, `integration_records`, `job_runs`, `payout_events`, `stored`, `system_errors` | 38 | P06/P08 |
| /api/dashboard/finance | GET | `app_settings`, `dashboard_ledger`, `feature_requests`, `integration_credentials`, `integration_records`, `job_runs` | 9 | P06/P08 |
| /api/dashboard/platform | GET | `app_settings`, `feature_requests`, `integration_credentials`, `integration_records`, `job_runs` | 11 | P06/P08 |
| /api/dinero/accounts | GET, POST | `app_settings`, `being`, `feature_requests`, `integration_credentials`, `integration_records`, `job_runs`, `system_errors` | 13 | P06/P08 |
| /api/documents | GET, POST | `app_settings`, `feature_requests`, `integration_credentials`, `integration_records`, `job_runs`, `stored`, `system_errors` | 19 | P06/P08 |
| /api/emballage/connection | GET, POST | `app_settings`, `emballage_submissions`, `feature_requests`, `integration_credentials`, `integration_records`, `job_runs` | 11 | P06/P08 |
| /api/emballage/reporting | GET, POST | `app_settings`, `emballage_submissions`, `feature_requests`, `integration_credentials`, `integration_records`, `job_runs`, `stored`, `system_errors` | 19 | P06/P08 |
| /api/flatpay/connection | GET, POST | `app_settings`, `feature_requests`, `integration_credentials`, `integration_records`, `job_runs` | 8 | P06/P08 |
| /api/flatpay/draft | POST | `app_settings`, `being`, `feature_requests`, `integration_credentials`, `integration_records`, `job_runs`, `payout_events`, `stored` | 21 | P06/P08 |
| /api/flatpay/production | GET, POST | `app_settings`, `being`, `feature_requests`, `integration_credentials`, `integration_records`, `job_runs` | 14 | P06/P08 |
| /api/flatpay/records | POST | `app_settings`, `feature_requests`, `integration_credentials`, `integration_records`, `job_runs`, `payout_events`, `stored` | 13 | P06/P08 |
| /api/flatpay/refunds | POST | `app_settings`, `feature_requests`, `integration_credentials`, `integration_records`, `job_runs` | 10 | P06/P08 |
| /api/flatpay/sync | POST | `app_settings`, `feature_requests`, `integration_credentials`, `integration_records`, `job_runs`, `payout_events`, `stored` | 15 | P06/P08 |
| /api/integrations | GET, POST | `app_settings`, `feature_requests`, `integration_credentials`, `integration_records`, `job_runs`, `system_errors` | 8 | P06/P08 |
| /api/integrations/selection | GET, POST | `app_settings`, `feature_requests`, `integration_credentials`, `integration_records`, `job_runs` | 8 | P06/P08 |
| /api/integrations/start-date | GET, POST | `app_settings`, `feature_requests`, `integration_credentials`, `integration_records`, `job_runs` | 8 | P06/P08 |
| /api/invoices/email-test | POST | `app_settings`, `feature_requests`, `integration_credentials`, `integration_records`, `invoice_email_deliveries`, `job_runs`, `stored`, `system_errors` | 17 | P06/P08 |
| /api/invoices/email | POST | `app_settings`, `feature_requests`, `integration_credentials`, `integration_records`, `invoice_email_deliveries`, `job_runs`, `stored`, `system_errors` | 17 | P06/P08 |
| /api/invoices/pdf | GET | `app_settings`, `feature_requests`, `integration_records`, `job_runs`, `stored`, `system_errors` | 12 | P06/P08 |
| /api/invoices | GET, POST | `app_settings`, `feature_requests`, `integration_credentials`, `integration_records`, `job_runs`, `stored`, `system_errors` | 16 | P06/P08 |
| /api/notifications | GET, POST | `app_settings`, `feature_requests`, `integration_credentials`, `integration_records`, `job_runs`, `system_errors` | 8 | P06/P08 |
| /api/payouts/log | GET | `app_settings`, `feature_requests`, `integration_credentials`, `integration_records`, `job_runs`, `json_each`, `payout_events`, `stored` | 14 | P06/P08 |
| /api/payouts/overview | GET | `app_settings`, `feature_requests`, `integration_credentials`, `integration_records`, `job_runs`, `json_each`, `payout_events`, `payouts` | 10 | P06/P08 |
| /api/payouts/transfer | POST | `app_settings`, `being`, `feature_requests`, `integration_credentials`, `integration_records`, `job_runs`, `payout_events`, `stored`, `system_errors` | 26 | P06/P08 |
| /api/refunds/overview | GET | `app_settings`, `feature_requests`, `filtered`, `integration_credentials`, `integration_records`, `job_runs`, `refunds` | 8 | P06/P08 |
| /api/refunds/transfer | POST | `app_settings`, `being`, `feature_requests`, `integration_credentials`, `integration_records`, `job_runs`, `stored`, `system_errors` | 22 | P06/P08 |
| /api/sales/log | GET | `app_settings`, `feature_requests`, `integration_records`, `invoice_email_deliveries`, `job_runs` | 7 | P06/P08 |
| /api/sales/preview | POST | `app_settings`, `being`, `feature_requests`, `integration_credentials`, `integration_records`, `job_runs` | 16 | P06/P08 |
| /api/sales/transfer | POST | `app_settings`, `being`, `feature_requests`, `integration_credentials`, `integration_records`, `job_runs`, `stored`, `system_errors` | 21 | P06/P08 |
| /api/shopify/inventory | GET, POST | `app_settings`, `being`, `feature_requests`, `integration_credentials`, `integration_records`, `job_runs`, `stored`, `system_errors` | 21 | P06/P08 |
| /api/shopify/orders | GET, POST | `app_settings`, `feature_requests`, `integration_credentials`, `integration_records`, `job_runs`, `stored`, `system_errors` | 19 | P06/P08 |
| /api/shopify/packaging | GET, POST | `app_settings`, `feature_requests`, `integration_credentials`, `integration_records`, `job_runs`, `stored`, `system_errors` | 17 | P06/P08 |
| /api/shopify/payments | GET, POST | `app_settings`, `feature_requests`, `integration_credentials`, `integration_records`, `job_runs`, `stored`, `system_errors` | 13 | P06/P08 |
| /api/shopify/payouts | GET, POST | `app_settings`, `feature_requests`, `integration_credentials`, `integration_records`, `job_runs`, `payout_events`, `stored`, `system_errors` | 17 | P06/P08 |
| /api/shopify/refunds | GET, POST | `app_settings`, `feature_requests`, `integration_credentials`, `integration_records`, `job_runs`, `stored`, `system_errors` | 13 | P06/P08 |
| /api/viabill/connection | GET, POST | `app_settings`, `feature_requests`, `integration_credentials`, `integration_records`, `job_runs`, `stored`, `system_errors` | 11 | P06/P08 |
| /api/viabill/records | GET, POST | `app_settings`, `feature_requests`, `integration_credentials`, `integration_records`, `job_runs`, `payout_events`, `stored`, `system_errors` | 12 | P06/P08 |

## Datalag og ressourceadgang

| Fil | Lokale adgangssignaler | Mål / næste ændring |
| --- | --- | --- |
| `db/credentials.ts` | SQL, credentials, legacy-ejer | Scoped kontekst og ejerskab i P06; jobs/writes i P08. Udeladt fra admin-Worker. |
| `db/dashboard-activity.ts` | SQL, legacy-ejer | Scoped kontekst og ejerskab i P06; jobs/writes i P08. Udeladt fra admin-Worker. |
| `db/dashboard-finance.ts` | SQL, HTTP, credentials, lås/fremdrift, legacy-ejer | Scoped kontekst og ejerskab i P06; jobs/writes i P08. Udeladt fra admin-Worker. |
| `db/database.ts` | SQL, dokumentlager | Scoped kontekst og ejerskab i P06; jobs/writes i P08. Udeladt fra admin-Worker. |
| `db/dinero-accounts.ts` | HTTP, credentials | Scoped kontekst og ejerskab i P06; jobs/writes i P08. Udeladt fra admin-Worker. |
| `db/dinero-chart.ts` | SQL, credentials, legacy-ejer | Scoped kontekst og ejerskab i P06; jobs/writes i P08. Udeladt fra admin-Worker. |
| `db/dinero-client.ts` | HTTP, credentials | Scoped kontekst og ejerskab i P06; jobs/writes i P08. Udeladt fra admin-Worker. |
| `db/emballage-monitor.ts` | SQL, credentials, legacy-ejer | Scoped kontekst og ejerskab i P06; jobs/writes i P08. Udeladt fra admin-Worker. |
| `db/emballage.ts` | SQL, credentials, lås/fremdrift, legacy-ejer | Scoped kontekst og ejerskab i P06; jobs/writes i P08. Udeladt fra admin-Worker. |
| `db/errors.ts` | SQL, mail, legacy-ejer | Scoped kontekst og ejerskab i P06; jobs/writes i P08. Udeladt fra admin-Worker. |
| `db/flatpay-activity.ts` | SQL, credentials, legacy-ejer | Scoped kontekst og ejerskab i P06; jobs/writes i P08. Udeladt fra admin-Worker. |
| `db/flatpay-automation.ts` | SQL, credentials, legacy-ejer | Scoped kontekst og ejerskab i P06; jobs/writes i P08. Udeladt fra admin-Worker. |
| `db/flatpay-draft.ts` | SQL, dokumentlager, credentials, legacy-ejer | Scoped kontekst og ejerskab i P06; jobs/writes i P08. Udeladt fra admin-Worker. |
| `db/flatpay-production.ts` | SQL, credentials, legacy-ejer | Scoped kontekst og ejerskab i P06; jobs/writes i P08. Udeladt fra admin-Worker. |
| `db/flatpay-report.ts` | SQL, HTTP, dokumentlager, credentials, legacy-ejer | Scoped kontekst og ejerskab i P06; jobs/writes i P08. Udeladt fra admin-Worker. |
| `db/flatpay-sync.ts` | SQL, credentials, lås/fremdrift, legacy-ejer | Scoped kontekst og ejerskab i P06; jobs/writes i P08. Udeladt fra admin-Worker. |
| `db/flatpay-upcoming.ts` | SQL, legacy-ejer | Scoped kontekst og ejerskab i P06; jobs/writes i P08. Udeladt fra admin-Worker. |
| `db/history.ts` | SQL, legacy-ejer | Scoped kontekst og ejerskab i P06; jobs/writes i P08. Udeladt fra admin-Worker. |
| `db/incident-recovery.ts` | SQL, legacy-ejer | Scoped kontekst og ejerskab i P06; jobs/writes i P08. Udeladt fra admin-Worker. |
| `db/integration-selection.ts` | SQL, credentials, legacy-ejer | Scoped kontekst og ejerskab i P06; jobs/writes i P08. Udeladt fra admin-Worker. |
| `db/integration-start.ts` | SQL, legacy-ejer | Scoped kontekst og ejerskab i P06; jobs/writes i P08. Udeladt fra admin-Worker. |
| `db/job-runs.ts` | SQL, legacy-ejer | Scoped kontekst og ejerskab i P06; jobs/writes i P08. Udeladt fra admin-Worker. |
| `db/manual-booking.ts` | SQL, credentials, legacy-ejer | Scoped kontekst og ejerskab i P06; jobs/writes i P08. Udeladt fra admin-Worker. |
| `db/order-payment-provider.ts` | SQL, legacy-ejer | Scoped kontekst og ejerskab i P06; jobs/writes i P08. Udeladt fra admin-Worker. |
| `db/paginated-sync.ts` | SQL, lås/fremdrift, legacy-ejer | Scoped kontekst og ejerskab i P06; jobs/writes i P08. Udeladt fra admin-Worker. |
| `db/payout-automation.ts` | SQL, dokumentlager, credentials, legacy-ejer | Scoped kontekst og ejerskab i P06; jobs/writes i P08. Udeladt fra admin-Worker. |
| `db/payout-events.ts` | SQL, lås/fremdrift, legacy-ejer | Scoped kontekst og ejerskab i P06; jobs/writes i P08. Udeladt fra admin-Worker. |
| `db/payout-log.ts` | SQL, credentials, legacy-ejer | Scoped kontekst og ejerskab i P06; jobs/writes i P08. Udeladt fra admin-Worker. |
| `db/payout-transfer.ts` | SQL, credentials, legacy-ejer | Scoped kontekst og ejerskab i P06; jobs/writes i P08. Udeladt fra admin-Worker. |
| `db/refund-automation.ts` | SQL, credentials, legacy-ejer | Scoped kontekst og ejerskab i P06; jobs/writes i P08. Udeladt fra admin-Worker. |
| `db/sales-automation.ts` | SQL, legacy-ejer | Scoped kontekst og ejerskab i P06; jobs/writes i P08. Udeladt fra admin-Worker. |
| `db/sales-transfer.ts` | SQL, dokumentlager, credentials, lås/fremdrift, legacy-ejer | Scoped kontekst og ejerskab i P06; jobs/writes i P08. Udeladt fra admin-Worker. |
| `db/schema.ts` | credentials, lås/fremdrift, legacy-ejer | Scoped kontekst og ejerskab i P06; jobs/writes i P08. Udeladt fra admin-Worker. |
| `db/shopify-order.ts` | lås/fremdrift | Scoped kontekst og ejerskab i P06; jobs/writes i P08. Udeladt fra admin-Worker. |
| `db/shopify.ts` | HTTP, credentials | Scoped kontekst og ejerskab i P06; jobs/writes i P08. Udeladt fra admin-Worker. |
| `db/sync-cycle.ts` | SQL, lås/fremdrift, legacy-ejer | Scoped kontekst og ejerskab i P06; jobs/writes i P08. Udeladt fra admin-Worker. |
| `lib/dashboard-finance.ts` | lås/fremdrift | Scoped kontekst og ejerskab i P06; jobs/writes i P08. Udeladt fra admin-Worker. |
| `lib/diagnostics.ts` | credentials | Scoped kontekst og ejerskab i P06; jobs/writes i P08. Udeladt fra admin-Worker. |
| `lib/dinero-sale.ts` | dokumentlager, lås/fremdrift, legacy-ejer | Scoped kontekst og ejerskab i P06; jobs/writes i P08. Udeladt fra admin-Worker. |
| `lib/emballage-api.ts` | HTTP, lås/fremdrift | Scoped kontekst og ejerskab i P06; jobs/writes i P08. Udeladt fra admin-Worker. |
| `lib/flatpay-api.ts` | HTTP | Scoped kontekst og ejerskab i P06; jobs/writes i P08. Udeladt fra admin-Worker. |
| `lib/flatpay-draft.ts` | lås/fremdrift, legacy-ejer | Scoped kontekst og ejerskab i P06; jobs/writes i P08. Udeladt fra admin-Worker. |
| `lib/flatpay-report.ts` | lås/fremdrift, legacy-ejer | Scoped kontekst og ejerskab i P06; jobs/writes i P08. Udeladt fra admin-Worker. |
| `lib/invoice-check.ts` | lås/fremdrift | Scoped kontekst og ejerskab i P06; jobs/writes i P08. Udeladt fra admin-Worker. |
| `lib/invoice-pdf.ts` | SQL, HTTP, dokumentlager, legacy-ejer | Scoped kontekst og ejerskab i P06; jobs/writes i P08. Udeladt fra admin-Worker. |
| `lib/packaging.ts` | dokumentlager | Scoped kontekst og ejerskab i P06; jobs/writes i P08. Udeladt fra admin-Worker. |
| `lib/payout-report.ts` | SQL, HTTP, dokumentlager, legacy-ejer | Scoped kontekst og ejerskab i P06; jobs/writes i P08. Udeladt fra admin-Worker. |
| `lib/refund-voucher.ts` | dokumentlager, legacy-ejer | Scoped kontekst og ejerskab i P06; jobs/writes i P08. Udeladt fra admin-Worker. |
| `lib/sales-preview.ts` | lås/fremdrift | Scoped kontekst og ejerskab i P06; jobs/writes i P08. Udeladt fra admin-Worker. |
| `lib/shopify-payments.ts` | lås/fremdrift | Scoped kontekst og ejerskab i P06; jobs/writes i P08. Udeladt fra admin-Worker. |
| `lib/shopify-request.ts` | HTTP | Scoped kontekst og ejerskab i P06; jobs/writes i P08. Udeladt fra admin-Worker. |
| `lib/viabill.ts` | HTTP, credentials | Scoped kontekst og ejerskab i P06; jobs/writes i P08. Udeladt fra admin-Worker. |
| `worker-entry.ts` | SQL, HTTP, legacy-ejer | Scoped kontekst og ejerskab i P06; jobs/writes i P08. Udeladt fra admin-Worker. |

Omfang: 43 API-ruter og 53 datalag-/runtimefiler med adgangssignaler. Tabellen er en reproducerbar teknisk fortegnelse; se ADR-001.md for de besluttede ejerskabsregler og ADMIN-FOUNDATION.md for det implementerede udsnit.
