INSERT OR IGNORE INTO feature_requests (id, tenant, title, description, desired_outcome, area, priority, status, created_by)
VALUES ('backlog-viabill-integration', 'sablen.dk', 'Integration til ViaBill', 'ViaBill skal integreres til betalinger og udbetalinger. Arbejdet afventer de nødvendige oplysninger og afklaringer fra ViaBill.', 'Færdiggør forbindelsen, synkroniseringen og bogføringsflowet, når ViaBill har leveret den manglende information.', 'Integrationer', 'high', 'clarification', 'rene@sablen.dk');

INSERT OR IGNORE INTO feature_requests (id, tenant, title, description, desired_outcome, area, priority, status, created_by)
VALUES ('backlog-flatpay-integration', 'sablen.dk', 'Integration til Flatpay', 'Flatpay skal integreres til betalinger og udbetalinger. Arbejdet afventer API-information og adgangsoplysninger fra Flatpay.', 'Byg import og bogføringsflow, når Flatpay har leveret dokumentation og adgang.', 'Integrationer', 'high', 'clarification', 'rene@sablen.dk');

INSERT OR IGNORE INTO feature_requests (id, tenant, title, description, desired_outcome, area, priority, status, created_by)
VALUES ('backlog-packaging-reporting-integration', 'sablen.dk', 'Integration til Emballageindberetning.dk', 'Den eksisterende emballageregistrering skal forbindes til Emballageindberetning.dk. Arbejdet afventer godkendelse fra Emballageindberetning.dk.', 'Automatisér indberetningen med kontrol og tydelig status, når adgangen er godkendt.', 'Integrationer', 'medium', 'clarification', 'rene@sablen.dk');

INSERT OR IGNORE INTO feature_requests (id, tenant, title, description, desired_outcome, area, priority, status, created_by)
VALUES ('backlog-sales-analysis', 'sablen.dk', 'Salgsanalyse-side', 'Opret en salgsanalyse-side, som giver et samlet og anvendeligt overblik over salget i webshoppen.', 'Vis relevante nøgletal, udvikling og mulighed for at analysere salget over valgte perioder.', 'Salg', 'medium', 'proposed', 'rene@sablen.dk');

PRAGMA optimize;
