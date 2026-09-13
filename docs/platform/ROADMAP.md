# Udviklingsplan

Opdatering 13. september 2026: Se ADR-001.md, ADMIN-FOUNDATION.md og BACKLOG.md for den aktuelle delvise gennemførelse af etape 1–3/5. Selvstændig test-Worker og adminskema er etableret, men Access-login er endnu ikke konfigureret. Ingen integrationer er flyttet og ingen produktionsetape er startet. Beskrivelsen nedenfor bevarer den oprindelige samlede plan.

Etape 0 er lokalt gennemført for klon, revision, instruktioner og opgavegrundlag den 12. september 2026. En fælles GitHub-tavle er endnu ikke oprettet, så etape 0's fulde oprindelige acceptkrav er ikke afsluttet. Etape 1–10 er fortsat planlagt; forslag til etape 1–2 ligger i DATA-MODEL.md og TEST-ENVIRONMENT.md. Konkrete udviklingsopgaver står i BACKLOG.md.

| Etape | Leverance | Acceptkrav |
| --- | --- | --- |
| 0 | Git-checkout og projektorganisering | Rigtig lokal klon, gennemgåede lokale afvigelser, projektinstruktioner og fælles opgavetavle. |
| 1 | Arkitektur og dataejerskab | Beslutningsnotat for virksomhed, webshop, bruger, regnskab og betalingsaftale; kortlægning af alle hardcodede Sablen-værdier. |
| 2 | Separat testmiljø | Egne ressourcer og secrets; ingen produktionsbogføring eller kundemails fra test. Dokumenteret udrulning og tilbageførsel. |
| 3 | Identitet og adgang | Platformadministrator og webshopbrugere; servervalideret adgang ved alle læsninger og skrivninger. |
| 4 | Dataadskillelse | Forespørgsler, credentials, dokumentnøgler, cache, logs, notifikationer og dubletkontrol er afgrænset korrekt. Tests med to webshops afviser adgang på tværs. |
| 5 | Administration | Opret/deaktivér virksomhed og webshop; tilknyt brugere; se integrationer og driftsstatus; administrative handlinger logges. |
| 6 | Integrationer pr. webshop | Egne nøgler, kontoplaner, startdatoer og mailvalg. Tilslutning og frakobling påvirker kun den relevante webshop. |
| 7 | Kørsler pr. webshop | Intervaller, kørselslåse, genforsøg og fremdrift adskilles. Fejl hos én webshop blokerer ikke andre. |
| 8 | Pilot med to testwebshops | Test salg, refunderinger, udbetalinger, rapporter og advarsler med overlappende eksterne ID'er. Kontroller også fælles Dinero-regnskab. |
| 9 | Flyt Sablen | Backup og prøveflytning; alle bogføringsreferencer og dokumenter bevares; gamle kørsler stoppes før nye startes. Ingen dobbeltbogføring. |
| 10 | Åbn for næste webshop | Dokumenteret oprettelse, driftsovervågning, support og gendannelse. |

## Leveranceprocedure
Én afgrænset opgave med acceptkrav → ændring i separat branch → relevante tests og typekontrol → pull request → testmiljø → kontrolleret produktion.

## Flytning af Sablen
Flytteplanen skal omfatte konfiguration, krypterede nøgler, ordrer, fakturaer, udbetalinger, refunderinger, dokumenter, jobhistorik, låse, sidekurser og bogføringskvitteringer. Bevar tilknytning til Dinero-organisation og eksisterende bilags-ID'er. En tilbageførsel skal også tage højde for posteringer oprettet efter skiftet; database-restore alene må ikke give genbogføring.
