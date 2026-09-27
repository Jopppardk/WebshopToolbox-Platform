# Separat platformrepository – 27. september 2026

Privat destination: Jopppardk/WebshopToolbox-Platform. Historik bevaret fra platform/admin-foundation b9acb15; det oprindelige repositories nye main fc6c8cb er ikke flettet ind. Alle aktuelle platformfiler fra de publicerede dev/prod-udgaver medtages sammen med dokumentation og logo-kilder. Den tidligere klon i work/platform bevares urørt; fremtidigt arbejde sker i work/WebshopToolbox-Platform.

Ingen secrets, .wrangler-backups, lokale databaser, node_modules eller genererede klientbundter medtages. Secrets følger ikke med til GitHub Actions. Sablens deploy.yml er fjernet; kun validering ved push og manuel WebshopToolbox-udgivelse er tilbage. Historiske kildefiler og dry-run-konfiguration bevares til fælles kode og regressionstests. npm deploy:cloudflare peger nu på WebshopToolbox dev, ikke Sablen.

GitHub-udgivelse er klargjort med separate Cloudflare API-tokens i GitHub Environment dev/prod; se nedenfor. Automatisk bogføring og kundemail er fortsat blokeret. Ingen deployment, databaseflytning eller DNS-ændring udføres som del af repository-adskillelsen. Produktionskundelogin afventer stadig Cloudflare-dashboard-login som beskrevet i PRODUCTION.md.

Valideret lokalt: 349/349 eksisterende tests samt særskilt repository-regression bestået; begge typechecks, build og lokale/production/legacy dry-runs bestået. Deployment-guard accepterer den nye origin og afviser det oprindelige GitHub-repository. 757 historiske blobs og 516 aktuelle filer kontrolleret for kendte credentials/private nøgler uden fund; ignorerede runtime-/backupfiler udeladt. Push foretages som en samlet første platformcommit oven på den bevarede historik.

## Publiceret

Koden og historikken er pushet til det private repository på main som `5cf8b3e657a2393d07d817cbac00d197e5b712d8`. Origin er verificeret mod GitHub. GitHub-valideringen starter ved push; ingen deployment-workflow er startet. Den oprindelige klon og dens origin er bevaret.

## GitHub-miljøsecrets etableret

Efter brugerens godkendelse er to account-owned Cloudflare-tokens oprettet og gemt som `CLOUDFLARE_API_TOKEN` i henholdsvis GitHub Environment `dev` og `prod` i det nye private repository. Begge udløber 28. september 2027 og skal roteres inden da.

- Dev: `48c2607ad3f329215f75f7c2493bb093`, Individual Workers Editor kun for `webshop-toolbox-platform-test`.
- Prod: `daff75a1e9482dd85fd4c08cf030e388`, Individual Workers Editor kun for `webshop-toolbox-platform-production`.
- Begge har Workers Routes Write kun for zonen `webshoptoolbox.dk`. Denne zonerettighed omfatter routes i hele zonen; Worker-koderettigheden er særskilt afgrænset som ovenfor.

Verificeret: begge tokens aktive, GET af egen Workers settings giver 200, samme GET for `sablen-integrationshub` giver 403. GitHub bekræfter begge environment-secrets gemt. Overførsel skete med GitHubs public-key/sealed-box-kryptering; midlertidige tokenfiler er slettet. Ingen tokenværdier er medtaget i Git eller dokumentation. Eksisterende Sablen-token er uændret.

CI for kodecommit `5cf8b3e` og dokumentationscommit `d77eaf3` er bestået. Der er ikke startet en deployment som del af tokenopsætningen. Hele deploymentforløbet med de nye begrænsede tokens er derfor endnu ikke afprøvet; eventuelle manglende rettigheder skal vurderes konkret uden at udvide til Sablen-ressourcer. Database-, Access-, DNS- og runtimeopsætning er uændret.
