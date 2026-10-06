# Plan

Den prioriterede rækkefølge efter analysen 6. oktober 2026. Den tidligere udviklingsplan ligger i [archive/ROADMAP-2026-10-04.md](archive/ROADMAP-2026-10-04.md).

## Næste skridt

1. ~~**Tier 1-ydelse.**~~ Udført 6. oktober 2026 (se CHANGELOG).
2. ~~**Kodekvalitet.**~~ Udført 6. oktober 2026: ingen "[object Object]", lint 467 → 275, al kode formateret (se CHANGELOG).
3. **"Kræver handling".** Én liste over alt, kunden skal tage stilling til:
   - fejlede og uafklarede poster
   - ordrer, der afventer opsætning af marked
   - tilbagebetalinger, der venter på salget
   - lagerreguleringer
4. **Eksport til revisor (CSV)** fra Salg, Tilbagebetalinger og Udbetalinger.
5. **"Prøv igen" på flere poster ad gangen.**
6. **Afstemning af mellemregningskontoen** mod Dinero.
7. **Drift.**
   - Databasens størrelse i den daglige driftsmail.
   - Opbevaringsregel for `production_attempts` og `operation_snapshots`.
   - En øvelse i at gendanne data.
   - Backup af R2.
8. **Test.** En browsertest af Tier 0 (virksomheder, support-login, driftsoverblik) og af printeropsætningen til Shipmondo.

## Før lancering

- Sletning og eksport af en kundes data (GDPR)
- "Kom godt i gang"-tjekliste for nye kunder: Shopify, Dinero, bogføringsstart, kontoplan, fakturaopsætning, testmail
- Abonnement og betaling
- Funktionsflag pr. kunde

## Senere

- e-conomic
- OSS-moms
- Flere webshopplatforme
