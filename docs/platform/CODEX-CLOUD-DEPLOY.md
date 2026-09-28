# Deployment fra Codex Cloud

## Fast udgivelsesvej

Codex Cloud starter `.github/workflows/platform-deploy.yml` i
`Jopppardk/WebshopToolbox-Platform`. GitHub Actions udfører de eksisterende
platformscripts med de separate `CLOUDFLARE_API_TOKEN`-secrets i GitHub Environments
`dev` og `prod`. Cloudflare-tokens skal ikke kopieres til Codex Cloud.

`target=dev` betyder kontroller → dev → HTTP-efterkontrol.
`target=prod` betyder kontroller → dev → HTTP-efterkontrol → prod → HTTP-efterkontrol.
Prod springes over, hvis et tidligere trin fejler. Hele forløbet er serialiseret,
så to udgivelser ikke kan erstatte dev under hinandens produktionsgate. GitHub kan
erstatte en ventende kørsel med en nyere; kontrollér altid den konkrete kørsels status.
Et fejlet eftertjek kan betyde, at miljøet allerede er ændret. Der udføres hverken
automatisk rollback, genforsøg af deploy eller databasegendannelse.

Workflowet accepterer kun main og en fuld, godkendt `expected_sha`, som skal være
identisk med workflowets SHA. Alle jobs checker denne uforanderlige SHA ud. Main,
der flytter sig mellem bestilling og workflowstart, medfører stop før deployment.
Tests/builds/dry-runs svarer til obligatorisk CI. Migrationer kræver fortsat særskilt
backup og kontrol og indgår ikke i dette workflow.

Efterkontrollen foretager kun anonyme GET-kald: healthz med miljøets forventede
sikkerhedsflag, HTML-kundelogin, ordre-API med 401 og adminredirect til den konkrete
Access-issuer. Det er en drifts-/adgangskontrol, ikke en autentificeret leverandørpilot
eller et bevis for korrekt bogføring. Der sendes ingen mails eller økonomiske testwrites.

## Engangsopsætning i Codex Cloud

1. Brug det private repository `Jopppardk/WebshopToolbox-Platform`.
2. Opret et separat GitHub **fine-grained personal access token**, kun til dette
   repository, med **Actions: Read and write**, **Contents: Read-only** og den
   automatiske Metadata-læseadgang. Angiv en udløbsdato og forny før udløb. Tokenet
   kan starte og administrere Actions-kørsler; det har ikke kode-write eller adgang
   til at læse Cloudflare-secrets. Repoet skal bevare sine environment-beskyttelser.
3. Gem tokenet som `GH_TOKEN` under miljøets **Environment variables**, hvis du
   vælger tokenbaseret deployment fra agentfasen. Dette giver kode/agenten i miljøet
   adgang til tokenet gennem hele opgaven; brug kun miljøet til betroet platformarbejde
   og begræns hvem der kan anvende det. Indtast tokenet direkte i indstillingerne,
   aldrig i en prompt, et commit, et script eller en log. Et eksisterende, autoriseret
   `gh`-login eller `GITHUB_TOKEN` understøttes også.
4. Slå agentens internetadgang til og tillad `api.github.com` med **GET og POST**
   (UI-valget kan hedde alle HTTP-metoder). Behold de nødvendige dependency-/GitHub-
   domæner til kodearbejdet. Selve deployment og efterkontrol kører på GitHub; Cloud
   behøver derfor ikke adgang til Cloudflare API eller platformdomænerne. Hvis Cloud
   også skal foretage selvstændige HTTP-læsekontroller, tilføj præcist
   `dev.webshoptoolbox.dk` og `portal.webshoptoolbox.dk`.
5. Start en frisk Cloud-opgave efter miljøændringen og kør adgangskontrollen nedenfor.
   Gamle opgaver har ikke nødvendigvis den nye konfiguration.

**Secrets i Codex Cloud er kun tilgængelige under setup og fjernes før agentfasen.**
Et `GH_TOKEN`/`CLOUDFLARE_API_TOKEN` i Secrets løser derfor ikke adgang fra agentens
terminal. Setup må ikke kopiere secrets til `.bashrc`, disk eller logs for at omgå
denne grænse. GitHub-connectoren og en kloningsadgang er heller ikke automatisk en
`gh`-session med Actions-write.

Se [OpenAI: Cloud environments](https://learn.chatgpt.com/docs/environments/cloud-environment),
[OpenAI: internetadgang](https://learn.chatgpt.com/docs/cloud/internet-access) og
[GitHub: workflow dispatch og tokenrettigheder](https://docs.github.com/en/rest/actions/workflows#create-a-workflow-dispatch-event).

## Hver udgivelse

Cloud-ændringer skal først publiceres som branch/PR, bestå CI og merges efter
brugerens godkendelse. En lokal Cloud-commit eller klargjort PR-beskrivelse er ikke
nødvendigvis publiceret på GitHub. Hent derefter den godkendte main-SHA.

```sh
# Læser kun GitHub; ingen build eller deployment. Udskriver aktuel main-SHA.
node scripts/platform-release.mjs check

# Udskift <godkendt-40-tegns-main-sha> med den konkret godkendte version.
node scripts/platform-release.mjs dev --sha <godkendt-40-tegns-main-sha>
node scripts/platform-release.mjs prod --sha <godkendt-40-tegns-main-sha>

# Efter en bestilling: læs status på det returnerede run-ID.
node scripts/platform-release.mjs status <run-id>
```

`check` beviser læseadgang og aktivt workflow; Actions-write kan først bekræftes ved
en faktisk dispatch. Scriptet kræver Node og curl og følger Cloud-miljøets HTTPS-proxy.
Det bruger kun GitHubs API og sender tokenet til curl via stdin, ikke kommandolinjen.

`status` giver exitkode 2, mens kørslen venter/kører, 0 ved afsluttet success og 1 ved
afsluttet fejl/annullering eller læsefejl. Vent og kontrollér samme run-ID; start ikke
en ekstra deployment for at hente status. Se jobs/logs i workflowet ved fejl eller
afventende environment-godkendelse.

Ved timeout/ukendt udfald af dispatch må kaldet **ikke gentages blindt**. Find først
det udskrevne sporings-ID i [workflowets kørsler](https://github.com/Jopppardk/WebshopToolbox-Platform/actions/workflows/platform-deploy.yml).
Også ældre API-svar uden run-ID håndteres ved dette ID. Bestilt/køsat/skipped er ikke
udgivet. Dokumentér først deployment som gennemført efter grønt workflow og HTTP-gate.

## Status 28. september 2026

Implementeret på `platform/cloud-deploy`: Cloud-bestillingsscript, versionskontrol,
samlet dev→prod-workflow og læsebaserede HTTP-gates. Separate Cloudflare-miljøsecrets
var etableret og brugt succesfuldt før denne ændring; se REPOSITORY-SPLIT.md.
Testet lokalt: 384/384 tests, begge TypeScript-kontroller, begge klientbuilds,
alle tre Wrangler-dry-runs, konfigurationskontroller og `git diff --check` bestået.
Workflow-YAML er parset, og jobafhængigheder/pinnede checkouts er kontrolleret.
Den nye HTTP-kontrol er også kørt succesfuldt mod begge eksisterende miljøer med
kun læsekald. Det beviser ikke deployment af den nye procedure.

PR/CI, Cloud-miljøopsætning og første Cloud-bestilte udgivelse afventer særskilt
verifikation. Adgang bliver ikke etableret af dette dokument.
