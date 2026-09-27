# Separat platformrepository – 27. september 2026

Privat destination: Jopppardk/WebshopToolbox-Platform. Historik bevaret fra platform/admin-foundation b9acb15; det oprindelige repositories nye main fc6c8cb er ikke flettet ind. Alle aktuelle platformfiler fra de publicerede dev/prod-udgaver medtages sammen med dokumentation og logo-kilder. Den tidligere klon i work/platform bevares urørt; fremtidigt arbejde sker i work/WebshopToolbox-Platform.

Ingen secrets, .wrangler-backups, lokale databaser, node_modules eller genererede klientbundter medtages. Secrets følger ikke med til GitHub Actions. Sablens deploy.yml er fjernet; kun validering ved push og manuel WebshopToolbox-udgivelse er tilbage. Historiske kildefiler og dry-run-konfiguration bevares til fælles kode og regressionstests. npm deploy:cloudflare peger nu på WebshopToolbox dev, ikke Sablen.

GitHub-udgivelse er klargjort men kræver Cloudflare API-token i GitHub Environment dev/prod. Automatisk bogføring og kundemail er fortsat blokeret. Ingen deployment, databaseflytning eller DNS-ændring udføres som del af repository-adskillelsen. Produktionskundelogin afventer stadig Cloudflare-dashboard-login som beskrevet i PRODUCTION.md.

Valideret lokalt: 349/349 eksisterende tests samt særskilt repository-regression bestået; begge typechecks, build og lokale/production/legacy dry-runs bestået. Deployment-guard accepterer den nye origin og afviser det oprindelige GitHub-repository. 757 historiske blobs og 516 aktuelle filer kontrolleret for kendte credentials/private nøgler uden fund; ignorerede runtime-/backupfiler udeladt. Push foretages som en samlet første platformcommit oven på den bevarede historik.

## Publiceret

Koden og historikken er pushet til det private repository på main som `5cf8b3e657a2393d07d817cbac00d197e5b712d8`. Origin er verificeret mod GitHub. GitHub-valideringen starter ved push; ingen deployment-workflow er startet. Den oprindelige klon og dens origin er bevaret.
