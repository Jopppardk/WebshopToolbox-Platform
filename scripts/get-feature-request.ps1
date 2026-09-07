param(
  [ValidateRange(1, 2147483647)]
  [int]$ReferenceNumber,
  [switch]$HealthCheck
)

$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$settingsPath = Join-Path $PSScriptRoot '..\.env.access.local'
if (-not (Test-Path -LiteralPath $settingsPath)) {
  throw 'Kør scripts/setup-feature-log-access.ps1 først.'
}

$settings = @{}
foreach ($line in Get-Content -LiteralPath $settingsPath) {
  if ($line -match '^([^=]+)=(.*)$') {
    $settings[$matches[1]] = $matches[2]
  }
}

$clientId = $settings['CF_ACCESS_CLIENT_ID']
$encryptedSecret = $settings['CF_ACCESS_CLIENT_SECRET_DPAPI']
if ([string]::IsNullOrWhiteSpace($clientId) -or [string]::IsNullOrWhiteSpace($encryptedSecret)) {
  throw 'Den lokale Access-konfiguration er ufuldstændig.'
}

$secureSecret = ConvertTo-SecureString $encryptedSecret
$secretPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureSecret)
try {
  $plainSecret = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($secretPointer)
  $helperPath = Join-Path $PSScriptRoot 'fetch-feature-requests.mjs'
  $json = & node $helperPath $clientId $plainSecret
  if ($LASTEXITCODE -ne 0) {
    throw "Cloudflare-forbindelsen fejlede (kode $LASTEXITCODE)."
  }
  $response = $json | ConvertFrom-Json
} finally {
  if ($secretPointer -ne [IntPtr]::Zero) {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($secretPointer)
  }
  $plainSecret = $null
}

if ($HealthCheck) {
  if ($null -eq $response.requests) {
    throw 'Udviklingsloggen returnerede ikke et gyldigt svar.'
  }
  return
}

if ($ReferenceNumber -lt 1) {
  throw 'Angiv -ReferenceNumber eller brug -HealthCheck.'
}

$request = $response.requests | Where-Object { [int]$_.reference_number -eq $ReferenceNumber } | Select-Object -First 1
if (-not $request) {
  throw "Forslag #$ReferenceNumber blev ikke fundet."
}

$request | Select-Object reference_number, title, description, desired_outcome, area, priority, status, created_by, created_at, updated_at | ConvertTo-Json -Depth 4
