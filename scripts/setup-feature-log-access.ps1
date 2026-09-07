$ErrorActionPreference = 'Stop'

$clientId = Read-Host 'Cloudflare Access Client ID'
if ([string]::IsNullOrWhiteSpace($clientId)) {
  throw 'Client ID maa ikke vaere tomt.'
}

$clientSecret = Read-Host 'Cloudflare Access Client Secret' -AsSecureString
$encryptedSecret = ConvertFrom-SecureString $clientSecret
$settingsPath = Join-Path $PSScriptRoot '..\.env.access.local'

@(
  "CF_ACCESS_CLIENT_ID=$($clientId.Trim())"
  "CF_ACCESS_CLIENT_SECRET_DPAPI=$encryptedSecret"
) | Set-Content -LiteralPath $settingsPath -Encoding utf8

Write-Host 'Adgangen er gemt krypteret til din Windows-bruger.' -ForegroundColor Green
Write-Host 'Kontrollerer forbindelsen...'
& (Join-Path $PSScriptRoot 'get-feature-request.ps1') -HealthCheck
Write-Host 'Forbindelsen virker.' -ForegroundColor Green
