# Sablen Toolbox

Den komplette produktions- og gendannelsesvejledning findes i [DRIFTSMANUAL.md](./DRIFTSMANUAL.md).

Sablen Toolbox er Sablens interne integrationsplatform til Shopify, Dinero og
tilknyttede bogførings- og dokumentflows. Produktionsmiljøet kører på Cloudflare
Workers med D1 og R2 og er tilgængeligt på `integration.sablen.dk`.

## Lokal udvikling

Krav: Node.js 22.13 eller nyere.

```bash
npm ci
npm run dev
```

Kør kvalitetstjek før en ændring sendes til GitHub:

```bash
npm test
npm run build
```

## Deployment

Push til `main` starter GitHub Actions-workflowet i
`.github/workflows/deploy.yml`. Workflowet tester og bygger først løsningen og
deployes kun derefter til Cloudflare Worker `sablen-integrationshub`.

Repositoryet skal have disse GitHub Actions-secrets:

- `CLOUDFLARE_ACCOUNT_ID`
- `CLOUDFLARE_API_TOKEN`

Integrationsnøgler til Shopify, Dinero og ViaBill må aldrig gemmes i GitHub.
De håndteres fortsat i produktionsløsningen og Cloudflare.
