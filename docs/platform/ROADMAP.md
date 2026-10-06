# Plan

Den prioriterede rækkefølge efter analysen 6. oktober 2026. Den tidligere udviklingsplan ligger i [archive/ROADMAP-2026-10-04.md](archive/ROADMAP-2026-10-04.md).

## Næste skridt

1. **Tier 1-ydelse.** Lad filer med hash i navnet blive cachet i et år, og del appen op, så f.eks. diagrambiblioteket kun hentes, hvor det bruges. Opdatér også wrangler, så de sidste sårbarheder i udviklingsværktøjerne forsvinder.
2. **Kodekvalitet.** Ret først fund af typen "[object Object]" (`no-base-to-string`) og manglende sammenhæng mellem label og felt i Tier 1. Formatér de største filer én ad gangen.
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
