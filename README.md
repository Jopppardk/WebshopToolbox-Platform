# WebshopToolbox Platform

Selvstændigt repository til Tier 0-administration og Tier 1-kundeportal.

- Dev: https://dev.webshoptoolbox.dk
- Prod: https://portal.webshoptoolbox.dk
- Kilde: https://github.com/Jopppardk/WebshopToolbox-Platform

Læs [projektstatus](docs/platform/PROJECT.md), [overlevering](docs/platform/HANDOVER.md) og [repository-adskillelsen](docs/platform/REPOSITORY-SPLIT.md).

## Udvikling

Node.js 22.23.2 eller nyere. Kør `npm ci`, `npm run platform:init`, `npm run platform:seed` og `npm run platform:dev` til et separat lokalt testmiljø. Fixtures er syntetiske og må ikke indlæses i produktion.

`npm test`, `npm run typecheck`, `npm run platform:tier1:typecheck`, `npm run platform:tier1:build`, `npm run test:portal` og platformens build kontrollerer løsningen.

## Udgivelse

Push deployer ikke. GitHub Actions-workflowet **Udgiv WebshopToolbox** startes manuelt på main med dev eller prod. Der skal først konfigureres en passende Cloudflare API-token som `CLOUDFLARE_API_TOKEN` i det valgte GitHub Environment. Der er ikke overført secrets fra Sablen eller lokale credentials. Migrationer kræver særskilt backup og udføres ikke automatisk.

Lokal, eksplicit udgivelse: `npm run deploy:dev` eller `npm run deploy:prod`. Begge scripts kontrollerer repository og de separate Cloudflare-ressourcer. Bogføring, automatisk kundemail og cron er fortsat blokeret.

## Forholdet til Sablen

Git-historikken er bevaret fra platformbranchen i det oprindelige repository. Den gamle Sablen-app (Next/vinext under `app/`, `db/`, `components/` m.fl., `wrangler.direct.jsonc` og Sablens driftsvejledninger) blev fjernet 6. oktober 2026; den findes fortsat i git-historikken og i det oprindelige repository. De fem fælles moduler platformen brugte, ligger nu i `platform/`, og de gamle API-ruter er fastfrosset i `lib/legacy-routes.json`, så en test sikrer, at ingen af dem svarer her. Det oprindelige repository og de kørende løsninger ændres ikke.
