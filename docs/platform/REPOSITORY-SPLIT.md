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

## 27. september 2026 – første GitHub-deployment gennemført

Begge miljøer er udgivet via det nye repositories manuelle workflow fra commit `354c194731f5c27fc46b5c25171b51a17eb9afab`:

- Dev: https://github.com/Jopppardk/WebshopToolbox-Platform/actions/runs/36341400602 – success, Worker-version `ac18c8aa-7834-4baf-8681-31213d4a7139`.
- Prod: https://github.com/Jopppardk/WebshopToolbox-Platform/actions/runs/36341619641 – success, Worker-version `c868b7f3-2e4c-4ad5-b416-a7b59585c257`.

Begge kørsler bestod 352 tests, begge typechecks, build og upload/trigger-deployment. Repository-guard accepterer nu også GitHub Actions' præcise HTTPS-origin uden `.git`; andre repositories afvises fortsat. Dev bruger nu kun custom domain `dev.webshoptoolbox.dk` og har `workers_dev=false`, ligesom prod. Den gamle workers.dev-adresse er dermed lukket. Dette undgår Wranglers kontoovergribende subdomain-opslag; API-tokenrettigheder er ikke udvidet. Produktionsvalidatorens normalisering er tilpasset samme regel.

Tidlige forsøg: første stoppet før upload af origin-kontrollen; andet uploadede dev-kode men fejlede under workers.dev-triggeropsætning; tredje stoppet af den fælles config-validering. Endelige kørsler ovenfor er begge fuldt gennemført.

Efterkontrol: dev healthz/login 200, anonymt ordre-API 401, /admin/ 302 til Access, bookkeeping/customerEmail blocked. Prod-ruter svarer fortsat 302 til den eksisterende domænedækkende Access-app; kundelogin og autentificeret brugerflow er derfor stadig ikke færdigverificeret. Denne deployment ændrede ingen Access-politikker. Ingen migrationer, økonomiske posteringer eller testmails kørt. Sablen-repository og -ressourcer er ikke ændret.
